#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { runSmoke: runBackendRecoverySmoke } = require('./smoke-backend-recovery');
const { runSmoke: runFirstRunStreamSmoke } = require('./smoke-first-run-stream');
const { runSmoke: runOverlayLayoutSmoke } = require('./smoke-overlay-layout');

const REPO_ROOT = path.resolve(__dirname, '..');
const SMOKE_SCHEMA_VERSION = 'first-run-closeout-smoke.v1';
const COMMAND = 'npm run smoke:first-run-closeout';
const RUNBOOK_PATH = 'FIRST_RUN_STREAM_CLOSEOUT_RUNBOOK_JA.md';

const CHILD_SMOKES = Object.freeze([
  Object.freeze({
    id: 'first-run-stream',
    packageScript: 'smoke:first-run-stream',
    command: 'npm run smoke:first-run-stream',
    scriptPath: 'scripts/smoke-first-run-stream.js',
    expectedEvidenceVersion: 'synthetic-first-run-stream.v1',
    evidenceVersionPath: Object.freeze(['harness', 'schemaVersion']),
    executionMode: 'module',
  }),
  Object.freeze({
    id: 'backend-recovery',
    packageScript: 'smoke:backend-recovery',
    command: 'npm run smoke:backend-recovery',
    scriptPath: 'scripts/smoke-backend-recovery.js',
    expectedEvidenceVersion: null,
    evidenceVersionPath: Object.freeze([]),
    executionMode: 'module',
  }),
  Object.freeze({
    id: 'overlay-layout',
    packageScript: 'smoke:overlay-layout',
    command: 'npm run smoke:overlay-layout',
    scriptPath: 'scripts/smoke-overlay-layout.js',
    expectedEvidenceVersion: 'overlay-layout-smoke.v1',
    evidenceVersionPath: Object.freeze(['schemaVersion']),
    executionMode: 'module',
  }),
]);

const SMOKE_RUNNERS = Object.freeze({
  'first-run-stream': runFirstRunStreamSmoke,
  'backend-recovery': runBackendRecoverySmoke,
  'overlay-layout': runOverlayLayoutSmoke,
});

const RUNBOOK_REQUIRED_COMMANDS = Object.freeze([
  'npm run smoke:first-run-stream',
  'npm run smoke:backend-recovery',
  'npm run smoke:overlay-layout',
  'npm run smoke:first-run-closeout',
  'npm test',
  'npm run build',
  'npm run lint',
]);

const FORBIDDEN_STRINGS = Object.freeze([
  '勇者と魔王',
  'Hero and Demon King',
  'Recovered overlay subtitle',
  'Open the gate.',
  'Open the ancient gate and keep watch.',
  'The ancient gate creaks open as the hero raises a steady blade for the final trial.',
  'sk-FIRSTRUNSTREAMKEY1234',
  'sk-BACKENDRECOVERYKEY1234',
  'sk-OVERLAYLAYOUTKEY1234',
  'C:\\Users\\streamer\\Pictures\\first-run-secret.png',
  'C:\\Users\\streamer\\Pictures\\backend-recovery-secret.png',
  'C:\\Users\\streamer\\Pictures\\layout-secret.png',
]);

const FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({ id: 'provider_key', pattern: /sk-[A-Za-z0-9_-]{12,}/ }),
  Object.freeze({ id: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9._-]+/i }),
  Object.freeze({ id: 'windows_user_path', pattern: /C:\\Users\\/i }),
  Object.freeze({ id: 'stack_frame', pattern: /\bat\s+[^()\n]+\([^()\n]+:\d+:\d+\)/ }),
  Object.freeze({ id: 'cache_key_value', pattern: /cacheKey["'\s:=]+[A-Za-z0-9_.:-]+/i }),
  Object.freeze({ id: 'debug_payload_value', pattern: /debugPayload["'\s:=]+/i }),
]);

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function readText(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function assertNoSensitiveOutput(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const forbidden of FORBIDDEN_STRINGS) {
    assert.equal(text.includes(forbidden), false, `${label} leaked forbidden payload`);
  }
  for (const { id, pattern } of FORBIDDEN_PATTERNS) {
    assert.equal(pattern.test(text), false, `${label} leaked forbidden pattern ${id}`);
  }
}

function getPathValue(value, pathParts) {
  let cursor = value;
  for (const pathPart of pathParts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[pathPart];
  }
  return cursor;
}

function validatePackageScripts({ packageJson = JSON.parse(readText('package.json')) } = {}) {
  const scripts = packageJson.scripts || {};
  const checks = [];
  for (const smoke of CHILD_SMOKES) {
    const expected = `node ${smoke.scriptPath}`;
    checks.push({
      id: `script:${smoke.packageScript}`,
      command: smoke.command,
      ok: scripts[smoke.packageScript] === expected,
    });
  }
  checks.push({
    id: 'script:smoke:first-run-closeout',
    command: COMMAND,
    ok: scripts['smoke:first-run-closeout'] === 'node scripts/smoke-first-run-closeout.js',
  });
  return Object.freeze(checks.map(Object.freeze));
}

function validateRunbook({ text = readText(RUNBOOK_PATH) } = {}) {
  const commandChecks = RUNBOOK_REQUIRED_COMMANDS.map((command) => Object.freeze({
    id: `runbook-command:${command}`,
    command,
    ok: text.includes(command),
  }));
  const invariantChecks = [
    ['runbook-invariant:localhost', '127.0.0.1'],
    ['runbook-invariant:no-game-modification', 'ゲーム本体の改変'],
    ['runbook-invariant:no-file-parsing', 'ファイル解析'],
    ['runbook-invariant:no-code-injection', 'コード注入'],
    ['runbook-invariant:no-script-distribution', 'スクリプト配布'],
    ['runbook-invariant:provider-keys', 'API キー'],
    ['runbook-invariant:screenshot-paths', 'スクリーンショット'],
    ['runbook-invariant:manual-windows-obs', 'Windows 10/11 + OBS'],
  ].map(([id, needle]) => Object.freeze({ id, ok: text.includes(needle) }));
  return Object.freeze([...commandChecks, ...invariantChecks]);
}

async function runSmokeModule(smoke) {
  const runner = SMOKE_RUNNERS[smoke.id];
  assert.equal(typeof runner, 'function', `${smoke.id} smoke runner must exist`);
  return runner();
}

async function runChildSmoke(smoke, { runner = runSmokeModule, now = () => Date.now() } = {}) {
  const startedAtMs = now();
  const childSummary = await runner(smoke);
  const completedAtMs = now();
  const canonicalSummary = JSON.stringify(childSummary);

  assertNoSensitiveOutput(childSummary, smoke.id);

  const childEvidenceVersion = childSummary && smoke.evidenceVersionPath.length > 0
    ? getPathValue(childSummary, smoke.evidenceVersionPath)
    : null;
  if (smoke.expectedEvidenceVersion !== null) {
    assert.equal(
      childEvidenceVersion,
      smoke.expectedEvidenceVersion,
      `${smoke.id} evidence version must stay stable`,
    );
  }

  const passed = childSummary && childSummary.ok === true;
  return Object.freeze({
    id: smoke.id,
    command: smoke.command,
    executionMode: smoke.executionMode,
    exitCode: passed ? 0 : 1,
    passed,
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    summaryBytes: byteLength(canonicalSummary),
    summarySha256: sha256Hex(canonicalSummary),
    childEvidenceVersion: childEvidenceVersion || null,
    safeEvidenceOnly: true,
    errorCode: passed ? null : 'CHILD_SMOKE_FAILED',
  });
}

function assertChecksPass(checks, label) {
  const failed = checks.filter((check) => !check.ok);
  assert.equal(failed.length, 0, `${label} failed ${failed.length} required checks`);
}

function buildSummary({ smokeResults, runbookChecks, packageChecks, generatedAt }) {
  const passed = smokeResults.filter((result) => result.passed).length;
  const failed = smokeResults.length - passed;
  const allChecks = [...runbookChecks, ...packageChecks];
  const checksPassed = allChecks.filter((check) => check.ok).length;
  const summary = {
    schemaVersion: SMOKE_SCHEMA_VERSION,
    command: COMMAND,
    generatedAt,
    runbook: {
      path: RUNBOOK_PATH,
      sha256: sha256Hex(readText(RUNBOOK_PATH)),
      requiredChecks: allChecks.length,
      passedChecks: checksPassed,
    },
    totals: {
      smokeCommands: smokeResults.length,
      passed,
      failed,
      requiredChecks: allChecks.length,
      passedChecks: checksPassed,
    },
    manualGate: {
      windowsObsHumanValidationRequired: true,
      reasonCode: 'WINDOWS_OBS_VISUAL_GATE',
      runbookPath: RUNBOOK_PATH,
    },
    privacy: {
      rawTextPayloadsAbsent: true,
      providerSecretsAbsent: true,
      screenshotPathsAbsent: true,
      stackTracesAbsent: true,
      rawLogsAbsent: true,
      cacheKeyValuesAbsent: true,
      diagnosticDebugPayloadsAbsent: true,
    },
    smokeCommands: smokeResults,
  };
  assertNoSensitiveOutput(summary, 'closeout summary');
  return Object.freeze(summary);
}

async function runCloseoutSmoke({
  runner = runSmokeModule,
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
} = {}) {
  const runbookChecks = validateRunbook();
  const packageChecks = validatePackageScripts();
  assertChecksPass(runbookChecks, 'runbook');
  assertChecksPass(packageChecks, 'package scripts');

  const smokeResults = [];
  for (const smoke of CHILD_SMOKES) {
    smokeResults.push(await runChildSmoke(smoke, { runner, now: nowMs }));
  }
  const summary = buildSummary({
    smokeResults,
    runbookChecks,
    packageChecks,
    generatedAt: now(),
  });
  return summary;
}

function buildSafeFailure(error) {
  const code = error && error.code ? String(error.code) : 'FIRST_RUN_CLOSEOUT_FAILED';
  const message = error && error.message ? String(error.message) : 'first-run closeout failed';
  const safe = {
    schemaVersion: SMOKE_SCHEMA_VERSION,
    command: COMMAND,
    ok: false,
    code,
    message: message.replace(/".*?"/g, '"[REDACTED]"'),
  };
  assertNoSensitiveOutput(safe, 'safe failure');
  return safe;
}

async function main() {
  try {
    const summary = await runCloseoutSmoke();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(summary.totals.failed === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(buildSafeFailure(error), null, 2)}\n`);
    process.exit(1);
  }
}

module.exports = {
  CHILD_SMOKES,
  COMMAND,
  RUNBOOK_PATH,
  RUNBOOK_REQUIRED_COMMANDS,
  SMOKE_SCHEMA_VERSION,
  assertNoSensitiveOutput,
  buildSafeFailure,
  runChildSmoke,
  runCloseoutSmoke,
  runSmokeModule,
  validatePackageScripts,
  validateRunbook,
  getPathValue,
};

if (require.main === module) {
  main();
}
