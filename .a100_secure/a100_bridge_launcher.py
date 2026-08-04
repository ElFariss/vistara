from pathlib import Path

bridge_path = Path(__file__).with_name("a100_bridge.py")
source = bridge_path.read_text()

install_old = (
    "python -m pip install --quiet --disable-pip-version-check "
    "lightgbm holidays pyarrow scipy scikit-learn"
)
install_new = "true  # optional holidays package omitted; explicit event dates remain active"
if install_old not in source:
    raise RuntimeError("Expected dependency-install command was not found")
source = source.replace(install_old, install_new)

data_old = """test -f semi-finals/pasarpulse_data_bundle_2024-02_to_2026-07/data/processed/price_daily.csv
cp -f semi-finals/pasarpulse_data_bundle_2024-02_to_2026-07/data/processed/price_daily.csv proposed_model_run/price_daily.csv"""
data_new = """DATA_PATH=$(find . -type f -path '*/data/processed/price_daily.csv' -print -quit)
if [ -z \"$DATA_PATH\" ]; then
  DATA_PATH=$(find /home/nafisnaufal1426/adit/datathon-semi -type f -name 'price_daily.csv' -print -quit)
fi
echo \"Using price data: $DATA_PATH\"
test -n \"$DATA_PATH\"
cp -f \"$DATA_PATH\" proposed_model_run/price_daily.csv"""
if data_old not in source:
    raise RuntimeError("Expected data-path command was not found")
source = source.replace(data_old, data_new)

exec(compile(source, str(bridge_path), "exec"), globals(), globals())
