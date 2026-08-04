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
command = f"""set -u
cd {module.REMOTE_ROOT}
echo '=== deduplicate optimizer processes ==='
mapfile -t PIDS < <(pgrep -f '^python TEMP_pasarpulse_lgb_fast.py --core TEMP_pasarpulse_optimizer.py --workdir proposed_model_run$' | sort -n)
if [ "${{#PIDS[@]}}" -gt 1 ]; then
  KEEP="${{PIDS[0]}}"
  echo "Keeping oldest optimizer PID $KEEP"
  for PID in "${{PIDS[@]:1}}"; do
    echo "Terminating duplicate optimizer PID $PID"
    kill -TERM "$PID" 2>/dev/null || true
  done
  sleep 3
  for PID in "${{PIDS[@]:1}}"; do
    if kill -0 "$PID" 2>/dev/null; then
      echo "Force-killing duplicate optimizer PID $PID"
      kill -KILL "$PID" 2>/dev/null || true
    fi
  done
else
  echo "Optimizer process count: ${{#PIDS[@]}}"
fi
echo '=== active process ==='
date -Is
ps -eo pid,etime,%cpu,%mem,cmd | grep -E 'TEMP_pasarpulse_lgb_fast.py|lightgbm|catboost|xgboost' | grep -v grep || true
echo '=== GPU/package capability ==='
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader || true
python - <<'CAPABILITY'
for name in ['catboost', 'xgboost', 'torch']:
    try:
        module = __import__(name)
        print(name, getattr(module, '__version__', 'ok'))
    except Exception as exc:
        print(name, 'MISSING', repr(exc))
CAPABILITY
echo '=== cached feature panel ==='
ls -lh proposed_model_run/panel_features.parquet 2>/dev/null || true
echo '=== current log tail ==='
tail -n 120 proposed_model_run/a100_fast_run.log 2>/dev/null || true
echo '=== partial results ==='
find proposed_model_run/results -maxdepth 1 -type f -printf '%f %s bytes\n' 2>/dev/null || true
"""
raise SystemExit(client.execute_bash(command))
