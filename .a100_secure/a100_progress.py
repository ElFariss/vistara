from __future__ import annotations

import runpy
import shutil
from pathlib import Path

probe = Path(__file__).with_name("a100_sweep50_probe.py")
exit_code = 0
try:
    runpy.run_path(str(probe), run_name="__main__")
except SystemExit as exc:
    exit_code = int(exc.code or 0)
finally:
    sweep_archive = Path("/tmp/pasarpulse_sweep50_results.zip")
    compatibility_archive = Path("/tmp/a100_pasarpulse_gpu_v2_results.zip")
    if sweep_archive.exists():
        shutil.copy2(sweep_archive, compatibility_archive)
        print(
            f"Compatibility artifact: {compatibility_archive} "
            f"({compatibility_archive.stat().st_size} bytes)",
            flush=True,
        )

raise SystemExit(exit_code)
