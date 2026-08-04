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
echo '=== active optimizer processes ==='
date -Is
ps -eo pid,etime,%cpu,%mem,cmd | grep -E 'TEMP_pasarpulse_lgb_fast.py|TEMP_pasarpulse_cat_gpu.py|lightgbm|catboost|xgboost' | grep -v grep || true
echo '=== GPU state ==='
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader || true
echo '=== cached feature panel ==='
ls -lh proposed_model_run/panel_features.parquet 2>/dev/null || true
echo '=== CPU benchmark log tail ==='
tail -n 80 proposed_model_run/a100_fast_run.log 2>/dev/null || true
echo '=== GPU benchmark log tail ==='
tail -n 120 proposed_gpu_run/a100_gpu_run.log 2>/dev/null || true
echo '=== CPU partial results ==='
find proposed_model_run/results -maxdepth 1 -type f -printf '%f %s bytes\n' 2>/dev/null || true
echo '=== GPU partial results ==='
find proposed_gpu_run/results -maxdepth 1 -type f -printf '%f %s bytes\n' 2>/dev/null || true
"""
raise SystemExit(client.execute_bash(command))
