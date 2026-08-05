from __future__ import annotations

import importlib.util
from pathlib import Path

bridge_path = Path(__file__).with_name("a100_bridge.py")
spec = importlib.util.spec_from_file_location("a100_bridge_module", bridge_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

token = Path("/tmp/a100-token").read_text().strip()
client = module.JupyterClient(module.BASE_URL, token)
client.upload_file(
    Path(".a100_secure/pasarpulse_cat_gpu_v2.py"),
    f"{module.REMOTE_REL}/TEMP_pasarpulse_cat_gpu_v2.py",
)
client.upload_file(
    Path(".a100_secure/analyze_gpu_partial.py"),
    f"{module.REMOTE_REL}/TEMP_analyze_gpu_partial.py",
)

command = f"""set -u
cd {module.REMOTE_ROOT}

deduplicate() {{
  local pattern="$1"
  local label="$2"
  mapfile -t PIDS < <(pgrep -f "$pattern" | sort -n)
  if [ "${{#PIDS[@]}}" -gt 1 ]; then
    echo "Keeping oldest $label PID ${{PIDS[0]}}"
    for PID in "${{PIDS[@]:1}}"; do
      echo "Terminating duplicate $label PID $PID"
      kill -TERM "$PID" 2>/dev/null || true
    done
    sleep 3
    for PID in "${{PIDS[@]:1}}"; do
      if kill -0 "$PID" 2>/dev/null; then
        echo "Force-killing duplicate $label PID $PID"
        kill -KILL "$PID" 2>/dev/null || true
      fi
    done
  else
    echo "$label process count: ${{#PIDS[@]}}"
  fi
}}

CPU_PATTERN='^python TEMP_pasarpulse_lgb_fast.py --core TEMP_pasarpulse_optimizer.py --workdir proposed_model_run$'
GPU_V2_PATTERN='^python TEMP_pasarpulse_cat_gpu_v2.py --core TEMP_pasarpulse_optimizer.py --panel proposed_model_run/panel_features.parquet --outdir proposed_gpu_v2/results$'

echo '=== deduplicate optimizer processes ==='
deduplicate "$CPU_PATTERN" 'CPU optimizer'
deduplicate "$GPU_V2_PATTERN" 'GPU V2 optimizer'

if [ ! -f proposed_gpu_v2/DONE ] && ! pgrep -f "$GPU_V2_PATTERN" >/dev/null; then
  echo '=== launching detached checkpointed GPU V2 benchmark ==='
  mkdir -p proposed_gpu_v2/results
  nohup setsid /bin/bash -lc \
    "exec env PYTHONUNBUFFERED=1 python TEMP_pasarpulse_cat_gpu_v2.py --core TEMP_pasarpulse_optimizer.py --panel proposed_model_run/panel_features.parquet --outdir proposed_gpu_v2/results" \
    > proposed_gpu_v2/a100_gpu_v2.log 2>&1 < /dev/null &
  echo $! > proposed_gpu_v2/launcher.pid
  sleep 5
fi

echo '=== active optimizer processes ==='
date -Is
ps -eo pid,etime,%cpu,%mem,cmd | grep -E 'TEMP_pasarpulse_lgb_fast.py|TEMP_pasarpulse_cat_gpu_v2.py|lightgbm|catboost|xgboost' | grep -v grep || true
echo '=== GPU state ==='
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader || true
echo '=== cached feature panel ==='
ls -lh proposed_model_run/panel_features.parquet 2>/dev/null || true
echo '=== CPU benchmark log tail ==='
tail -n 80 proposed_model_run/a100_fast_run.log 2>/dev/null || true
echo '=== GPU V2 benchmark log tail ==='
tail -n 160 proposed_gpu_v2/a100_gpu_v2.log 2>/dev/null || true
echo '=== CPU partial results ==='
find proposed_model_run/results -maxdepth 1 -type f -printf '%f %s bytes\n' 2>/dev/null || true
echo '=== GPU V2 partial results ==='
find proposed_gpu_v2/results -maxdepth 1 -type f -printf '%f %s bytes\n' 2>/dev/null || true
if [ -f proposed_gpu_v2/results/pooled_metrics_partial.csv ]; then
  echo '=== GPU V2 partial pooled table ==='
  cat proposed_gpu_v2/results/pooled_metrics_partial.csv
  echo '=== GPU V2 leakage-safe calibration diagnostics ==='
  python TEMP_analyze_gpu_partial.py || true
fi
if [ -f proposed_gpu_v2/results/pooled_metrics.csv ]; then
  echo '=== GPU V2 final pooled table ==='
  cat proposed_gpu_v2/results/pooled_metrics.csv
fi
if [ -f proposed_gpu_v2/DONE ]; then
  echo '=== Packaging completed GPU V2 benchmark ==='
  python TEMP_analyze_gpu_partial.py > proposed_gpu_v2/results/leakage_safe_diagnostics.txt 2>&1 || true
  rm -f a100_pasarpulse_gpu_v2_results.zip
  zip -9 -j a100_pasarpulse_gpu_v2_results.zip \
    proposed_gpu_v2/results/pooled_metrics.csv \
    proposed_gpu_v2/results/fold_metrics.csv \
    proposed_gpu_v2/results/oof_predictions.csv \
    proposed_gpu_v2/results/adaptive_weights.csv \
    proposed_gpu_v2/results/feature_importance.csv \
    proposed_gpu_v2/results/runtime_seconds.txt \
    proposed_gpu_v2/results/leakage_safe_diagnostics.txt \
    proposed_gpu_v2/a100_gpu_v2.log
fi
"""
return_code = client.execute_bash(command)
if return_code != 0:
    raise SystemExit(return_code)

try:
    client.download_file(
        f"{module.REMOTE_REL}/a100_pasarpulse_gpu_v2_results.zip",
        Path("/tmp/a100_pasarpulse_gpu_v2_results.zip"),
    )
except RuntimeError as exc:
    if "404" not in str(exc) and "not found" not in str(exc).lower():
        raise
    print("GPU V2 final bundle is not ready yet.", flush=True)
