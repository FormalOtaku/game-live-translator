'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { ContractError } = require('../src/contracts/security');
const { OverlayState } = require('../src/core/subtitle-state');
const {
  SCHEMA_VERSION,
  DEFAULT_MAX_DURATION_MS,
  SYNTHETIC_OCR_CANDIDATE,
  FAILURE_REASONS,
  PRIVACY_GUARANTEES,
  runSyntheticFirstRunStream,
} = require('../src/core/synthetic-first-run-stream');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const FIXED_TIME_MS = Date.parse(FIXED_TIME);

function fixedClock(value = FIXED_TIME) {
  return () => value;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function deterministicProvider({ name = 'echo', translatedText = 'Hero and Demon King', error } = {}) {
  const calls = [];
  const provider = Object.freeze({
    name,
    async translate(input) {
      calls.push(input);
      if (error) throw error;
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText,
        provider: name,
        durationMs: 4,
        cacheHit: false,
      });
    },
  });
  return { provider, calls };
}

function baseProfile(overrides = {}) {
  return {
    id: 'first-run-profile',
    translationProvider: 'echo',
    targetLang: 'en',
    ocrConfidenceFloor: 0.6,
    themeId: 'stream_box',
    subtitleDisplayMs: 4000,
    glossary: [],
    ...overrides,
  };
}

test('synthetic OCR candidate is frozen and contains a Japanese source string', () => {
  assert.equal(Object.isFrozen(SYNTHETIC_OCR_CANDIDATE), true);
  assert.equal(typeof SYNTHETIC_OCR_CANDIDATE.text, 'string');
  assert.ok(SYNTHETIC_OCR_CANDIDATE.text.length > 0);
  assert.match(SYNTHETIC_OCR_CANDIDATE.text, /[぀-ヿ一-鿿]/);
  assert.equal(SYNTHETIC_OCR_CANDIDATE.confidence >= 0.6, true);
});

test('runSyntheticFirstRunStream publishes English subtitle to overlay within budget', async () => {
  const { provider, calls } = deterministicProvider({ translatedText: 'Hero and Demon King' });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile(),
    provider,
    clock: fixedClock(),
    idFactory: () => 'first-run-subtitle',
  });

  assert.equal(summary.schemaVersion, SCHEMA_VERSION);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(summary.profileId, 'first-run-profile');
  assert.equal(summary.provider, 'echo');
  assert.equal(summary.targetLang, 'en');
  assert.equal(summary.themeId, 'stream_box');
  assert.equal(summary.stage, 'overlay');
  assert.equal(summary.overlayPublished, true);
  assert.equal(summary.failure, null);
  assert.equal(summary.withinBudget, true);
  assert.equal(summary.durationMs, 0);
  assert.equal(summary.maxDurationMs, DEFAULT_MAX_DURATION_MS);
  assert.equal(summary.startedAt, FIXED_TIME);
  assert.equal(summary.completedAt, FIXED_TIME);

  assert.equal(Object.isFrozen(summary.subtitle), true);
  assert.equal(summary.subtitle.id, 'first-run-subtitle');
  assert.equal(summary.subtitle.provider, 'echo');
  assert.equal(summary.subtitle.themeId, 'stream_box');
  assert.equal(summary.subtitle.displayMs, 4000);
  assert.equal(summary.subtitle.createdAt, FIXED_TIME);
  assert.equal(summary.subtitle.translatedTextSha256, sha256Hex('Hero and Demon King'));
  assert.equal(summary.subtitle.escapedTextSha256, sha256Hex('Hero and Demon King'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetLang, 'en');
  assert.equal(calls[0].sourceText, SYNTHETIC_OCR_CANDIDATE.text);
});

test('runSyntheticFirstRunStream publishes into an injected OverlayState', async () => {
  const { provider } = deterministicProvider({ translatedText: 'Hero and Demon King' });
  const overlayState = new OverlayState({ clock: fixedClock() });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile(),
    provider,
    overlayState,
    clock: fixedClock(),
    idFactory: () => 'first-run-shared-state',
  });

  const latest = overlayState.latestFrame();
  assert.notEqual(latest, null);
  assert.equal(summary.overlayPublished, true);
  assert.equal(summary.subtitle.id, 'first-run-shared-state');
  assert.equal(latest.id, 'first-run-shared-state');
  assert.equal(latest.escapedText, 'Hero and Demon King');
  assert.equal(Object.hasOwn(latest, 'sourceText'), false);
});

