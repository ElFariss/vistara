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
mkdir -p architecture_sweep_50/results

echo '=== sweep environment ==='
date -Is
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader || true
python - <<'CHECK'
import importlib.util
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
  nohup setsid env PYTHONUNBUFFERED=1 python TEMP_pasarpulse_sweep50.py \
    --core TEMP_pasarpulse_optimizer.py \
    --panel proposed_model_run/panel_features.parquet \
    --root {remote_root} \
    --outdir architecture_sweep_50/results \
    > architecture_sweep_50/sweep.log 2>&1 < /dev/null &
  echo $! > architecture_sweep_50/sweep.pid
  sleep 8
fi

echo '=== active sweep process ==='
ps -eo pid,etime,%cpu,%mem,cmd | grep 'TEMP_pasarpulse_sweep50.py' | grep -v grep || true

echo '=== checkpoint inventory ==='
python - <<'STATUS'
from pathlib import Path
import json
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
tail -n 160 architecture_sweep_50/sweep.log 2>/dev/null || true

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
