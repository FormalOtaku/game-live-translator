'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ContractError } = require('../src/contracts/security');
const {
  OCR_REJECTION_REASONS,
  DuplicateSuppressor,
} = require('../src/core/ocr-text');
const { OverlayState } = require('../src/core/subtitle-state');
const { runOcrToOverlayPipeline } = require('../src/core/runtime-pipeline');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';

function fixedClock(value = FIXED_TIME) {
  return () => value;
}

function makeProvider({ name = 'echo', translatedText, error } = {}) {
  const calls = [];
  const provider = Object.freeze({
    name,
    async translate(input) {
      calls.push(input);
      if (error) throw error;
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText: translatedText ?? input.sourceText,
        provider: name,
        durationMs: 5,
        cacheHit: false,
      });
    },
  });
  return { provider, calls };
}

function baseProfile(overrides = {}) {
  return {
    id: 'profile-1',
    translationProvider: 'echo',
    targetLang: 'en',
    ocrConfidenceFloor: 0.6,
    themeId: 'stream_box',
    subtitleDisplayMs: 3000,
    glossary: [
      { id: 'hero', sourceTerm: '勇者', targetTerm: 'Hero' },
      { id: 'lord', sourceTerm: '魔王', targetTerm: 'Demon King' },
    ],
    ...overrides,
  };
}

test('runOcrToOverlayPipeline publishes deterministic subtitle after OCR glossary provider path', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const duplicateSuppressor = new DuplicateSuppressor({ ttlMs: 4000 });
  const { provider, calls } = makeProvider();

  const result = await runOcrToOverlayPipeline({
    profile: baseProfile(),
    ocrCandidate: {
      text: '　勇者　と　魔王　',
      confidence: 0.91,
      durationMs: 12,
    },
    provider,
    duplicateSuppressor,
    overlayState,
    nowMs: 1000,
    clock: fixedClock(),
    idFactory: () => 'subtitle-1',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.stage, 'overlay');
  assert.equal(result.ocr.normalizedText, '勇者 と 魔王');
  assert.equal(result.translationInput.sourceText, '勇者 と 魔王');
  assert.equal(result.translationInput.glossaryAppliedText, 'Hero と Demon King');
  assert.deepEqual(result.translationInput.appliedTerms.map((term) => term.id), ['hero', 'lord']);
  assert.deepEqual(calls, [{ sourceText: 'Hero と Demon King', targetLang: 'en' }]);
  assert.match(result.cacheKey, /^v1:echo:en:[a-f0-9]{64}:[a-f0-9]{64}$/);
  assert.equal(result.cacheKey.includes('勇者'), false);
  assert.equal(result.cacheKey.includes('Hero'), false);
  assert.equal(result.translation.translatedText, 'Hero と Demon King');
  assert.deepEqual(result.subtitleFrame, {
    id: 'subtitle-1',
    profileId: 'profile-1',
    translatedText: 'Hero と Demon King',
    escapedText: 'Hero と Demon King',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 3000,
    themeId: 'stream_box',
    confidence: 0.91,
  });
  assert.equal(result.overlaySnapshot.lastSubtitle.id, 'subtitle-1');
  assert.equal(Object.hasOwn(result.overlaySnapshot.lastSubtitle, 'sourceText'), false);
  assert.equal(overlayState.latestFrame().id, 'subtitle-1');
  assert.equal(Object.isFrozen(result), true);
});

test('runOcrToOverlayPipeline rejects OCR without provider call or overlay publish', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const { provider, calls } = makeProvider();

  const result = await runOcrToOverlayPipeline({
    profile: baseProfile(),
    ocrCandidate: {
      text: '勇者',
      confidence: 0.1,
    },
    provider,
    overlayState,
    nowMs: 1000,
    clock: fixedClock(),
  });

  assert.equal(result.accepted, false);
  assert.equal(result.stage, 'ocr');
  assert.equal(result.rejectionReason, OCR_REJECTION_REASONS.CONFIDENCE_TOO_LOW);
  assert.equal(calls.length, 0);
  assert.equal(result.translationInput, null);
  assert.equal(result.translation, null);
  assert.equal(result.subtitleFrame, null);
  assert.equal(result.overlaySnapshot.lastSubtitle, null);
  assert.equal(overlayState.latestFrame(), null);
});

