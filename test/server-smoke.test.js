'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-local-api.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('server smoke command timed out'));
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

test('server smoke command exercises the localhost API and OBS overlay streams', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('秘密の原文'), false);
  assert.equal(result.stdout.includes('sk-ABCDEFGHIJKLMNOP1234'), false);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:server');
  assert.equal(summary.bindAddress, '127.0.0.1');
  assert.match(summary.overlayUrl, /^http:\/\/127\.0\.0\.1:\d+\/overlay$/);
  assert.equal(summary.overlayUrl, `http://127.0.0.1:${summary.port}/overlay`);
  assert.deepEqual(summary.checks, [
    'server binds 127.0.0.1 on an ephemeral port',
    'GET /health reports selected localhost port',
    'GET /api/status returns sanitized AppStatus',
    'GET /overlay serves self-contained privacy-safe OBS HTML',
    'non-upgrade websocket paths return retryable WS_REJECTED',
    'WS /ws/app sends sanitized AppStatus snapshot',
    'WS /ws/overlay replays latest sanitized subtitle',
    'WS /ws/app broadcasts overlay client count',
    'OverlayState publishFrame fans out to overlay and app streams',
    'OverlayState clearFrame fans out to overlay and app streams',
  ]);
});
