from __future__ import annotations

import base64
import datetime as dt
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlparse

import websocket

BASE_URL = "https://node680-ai-hub.ub.ac.id/user/nafisnaufal1426/"
REMOTE_REL = "adit/datathon-semi/pasarpulse_data_pipeline_v6"
REMOTE_ROOT = f"/home/nafisnaufal1426/{REMOTE_REL}"
TOKEN_PATH = Path("/tmp/a100-token")
RESULT_PATH = Path("/tmp/a100_pasarpulse_fast_results.zip")


class JupyterClient:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.token = token

    def request(self, method: str, endpoint: str, payload: dict | None = None):
        url = urljoin(self.base_url, endpoint)
        data = None if payload is None else json.dumps(payload).encode()
        for attempt in range(6):
            request = urllib.request.Request(
                url,
                data=data,
                method=method,
                headers={
                    "Authorization": f"token {self.token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    raw = response.read()
                return json.loads(raw) if raw else None
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")
                raise RuntimeError(
                    f"Jupyter HTTP {exc.code} for {endpoint}: {detail[:500]}"
                ) from exc
            except urllib.error.URLError:
                if attempt == 5:
                    raise
                time.sleep(2**attempt)
        raise RuntimeError("unreachable")

    def upload_file(self, local: Path, remote_relative: str) -> None:
        encoded = base64.b64encode(local.read_bytes()).decode()
        endpoint = "api/contents/" + urllib.parse.quote(remote_relative, safe="/")
        self.request(
            "PUT",
            endpoint,
            {"type": "file", "format": "base64", "content": encoded},
        )
        print(f"Uploaded {local.name} -> {remote_relative}", flush=True)

    def download_file(self, remote_relative: str, local: Path) -> None:
        endpoint = (
            "api/contents/"
            + urllib.parse.quote(remote_relative, safe="/")
            + "?content=1"
        )
        payload = self.request("GET", endpoint)
        if not payload or payload.get("type") != "file":
            raise RuntimeError(f"Remote artifact not found: {remote_relative}")
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(base64.b64decode(payload["content"]))
        print(f"Downloaded {remote_relative} -> {local}", flush=True)

    def execute_bash(self, command: str, kernel_name: str = "python3") -> int:
        kernel = self.request("POST", "api/kernels", {"name": kernel_name})
        kernel_id = kernel["id"]
        try:
            return self._execute_bash(kernel_id, command)
        finally:
            try:
                self.request("DELETE", f"api/kernels/{kernel_id}")
            except Exception as exc:
                print(f"Kernel cleanup warning: {type(exc).__name__}", flush=True)

    def _execute_bash(self, kernel_id: str, command: str) -> int:
        parsed = urlparse(self.base_url)
        session_id = uuid.uuid4().hex
        websocket_url = (
            f"wss://{parsed.netloc}{parsed.path}api/kernels/{kernel_id}/channels"
            f"?session_id={session_id}"
        )
        socket = websocket.create_connection(
            websocket_url,
            header=[f"Authorization: token {self.token}"],
            origin=f"{parsed.scheme}://{parsed.netloc}",
            sslopt={"cert_reqs": ssl.CERT_REQUIRED},
            timeout=7200,
        )
        message_id = uuid.uuid4().hex
        code = (
            "import subprocess\n"
            f"_p = subprocess.Popen(['/bin/bash', '-lc', {command!r}], "
            "stdout=subprocess.PIPE, stderr=subprocess.STDOUT, "
            "text=True, bufsize=1)\n"
            "for _line in _p.stdout:\n"
            "    print(_line, end='', flush=True)\n"
            "_p.wait()\n"
            "print(f'\\n[remote exit code: {_p.returncode}]', flush=True)\n"
        )
        message = {
            "header": {
                "msg_id": message_id,
                "username": "pasarpulse-a100-runner",
                "session": session_id,
                "date": dt.datetime.now(dt.timezone.utc).isoformat(),
                "msg_type": "execute_request",
                "version": "5.3",
            },
            "parent_header": {},
            "metadata": {},
            "content": {
                "code": code,
                "silent": False,
                "store_history": False,
                "user_expressions": {"exit_code": "_p.returncode"},
                "allow_stdin": False,
                "stop_on_error": True,
            },
            "channel": "shell",
            "buffers": [],
        }
        exit_code: int | None = None
        idle = False
        try:
            socket.send(json.dumps(message))
            while True:
                reply = json.loads(socket.recv())
                if reply.get("parent_header", {}).get("msg_id") != message_id:
                    continue
                message_type = reply.get("msg_type") or reply.get("header", {}).get(
                    "msg_type"
                )
                content = reply.get("content", {})
                if message_type == "stream":
                    print(content.get("text", ""), end="", flush=True)
                elif message_type == "error":
                    print("\n".join(content.get("traceback", [])), file=sys.stderr)
                elif message_type == "execute_reply":
                    expression = content.get("user_expressions", {}).get(
                        "exit_code", {}
                    )
                    value = expression.get("data", {}).get("text/plain")
                    exit_code = int(value) if value is not None else 1
                elif (
                    message_type == "status"
                    and content.get("execution_state") == "idle"
                ):
                    idle = True
                if idle and exit_code is not None:
                    return exit_code
        finally:
            socket.close()


def main() -> None:
    token = TOKEN_PATH.read_text().strip()
    if not token:
        raise RuntimeError("Decrypted A100 token is empty")
    client = JupyterClient(BASE_URL, token)

    client.upload_file(
        Path(".a100_secure/pasarpulse_optimizer.py"),
        f"{REMOTE_REL}/TEMP_pasarpulse_optimizer.py",
    )
    client.upload_file(
        Path(".a100_secure/pasarpulse_lgb_fast.py"),
        f"{REMOTE_REL}/TEMP_pasarpulse_lgb_fast.py",
    )

    command = f"""set -euo pipefail
cd {REMOTE_ROOT}
echo '=== A100 environment ==='
hostname
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader || true
python - <<'CHECK'
import sys
print('python', sys.executable)
for module in ['numpy', 'pandas', 'scipy', 'sklearn', 'lightgbm', 'pyarrow', 'holidays']:
    try:
        loaded = __import__(module)
        print(module, getattr(loaded, '__version__', 'ok'))
    except Exception as exc:
        print(module, 'MISSING', repr(exc))
CHECK
python -m pip install --quiet --disable-pip-version-check lightgbm holidays pyarrow scipy scikit-learn
mkdir -p proposed_model_run
test -f semi-finals/pasarpulse_data_bundle_2024-02_to_2026-07/data/processed/price_daily.csv
cp -f semi-finals/pasarpulse_data_bundle_2024-02_to_2026-07/data/processed/price_daily.csv proposed_model_run/price_daily.csv
rm -rf proposed_model_run/results
rm -f proposed_model_run/panel_features.parquet
echo '=== Starting fast paper-aligned search ==='
PYTHONUNBUFFERED=1 python TEMP_pasarpulse_lgb_fast.py \
  --core TEMP_pasarpulse_optimizer.py \
  --workdir proposed_model_run \
  2>&1 | tee proposed_model_run/a100_fast_run.log
echo '=== Metrics ==='
cat proposed_model_run/results/pooled_metrics.csv
rm -f a100_pasarpulse_fast_results.zip
zip -9 -j a100_pasarpulse_fast_results.zip \
  proposed_model_run/results/pooled_metrics.csv \
  proposed_model_run/results/fold_metrics.csv \
  proposed_model_run/results/oof_predictions.csv \
  proposed_model_run/results/feature_importance.csv \
  proposed_model_run/results/runtime_seconds.txt \
  proposed_model_run/a100_fast_run.log
"""
    return_code = client.execute_bash(command)
    if return_code != 0:
        raise SystemExit(return_code)

    client.download_file(
        f"{REMOTE_REL}/a100_pasarpulse_fast_results.zip",
        RESULT_PATH,
    )


if __name__ == "__main__":
    main()