test('runOcrToOverlayPipeline suppresses duplicate OCR and keeps previous overlay frame', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const duplicateSuppressor = new DuplicateSuppressor({ ttlMs: 4000 });
  const { provider, calls } = makeProvider();
  let frameId = 0;

  const first = await runOcrToOverlayPipeline({
    profile: baseProfile(),
    ocrCandidate: { text: '勇者', confidence: 0.95 },
    provider,
    duplicateSuppressor,
    overlayState,
    nowMs: 1000,
    clock: fixedClock(),
    idFactory: () => `subtitle-${frameId += 1}`,
  });
  const duplicate = await runOcrToOverlayPipeline({
    profile: baseProfile(),
    ocrCandidate: { text: '　勇者　', confidence: 0.95 },
    provider,
    duplicateSuppressor,
    overlayState,
    nowMs: 1500,
    clock: fixedClock(),
    idFactory: () => `subtitle-${frameId += 1}`,
  });

  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.rejectionReason, OCR_REJECTION_REASONS.DUPLICATE_TEXT);
  assert.equal(calls.length, 1);
  assert.equal(duplicate.overlaySnapshot.lastSubtitle.id, 'subtitle-1');
  assert.equal(overlayState.latestFrame().id, 'subtitle-1');
});

test('runOcrToOverlayPipeline escapes malicious provider output for overlay replay', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const { provider } = makeProvider({
    name: 'deepl',
    translatedText: '<img src=x onerror=alert(1)>',
  });

  const result = await runOcrToOverlayPipeline({
    profile: baseProfile({ translationProvider: 'deepl', glossary: [] }),
    ocrCandidate: { text: '危険な文章', confidence: 0.99 },
    provider,
    overlayState,
    nowMs: 1000,
    clock: fixedClock(),
    idFactory: () => 'subtitle-xss',
  });

  assert.equal(result.subtitleFrame.translatedText, '<img src=x onerror=alert(1)>');
  assert.equal(result.subtitleFrame.escapedText, '&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
  assert.equal(result.overlaySnapshot.lastSubtitle.escapedText.includes('<img'), false);
  assert.equal(result.overlaySnapshot.lastSubtitle.escapedText, result.subtitleFrame.escapedText);
});

test('runOcrToOverlayPipeline can keep debug sourceText internally but never replays it to overlay', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const { provider } = makeProvider({ translatedText: 'Secret village' });

  const result = await runOcrToOverlayPipeline({
    profile: baseProfile({ glossary: [] }),
    ocrCandidate: { text: '秘密の村', confidence: 0.95 },
    provider,
    overlayState,
    nowMs: 1000,
    clock: fixedClock(),
    idFactory: () => 'subtitle-debug',
    includeSourceText: true,
  });

  assert.equal(result.subtitleFrame.sourceText, '秘密の村');
  assert.equal(Object.hasOwn(result.overlaySnapshot.lastSubtitle, 'sourceText'), false);
});

test('runOcrToOverlayPipeline propagates provider errors without publishing frames', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const providerError = new ContractError(
    'PROVIDER_NETWORK_ERROR',
    'network failed',
    { provider: 'deepl' },
  );
  const { provider, calls } = makeProvider({ name: 'deepl', error: providerError });

  await assert.rejects(
    () => runOcrToOverlayPipeline({
      profile: baseProfile({ translationProvider: 'deepl', glossary: [] }),
      ocrCandidate: { text: '勇者', confidence: 0.95 },
      provider,
      overlayState,
      nowMs: 1000,
      clock: fixedClock(),
    }),
    (error) => error.code === 'PROVIDER_NETWORK_ERROR',
  );

  assert.equal(calls.length, 1);
  assert.equal(overlayState.latestFrame(), null);
});

