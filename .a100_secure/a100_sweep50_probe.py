from __future__ import annotations

import importlib.util
import json
from pathlib import Path

bridge_path = Path(__file__).with_name("a100_bridge.py")
spec = importlib.util.spec_from_file_location("a100_bridge_module", bridge_path)
bridge = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge)

payload_path = Path(__file__).with_name("pasarpulse_sweep50_payload.py")
payload_spec = importlib.util.spec_from_file_location("sweep_payload", payload_path)
payload = importlib.util.module_from_spec(payload_spec)
assert payload_spec.loader is not None
payload_spec.loader.exec_module(payload)

local_sweep = payload.materialize("/tmp/pasarpulse_sweep50.py")
source = local_sweep.read_text(encoding="utf-8")

# Override the original centroid merge with a robust implementation before main() executes.
geo_override = r'''
def add_geo_neighbor_features(panel, root):
    import json as _json
    import math as _math
    import re as _re
    from pathlib import Path as _Path

    def _norm(value):
        return _re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).strip()

    def _coordinate_points(value):
        if isinstance(value, (list, tuple)):
            if (
                len(value) >= 2
                and isinstance(value[0], (int, float))
                and isinstance(value[1], (int, float))
            ):
                yield float(value[0]), float(value[1])
            else:
                for item in value:
                    yield from _coordinate_points(item)

    candidates = list(_Path(root).rglob("*province*.geojson"))
    candidates += list(_Path(root).rglob("*provinces*.json"))
    if not candidates:
        print("Geo override: no province GeoJSON found; continuing without geo features", flush=True)
        return panel, []
    geo_path = sorted(set(candidates), key=lambda path: ("reference" not in str(path), len(str(path))))[0]
    payload = _json.loads(geo_path.read_text(encoding="utf-8"))

    province_lookup = {
        _norm(name): (str(code).zfill(2), str(name))
        for code, name in panel[["province_code", "province_name"]]
        .drop_duplicates()
        .itertuples(index=False, name=None)
    }
    rows = []
    for feature in payload.get("features", []):
        properties = feature.get("properties") or {}
        match = None
        for value in properties.values():
            normalized = _norm(value)
            if normalized in province_lookup:
                match = province_lookup[normalized]
                break
        if match is None:
            continue
        geometry = feature.get("geometry") or {}
        points = list(_coordinate_points(geometry.get("coordinates", [])))
        if not points:
            continue
        longitude = float(np.mean([point[0] for point in points]))
        latitude = float(np.mean([point[1] for point in points]))
        rows.append(
            {
                "province_code": match[0],
                "geo_longitude": longitude,
                "geo_latitude": latitude,
            }
        )
    centroids = pd.DataFrame(rows).drop_duplicates("province_code")
    print(
        f"Geo override loaded {len(centroids)} matched province centroids from {geo_path}",
        flush=True,
    )
    if len(centroids) < 20:
        print("Geo override: insufficient matched centroids; continuing without geo features", flush=True)
        return panel, []

    def _distance_km(lat1, lon1, lat2, lon2):
        radius = 6371.0088
        phi1, phi2 = _math.radians(lat1), _math.radians(lat2)
        dphi = _math.radians(lat2 - lat1)
        dlambda = _math.radians(lon2 - lon1)
        value = (
            _math.sin(dphi / 2.0) ** 2
            + _math.cos(phi1) * _math.cos(phi2) * _math.sin(dlambda / 2.0) ** 2
        )
        return 2.0 * radius * _math.asin(min(1.0, _math.sqrt(value)))

    edge_rows = []
    centroid_records = list(centroids.itertuples(index=False))
    for current in centroid_records:
        distances = []
        for neighbor in centroid_records:
            if current.province_code == neighbor.province_code:
                continue
            distance = _distance_km(
                current.geo_latitude,
                current.geo_longitude,
                neighbor.geo_latitude,
                neighbor.geo_longitude,
            )
            distances.append((distance, neighbor.province_code))
        for distance, neighbor_code in sorted(distances)[:4]:
            edge_rows.append(
                {
                    "province_code": current.province_code,
                    "neighbor_code": neighbor_code,
                    "geo_neighbor_distance_km": distance,
                    "geo_neighbor_weight": 1.0 / (25.0 + distance),
                }
            )
    edges = pd.DataFrame(edge_rows)
    source = panel[
        ["date", "province_code", "commodity_code", "market_level", "price_filled"]
    ].rename(
        columns={
            "province_code": "neighbor_code",
            "price_filled": "geo_neighbor_price",
        }
    )
    expanded = edges.merge(source, on="neighbor_code", how="left")
    expanded = expanded[expanded["geo_neighbor_price"].notna()].copy()
    expanded["geo_weighted_price"] = (
        expanded["geo_neighbor_price"] * expanded["geo_neighbor_weight"]
    )
    keys = ["date", "province_code", "commodity_code", "market_level"]
    neighbor = (
        expanded.groupby(keys, observed=True)
        .agg(
            geo_weighted_price=("geo_weighted_price", "sum"),
            geo_weight_sum=("geo_neighbor_weight", "sum"),
            geo_neighbor_std=("geo_neighbor_price", "std"),
            geo_neighbor_min=("geo_neighbor_price", "min"),
            geo_neighbor_max=("geo_neighbor_price", "max"),
            geo_mean_neighbor_distance_km=("geo_neighbor_distance_km", "mean"),
        )
        .reset_index()
    )
    neighbor["geo_neighbor_mean"] = (
        neighbor["geo_weighted_price"] / neighbor["geo_weight_sum"].replace(0.0, np.nan)
    )
    keep = keys + [
        "geo_neighbor_mean",
        "geo_neighbor_std",
        "geo_neighbor_min",
        "geo_neighbor_max",
        "geo_mean_neighbor_distance_km",
    ]
    output = panel.merge(centroids, on="province_code", how="left")
    output = output.merge(neighbor[keep], on=keys, how="left")
    output["geo_neighbor_gap"] = output["price_filled"] - output["geo_neighbor_mean"]
    output["geo_neighbor_ratio"] = (
        output["price_filled"] / output["geo_neighbor_mean"] - 1.0
    )
    output = output.sort_values(
        ["province_code", "commodity_code", "market_level", "date"]
    )
    geo_group = output.groupby(
        ["province_code", "commodity_code", "market_level"],
        observed=True,
        sort=False,
    )
    output["geo_neighbor_delta_7"] = (
        output["geo_neighbor_mean"] - geo_group["geo_neighbor_mean"].shift(7)
    )
    output["geo_neighbor_delta_14"] = (
        output["geo_neighbor_mean"] - geo_group["geo_neighbor_mean"].shift(14)
    )
    features = [
        "geo_longitude",
        "geo_latitude",
        "geo_neighbor_mean",
        "geo_neighbor_std",
        "geo_neighbor_min",
        "geo_neighbor_max",
        "geo_mean_neighbor_distance_km",
        "geo_neighbor_gap",
        "geo_neighbor_ratio",
        "geo_neighbor_delta_7",
        "geo_neighbor_delta_14",
    ]
    return output.replace([np.inf, -np.inf], np.nan), features
'''
marker = 'if __name__ == "__main__":'
if marker not in source:
    raise RuntimeError("Sweep payload main marker was not found")
