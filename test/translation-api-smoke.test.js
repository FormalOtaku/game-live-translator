'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-translation-api.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('translation API smoke command timed out'));
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

test('translation API smoke command exercises translate route and status broadcast', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('勇者の秘密の翻訳原文'), false);
  assert.equal(result.stdout.includes('secret translated smoke output'), false);
  assert.equal(result.stdout.includes('secret hero glossary term'), false);
  assert.equal(result.stdout.includes('sk-TRANSLATIONSMOKEKEY1234'), false);
  assert.equal(/v1:(?:echo|deepl):en:[a-f0-9]{64}:[a-f0-9]{64}/u.test(result.stdout), false);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:translation');
  assert.equal(summary.bindAddress, '127.0.0.1');
  assert.equal(Number.isInteger(summary.port), true);
  assert.deepEqual(summary.checks, [
    'server binds 127.0.0.1 on an ephemeral port',
    'GET /health reports selected localhost port',
    'translate test preflight method and malformed requests do not mutate status',
    'missing profile returns redacted error status before provider call',
    'translate success validates result input preparation and running-ok status',
    'translate provider failure returns retryable error and running-error status',
  ]);
});
