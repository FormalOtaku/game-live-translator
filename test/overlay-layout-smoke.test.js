'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const SMOKE_TEST_TIMEOUT_MS = 30000;
const REQUIRED_RESOLUTIONS = Object.freeze(['1280x720', '1920x1080', '2560x1440']);
const REQUIRED_THEMES = Object.freeze(['classic_subtitle', 'stream_box', 'minimal']);
const REQUIRED_MAX_LINES = Object.freeze([1, 2, 3]);
const SAMPLE_SENTINELS = Object.freeze([
  'Open the gate.',
  'Open the ancient gate and keep watch.',
  'The ancient gate creaks open as the hero raises a steady blade for the final trial.',
]);

function runSmokeCommand() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/smoke-overlay-layout.js'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('overlay layout smoke command timed out'));
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
  assert.equal(combined.includes('レイアウト検証用の原文'), false);
  assert.equal(combined.includes('sk-OVERLAYLAYOUTKEY1234'), false);
  assert.equal(combined.includes('layout-secret.png'), false);
  for (const sample of SAMPLE_SENTINELS) {
    assert.equal(combined.includes(sample), false);
  }
  assert.equal(/\s+at\s+\S+[^\n]*:\d+:\d+/.test(combined), false);
  assert.equal(/"debug"\s*:/.test(combined), false);
  assert.equal(/data:image\//.test(combined), false);
}

test('overlay layout smoke command verifies required OBS resolutions and themes', async () => {
  const result = await runSmokeCommand();

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assertNoSensitiveOutput(result);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.command, 'npm run smoke:overlay-layout');
  assert.equal(summary.schemaVersion, 'overlay-layout-smoke.v1');
  assert.deepEqual(summary.totals, {
    resolutions: 3,
    themes: 3,
    maxLinesCases: 3,
    layoutCases: 27,
  });
  assert.match(summary.evidence.evidenceHash, /^[a-f0-9]{16}$/);
  assert.deepEqual(Object.keys(summary.evidence.sampleHashes), ['1', '2', '3']);

  const resolutionLabels = summary.resolutions.map((entry) => entry.resolution);
  assert.deepEqual(resolutionLabels, REQUIRED_RESOLUTIONS);

  for (const resolution of summary.resolutions) {
    assert.equal(Number.isInteger(resolution.width), true);
    assert.equal(Number.isInteger(resolution.height), true);
    assert.equal(Number.isInteger(resolution.safeWidthPx), true);
    assert.equal(Number.isInteger(resolution.safeHeightPx), true);
    assert.deepEqual(resolution.themes.map((theme) => theme.themeId), REQUIRED_THEMES);

    for (const theme of resolution.themes) {
      assert.match(theme.htmlHash, /^[a-f0-9]{16}$/);
      assert.match(theme.cssHash, /^[a-f0-9]{16}$/);
      assert.equal(Number.isInteger(theme.htmlLength), true);
      assert.equal(theme.transparentViewport, true);
      assert.equal(theme.fixedRoot, true);
      assert.equal(theme.scrollbars, false);
      assert.equal(theme.externalAssets, false);
      assert.equal(theme.overflowWrapAnywhere, true);
      assert.equal(theme.textWrapBalance, true);
      assert.equal(theme.lineHeight, 1.18);
      assert.equal(Number.isInteger(theme.fontSizeResolvedPx), true);
      assert.deepEqual(theme.maxLinesCases.map((layoutCase) => layoutCase.maxLines), REQUIRED_MAX_LINES);

      for (const layoutCase of theme.maxLinesCases) {
        assert.equal(layoutCase.fitsWithinSafeArea, true);
        assert.equal(layoutCase.clipped, false);
        assert.equal(layoutCase.overlaps, false);
        assert.ok(layoutCase.usedLines >= 1);
        assert.ok(layoutCase.usedLines <= layoutCase.maxLines);
        assert.ok(layoutCase.blockWidthPx <= layoutCase.safeWidthPx);
        assert.ok(layoutCase.blockHeightPx <= layoutCase.safeHeightPx);
        assert.match(layoutCase.sampleHash, /^[a-f0-9]{16}$/);
        assert.match(layoutCase.htmlHash, /^[a-f0-9]{16}$/);
        assert.match(layoutCase.cssHash, /^[a-f0-9]{16}$/);
      }
    }
  }
});

test('overlay layout smoke exports runSmoke for deterministic reuse', () => {
  const { runSmoke } = require('../scripts/smoke-overlay-layout');
  const summary = runSmoke();

  assert.equal(summary.ok, true);
  assert.equal(summary.totals.layoutCases, 27);
  assert.deepEqual(summary.resolutions.map((entry) => entry.resolution), REQUIRED_RESOLUTIONS);
});