source = source.replace(marker, geo_override + "\n\n" + marker, 1)
local_sweep.write_text(source, encoding="utf-8")

token = Path("/tmp/a100-token").read_text().strip()
client = bridge.JupyterClient(bridge.BASE_URL, token)
client.upload_file(local_sweep, f"{bridge.REMOTE_REL}/TEMP_pasarpulse_sweep50.py")

remote_root = bridge.REMOTE_ROOT
remote_rel = bridge.REMOTE_REL
process_pattern = (
    "^python TEMP_pasarpulse_sweep50.py --core TEMP_pasarpulse_optimizer.py "
    "--panel proposed_model_run/panel_features.parquet --root "
    f"{remote_root} --outdir architecture_sweep_50/results$"
)

command = f"""set -u
cd {remote_root}
mkdir -p architecture_sweep_50/results architecture_sweep_50/python_packages

export PYTHONPATH="$PWD/architecture_sweep_50/python_packages:${{PYTHONPATH:-}}"
if ! python -c 'import xgboost' >/dev/null 2>&1; then
  echo '=== installing XGBoost into project-local package directory ==='
  python -m pip install --quiet --target architecture_sweep_50/python_packages 'xgboost==3.0.2' || true
fi

echo '=== sweep environment ==='
date -Is
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader || true
python - <<'CHECK'
for name in ['catboost', 'xgboost', 'lightgbm', 'pandas', 'pyarrow']:
    try:
        module = __import__(name)
        print(name, getattr(module, '__version__', 'ok'))
    except Exception as exc:
        print(name, 'MISSING', repr(exc))
CHECK
python -m py_compile TEMP_pasarpulse_sweep50.py
python - <<'CATALOG'
import importlib.util, sys
spec = importlib.util.spec_from_file_location('sweep50_remote', 'TEMP_pasarpulse_sweep50.py')
module = importlib.util.module_from_spec(spec)
sys.modules['sweep50_remote'] = module
spec.loader.exec_module(module)
print('catalog_size', len(module.build_catalog()))
CATALOG

mapfile -t PIDS < <(pgrep -f {process_pattern!r} | sort -n)
if [ "${{#PIDS[@]}}" -gt 1 ]; then
  echo "Keeping oldest sweep PID ${{PIDS[0]}}"
  for PID in "${{PIDS[@]:1}}"; do
    echo "Stopping duplicate sweep PID $PID"
    kill -TERM "$PID" 2>/dev/null || true
  done
  sleep 3
fi

if [ ! -s architecture_sweep_50/results/best_model_summary.json ] && ! pgrep -f {process_pattern!r} >/dev/null; then
  echo '=== launching detached 120-architecture sweep ==='
  nohup setsid env PYTHONUNBUFFERED=1 PYTHONPATH="$PWD/architecture_sweep_50/python_packages:${{PYTHONPATH:-}}" \
    python TEMP_pasarpulse_sweep50.py \
    --core TEMP_pasarpulse_optimizer.py \
    --panel proposed_model_run/panel_features.parquet \
    --root {remote_root} \
    --outdir architecture_sweep_50/results \
    > architecture_sweep_50/sweep.log 2>&1 < /dev/null &
  echo $! > architecture_sweep_50/sweep.pid
  sleep 10
fi

echo '=== active sweep process ==='
ps -eo pid,etime,%cpu,%mem,cmd | grep 'TEMP_pasarpulse_sweep50.py' | grep -v grep || true

echo '=== checkpoint inventory ==='
python - <<'STATUS'
from pathlib import Path
import pandas as pd
root = Path('architecture_sweep_50/results')
for name in [
    'variant_catalog.csv', 'evaluations.csv', 'predictions.csv',
    'phase1_ranking.csv', 'phase2_dev_ranking.csv',
    'phase3_holdout_ranking.csv', 'final_variant_metrics.csv',
    'ensemble_holdout_metrics.csv', 'best_model_summary.json'
]:
    path = root / name
    if not path.exists():
        print(name, 'missing')
        continue
    detail = f'{{path.stat().st_size}} bytes'
    if path.suffix == '.csv':
        try:
            frame = pd.read_csv(path)
            detail += f', {{len(frame)}} rows'
        except Exception as exc:
            detail += f', unreadable {{type(exc).__name__}}'
    print(name, detail)
summary = root / 'best_model_summary.json'
if summary.exists():
    print('FINAL_SUMMARY_JSON')
    print(summary.read_text())
STATUS

echo '=== latest sweep log ==='
tail -n 180 architecture_sweep_50/sweep.log 2>/dev/null || true

if [ -s architecture_sweep_50/results/best_model_summary.json ]; then
  echo '=== packaging completed sweep ==='
  python - <<'PACKAGE'
from pathlib import Path
import shutil
source = Path('architecture_sweep_50')
archive = Path('pasarpulse_sweep50_results')
shutil.make_archive(str(archive), 'zip', root_dir=source)
print(archive.with_suffix('.zip'), archive.with_suffix('.zip').stat().st_size)
PACKAGE
fi
"""
return_code = client.execute_bash(command)
if return_code != 0:
    raise SystemExit(return_code)

try:
    client.download_file(
        f"{remote_rel}/pasarpulse_sweep50_results.zip",
        Path("/tmp/pasarpulse_sweep50_results.zip"),
    )
except RuntimeError as exc:
    text = str(exc).lower()
    if "404" not in text and "not found" not in text:
        raise
    print("Sweep result archive is not ready yet.", flush=True)
