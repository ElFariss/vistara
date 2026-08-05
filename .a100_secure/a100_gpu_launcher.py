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
    Path(".a100_secure/pasarpulse_optimizer.py"),
    f"{module.REMOTE_REL}/TEMP_pasarpulse_optimizer.py",
)
client.upload_file(
    Path(".a100_secure/pasarpulse_cat_gpu.py"),
    f"{module.REMOTE_REL}/TEMP_pasarpulse_cat_gpu.py",
)

command = f"""set -euo pipefail
cd {module.REMOTE_ROOT}
echo '=== GPU CatBoost environment ==='
date -Is
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader
python - <<'CHECK'
import catboost
print('catboost', catboost.__version__)
CHECK
test -s proposed_model_run/panel_features.parquet
rm -rf proposed_gpu_run
mkdir -p proposed_gpu_run/results
echo '=== Starting GPU CatBoost rolling-origin search ==='
PYTHONUNBUFFERED=1 python TEMP_pasarpulse_cat_gpu.py \
  --core TEMP_pasarpulse_optimizer.py \
  --panel proposed_model_run/panel_features.parquet \
  --outdir proposed_gpu_run/results \
  2>&1 | tee proposed_gpu_run/a100_gpu_run.log
echo '=== GPU metrics ==='
cat proposed_gpu_run/results/pooled_metrics.csv
rm -f a100_pasarpulse_gpu_results.zip
zip -9 -j a100_pasarpulse_gpu_results.zip \
  proposed_gpu_run/results/pooled_metrics.csv \
  proposed_gpu_run/results/fold_metrics.csv \
  proposed_gpu_run/results/oof_predictions.csv \
  proposed_gpu_run/results/adaptive_weights.csv \
  proposed_gpu_run/results/feature_importance.csv \
  proposed_gpu_run/results/runtime_seconds.txt \
  proposed_gpu_run/a100_gpu_run.log
"""
return_code = client.execute_bash(command)
if return_code != 0:
    raise SystemExit(return_code)

client.download_file(
    f"{module.REMOTE_REL}/a100_pasarpulse_gpu_results.zip",
    Path("/tmp/a100_pasarpulse_gpu_results.zip"),
)
