from pathlib import Path

probe_path = Path(__file__).with_name("a100_sweep50_probe_v3.py")
source = probe_path.read_text(encoding="utf-8")
exec(compile(source, str(probe_path), "exec"), globals(), globals())
