from pathlib import Path

bridge_path = Path(__file__).with_name("a100_bridge.py")
source = bridge_path.read_text()
old = (
    "python -m pip install --quiet --disable-pip-version-check "
    "lightgbm holidays pyarrow scipy scikit-learn"
)
new = "python -m pip install --user --quiet --disable-pip-version-check holidays"
if old not in source:
    raise RuntimeError("Expected dependency-install command was not found")
source = source.replace(old, new)
exec(compile(source, str(bridge_path), "exec"), globals(), globals())
