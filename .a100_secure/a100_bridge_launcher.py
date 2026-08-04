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

copy_line = 'cp -f "$DATA_PATH" proposed_model_run/price_daily.csv'
schema_block = r'''cp -f "$DATA_PATH" proposed_model_run/price_daily.csv
python - <<'NORMALIZE'
import pandas as pd
from pathlib import Path

path = Path('proposed_model_run/price_daily.csv')
frame = pd.read_csv(path)
print('Raw price columns:', frame.columns.tolist(), flush=True)
if 'price' not in frame.columns:
    known = set([
        'date', 'province_code', 'province_name', 'commodity_code',
        'commodity_name', 'market_level', 'series_id', 'observed'
    ])
    candidates = []
    preferred = [
        'price_idr_per_kg', 'price_clean', 'price_value', 'value',
        'harga', 'harga_rp', 'median_price', 'mean_price'
    ]
    for column in frame.columns:
        lower = column.lower()
        numeric = pd.to_numeric(frame[column], errors='coerce')
        valid = numeric[(numeric > 1000) & (numeric < 500000)]
        if valid.empty:
            continue
        name_score = 0
        if column in preferred:
            name_score += 100 - preferred.index(column)
        if 'price' in lower or 'harga' in lower:
            name_score += 50
        if lower in known or lower.endswith('_id') or 'code' in lower:
            name_score -= 100
        coverage = float(valid.notna().mean())
        candidates.append((name_score, coverage, column))
    if not candidates:
        raise RuntimeError('No plausible IDR/kg price column found')
    candidates.sort(reverse=True)
    selected = candidates[0][2]
    print('Selected price column:', selected, 'candidates:', candidates[:8], flush=True)
    frame = frame.rename(columns=dict([(selected, 'price')]))
frame['price'] = pd.to_numeric(frame['price'], errors='coerce')
frame.to_csv(path, index=False)
print('Normalized rows:', len(frame), 'non-null price:', int(frame['price'].notna().sum()), flush=True)
NORMALIZE'''
if copy_line not in source:
    raise RuntimeError("Expected copied-data line was not found")
source = source.replace(copy_line, schema_block)

exec(compile(source, str(bridge_path), "exec"), globals(), globals())