test('summary never exposes source text, translated text, images, api keys, or debug payloads', async () => {
  const { provider } = deterministicProvider({ translatedText: 'The hero and the demon king' });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile(),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-privacy',
    maxDurationMs: 60_000,
  });

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(SYNTHETIC_OCR_CANDIDATE.text), false);
  assert.equal(serialized.includes('The hero'), false);
  assert.equal(serialized.includes('demon king'), false);
  assert.equal(serialized.includes('screenshotPath'), false);
  assert.equal(serialized.includes('imagePath'), false);
  assert.equal(serialized.includes('.png'), false);
  assert.equal(serialized.includes('.jpg'), false);
  assert.equal(Object.hasOwn(summary, 'sourceText'), false);
  assert.equal(Object.hasOwn(summary, 'translatedText'), false);
  assert.equal(Object.hasOwn(summary, 'apiKey'), false);
  assert.equal(Object.hasOwn(summary, 'apiKeys'), false);
  assert.equal(Object.hasOwn(summary.subtitle, 'sourceText'), false);
  assert.equal(Object.hasOwn(summary.subtitle, 'translatedText'), false);
  assert.equal(Object.hasOwn(summary.subtitle, 'escapedText'), false);
  assert.equal(Object.hasOwn(summary.subtitle, 'apiKey'), false);

  assert.deepEqual(summary.privacy, PRIVACY_GUARANTEES);
  assert.equal(summary.privacy.sourceTextIncluded, false);
  assert.equal(summary.privacy.translatedTextIncluded, false);
  assert.equal(summary.privacy.imagesIncluded, false);
  assert.equal(summary.privacy.apiKeysIncluded, false);
  assert.equal(summary.privacy.persistenceUsed, false);
});

test('runSyntheticFirstRunStream marks overlayPublished=false and frozen failure when provider mismatches profile', async () => {
  const { provider, calls } = deterministicProvider({ name: 'deepl' });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile({ translationProvider: 'echo' }),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-mismatch',
  });

  assert.equal(summary.overlayPublished, false);
  assert.equal(summary.subtitle, null);
  assert.equal(summary.stage, 'error');
  assert.equal(Object.isFrozen(summary.failure), true);
  assert.equal(summary.failure.reason, FAILURE_REASONS.PIPELINE_ERROR);
  assert.equal(summary.failure.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(summary.failure.fieldErrors));
  assert.equal(summary.failure.fieldErrors[0].code, 'PROVIDER_MISMATCH');
  assert.equal(Object.isFrozen(summary.failure.fieldErrors), true);
  assert.equal(Object.isFrozen(summary.failure.fieldErrors[0]), true);
  assert.equal(calls.length, 0);
});

test('failure summary redacts api keys and sensitive payloads from provider error messages', async () => {
  const error = new ContractError(
    'PROVIDER_NETWORK_ERROR',
    'failed call with api_key=sk-abcdef0123456789 token=Bearer ZZZZZZZZZZ',
    { provider: 'deepl' },
  );
  const { provider } = deterministicProvider({ name: 'deepl', error });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile({ translationProvider: 'deepl' }),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-redacted',
  });

  assert.equal(summary.overlayPublished, false);
  assert.equal(summary.subtitle, null);
  assert.equal(summary.stage, 'error');
  assert.equal(summary.failure.reason, FAILURE_REASONS.PIPELINE_ERROR);
  assert.equal(summary.failure.code, 'PROVIDER_NETWORK_ERROR');
  assert.equal(summary.failure.message.includes('sk-abcdef0123456789'), false);
  assert.equal(summary.failure.message.includes('Bearer ZZZZZZZZZZ'), false);
  assert.equal(summary.failure.message.includes('[REDACTED]'), true);
});

test('runSyntheticFirstRunStream surfaces OCR rejection without provider call when confidence floor too high', async () => {
  const { provider, calls } = deterministicProvider();

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile({ ocrConfidenceFloor: 0.99 }),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-rejected',
  });

  assert.equal(summary.overlayPublished, false);
  assert.equal(summary.subtitle, null);
  assert.equal(summary.stage, 'ocr');
  assert.equal(summary.failure.reason, FAILURE_REASONS.OCR_REJECTED);
  assert.equal(summary.failure.code, 'CONFIDENCE_TOO_LOW');
  assert.equal(calls.length, 0);
});

