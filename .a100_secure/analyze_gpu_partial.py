from __future__ import annotations

from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd


PREDICTION_PATH = Path("proposed_gpu_v2/results/oof_predictions.csv")
EXPERTS = [
    "CAT_GPU_V2_delta",
    "CAT_GPU_V2_logratio",
    "CAT_GPU_V2_level",
    "CAT_GPU_V2_last_price",
]


def mae(actual, prediction):
    return float(np.mean(np.abs(np.asarray(actual) - np.asarray(prediction))))


def sequential_bias_predictions(frame, group_columns=None, shrinkage=20.0):
    outputs = []
    for horizon, horizon_frame in frame.groupby("horizon_days", observed=True):
        for model, model_frame in horizon_frame.groupby("model", observed=True):
            model_frame = model_frame.sort_values(["fold_id", "series_id"]).copy()
            for fold_id in sorted(model_frame["fold_id"].unique()):
                current = model_frame[model_frame["fold_id"] == fold_id].copy()
                prior = model_frame[model_frame["fold_id"] < fold_id].copy()
                if prior.empty:
                    current["calibrated_prediction"] = current["predicted_price"]
                else:
                    prior = prior.assign(
                        residual=prior["actual_price"] - prior["predicted_price"]
                    )
                    global_bias = float(prior["residual"].median())
                    if group_columns:
                        grouped = (
                            prior.groupby(group_columns, observed=True)["residual"]
                            .agg(["median", "count"])
                            .reset_index()
                            .rename(columns={"median": "group_bias", "count": "group_count"})
                        )
                        current = current.merge(grouped, on=group_columns, how="left")
                        count = current["group_count"].fillna(0.0).to_numpy(dtype=float)
                        group_bias = current["group_bias"].fillna(global_bias).to_numpy(dtype=float)
                        weight = count / (count + shrinkage)
                        bias = weight * group_bias + (1.0 - weight) * global_bias
                    else:
                        bias = np.full(len(current), global_bias, dtype=float)
                    bias = np.clip(bias, -5000.0, 5000.0)
                    current["calibrated_prediction"] = np.clip(
                        current["predicted_price"].to_numpy(dtype=float) + bias,
                        1000.0,
                        500000.0,
                    )
                outputs.append(current)
    return pd.concat(outputs, ignore_index=True)


def chronological_grid_blend(frame):
    keys = [
        "series_id",
        "province_code",
        "commodity_code",
        "market_level",
        "forecast_origin",
        "target_date",
        "horizon_days",
        "fold_id",
        "actual_price",
    ]
    expert_frame = frame[frame["model"].isin(EXPERTS)].copy()
    pivot = expert_frame.pivot_table(
        index=keys,
        columns="model",
        values="predicted_price",
        aggfunc="first",
    ).reset_index()
    rows = []
    grid = []
    for delta_weight in np.arange(0.4, 1.01, 0.1):
        remaining = round(1.0 - delta_weight, 10)
        for log_weight in np.arange(0.0, remaining + 0.001, 0.1):
            for level_weight in np.arange(0.0, remaining - log_weight + 0.001, 0.1):
                last_weight = 1.0 - delta_weight - log_weight - level_weight
                if last_weight < -1e-9:
                    continue
                weights = np.array(
                    [delta_weight, log_weight, level_weight, max(0.0, last_weight)],
                    dtype=float,
                )
                weights /= weights.sum()
                grid.append(weights)
    grid = np.unique(np.round(np.asarray(grid), 8), axis=0)

    for horizon, horizon_frame in pivot.groupby("horizon_days", observed=True):
        horizon_frame = horizon_frame.sort_values(["fold_id", "series_id"])
        for fold_id in sorted(horizon_frame["fold_id"].unique()):
            current = horizon_frame[horizon_frame["fold_id"] == fold_id].copy()
            prior = horizon_frame[horizon_frame["fold_id"] < fold_id].copy()
            if prior.empty:
                weights = np.array([1.0, 0.0, 0.0, 0.0])
            else:
                prior_matrix = prior[EXPERTS].to_numpy(dtype=float)
                prior_y = prior["actual_price"].to_numpy(dtype=float)
                scores = np.mean(
                    np.abs(prior_y[:, None] - prior_matrix @ grid.T), axis=0
                )
                regularization = 35.0 * np.sum(
                    (grid - np.array([0.7, 0.1, 0.0, 0.2])) ** 2,
                    axis=1,
                )
                weights = grid[np.argmin(scores + regularization)]
            prediction = current[EXPERTS].to_numpy(dtype=float) @ weights
            current["predicted_price"] = np.clip(prediction, 1000.0, 500000.0)
            current["model"] = "CHRONOLOGICAL_REGULARIZED_GRID_BLEND"
            current["weights"] = ",".join(f"{value:.2f}" for value in weights)
            rows.append(current)
    return pd.concat(rows, ignore_index=True)


def summarize(frame, label):
    rows = []
    for (model, horizon), group in frame.groupby(
        ["model", "horizon_days"], observed=True
    ):
        rows.append(
            dict(
                candidate=label,
                model=model,
                horizon_days=int(horizon),
                folds=int(group["fold_id"].nunique()),
                rows=len(group),
                mae=mae(group["actual_price"], group["predicted_price"]),
                mean_error=float(
                    np.mean(group["predicted_price"] - group["actual_price"])
                ),
            )
        )
    return pd.DataFrame(rows)


def main():
    if not PREDICTION_PATH.exists():
        print("No GPU V2 predictions yet")
        return
    frame = pd.read_csv(PREDICTION_PATH)
    summaries = [summarize(frame, "raw")]

    global_calibrated = sequential_bias_predictions(frame)
    global_calibrated = global_calibrated.rename(
        columns={"predicted_price": "raw_prediction"}
    )
    global_calibrated["predicted_price"] = global_calibrated[
        "calibrated_prediction"
    ]
    summaries.append(summarize(global_calibrated, "prior_global_median_bias"))

    hierarchical = sequential_bias_predictions(
        frame,
        group_columns=["commodity_code", "market_level"],
        shrinkage=20.0,
    )
    hierarchical = hierarchical.rename(
        columns={"predicted_price": "raw_prediction"}
    )
    hierarchical["predicted_price"] = hierarchical["calibrated_prediction"]
    summaries.append(
        summarize(hierarchical, "prior_commodity_market_bias_shrink20")
    )

    blend = chronological_grid_blend(frame)
    summaries.append(summarize(blend, "chronological_regularized_grid"))

    summary = pd.concat(summaries, ignore_index=True)
    summary = summary.sort_values(["horizon_days", "mae", "candidate", "model"])
    print("=== Leakage-safe post-processing diagnostics ===")
    print(summary.to_string(index=False))

    print("=== Per-fold raw GPU V2 MAE ===")
    per_fold = (
        frame.groupby(["model", "horizon_days", "fold_id"], observed=True)
        .apply(
            lambda group: pd.Series(
                dict(
                    mae=mae(group["actual_price"], group["predicted_price"]),
                    mean_error=float(
                        np.mean(
                            group["predicted_price"] - group["actual_price"]
                        )
                    ),
                )
            ),
            include_groups=False,
        )
        .reset_index()
        .sort_values(["horizon_days", "fold_id", "mae"])
    )
    print(per_fold.to_string(index=False))


if __name__ == "__main__":
    main()