test('runOcrToOverlayPipeline does not suppress retry after provider failure', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  const duplicateSuppressor = new DuplicateSuppressor({ ttlMs: 4000 });
  let calls = 0;
  let failNext = true;
  const provider = Object.freeze({
    name: 'deepl',
    async translate(input) {
      calls += 1;
      if (failNext) {
        failNext = false;
        throw new ContractError('PROVIDER_NETWORK_ERROR', 'temporary network failure', { provider: 'deepl' });
      }
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText: 'Retried line',
        provider: 'deepl',
        durationMs: 8,
        cacheHit: false,
      });
    },
  });

  await assert.rejects(
    () => runOcrToOverlayPipeline({
      profile: baseProfile({ translationProvider: 'deepl', glossary: [] }),
      ocrCandidate: { text: '同じ行', confidence: 0.96 },
      provider,
      duplicateSuppressor,
      overlayState,
      nowMs: 1000,
      clock: fixedClock(),
    }),
    (error) => error.code === 'PROVIDER_NETWORK_ERROR',
  );
  const retry = await runOcrToOverlayPipeline({
    profile: baseProfile({ translationProvider: 'deepl', glossary: [] }),
    ocrCandidate: { text: '同じ行', confidence: 0.96 },
    provider,
    duplicateSuppressor,
    overlayState,
    nowMs: 1200,
    clock: fixedClock(),
    idFactory: () => 'subtitle-retry',
  });

  assert.equal(calls, 2);
  assert.equal(retry.accepted, true);
  assert.equal(retry.subtitleFrame.id, 'subtitle-retry');
  assert.equal(overlayState.latestFrame().id, 'subtitle-retry');
});

test('runOcrToOverlayPipeline rejects provider/profile mismatches before provider call', async () => {
  const { provider, calls } = makeProvider({ name: 'echo' });

  await assert.rejects(
    () => runOcrToOverlayPipeline({
      profile: baseProfile({ translationProvider: 'deepl' }),
      ocrCandidate: { text: '勇者', confidence: 0.95 },
      provider,
      clock: fixedClock(),
    }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'PROVIDER_MISMATCH',
  );

  assert.equal(calls.length, 0);
});

test('runOcrToOverlayPipeline rejects unnamed providers before provider call', async () => {
  let calls = 0;
  const provider = Object.freeze({
    async translate(input) {
      calls += 1;
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText: 'wrong provider result',
        provider: 'echo',
        durationMs: 1,
        cacheHit: false,
      });
    },
  });

  await assert.rejects(
    () => runOcrToOverlayPipeline({
      profile: baseProfile({ translationProvider: 'deepl', glossary: [] }),
      ocrCandidate: { text: '勇者', confidence: 0.95 },
      provider,
      nowMs: 1000,
      clock: fixedClock(),
    }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'PROVIDER_NAME_REQUIRED',
  );

  assert.equal(calls, 0);
});

test('runOcrToOverlayPipeline rejects mismatched translation results before overlay publish', async () => {
  const overlayState = new OverlayState({ clock: fixedClock() });
  let calls = 0;
  const provider = Object.freeze({
    name: 'deepl',
    async translate(input) {
      calls += 1;
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText: 'wrong provider result',
        provider: 'echo',
        durationMs: 1,
        cacheHit: false,
      });
    },
  });

  await assert.rejects(
    () => runOcrToOverlayPipeline({
      profile: baseProfile({ translationProvider: 'deepl', glossary: [] }),
      ocrCandidate: { text: '勇者', confidence: 0.95 },
      provider,
      overlayState,
      nowMs: 1000,
      clock: fixedClock(),
    }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'TRANSLATION_PROVIDER_MISMATCH',
  );

  assert.equal(calls, 1);
  assert.equal(overlayState.latestFrame(), null);
});
