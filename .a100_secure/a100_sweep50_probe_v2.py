from pathlib import Path

probe_path = Path(__file__).with_name("a100_sweep50_probe.py")
source = probe_path.read_text(encoding="utf-8")
old = '''export PYTHONPATH="$PWD/architecture_sweep_50/python_packages:${PYTHONPATH:-}"
if ! python -c 'import xgboost' >/dev/null 2>&1; then
  echo '=== installing XGBoost into project-local package directory ==='
  python -m pip install --quiet --target architecture_sweep_50/python_packages 'xgboost==3.0.2' || true
fi'''
new = '''echo '=== cleaning incompatible transitive packages from local target ==='
rm -rf architecture_sweep_50/python_packages/numpy* \\
       architecture_sweep_50/python_packages/scipy* \\
       architecture_sweep_50/python_packages/pandas*
export PYTHONPATH="$PWD/architecture_sweep_50/python_packages:${PYTHONPATH:-}"
if ! python -c 'import xgboost' >/dev/null 2>&1; then
  echo '=== installing dependency-free XGBoost wheel into project-local directory ==='
  python -m pip install --quiet --no-deps --upgrade \\
    --target architecture_sweep_50/python_packages 'xgboost==3.0.2' || true
fi'''
if old not in source:
    raise RuntimeError("Expected XGBoost installation block was not found")
source = source.replace(old, new, 1)
exec(compile(source, str(probe_path), "exec"), globals(), globals())
