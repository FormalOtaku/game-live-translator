'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-capture-ocr-api.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('capture/OCR API smoke command timed out'));
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

test('capture/OCR API smoke command exercises source OCR and capture routes', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('秘密の原文'), false);
  assert.equal(result.stdout.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
  assert.equal(result.stdout.includes('secret-capture.png'), false);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:capture-ocr');
  assert.equal(summary.bindAddress, '127.0.0.1');
  assert.equal(Number.isInteger(summary.port), true);
  assert.deepEqual(summary.checks, [
    'server binds 127.0.0.1 on an ephemeral port',
    'GET /health reports selected localhost port',
    'capture source enumeration success and no-leak failure routes pass',
    'manual OCR success ROI fallback missing-ROI and no-leak engine failure pass',
    'capture start updates status and duplicate start is blocked',
    'capture stop updates status and idle stop is blocked',
  ]);
});
