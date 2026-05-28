'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-first-run-stream.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('first-run stream smoke command timed out'));
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

test('first-run stream smoke command exercises synthetic pipeline through localhost overlay', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('勇者と魔王'), false);
  assert.equal(result.stdout.includes('Hero and Demon King'), false);
  assert.equal(result.stdout.includes('sk-FIRSTRUNSTREAMKEY1234'), false);
  assert.equal(result.stdout.includes('first-run-secret.png'), false);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:first-run-stream');
  assert.equal(summary.bindAddress, '127.0.0.1');
  assert.match(summary.overlayUrl, /^http:\/\/127\.0\.0\.1:\d+\/overlay$/);
  assert.equal(summary.overlayUrl, `http://127.0.0.1:${summary.port}/overlay`);
  assert.equal(summary.harness.schemaVersion, 'synthetic-first-run-stream.v1');
  assert.equal(summary.harness.stage, 'overlay');
  assert.equal(summary.harness.withinBudget, true);
  assert.equal(summary.harness.overlayPublished, true);
  assert.equal(summary.harness.subtitle.id, 'first-run-subtitle');
  assert.match(summary.harness.subtitle.translatedTextSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.harness.subtitle.escapedTextSha256, /^[a-f0-9]{64}$/);
  assert.equal(summary.harness.privacy.sourceTextIncluded, false);
  assert.equal(summary.harness.privacy.translatedTextIncluded, false);
  assert.equal(summary.harness.privacy.imagesIncluded, false);
  assert.equal(summary.harness.privacy.apiKeysIncluded, false);
  assert.equal(summary.harness.privacy.persistenceUsed, false);
  assert.match(summary.evidence.overlayHtmlSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.evidence.liveFrameEscapedTextSha256, /^[a-f0-9]{64}$/);
  assert.match(summary.evidence.replayFrameEscapedTextSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(summary.checks, [
    'server binds localhost and reports OBS overlay URL',
    'GET /health reports selected localhost port',
    'initial GET /api/status is sanitized and empty',
    'WS /ws/app sends empty sanitized snapshot',
    'WS /ws/app broadcasts overlay client count',
    'synthetic OCR translation pipeline publishes overlay frame',
    'WS /ws/overlay receives live sanitized subtitle',
    'WS /ws/app broadcasts subtitle status',
    'post-publish GET /api/status exposes latest sanitized subtitle',
    'GET /overlay serves self-contained visible subtitle HTML',
    'late WS /ws/overlay replays latest sanitized subtitle',
  ]);
});