test('runSyntheticFirstRunStream marks withinBudget=false when elapsed exceeds maxDurationMs', async () => {
  const startIso = FIXED_TIME;
  const endIso = new Date(FIXED_TIME_MS + 6 * 60 * 1000).toISOString();
  let phase = 'start';
  const clock = () => (phase === 'start' ? startIso : endIso);

  const { provider } = deterministicProvider();
  const switchingProvider = Object.freeze({
    name: provider.name,
    async translate(input) {
      const result = await provider.translate(input);
      phase = 'end';
      return result;
    },
  });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile(),
    provider: switchingProvider,
    clock,
    idFactory: () => 'subtitle-slow',
    maxDurationMs: 5 * 60 * 1000,
  });

  assert.equal(summary.withinBudget, false);
  assert.equal(summary.durationMs, 6 * 60 * 1000);
  assert.equal(summary.maxDurationMs, 5 * 60 * 1000);
  assert.equal(summary.overlayPublished, true);
  assert.notEqual(summary.subtitle, null);
  assert.equal(summary.failure.reason, FAILURE_REASONS.TIMEOUT);
  assert.equal(summary.failure.code, FAILURE_REASONS.TIMEOUT);
});

test('runSyntheticFirstRunStream validates maxDurationMs bound', async () => {
  const { provider } = deterministicProvider();
  for (const maxDurationMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'abc', null]) {
    await assert.rejects(
      () => runSyntheticFirstRunStream({
        profile: baseProfile(),
        provider,
        clock: fixedClock(),
        maxDurationMs,
      }),
      (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
    );
  }
});

test('failure summary drops provider details and field error messages', async () => {
  const error = new ContractError(
    'PROVIDER_RESPONSE_INVALID',
    'invalid provider response from api_key=sk-providerdetail0123',
    {
      host: 'private.internal.local',
      providerResponseBody: 'secret translated payload',
      fieldErrors: [
        {
          field: 'providerResponseBody',
          code: 'PROVIDER_RESPONSE_INVALID',
          message: 'body leaked sk-providerdetail0123',
        },
      ],
    },
  );
  const { provider } = deterministicProvider({ name: 'deepl', error });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile({ translationProvider: 'deepl' }),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-detail-drop',
  });

  const serialized = JSON.stringify(summary);
  assert.equal(summary.failure.code, 'PROVIDER_RESPONSE_INVALID');
  assert.deepEqual(summary.failure.fieldErrors, [
    { field: 'providerResponseBody', code: 'PROVIDER_RESPONSE_INVALID' },
  ]);
  assert.equal(serialized.includes('private.internal.local'), false);
  assert.equal(serialized.includes('secret translated payload'), false);
  assert.equal(serialized.includes('body leaked'), false);
  assert.equal(serialized.includes('sk-providerdetail0123'), false);
});

test('summary stays frozen and shallow-immutable after return', async () => {
  const { provider } = deterministicProvider();
  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile(),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-frozen',
  });

  assert.throws(() => { summary.overlayPublished = false; }, TypeError);
  assert.throws(() => { summary.subtitle.id = 'mutated'; }, TypeError);
  assert.throws(() => { summary.privacy.apiKeysIncluded = true; }, TypeError);
});

test('runSyntheticFirstRunStream html-escapes hostile provider output before overlay publication', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const { provider } = deterministicProvider({ name: 'echo', translatedText: malicious });

  const summary = await runSyntheticFirstRunStream({
    profile: baseProfile(),
    provider,
    clock: fixedClock(),
    idFactory: () => 'subtitle-xss',
  });

  assert.equal(summary.overlayPublished, true);
  assert.equal(summary.subtitle.translatedTextSha256, sha256Hex(malicious));
  const escaped = '&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;';
  assert.equal(summary.subtitle.escapedTextSha256, sha256Hex(escaped));
  assert.notEqual(summary.subtitle.translatedTextSha256, summary.subtitle.escapedTextSha256);
});
