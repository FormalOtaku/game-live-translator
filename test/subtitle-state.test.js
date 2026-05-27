'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DISPLAY_MS,
  DEFAULT_THEME_ID,
  normalizeSubtitleText,
  createSubtitleFrame,
  sanitizeSubtitleForOverlay,
  isFrameExpired,
  OverlayState,
} = require('../src/core/subtitle-state');

const FIXED_TIME = '2026-05-27T12:00:00.000Z';

function fixedClock(value = FIXED_TIME) {
  return () => value;
}

test('normalizeSubtitleText folds width, strips controls, and collapses whitespace', () => {
  assert.equal(normalizeSubtitleText('　Ｈｅｌｌｏ\u0000\nworld\u200B　'), 'Hello world');
  assert.equal(normalizeSubtitleText('safe\u202Evil\u2066 text'), 'safevil text');
  assert.equal(normalizeSubtitleText(null), '');
});

test('createSubtitleFrame returns deterministic frozen frame and escaped overlay text', () => {
  const frame = createSubtitleFrame({
    profileId: ' profile-1 ',
    translatedText: '<script>alert("x")</script>',
    provider: 'deepl',
    themeId: 'stream_box',
  }, {
    idFactory: () => 'subtitle-1',
    clock: fixedClock(),
  });

  assert.deepEqual(frame, {
    id: 'subtitle-1',
    profileId: 'profile-1',
    translatedText: '<script>alert("x")</script>',
    escapedText: '&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;',
    provider: 'deepl',
    createdAt: FIXED_TIME,
    displayMs: DEFAULT_DISPLAY_MS,
    themeId: 'stream_box',
  });
  assert.equal(Object.isFrozen(frame), true);
  assert.equal(Object.hasOwn(frame, 'sourceText'), false);
  assert.equal(Object.hasOwn(frame, 'confidence'), false);
});

test('createSubtitleFrame defaults theme and includes sourceText only when explicitly requested', () => {
  const hidden = createSubtitleFrame({
    id: 'subtitle-2',
    profileId: 'profile-1',
    sourceText: '勇者',
    translatedText: 'Hero',
    provider: 'echo',
    createdAt: FIXED_TIME,
  });
  const debug = createSubtitleFrame({
    id: 'subtitle-3',
    profileId: 'profile-1',
    sourceText: '　勇者　',
    translatedText: 'Hero',
    provider: 'echo',
    createdAt: FIXED_TIME,
    includeSourceText: true,
    confidence: 0.92,
  });

  assert.equal(hidden.themeId, DEFAULT_THEME_ID);
  assert.equal(Object.hasOwn(hidden, 'sourceText'), false);
  assert.equal(debug.sourceText, '勇者');
  assert.equal(debug.confidence, 0.92);
});

test('createSubtitleFrame can derive deterministic default id from injected clock', () => {
  const frame = createSubtitleFrame({
    profileId: 'profile-1',
    translatedText: 'Clock seeded id',
    provider: 'echo',
  }, { clock: fixedClock() });

  assert.equal(frame.id, `subtitle_${Date.parse(FIXED_TIME).toString(36)}`);
  assert.equal(frame.createdAt, FIXED_TIME);
});

test('createSubtitleFrame rejects invalid required fields and numeric ranges', () => {
  assert.throws(
    () => createSubtitleFrame({
      id: '',
      profileId: '',
      translatedText: '   ',
      provider: '',
      themeId: '',
      displayMs: 0,
      confidence: 2,
      createdAt: 'not-a-date',
    }),
    (error) => {
      assert.equal(error.code, 'VALIDATION_ERROR');
      const codes = error.details.fieldErrors.map((fieldError) => fieldError.code);
      assert.ok(codes.includes('FIELD_REQUIRED'));
      assert.ok(codes.includes('TRANSLATED_TEXT_EMPTY'));
      assert.ok(codes.includes('DISPLAY_MS_INVALID'));
      assert.ok(codes.includes('CONFIDENCE_INVALID'));
      assert.ok(codes.includes('TIMESTAMP_INVALID'));
      return true;
    },
  );
});

