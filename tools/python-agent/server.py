import json
import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.getenv("PY_AGENT_HOST", "0.0.0.0")
PORT = int(os.getenv("PY_AGENT_PORT", "8091"))
TOKEN = os.getenv("PY_AGENT_TOKEN", "")
TIMEOUT_SEC = float(os.getenv("PY_AGENT_TIMEOUT_SEC", "2.5"))
MAX_CODE_CHARS = int(os.getenv("PY_AGENT_MAX_CODE_CHARS", "8000"))
MAX_BODY_BYTES = int(os.getenv("PY_AGENT_MAX_BODY_BYTES", "262144"))

CHILD_RUNNER = r'''
import ast
import json
import math
import resource
import sys
import traceback

SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}

BLOCKED_CALLS = {"open", "exec", "eval", "compile", "input", "__import__", "globals", "locals", "dir"}
BLOCKED_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.Global,
    ast.Nonlocal,
    ast.With,
    ast.AsyncWith,
    ast.Try,
    ast.Raise,
    ast.ClassDef,
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.Lambda,
)


def fail(message, reason="execution_failed"):
    print(json.dumps({"ok": False, "reason": reason, "error": message}))
    sys.exit(0)


def main():
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
        mem = 256 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    except Exception:
        pass

    try:
        payload = json.load(sys.stdin)
    except Exception:
        fail("invalid_json", "bad_request")

    code = str(payload.get("code", ""))
    context = payload.get("context", {})

    if len(code) == 0:
        fail("empty_code", "bad_request")
    if len(code) > 8000:
        fail("code_too_large", "bad_request")
    if not isinstance(context, dict):
        fail("context_must_be_object", "bad_request")

    try:
        tree = ast.parse(code, mode="exec")
    except Exception as exc:
        fail(f"syntax_error: {exc}", "bad_request")

    for node in ast.walk(tree):
        if isinstance(node, BLOCKED_NODES):
            fail(f"blocked_node: {type(node).__name__}", "forbidden")

        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in BLOCKED_CALLS:
                fail(f"blocked_call: {node.func.id}", "forbidden")

        if isinstance(node, ast.Attribute) and str(getattr(node, "attr", "")).startswith("__"):
            fail("dunder_attribute_blocked", "forbidden")

    scope = {
        "__builtins__": SAFE_BUILTINS,
        "math": math,
        "context": context,
    }

    try:
        compiled = compile(tree, "<agent-python>", "exec")
        exec(compiled, scope, scope)
        result = scope.get("result")
        print(json.dumps({"ok": True, "result": result}, default=str))
    except Exception as exc:
        fail(f"runtime_error: {exc}")


if __name__ == "__main__":
    main()
'''


def execute_snippet(code, context):
    payload = json.dumps({"code": code, "context": context})
    started = time.time()

    try:
        completed = subprocess.run(
            [sys.executable, "-I", "-c", CHILD_RUNNER],
            input=payload,
            text=True,
            capture_output=True,
            timeout=TIMEOUT_SEC,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "reason": "timeout",
            "error": "python_execution_timeout",
            "runtime_ms": int((time.time() - started) * 1000),
        }

    stdout = (completed.stdout or "").strip()
    if not stdout:
        return {
            "ok": False,
            "reason": "empty_output",
            "error": (completed.stderr or "").strip()[:500],
            "runtime_ms": int((time.time() - started) * 1000),
        }

    try:
        parsed = json.loads(stdout)
    except Exception:
        return {
            "ok": False,
            "reason": "invalid_worker_output",
            "error": stdout[:500],
            "runtime_ms": int((time.time() - started) * 1000),
        }

    parsed["runtime_ms"] = int((time.time() - started) * 1000)
    return parsed


class Handler(BaseHTTPRequestHandler):
    server_version = "UMKMPythonAgent/1.0"

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {TOKEN}"

    def do_GET(self):
        if self.path == "/health":
            return self._send_json(
                200,
                {
                    "ok": True,
                    "service": "python-agent",
                    "timeout_sec": TIMEOUT_SEC,
                },
            )
        return self._send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path != "/execute":
            return self._send_json(404, {"ok": False, "error": "not_found"})

        if not self._authorized():
            return self._send_json(401, {"ok": False, "error": "unauthorized"})

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            return self._send_json(400, {"ok": False, "error": "invalid_content_length"})

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json(400, {"ok": False, "error": "invalid_json"})

        code = str(payload.get("code", ""))
        context = payload.get("context", {})

        if len(code) > MAX_CODE_CHARS:
            return self._send_json(400, {"ok": False, "error": "code_too_large"})

        result = execute_snippet(code, context)
        status = 200 if result.get("ok") else 422
        return self._send_json(status, result)

    def log_message(self, fmt, *args):
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"python-agent listening on {HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
