import test from 'node:test';
import assert from 'node:assert/strict';
import { runPythonSnippet } from '../src/services/pythonRuntime.mjs';

test('python runtime returns disabled when PYTHON_AGENT_URL is not configured', async () => {
  const result = await runPythonSnippet({
    code: 'result = 1 + 1',
    context: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'disabled');
});
