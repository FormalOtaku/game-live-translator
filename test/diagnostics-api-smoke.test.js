'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-diagnostics-api.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('diagnostics API smoke command timed out'));
    }, SMOKE_TEST_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('diagnostics API smoke command exercises bundle route and redaction', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('秘密の診断OCR原文'), false);
  assert.equal(result.stdout.includes('secret diagnostic translated output'), false);
  assert.equal(result.stdout.includes('sk-DIAGNOSTICSMOKEKEY1234'), false);
  assert.equal(result.stdout.includes('diagnostic-secret.png'), false);
  assert.equal(result.stdout.includes('diagnostic-frame.png'), false);
  assert.equal(result.stdout.includes('provider.js'), false);
  assert.equal(result.stdout.includes('upstream diagnostics response secret'), false);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:diagnostics');
  assert.equal(summary.bindAddress, '127.0.0.1');
  assert.equal(Number.isInteger(summary.port), true);
  assert.deepEqual(summary.checks, [
    'server binds 127.0.0.1 on an ephemeral port',
    'GET /health reports selected localhost port',
    'diagnostics bundle returns a valid minimal bundle without a provider',
    'diagnostics bundle method and CORS guards avoid provider collection',
    'diagnostics bundle provider logs are redacted and validated',
    'diagnostics provider failures and invalid shapes map to redacted DIAGNOSTICS_FAILED',
  ]);
});
