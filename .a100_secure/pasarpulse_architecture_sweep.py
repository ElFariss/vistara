from __future__ import annotations

import gc
import importlib.util
import json
import math
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize


SEARCH_FOLDS = (1, 2, 3)
CONFIRM_FOLDS = (4, 5, 6, 7)
TOP_CANDIDATES = 14
SEED = 42


@dataclass(frozen=True)
class Variant:
    variant_id: str
    family: str
    profile: str
    target: str
    feature_stack: str
    recency: str


def load_core(path: Path):
    spec = importlib.util.spec_from_file_location("pasarpulse_core", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def generate_variants() -> list[Variant]:
    stacks = [
        "price_core",
        "price_full",
        "calendar_full",
        "graph_full",
        "hierarchy_reduced",
        "shock_volatility",
    ]
    recencies = ["all_half240", "window540_half120"]
    variants: list[Variant] = []

    # 60 base LightGBM architectures: five target formulations.
    for target in ["level", "delta", "logratio", "scaled_delta", "asinh_delta"]:
        for stack in stacks:
            for recency in recencies:
                variants.append(
                    Variant(
                        variant_id=f"LGB_L1__{target}__{stack}__{recency}",
                        family="lightgbm",
                        profile="l1_medium",
                        target=target,
                        feature_stack=stack,
                        recency=recency,
                    )
                )

    # 24 robust LightGBM architectures around the strongest target families.
    for target in ["logratio", "scaled_delta"]:
        for stack in stacks:
            for recency in recencies:
                variants.append(
                    Variant(
                        variant_id=f"LGB_HUBER__{target}__{stack}__{recency}",
                        family="lightgbm",
                        profile="huber_deep",
                        target=target,
                        feature_stack=stack,
                        recency=recency,
                    )
                )

    # 24 A100-native XGBoost architectures.
    for target in ["logratio", "scaled_delta"]:
        for stack in stacks:
            for recency in recencies:
                variants.append(
                    Variant(
                        variant_id=f"XGB_GPU__{target}__{stack}__{recency}",
                        family="xgboost_gpu",
                        profile="pseudo_huber",
                        target=target,
                        feature_stack=stack,
                        recency=recency,
                    )
                )

    # 12 A100-native CatBoost architectures.
    for stack in stacks:
        for recency in recencies:
            variants.append(
                Variant(
                    variant_id=f"CAT_GPU__logratio__{stack}__{recency}",
                    family="catboost_gpu",
                    profile="rmse_depth7",
                    target="logratio",
                    feature_stack=stack,
                    recency=recency,
                )
            )

    assert len(variants) == 120, len(variants)
    return variants


def metric_values(actual, prediction):
    actual = np.asarray(actual, dtype=float)
    prediction = np.asarray(prediction, dtype=float)
    error = prediction - actual
    denominator = np.abs(actual) + np.abs(prediction)
    return {
        "rows": int(len(actual)),
        "sum_abs_error": float(np.abs(error).sum()),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(np.sqrt(np.mean(error**2))),
        "smape": float(
            np.mean(2.0 * np.abs(error) / np.where(denominator == 0, 1, denominator))
            * 100.0
        ),
        "mean_error": float(np.mean(error)),
    }


def add_derived_features(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    price = frame["price_filled"].clip(lower=1000.0)
    derived: dict[str, pd.Series | np.ndarray] = {
        "log_price": np.log(price),
        "abs_ratio_lag_1": frame.get("ratio_lag_1", 0.0).abs(),
        "abs_ratio_lag_7": frame.get("ratio_lag_7", 0.0).abs(),
        "abs_ratio_lag_14": frame.get("ratio_lag_14", 0.0).abs(),
    }
    for window in [7, 14, 28, 56]:
        maximum = frame.get(f"roll_max_{window}")
        minimum = frame.get(f"roll_min_{window}")
        standard = frame.get(f"roll_std_{window}")
        gap = frame.get(f"mean_gap_{window}")
        if maximum is not None and minimum is not None:
            derived[f"range_{window}"] = maximum - minimum
            derived[f"range_ratio_{window}"] = (maximum - minimum) / price
        if standard is not None and gap is not None:
            derived[f"z_gap_{window}"] = gap / standard.replace(0.0, np.nan)
            derived[f"vol_ratio_{window}"] = standard / price
    if "nat_median" in frame:
        derived["price_to_nat"] = price / frame["nat_median"].clip(lower=1000.0) - 1.0
        derived["gap_nat_ratio"] = frame["gap_nat"] / price
    if "island_median" in frame:
        derived["price_to_island"] = price / frame["island_median"].clip(lower=1000.0) - 1.0
        derived["gap_island_ratio"] = frame["gap_island"] / price
    for column in [
        "spread_retail_wholesale",
        "spread_wholesale_producer",
        "spread_retail_producer",
    ]:
        if column in frame:
            derived[f"{column}_ratio_current"] = frame[column] / price
    if "ewm_7" in frame and "ewm_28" in frame:
        derived["ewm_trend_7_28"] = frame["ewm_7"] - frame["ewm_28"]
        derived["ewm_trend_7_28_ratio"] = derived["ewm_trend_7_28"] / price
    if "nat_median_delta_7" in frame and "island_median_delta_7" in frame:
        derived["peer_momentum_disagreement_7"] = (
            frame["nat_median_delta_7"] - frame["island_median_delta_7"]
        )
    frame = pd.concat([frame, pd.DataFrame(derived, index=frame.index)], axis=1)

    scale = price.clip(lower=5000.0)
    frame["target_scaled_delta"] = frame["target_delta"] / scale
    frame["target_asinh_delta"] = np.arcsinh(frame["target_delta"] / 5000.0)
    return frame.replace([np.inf, -np.inf], np.nan)


def deduplicate(items):
    return list(dict.fromkeys(items))


def feature_stacks(core, frame: pd.DataFrame) -> dict[str, list[str]]:
    categories = [column for column in core.CATEGORICAL if column in frame]
    target_calendar = [
        column
        for column in ["target_dow", "target_month", "target_doy_sin", "target_doy_cos"]
        if column in frame
    ]
    price_core = ["price_filled"]
    for lag in [1, 2, 3, 5, 7, 10, 14, 21, 28, 35, 42, 56]:
        price_core.extend(
            [f"price_lag_{lag}", f"delta_lag_{lag}", f"ratio_lag_{lag}"]
        )
    for window in [3, 5, 7, 14, 21, 28, 42, 56]:
        price_core.extend(
            [
                f"roll_mean_{window}",
                f"roll_std_{window}",
                f"mean_gap_{window}",
            ]
        )
    price_core.extend(
        [f"{prefix}_{span}" for span in [3, 7, 14, 28, 56] for prefix in ["ewm", "ewm_gap"]]
    )
    price_core = [column for column in price_core if column in frame]
    price_full = [column for column in core.PRICE_BASE if column in frame]
    calendar = [column for column in core.CALENDAR if column in frame]
    graph = [column for column in core.GRAPH if column in frame]

    hierarchy_keywords = (
        "sameprov_",
        "spread_",
        "ratio_retail_",
        "ratio_wholesale_",
        "nat_",
        "island_",
        "gap_nat",
        "gap_island",
        "price_to_",
        "peer_momentum",
    )
    hierarchy = [
        column
        for column in frame.columns
        if column.startswith(hierarchy_keywords)
    ]
    shock_keywords = (
        "abs_ratio_",
        "range_",
        "range_ratio_",
        "z_gap_",
        "vol_ratio_",
        "ewm_trend_",
        "gap_nat_ratio",
        "gap_island_ratio",
        "peer_momentum_",
    )
    shock = [
        column for column in frame.columns if column.startswith(shock_keywords)
    ]

    stacks = {
        "price_core": price_core + categories,
        "price_full": price_full + categories,
        "calendar_full": price_full + calendar + target_calendar + categories,
        "graph_full": price_full + calendar + graph + target_calendar + categories,
        "hierarchy_reduced": price_core + calendar + hierarchy + target_calendar + categories,
        "shock_volatility": price_full
        + calendar
        + graph
        + shock
        + target_calendar
        + categories,
    }
    return {
        name: [column for column in deduplicate(columns) if column in frame]
        for name, columns in stacks.items()
    }


def apply_recency(train: pd.DataFrame, origin: pd.Timestamp, name: str):
    if name == "all_half240":
        selected = train
        half_life = 240.0
        floor = 0.30
    elif name == "window540_half120":
        selected = train[train["date"] >= origin - pd.Timedelta(days=540)].copy()
        half_life = 120.0
        floor = 0.18
    else:
        raise ValueError(name)
    age = (origin - selected["date"]).dt.days.clip(lower=0).to_numpy(dtype=float)
    weights = floor + (1.0 - floor) * np.exp(-age / half_life)
    return selected, weights.astype("float32")


def target_column(target: str) -> str:
    return {
        "level": "target_price",
        "delta": "target_delta",
        "logratio": "target_logratio",
        "scaled_delta": "target_scaled_delta",
        "asinh_delta": "target_asinh_delta",
    }[target]


def inverse_target(target: str, prediction, current):
    prediction = np.asarray(prediction, dtype=float)
    current = np.asarray(current, dtype=float)
    if target == "level":
        result = prediction
    elif target == "delta":
        result = current + prediction
    elif target == "logratio":
        result = current * np.exp(np.clip(prediction, -1.15, 1.15))
    elif target == "scaled_delta":
        result = current + prediction * np.maximum(current, 5000.0)
    elif target == "asinh_delta":
        result = current + np.sinh(np.clip(prediction, -3.0, 3.0)) * 5000.0
    else:
        raise ValueError(target)
    maximum_change = np.maximum(14000.0, 0.60 * current)
    return np.clip(result, np.maximum(1000.0, current - maximum_change), current + maximum_change)


def encode_numeric(train, test, features, categorical):
    train_x = train[features].copy()
    test_x = test[features].copy()
    categorical_present = [column for column in categorical if column in features]
    for column in categorical_present:
        combined = pd.concat(
            [train_x[column], test_x[column]], ignore_index=True
        ).fillna("missing").astype(str)
        values, uniques = pd.factorize(combined, sort=True)
        split = len(train_x)
        train_x[column] = values[:split].astype("int32")
        test_x[column] = values[split:].astype("int32")
    for column in features:
        if column in categorical_present:
            continue
        train_x[column] = pd.to_numeric(train_x[column], errors="coerce").astype("float32")
        test_x[column] = pd.to_numeric(test_x[column], errors="coerce").astype("float32")
    return train_x, test_x, categorical_present


def fit_predict(variant: Variant, train, test, features, categorical, weights):
    y_column = target_column(variant.target)
    valid = train[y_column].notna()
    train = train.loc[valid].copy()
    weights = np.asarray(weights)[valid.to_numpy()]
    if train.empty:
        raise RuntimeError(f"No valid rows for {variant.variant_id}")

    if variant.family == "lightgbm":
        from lightgbm import LGBMRegressor

        train_x, test_x, cats = encode_numeric(train, test, features, categorical)
        if variant.profile == "l1_medium":
            params = dict(
                objective="regression_l1",
                n_estimators=220,
                learning_rate=0.035,
                num_leaves=31,
                max_depth=-1,
                min_child_samples=70,
                max_bin=127,
                subsample=0.88,
                colsample_bytree=0.86,
                reg_alpha=0.08,
                reg_lambda=2.5,
            )
        else:
            params = dict(
                objective="huber",
                alpha=0.82,
                n_estimators=280,
                learning_rate=0.028,
                num_leaves=47,
                max_depth=-1,
                min_child_samples=48,
                max_bin=127,
                subsample=0.86,
                colsample_bytree=0.90,
                reg_alpha=0.12,
                reg_lambda=4.0,
            )
        model = LGBMRegressor(
            **params,
            random_state=SEED,
            n_jobs=-1,
            verbosity=-1,
        )
        model.fit(
            train_x,
            train[y_column],
            sample_weight=weights,
            categorical_feature=cats,
        )
        prediction = model.predict(test_x)

    elif variant.family == "xgboost_gpu":
        from xgboost import XGBRegressor

        train_x, test_x, _ = encode_numeric(train, test, features, categorical)
        params = dict(
            objective="reg:pseudohubererror",
            n_estimators=260,
            learning_rate=0.035,
            max_depth=7,
            min_child_weight=12.0,
            subsample=0.86,
            colsample_bytree=0.86,
            reg_alpha=0.08,
            reg_lambda=4.0,
            max_bin=256,
            tree_method="hist",
            device="cuda",
            random_state=SEED,
            n_jobs=4,
        )
        try:
            model = XGBRegressor(**params)
            model.fit(train_x, train[y_column], sample_weight=weights, verbose=False)
            prediction = model.predict(test_x)
        except Exception as exc:
            print(f"XGBoost pseudo-Huber fallback: {type(exc).__name__}: {exc}", flush=True)
            params["objective"] = "reg:squarederror"
            model = XGBRegressor(**params)
            model.fit(train_x, train[y_column], sample_weight=weights, verbose=False)
            prediction = model.predict(test_x)

    elif variant.family == "catboost_gpu":
        from catboost import CatBoostRegressor

        train_x = train[features].copy()
        test_x = test[features].copy()
        cats = [column for column in categorical if column in features]
        for column in cats:
            train_x[column] = train_x[column].fillna("missing").astype(str)
            test_x[column] = test_x[column].fillna("missing").astype(str)
        numeric = [column for column in features if column not in cats]
        for column in numeric:
            train_x[column] = pd.to_numeric(train_x[column], errors="coerce").astype("float32")
            test_x[column] = pd.to_numeric(test_x[column], errors="coerce").astype("float32")
        model = CatBoostRegressor(
            loss_function="RMSE",
            eval_metric="RMSE",
            iterations=260,
            depth=7,
            learning_rate=0.055,
            l2_leaf_reg=8.0,
            random_seed=SEED,
            random_strength=0.30,
            bootstrap_type="Bernoulli",
            subsample=0.86,
            task_type="GPU",
            devices="0",
            gpu_ram_part=0.72,
            allow_writing_files=False,
            verbose=False,
        )
        model.fit(
            train_x,
            train[y_column].astype("float32"),
            cat_features=cats,
            sample_weight=weights,
        )
        prediction = model.predict(test_x)
    else:
        raise ValueError(variant.family)

    del model
    gc.collect()
    return inverse_target(variant.target, prediction, test["price_filled"])


def supervised_for_horizon(core, panel, horizon):
    frame = core.create_supervised(panel, horizon)
    frame = add_derived_features(frame)
    valid = (
        (frame["observed"] == 1)
        & (frame["target_observed"] == 1)
        & frame["target_price"].notna()
        & frame["price_filled"].notna()
    )
    return frame.loc[valid].copy()


def fold_data(supervised, origin, horizon, recency):
    train = supervised[
        (supervised["date"] < origin)
        & ((supervised["date"] + pd.Timedelta(days=horizon)) <= origin)
    ].copy()
    test = supervised[supervised["date"] == origin].copy()
    counts = train.groupby("series_id", observed=True).size()
    eligible = counts[counts >= 240].index
    train = train[train["series_id"].isin(eligible)].copy()
    test = test[test["series_id"].isin(eligible)].copy()
    train, weights = apply_recency(train, origin, recency)
    return train, test, weights


def append_csv(frame: pd.DataFrame, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, mode="a", header=not path.exists(), index=False)


def completed_variant_ids(path: Path):
    if not path.exists() or path.stat().st_size == 0:
        return set()
    frame = pd.read_csv(path, usecols=["variant_id"])
    return set(frame["variant_id"].astype(str))


def run_screen(core, panel, variants, output_directory):
    output_directory.mkdir(parents=True, exist_ok=True)
    manifest_path = output_directory / "variant_manifest.json"
    manifest_path.write_text(
        json.dumps([asdict(variant) for variant in variants], indent=2),
        encoding="utf-8",
    )
    metrics_path = output_directory / "screen_fold_metrics.csv"
    summary_path = output_directory / "screen_summary.csv"
    completed = completed_variant_ids(summary_path)
    supervised = supervised_for_horizon(core, panel, 7)
    stacks = feature_stacks(core, supervised)

    for index, variant in enumerate(variants, 1):
        if variant.variant_id in completed:
            print(f"SCREEN skip {index}/120 {variant.variant_id}", flush=True)
            continue
        started = time.time()
        rows = []
        failed = None
        for fold_id in SEARCH_FOLDS:
            origin = core.ORIGINS[fold_id - 1]
            try:
                train, test, weights = fold_data(
                    supervised, origin, 7, variant.recency
                )
                prediction = fit_predict(
                    variant,
                    train,
                    test,
                    stacks[variant.feature_stack],
                    core.CATEGORICAL,
                    weights,
                )
                row = {
                    "variant_id": variant.variant_id,
                    "family": variant.family,
                    "profile": variant.profile,
                    "target": variant.target,
                    "feature_stack": variant.feature_stack,
                    "recency": variant.recency,
                    "horizon_days": 7,
                    "fold_id": fold_id,
                    "forecast_origin": origin.date().isoformat(),
                    **metric_values(test["target_price"], prediction),
                }
                rows.append(row)
            except Exception as exc:
                failed = f"{type(exc).__name__}: {exc}"
                print(f"SCREEN failure {variant.variant_id}: {failed}", flush=True)
                break
        if rows:
            append_csv(pd.DataFrame(rows), metrics_path)
        if failed is None and len(rows) == len(SEARCH_FOLDS):
            row_frame = pd.DataFrame(rows)
            total_rows = row_frame["rows"].sum()
            pooled_mae = row_frame["sum_abs_error"].sum() / total_rows
            fold_std = float(row_frame["mae"].std(ddof=0))
            worst = float(row_frame["mae"].max())
            robustness_score = pooled_mae + 0.12 * fold_std + 0.08 * max(0.0, worst - pooled_mae)
            summary = {
                **asdict(variant),
                "status": "ok",
                "search_rows": int(total_rows),
                "search_mae": float(pooled_mae),
                "search_fold_std": fold_std,
                "search_worst_fold_mae": worst,
                "robustness_score": float(robustness_score),
                "runtime_seconds": float(time.time() - started),
                "error": "",
            }
        else:
            summary = {
                **asdict(variant),
                "status": "failed",
                "search_rows": int(sum(row["rows"] for row in rows)),
                "search_mae": np.nan,
                "search_fold_std": np.nan,
                "search_worst_fold_mae": np.nan,
                "robustness_score": np.inf,
                "runtime_seconds": float(time.time() - started),
                "error": failed or "incomplete folds",
            }
        append_csv(pd.DataFrame([summary]), summary_path)
        print(
            f"SCREEN {index}/120 {variant.variant_id} status={summary['status']} "
            f"mae={summary['search_mae']} score={summary['robustness_score']} "
            f"seconds={summary['runtime_seconds']:.1f}",
            flush=True,
        )
        progress = {
            "phase": "screen",
            "completed_variants": index,
            "total_variants": len(variants),
            "last_variant": variant.variant_id,
            "last_status": summary["status"],
            "updated_at": pd.Timestamp.utcnow().isoformat(),
        }
        (output_directory / "progress.json").write_text(
            json.dumps(progress, indent=2), encoding="utf-8"
        )


def select_candidates(summary_path: Path, variants: list[Variant]):
    summary = pd.read_csv(summary_path)
    summary = summary[summary["status"] == "ok"].sort_values("robustness_score")
    by_id = {variant.variant_id: variant for variant in variants}
    selected: list[str] = []

    def add(identifier):
        if identifier in by_id and identifier not in selected:
            selected.append(identifier)

    for identifier in summary.head(8)["variant_id"]:
        add(identifier)
    for column in ["family", "target", "feature_stack"]:
        for _, group in summary.groupby(column, observed=True):
            add(group.iloc[0]["variant_id"])
    for identifier in summary["variant_id"]:
        if len(selected) >= TOP_CANDIDATES:
            break
        add(identifier)
    return [by_id[identifier] for identifier in selected[:TOP_CANDIDATES]]


def full_completed_keys(path: Path):
    if not path.exists() or path.stat().st_size == 0:
        return set()
    frame = pd.read_csv(path, usecols=["variant_id", "horizon_days", "fold_id"])
    return {
        (str(row.variant_id), int(row.horizon_days), int(row.fold_id))
        for row in frame.itertuples(index=False)
    }


def run_full(core, panel, candidates, output_directory):
    metrics_path = output_directory / "full_fold_metrics.csv"
    predictions_path = output_directory / "full_oof_predictions.csv"
    completed = full_completed_keys(metrics_path)
    metadata_columns = [
        "series_id",
        "province_code",
        "province_name",
        "commodity_code",
        "commodity_name",
        "market_level",
        "date",
        "target_price",
        "price_filled",
    ]

    for horizon in core.HORIZONS:
        supervised = supervised_for_horizon(core, panel, horizon)
        stacks = feature_stacks(core, supervised)
        for candidate_index, variant in enumerate(candidates, 1):
            for fold_id, origin in enumerate(core.ORIGINS, 1):
                key = (variant.variant_id, int(horizon), int(fold_id))
                if key in completed:
                    continue
                started = time.time()
                train, test, weights = fold_data(
                    supervised, origin, horizon, variant.recency
                )
                prediction = fit_predict(
                    variant,
                    train,
                    test,
                    stacks[variant.feature_stack],
                    core.CATEGORICAL,
                    weights,
                )
                metric = {
                    "variant_id": variant.variant_id,
                    "family": variant.family,
                    "profile": variant.profile,
                    "target": variant.target,
                    "feature_stack": variant.feature_stack,
                    "recency": variant.recency,
                    "horizon_days": int(horizon),
                    "fold_id": int(fold_id),
                    "forecast_origin": origin.date().isoformat(),
                    "runtime_seconds": float(time.time() - started),
                    **metric_values(test["target_price"], prediction),
                }
                append_csv(pd.DataFrame([metric]), metrics_path)

                part = test[metadata_columns].copy().rename(
                    columns={
                        "date": "forecast_origin",
                        "target_price": "actual_price",
                        "price_filled": "current_price",
                    }
                )
                part["target_date"] = part["forecast_origin"] + pd.Timedelta(days=horizon)
                part["horizon_days"] = horizon
                part["fold_id"] = fold_id
                part["variant_id"] = variant.variant_id
                part["predicted_price"] = prediction
                part["absolute_error"] = np.abs(
                    part["actual_price"] - part["predicted_price"]
                )
                append_csv(part, predictions_path)
                print(
                    f"FULL h={horizon} candidate={candidate_index}/{len(candidates)} "
                    f"fold={fold_id}/7 {variant.variant_id} mae={metric['mae']:.3f}",
                    flush=True,
                )
                progress = {
                    "phase": "full",
                    "horizon_days": int(horizon),
                    "candidate_index": candidate_index,
                    "candidate_count": len(candidates),
                    "fold_id": fold_id,
                    "last_variant": variant.variant_id,
                    "updated_at": pd.Timestamp.utcnow().isoformat(),
                }
                (output_directory / "progress.json").write_text(
                    json.dumps(progress, indent=2), encoding="utf-8"
                )


def aggregate_metrics(predictions: pd.DataFrame, split_name: str, folds):
    subset = predictions[predictions["fold_id"].isin(folds)]
    rows = []
    for (variant_id, horizon), group in subset.groupby(
        ["variant_id", "horizon_days"], observed=True
    ):
        rows.append(
            {
                "split": split_name,
                "variant_id": variant_id,
                "horizon_days": int(horizon),
                "folds": int(group["fold_id"].nunique()),
                **metric_values(group["actual_price"], group["predicted_price"]),
            }
        )
    return pd.DataFrame(rows)


def optimize_weights(actual, matrix):
    count = matrix.shape[1]

    def objective(weights):
        return float(np.mean(np.abs(actual - matrix @ weights)))

    constraints = ({"type": "eq", "fun": lambda weights: weights.sum() - 1.0},)
    bounds = [(0.0, 1.0)] * count
    starts = [np.ones(count) / count]
    starts.extend(np.eye(count))
    best = None
    for start in starts:
        result = minimize(
            objective,
            start,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 400, "ftol": 1e-8},
        )
        if result.success and (best is None or result.fun < best.fun):
            best = result
    if best is None:
        weights = np.ones(count) / count
    else:
        weights = np.clip(best.x, 0.0, 1.0)
        weights /= weights.sum()
    return weights


def build_fixed_ensembles(predictions: pd.DataFrame, output_directory: Path):
    key_columns = [
        "series_id",
        "province_code",
        "province_name",
        "commodity_code",
        "commodity_name",
        "market_level",
        "forecast_origin",
        "target_date",
        "horizon_days",
        "fold_id",
        "actual_price",
        "current_price",
    ]
    ensemble_parts = []
    weight_rows = []
    for horizon, horizon_frame in predictions.groupby("horizon_days", observed=True):
        pivot = horizon_frame.pivot_table(
            index=key_columns,
            columns="variant_id",
            values="predicted_price",
            aggfunc="first",
        ).dropna(axis=1, how="any")
        names = list(pivot.columns)
        reset = pivot.reset_index()
        search_mask = reset["fold_id"].isin(SEARCH_FOLDS).to_numpy()
        matrix = pivot.to_numpy(dtype=float)
        actual = reset["actual_price"].to_numpy(dtype=float)
        if len(names) > 10:
            individual = [
                (name, float(np.mean(np.abs(actual[search_mask] - matrix[search_mask, index]))))
                for index, name in enumerate(names)
            ]
            keep = [name for name, _ in sorted(individual, key=lambda item: item[1])[:10]]
            indices = [names.index(name) for name in keep]
            names = keep
            matrix = matrix[:, indices]
        weights = optimize_weights(actual[search_mask], matrix[search_mask])
        prediction = matrix @ weights
        current = reset["current_price"].to_numpy(dtype=float)
        maximum_change = np.maximum(14000.0, 0.60 * current)
        prediction = np.clip(
            prediction,
            np.maximum(1000.0, current - maximum_change),
            current + maximum_change,
        )
        part = reset[key_columns].copy()
        part["variant_id"] = "FIXED_EARLY_FOLD_CONVEX_ENSEMBLE"
        part["predicted_price"] = prediction
        part["absolute_error"] = np.abs(part["actual_price"] - prediction)
        ensemble_parts.append(part)
        for name, weight in zip(names, weights):
            weight_rows.append(
                {
                    "horizon_days": int(horizon),
                    "variant_id": name,
                    "weight": float(weight),
                }
            )
    ensemble = pd.concat(ensemble_parts, ignore_index=True)
    ensemble.to_csv(output_directory / "fixed_ensemble_predictions.csv", index=False)
    pd.DataFrame(weight_rows).to_csv(
        output_directory / "fixed_ensemble_weights.csv", index=False
    )
    return ensemble


def finalize(output_directory: Path):
    predictions = pd.read_csv(
        output_directory / "full_oof_predictions.csv",
        parse_dates=["forecast_origin", "target_date"],
    )
    ensemble = build_fixed_ensembles(predictions, output_directory)
    combined = pd.concat([predictions, ensemble], ignore_index=True)
    metrics = pd.concat(
        [
            aggregate_metrics(combined, "search_folds_1_3", SEARCH_FOLDS),
            aggregate_metrics(combined, "confirm_folds_4_7", CONFIRM_FOLDS),
            aggregate_metrics(combined, "all_7_folds", range(1, 8)),
        ],
        ignore_index=True,
    )
    metrics = metrics.sort_values(["horizon_days", "split", "mae"])
    metrics.to_csv(output_directory / "final_metrics.csv", index=False)
    print("=== FINAL CONFIRMATION METRICS ===", flush=True)
    print(
        metrics[metrics["split"] == "confirm_folds_4_7"]
        .groupby("horizon_days", observed=True)
        .head(10)
        .to_string(index=False),
        flush=True,
    )
    (output_directory / "DONE").write_text("success\n", encoding="utf-8")
    (output_directory / "progress.json").write_text(
        json.dumps(
            {
                "phase": "done",
                "updated_at": pd.Timestamp.utcnow().isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--core", type=Path, required=True)
    parser.add_argument("--panel", type=Path, required=True)
    parser.add_argument("--outdir", type=Path, required=True)
    args = parser.parse_args()

    core = load_core(args.core)
    panel = pd.read_parquet(args.panel)
    args.outdir.mkdir(parents=True, exist_ok=True)
    variants = generate_variants()
    started = time.time()

    run_screen(core, panel, variants, args.outdir)
    candidates = select_candidates(args.outdir / "screen_summary.csv", variants)
    (args.outdir / "selected_candidates.json").write_text(
        json.dumps([asdict(candidate) for candidate in candidates], indent=2),
        encoding="utf-8",
    )
    print("=== SELECTED CANDIDATES ===", flush=True)
    for candidate in candidates:
        print(candidate.variant_id, flush=True)

    run_full(core, panel, candidates, args.outdir)
    finalize(args.outdir)
    (args.outdir / "total_runtime_seconds.txt").write_text(
        str(time.time() - started), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
