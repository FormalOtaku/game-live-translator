'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  CHILD_SMOKES,
  RUNBOOK_REQUIRED_COMMANDS,
  SMOKE_SCHEMA_VERSION,
  assertNoSensitiveOutput,
  buildSafeFailure,
  runCloseoutSmoke,
  validatePackageScripts,
  validateRunbook,
} = require('../scripts/smoke-first-run-closeout');

const FORBIDDEN_OUTPUT = [
  '勇者と魔王',
  'Hero and Demon King',
  'Recovered overlay subtitle',
  'Open the gate.',
  'sk-FIRSTRUNSTREAMKEY1234',
  'sk-BACKENDRECOVERYKEY1234',
  'sk-OVERLAYLAYOUTKEY1234',
  'C:\\Users\\streamer\\Pictures',
  '"cacheKey"',
  '"debugPayload"',
];

function fakeSuccessRunner(smoke) {
  assert.ok(CHILD_SMOKES.some((candidate) => candidate.id === smoke.id));
  if (smoke.id === 'first-run-stream') {
    return {
      command: smoke.command,
      ok: true,
      harness: { schemaVersion: smoke.expectedEvidenceVersion },
    };
  }
  return {
    schemaVersion: smoke.expectedEvidenceVersion,
    command: smoke.command,
    ok: true,
  };
}

test('first-run closeout smoke command executes child smokes and prints safe evidence', () => {
  const result = spawnSync(process.execPath, ['scripts/smoke-first-run-closeout.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 90_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  for (const forbidden of FORBIDDEN_OUTPUT) {
    assert.equal(
      `${result.stdout}\n${result.stderr}`.includes(forbidden),
      false,
      `closeout output leaked ${forbidden}`,
    );
  }

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.schemaVersion, SMOKE_SCHEMA_VERSION);
  assert.equal(summary.command, 'npm run smoke:first-run-closeout');
  assert.equal(summary.runbook.path, 'FIRST_RUN_STREAM_CLOSEOUT_RUNBOOK_JA.md');
  assert.equal(summary.totals.smokeCommands, 3);
  assert.equal(summary.totals.passed, 3);
  assert.equal(summary.totals.failed, 0);
  assert.equal(summary.manualGate.windowsObsHumanValidationRequired, true);
  assert.equal(summary.manualGate.reasonCode, 'WINDOWS_OBS_VISUAL_GATE');
  assert.equal(summary.privacy.rawTextPayloadsAbsent, true);
  assert.equal(summary.privacy.providerSecretsAbsent, true);
  assert.equal(summary.privacy.screenshotPathsAbsent, true);
  assert.equal(summary.privacy.stackTracesAbsent, true);
  assert.equal(summary.privacy.rawLogsAbsent, true);
  assert.equal(summary.privacy.cacheKeyValuesAbsent, true);
  assert.equal(summary.privacy.diagnosticDebugPayloadsAbsent, true);

  const ids = summary.smokeCommands.map((smoke) => smoke.id).sort();
  assert.deepEqual(ids, ['backend-recovery', 'first-run-stream', 'overlay-layout']);
  for (const smoke of summary.smokeCommands) {
    assert.equal(smoke.passed, true);
    assert.equal(smoke.exitCode, 0);
    assert.equal(smoke.executionMode, 'module');
    assert.match(smoke.summarySha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof smoke.summaryBytes, 'number');
    assert.equal(smoke.safeEvidenceOnly, true);
    assert.equal(smoke.errorCode, null);
  }
});

test('runCloseoutSmoke supports deterministic injected child runners', async () => {
  const summary = await runCloseoutSmoke({
    runner: fakeSuccessRunner,
    now: () => '2026-05-28T12:00:00.000Z',
    nowMs: (() => {
      let tick = 0;
      return () => {
        tick += 10;
        return tick;
      };
    })(),
  });

  assert.equal(summary.generatedAt, '2026-05-28T12:00:00.000Z');
  assert.equal(summary.totals.passed, 3);
  assert.equal(summary.totals.failed, 0);
  assert.equal(summary.runbook.requiredChecks, summary.runbook.passedChecks);
  assert.deepEqual(
    summary.smokeCommands.map((smoke) => smoke.childEvidenceVersion),
    CHILD_SMOKES.map((smoke) => smoke.expectedEvidenceVersion),
  );
  assertNoSensitiveOutput(summary, 'deterministic summary');
});

test('runbook and package script validators cover every closeout command', () => {
  const runbookChecks = validateRunbook();
  const packageChecks = validatePackageScripts();
  assert.equal(runbookChecks.every((check) => check.ok), true);
  assert.equal(packageChecks.every((check) => check.ok), true);

  for (const command of RUNBOOK_REQUIRED_COMMANDS) {
    assert.ok(
      runbookChecks.some((check) => check.command === command && check.ok),
      `${command} must be in the runbook checks`,
    );
  }
});

test('child output privacy guard fails without echoing raw sensitive values', () => {
  assert.throws(
    () => assertNoSensitiveOutput('provider returned sk-FIRSTRUNSTREAMKEY1234', 'probe'),
    (error) => {
      assert.equal(error.message.includes('sk-FIRSTRUNSTREAMKEY1234'), false);
      assert.match(error.message, /forbidden payload/);
      return true;
    },
  );
});

test('safe failure output redacts quoted dynamic content and stays privacy-safe', () => {
  const safe = buildSafeFailure(new Error('failed with "sk-FIRSTRUNSTREAMKEY1234"'));
  assert.equal(safe.schemaVersion, SMOKE_SCHEMA_VERSION);
  assert.equal(safe.command, 'npm run smoke:first-run-closeout');
  assert.equal(safe.ok, false);
  assert.equal(JSON.stringify(safe).includes('sk-FIRSTRUNSTREAMKEY1234'), false);
  assert.match(safe.message, /\[REDACTED\]/);
});
