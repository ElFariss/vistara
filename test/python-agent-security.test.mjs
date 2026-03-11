import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address && typeof address === 'object' ? address.port : 0);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHealth(url, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      // Wait for the process to start listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`python_agent_health_timeout:${url}`);
}

test('python agent fails closed when no auth token is configured', async (t) => {
  let port;
  try {
    port = await getFreePort();
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EPERM') {
      t.diagnostic(`Skipping python agent socket test in restricted environment: ${error.message}`);
      t.skip();
      return;
    }
    throw error;
  }
  const serverPath = path.resolve('tools/python-agent/server.py');
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  const child = spawn(pythonBin, [serverPath], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PY_AGENT_HOST: '127.0.0.1',
      PY_AGENT_PORT: String(port),
      PY_AGENT_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  try {
    const health = await waitForHealth(`http://127.0.0.1:${port}/health`);
    const healthPayload = await health.json();
    assert.equal(healthPayload.auth_configured, false);

    const response = await fetch(`http://127.0.0.1:${port}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: 'result = 1 + 1',
        context: {},
      }),
    });

    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error, 'agent_token_required');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }

  assert.equal(stderr.join('').trim(), '');
});
