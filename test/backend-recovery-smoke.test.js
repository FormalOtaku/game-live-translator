'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-backend-recovery.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('backend recovery smoke command timed out'));
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

function assertNoSensitiveOutput(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(combined.includes('再起動前の原文'), false);
  assert.equal(combined.includes('Recovered overlay subtitle'), false);
  assert.equal(combined.includes('sk-BACKENDRECOVERYKEY1234'), false);
  assert.equal(combined.includes('backend-recovery-secret.png'), false);
  assert.equal(/\s+at\s+\S+[^\n]*:\d+:\d+/.test(combined), false);
  assert.equal(/"debug"\s*:/.test(combined), false);
}

test('backend recovery smoke command exercises restart and port conflict recovery', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assertNoSensitiveOutput(result);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:backend-recovery');
  assert.equal(summary.bindAddress, '127.0.0.1');
  assert.equal(Number.isInteger(summary.preferredPort), true);
  assert.equal(summary.restartedPort, summary.preferredPort);
  assert.equal(Number.isInteger(summary.recoveredPort), true);
  assert.equal(Number.isInteger(summary.fallback.preferredPort), true);
  assert.equal(Number.isInteger(summary.fallback.selectedPort), true);
  assert.ok(summary.fallback.selectedPort > summary.fallback.preferredPort);
  assert.ok(summary.fallback.selectedPort <= summary.fallback.preferredPort + summary.fallback.maxPortAttempts - 1);
  assert.deepEqual(summary.portUnavailable, {
    code: 'PORT_UNAVAILABLE',
    retryable: true,
    details: {
      bindAddress: '127.0.0.1',
      preferredPort: summary.portUnavailable.details.preferredPort,
      maxPortAttempts: 1,
    },
  });
  assert.equal(summary.recoveredPort, summary.portUnavailable.details.preferredPort);
  assert.match(summary.evidence.initialOverlayHtmlSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.evidence.restartedOverlayHtmlSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.evidence.restartedReplayFrameEscapedTextSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.evidence.fallbackOverlayHtmlSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.evidence.recoveredOverlayHtmlSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(summary.checks, [
    'explicit preferred port starts on localhost',
    'initial backend serves status overlay and websocket replay',
    'restart reuses preferred localhost port',
    'restarted backend reports trusted status and overlay HTML',
    'restarted overlay websocket replays sanitized subtitle',
    'occupied preferred port falls back to later localhost port',
    'fallback backend reports selected localhost port',
    'exhausted port attempts return retryable PORT_UNAVAILABLE',
    'released preferred port starts after conflict clears',
  ]);
});
