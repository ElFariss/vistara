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
    Path(".a100_secure/meta_stack_oof.py"),
    f"{module.REMOTE_REL}/TEMP_meta_stack_oof.py",
)
command = f"""set -euo pipefail
cd {module.REMOTE_ROOT}
if [ -s proposed_gpu_v2/results/oof_predictions.csv ]; then
  echo '=== Running prior-fold-only meta models ==='
  PYTHONUNBUFFERED=1 python TEMP_meta_stack_oof.py \
    2>&1 | tee proposed_gpu_v2/results/meta_stack.log
  echo '=== Meta metrics ==='
  cat proposed_gpu_v2/results/meta_metrics.csv
else
  echo 'GPU OOF predictions are not available yet.'
fi
"""
raise SystemExit(client.execute_bash(command))