test('sanitizeSubtitleForOverlay rebuilds escapedText and omits debug source by default', () => {
  const payload = sanitizeSubtitleForOverlay({
    id: 'subtitle-4',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: '<img src=x onerror=alert(1)>',
    escapedText: '<img src=x onerror=alert(1)>',
    provider: 'deepl',
    confidence: 0.8,
    createdAt: FIXED_TIME,
    displayMs: 3000,
    themeId: 'minimal',
  });

  assert.equal(payload.escapedText.includes('<img'), false);
  assert.equal(payload.escapedText, '&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
  assert.equal(Object.hasOwn(payload, 'sourceText'), false);
  assert.equal(payload.confidence, 0.8);
  assert.equal(Object.isFrozen(payload), true);
});

test('sanitizeSubtitleForOverlay can include debug source text explicitly', () => {
  const payload = sanitizeSubtitleForOverlay({
    id: 'subtitle-5',
    profileId: 'profile-1',
    sourceText: '勇者',
    translatedText: 'Hero',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 3000,
    themeId: 'classic_subtitle',
  }, { includeSourceText: true });

  assert.equal(payload.sourceText, '勇者');
});

test('OverlayState tracks overlay client counters without going negative', () => {
  const state = new OverlayState({ clock: fixedClock() });
  assert.equal(state.snapshot().overlayClients, 0);
  state.connectClient();
  state.connectClient();
  state.disconnectClient();
  state.disconnectClient();
  state.disconnectClient();
  const snapshot = state.snapshot();

  assert.equal(snapshot.overlayClients, 0);
  assert.equal(snapshot.connectionsOpened, 2);
  assert.equal(snapshot.connectionsClosed, 2);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('OverlayState replays latest unexpired frame for reconnecting clients', () => {
  let now = Date.parse(FIXED_TIME);
  const state = new OverlayState({ clock: () => now });
  const frame = createSubtitleFrame({
    id: 'subtitle-6',
    profileId: 'profile-1',
    translatedText: 'Hello stream',
    provider: 'deepl',
    createdAt: FIXED_TIME,
    displayMs: 1000,
    themeId: 'stream_box',
  });

  state.publishFrame(frame);
  now += 500;
  state.connectClient();
  const latest = state.latestFrame();

  assert.equal(latest.id, 'subtitle-6');
  assert.equal(state.snapshot().lastSubtitle.id, 'subtitle-6');
});

test('OverlayState omits expired frames from latestFrame and snapshots', () => {
  let now = Date.parse(FIXED_TIME);
  const state = new OverlayState({ clock: () => now });
  const frame = createSubtitleFrame({
    id: 'subtitle-7',
    profileId: 'profile-1',
    translatedText: 'Temporary line',
    provider: 'deepl',
    createdAt: FIXED_TIME,
    displayMs: 1000,
    themeId: 'stream_box',
  });

  state.publishFrame(frame);
  const beforeExpiry = state.snapshot().updatedAt;
  assert.equal(isFrameExpired(frame, now + 999), false);
  assert.equal(isFrameExpired(frame, now + 1000), true);
  now += 1000;

  const snapshot = state.snapshot();
  assert.equal(snapshot.lastSubtitle, null);
  assert.equal(snapshot.updatedAt, new Date(now).toISOString());
  assert.notEqual(snapshot.updatedAt, beforeExpiry);
  assert.equal(state.latestFrame(), null);
});

test('OverlayState clearFrame removes latest subtitle but preserves client counters', () => {
  const state = new OverlayState({ clock: fixedClock() });
  state.connectClient();
  state.publishFrame(createSubtitleFrame({
    id: 'subtitle-8',
    profileId: 'profile-1',
    translatedText: 'Line',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 3000,
    themeId: 'minimal',
  }));

  const snapshot = state.clearFrame();
  assert.equal(snapshot.overlayClients, 1);
  assert.equal(snapshot.lastSubtitle, null);
});

test('OverlayState publishFrame omits debug sourceText from replay snapshots', () => {
  const state = new OverlayState({ clock: fixedClock() });
  const debugFrame = createSubtitleFrame({
    id: 'subtitle-9',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: 'Translated line',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 3000,
    themeId: 'minimal',
    includeSourceText: true,
  });

  const snapshot = state.publishFrame(debugFrame);
  assert.equal(Object.hasOwn(debugFrame, 'sourceText'), true);
  assert.equal(Object.hasOwn(snapshot.lastSubtitle, 'sourceText'), false);
});
