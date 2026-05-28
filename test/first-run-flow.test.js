'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  REDACTED,
  DEFAULT_OCR_PRESET,
  DEFAULT_CAPTURE_HZ,
  DEFAULT_TARGET_LANG,
  DEFAULT_OVERLAY_THEME_ID,
  FIRST_RUN_STEP_DEFINITIONS,
  FIRST_RUN_STEP_IDS,
  PROVIDERS_REQUIRING_KEY,
  FIRST_RUN_RECOVERY_ACTIONS_BY_CODE,
  createFirstRunState,
  updateFirstRunDraft,
  updateFirstRunProgress,
  setFirstRunError,
  clearFirstRunError,
  isProviderKeyRequired,
  isProviderReady,
  isStepComplete,
  isStepAvailable,
  firstIncompleteStepId,
  nextFirstRunStepId,
  navigateFirstRun,
  validateDraftProfileForCreate,
  buildProfileCreateIntent,
  buildProviderKeySaveIntent,
  buildCaptureSourcesIntent,
  buildOcrTestIntent,
  buildTranslationTestIntent,
  buildActiveProfileIntent,
  applyProfileCreated,
  applyProviderKeySaved,
  applyOcrTestResult,
  applyTranslationTestResult,
  applyActiveProfileSaved,
  deriveDesktopSetup,
  isFirstRunComplete,
  buildFirstRunViewModel,
  sanitizeFirstRunError,
  deriveFirstRunRecoveryActions,
  safeIntentForLog,
} = require('../src/ui/first-run-flow');

function validCaptureSource(overrides = {}) {
  return {
    kind: 'window',
    id: 'window-1',
    label: 'Game Window',
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    ...overrides,
  };
}

function validRoi(overrides = {}) {
  return { x: 40, y: 420, width: 800, height: 180, ...overrides };
}

function readyState(overrides = {}) {
  let state = createFirstRunState();
  state = updateFirstRunDraft(state, {
    name: 'JRPG Stream',
    gameTitle: 'Game Title',
    translationProvider: 'echo',
    captureSource: validCaptureSource(),
    roi: validRoi(),
    glossary: [
      { id: 'term-1', sourceTerm: '勇者', targetTerm: 'Hero', note: 'name' },
    ],
  });
  state = updateFirstRunProgress(state, {
    boundaryAccepted: true,
    privacyAccepted: true,
    overlayUrlCopied: true,
    profileId: 'profile-1',
    ocrTestPassed: true,
    translationTestPassed: true,
    activeProfileId: 'profile-1',
    ...overrides.progress,
  });
  if (overrides.draft) state = updateFirstRunDraft(state, overrides.draft);
  return state;
}

test('first-run step registry is frozen and includes the API-backed profile persistence step', () => {
  assert.equal(Object.isFrozen(FIRST_RUN_STEP_DEFINITIONS), true);
  assert.equal(Object.isFrozen(FIRST_RUN_STEP_IDS), true);
  assert.deepEqual(FIRST_RUN_STEP_IDS, [
    'boundary',
    'privacy',
    'profile-basics',
    'provider',
    'provider-key',
    'obs-overlay',
    'capture-source',
    'roi',
    'persist-profile',
    'ocr-test',
    'translation-test',
    'finish',
  ]);
  for (const step of FIRST_RUN_STEP_DEFINITIONS) {
    assert.equal(Object.isFrozen(step), true);
    assert.equal(typeof step.action, 'string');
  }
  assert.equal(
    FIRST_RUN_STEP_DEFINITIONS.find((step) => step.id === 'persist-profile').visible,
    false,
  );
});

test('initial state uses privacy-first defaults and stores no provider key or raw test text', () => {
  const state = createFirstRunState({
    draft: {
      name: 'Draft',
      apiKey: 'sk-secret-should-not-exist',
      testText: 'raw source sentence',
    },
    progress: {
      providerKeySaved: true,
      __proto__: { activeProfileId: 'polluted' },
    },
  });

  assert.equal(state.currentStepId, 'boundary');
  assert.equal(state.draft.ocrPreset, DEFAULT_OCR_PRESET);
  assert.equal(state.draft.captureHz, DEFAULT_CAPTURE_HZ);
  assert.equal(state.draft.targetLang, DEFAULT_TARGET_LANG);
  assert.equal(state.draft.overlayThemeId, DEFAULT_OVERLAY_THEME_ID);
  assert.equal(Object.hasOwn(state.draft, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.draft, 'testText'), false);
  assert.equal(state.progress.activeProfileId, null);
  assert.equal(Object.prototype.activeProfileId, undefined);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.draft), true);
  assert.equal(Object.isFrozen(state.progress), true);
});

test('draft updates are allow-listed and keep nested capture fields sanitized', () => {
  const state = updateFirstRunDraft(createFirstRunState(), {
    name: 'Profile',
    captureSource: {
      ...validCaptureSource(),
      apiKey: 'not copied',
      bounds: { ...validRoi(), token: 'not copied' },
    },
    roi: { ...validRoi(), sourceText: 'not copied' },
    glossary: [
      {
        id: 'g1',
        sourceTerm: '東京',
        targetTerm: 'Tokyo',
        providerKey: 'not copied',
      },
    ],
    apiKey: 'ignored',
  });

  assert.equal(Object.hasOwn(state.draft, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.draft.captureSource, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.draft.captureSource.bounds, 'token'), false);
  assert.equal(Object.hasOwn(state.draft.roi, 'sourceText'), false);
  assert.equal(Object.hasOwn(state.draft.glossary[0], 'providerKey'), false);
  assert.equal(Object.isFrozen(state.draft.captureSource), true);
  assert.equal(Object.isFrozen(state.draft.roi), true);
  assert.equal(Object.isFrozen(state.draft.glossary[0]), true);
});

test('provider readiness treats echo as local-ready and DeepL as write-only-key gated', () => {
  let state = updateFirstRunDraft(createFirstRunState(), { translationProvider: 'echo' });
  assert.equal(isProviderKeyRequired('echo'), false);
  assert.equal(isProviderReady(state), true);

  state = updateFirstRunDraft(state, { translationProvider: 'deepl' });
  assert.equal(isProviderKeyRequired('deepl'), true);
  assert.equal(isProviderReady(state), false);
  state = updateFirstRunProgress(state, { providerKeySaved: true });
  assert.equal(isProviderReady(state), true);
  assert.deepEqual([...PROVIDERS_REQUIRING_KEY], ['deepl']);
});

test('step completion and availability are sequential and derive first incomplete step', () => {
  let state = createFirstRunState();
  assert.equal(firstIncompleteStepId(state), 'boundary');
  assert.equal(isStepAvailable(state, 'privacy'), false);
  assert.equal(nextFirstRunStepId(state), 'boundary');

  state = updateFirstRunProgress(state, { boundaryAccepted: true });
  assert.equal(firstIncompleteStepId(state), 'privacy');
  assert.equal(isStepAvailable(state, 'privacy'), true);
  assert.equal(nextFirstRunStepId(navigateFirstRun(state, 'boundary')), 'privacy');

  state = updateFirstRunProgress(state, { privacyAccepted: true });
  state = updateFirstRunDraft(state, { name: 'Profile' });
  assert.equal(isStepComplete(state, 'profile-basics'), true);

  const blocked = navigateFirstRun(state, 'roi');
  assert.equal(blocked.currentStepId, 'provider');
});

test('profile create intent aligns with ProfileCreateRequest and excludes provider keys', () => {
  const state = readyState();
  const errors = validateDraftProfileForCreate(state.draft);
  assert.deepEqual(errors, []);

  const intent = buildProfileCreateIntent(state);
  assert.equal(intent.method, 'POST');
  assert.equal(intent.path, '/api/profiles');
  assert.equal(intent.sensitive, false);
  assert.equal(intent.body.name, 'JRPG Stream');
  assert.equal(intent.body.translationProvider, 'echo');
  assert.equal(intent.body.targetLang, 'en');
  assert.deepEqual(intent.body.roi, validRoi());
  assert.equal(Object.hasOwn(intent.body, 'apiKey'), false);
  assert.equal(JSON.stringify(intent).includes('sk-'), false);
  assert.deepEqual(safeIntentForLog(intent).body, intent.body);
});

test('profile create intent refuses incomplete provider or capture state with safe errors', () => {
  const noProvider = updateFirstRunDraft(readyState(), { translationProvider: '' });
  assert.throws(
    () => buildProfileCreateIntent(noProvider),
    (error) => error.code === 'PROVIDER_UNKNOWN',
  );

  const needsKey = updateFirstRunDraft(readyState(), { translationProvider: 'deepl' });
  assert.throws(
    () => buildProfileCreateIntent(needsKey),
    (error) => error.code === 'PROVIDER_KEY_MISSING' &&
      !JSON.stringify(error).includes('apiKey'),
  );

  const noSource = updateFirstRunDraft(readyState(), { captureSource: null });
  assert.throws(
    () => buildProfileCreateIntent(noSource),
    (error) => error.code === 'CAPTURE_SOURCE_MISSING' &&
      !JSON.stringify(error).includes('apiKey'),
  );

  const noRoi = updateFirstRunDraft(readyState(), { roi: null });
  assert.throws(
    () => buildProfileCreateIntent(noRoi),
    (error) => error.code === 'ROI_MISSING' &&
      !JSON.stringify(error).includes('sourceText'),
  );

  const badRoi = updateFirstRunDraft(readyState(), { roi: { x: 0, y: 0, width: 0, height: 1 } });
  assert.throws(
    () => buildProfileCreateIntent(badRoi),
    (error) => error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors.some((fieldError) => fieldError.field === 'roi.width'),
  );
});

test('provider key intent uses current /api/keys provider route and keeps secret off JSON/log views', () => {
  const secret = 'sk-secret-provider-key-123456789';
  const intent = buildProviderKeySaveIntent({ provider: 'deepl', apiKey: secret });

  assert.equal(intent.method, 'PUT');
  assert.equal(intent.path, '/api/keys/deepl');
  assert.equal(intent.sensitive, true);
  assert.equal(JSON.stringify(intent).includes(secret), false);
  assert.deepEqual(safeIntentForLog(intent), {
    method: 'PUT',
    path: '/api/keys/deepl',
    sensitive: true,
    body: { apiKey: REDACTED },
  });
  assert.equal(intent.makeBody().apiKey, secret);
  assert.equal(Object.isFrozen(intent.makeBody()), true);

  assert.throws(
    () => buildProviderKeySaveIntent({ provider: 'echo', apiKey: secret }),
    (error) => error.code === 'PROVIDER_KEY_NOT_REQUIRED' &&
      !JSON.stringify(error).includes(secret),
  );
});

test('capture, OCR, translation, and active-profile intents match current API paths', () => {
  assert.deepEqual(safeIntentForLog(buildCaptureSourcesIntent()), {
    method: 'GET',
    path: '/api/capture/sources',
    sensitive: false,
  });

  const ocr = buildOcrTestIntent({ profileId: 'profile-1', roi: validRoi() });
  assert.equal(ocr.path, '/api/ocr/test');
  assert.deepEqual(ocr.body, { profileId: 'profile-1', roi: validRoi() });
  const ocrWithExtra = buildOcrTestIntent({
    profileId: 'profile-1',
    roi: { ...validRoi(), providerKey: 'not forwarded' },
  });
  assert.equal(Object.hasOwn(ocrWithExtra.body.roi, 'providerKey'), false);

  const sourceText = 'private Japanese line';
  const translation = buildTranslationTestIntent({ profileId: 'profile-1', text: sourceText });
  assert.equal(translation.path, '/api/translate/test');
  assert.equal(JSON.stringify(translation).includes(sourceText), false);
  assert.deepEqual(safeIntentForLog(translation), {
    method: 'POST',
    path: '/api/translate/test',
    sensitive: true,
    body: { profileId: 'profile-1', text: REDACTED },
  });
  assert.deepEqual(translation.makeBody(), { profileId: 'profile-1', text: sourceText });

  const active = buildActiveProfileIntent({ profileId: 'profile-1' });
  assert.equal(active.method, 'PUT');
  assert.equal(active.path, '/api/profiles/active');
  assert.deepEqual(active.body, { profileId: 'profile-1' });

  for (const bad of [{}, { profileId: '   ' }]) {
    assert.throws(
      () => buildActiveProfileIntent(bad),
      (error) => error.code === 'VALIDATION_ERROR' &&
        error.details.fieldErrors[0].field === 'profileId' &&
        !JSON.stringify(error).includes('   '),
    );
  }
});

test('apply helpers advance progress without retaining OCR or translated text', () => {
  let state = readyState({
    progress: {
      profileId: null,
      ocrTestPassed: false,
      translationTestPassed: false,
      activeProfileId: null,
    },
  });
  state = applyProfileCreated(state, {
    id: 'profile-2',
    translatedText: 'do not retain',
  });
  state = applyOcrTestResult(state, {
    accepted: true,
    text: 'raw OCR result',
    normalizedText: 'raw OCR result',
  });
  state = applyTranslationTestResult(state, {
    translatedText: 'translated output',
    sourceText: 'raw source',
  });
  state = applyActiveProfileSaved(state, { ok: true });

  assert.equal(state.progress.profileId, 'profile-2');
  assert.equal(state.progress.ocrTestPassed, true);
  assert.equal(state.progress.translationTestPassed, true);
  assert.equal(state.progress.activeProfileId, 'profile-2');
  const json = JSON.stringify(buildFirstRunViewModel(state));
  assert.equal(json.includes('raw OCR result'), false);
  assert.equal(json.includes('translated output'), false);
  assert.equal(json.includes('raw source'), false);
});

test('active profile application rejects missing profile id and failed responses safely', () => {
  const noProfileId = readyState({ progress: { profileId: null, activeProfileId: null } });
  assert.throws(
    () => applyActiveProfileSaved(noProfileId, { ok: true }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      !JSON.stringify(error).includes('translatedText'),
  );

  const failedResponse = readyState({ progress: { activeProfileId: null } });
  assert.throws(
    () => applyActiveProfileSaved(failedResponse, {
      ok: false,
      apiKey: 'sk-secret-provider-key-123456789',
      sourceText: 'raw text',
    }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      !JSON.stringify(error).includes('sk-secret-provider-key-123456789') &&
      !JSON.stringify(error).includes('raw text'),
  );
});

test('desktop setup and completion require acknowledgements, active profile, provider readiness, source, ROI, OCR, and translation tests', () => {
  const incomplete = readyState({ progress: { activeProfileId: null } });
  assert.deepEqual(deriveDesktopSetup(incomplete), {
    activeProfileId: null,
    providerKeySaved: true,
    captureSourceSelected: true,
    roiSaved: true,
  });
  assert.equal(isFirstRunComplete(incomplete), false);
  assert.equal(
    isFirstRunComplete(readyState({ progress: { boundaryAccepted: false } })),
    false,
  );
  assert.equal(
    isFirstRunComplete(readyState({ progress: { privacyAccepted: false } })),
    false,
  );
  assert.equal(
    isFirstRunComplete(readyState({ progress: { overlayUrlCopied: false } })),
    false,
  );

  const complete = readyState();
  assert.deepEqual(deriveDesktopSetup(complete), {
    activeProfileId: 'profile-1',
    providerKeySaved: true,
    captureSourceSelected: true,
    roiSaved: true,
  });
  assert.equal(isFirstRunComplete(complete), true);
  assert.equal(buildFirstRunViewModel(complete).complete, true);
});

test('first-run view model is frozen, redacted, and carries step errors with recovery actions', () => {
  let state = readyState({
    progress: {
      translationTestPassed: false,
      activeProfileId: null,
    },
  });
  state = setFirstRunError(state, 'translation-test', {
    error: {
      code: 'PROVIDER_NETWORK_ERROR',
      message: 'Network failed for sk-secret-123456789',
      retryable: true,
      details: {
        fieldErrors: [
          {
            field: 'apiKey',
            code: 'VALIDATION_ERROR',
            message: 'apiKey sk-secret-123456789 invalid',
            value: 'sk-secret-123456789',
          },
        ],
      },
    },
  });

  const vm = buildFirstRunViewModel(state);
  const serialized = JSON.stringify(vm);
  assert.equal(Object.isFrozen(vm), true);
  assert.equal(Object.isFrozen(vm.steps), true);
  assert.equal(serialized.includes('sk-secret-123456789'), false);
  assert.ok(serialized.includes(REDACTED));
  const translationStep = vm.steps.find((step) => step.id === 'translation-test');
  assert.deepEqual(translationStep.error.recoveryActions, ['retry', 'check_network']);
  assert.equal(translationStep.error.fieldErrors[0].field, 'apiKey');
  assert.equal(Object.hasOwn(translationStep.error.fieldErrors[0], 'value'), false);

  state = clearFirstRunError(state, 'translation-test');
  assert.equal(buildFirstRunViewModel(state).errors['translation-test'], undefined);
});

test('recovery derivation uses code and retryable only', () => {
  assert.deepEqual(
    deriveFirstRunRecoveryActions({
      state: 'error',
      code: 'PROVIDER_AUTH_FAILED',
      retryable: false,
      message: 'retry please',
    }),
    ['edit_api_key', 'retry'],
  );
  assert.deepEqual(
    deriveFirstRunRecoveryActions({
      state: 'error',
      code: 'NEW_CODE',
      retryable: true,
      message: 'mentions api key',
    }),
    ['retry', 'open_diagnostics'],
  );
  assert.deepEqual(
    deriveFirstRunRecoveryActions({
      state: 'error',
      code: 'OCR_TEXT_NOT_ACCEPTED',
      retryable: false,
    }),
    ['redraw_roi', 'retry'],
  );
  assert.equal(Object.isFrozen(FIRST_RUN_RECOVERY_ACTIONS_BY_CODE.PROVIDER_AUTH_FAILED), true);
  assert.equal(Object.isFrozen(FIRST_RUN_RECOVERY_ACTIONS_BY_CODE.OCR_TEXT_NOT_ACCEPTED), true);
});

test('sanitizeFirstRunError handles plain errors without exposing raw exception messages', () => {
  const error = new Error('raw stack mentions sk-secret-123456789 and sourceText');
  error.code = 'DB_UNAVAILABLE';
  const sanitized = sanitizeFirstRunError(error);
  assert.equal(sanitized.code, 'DB_UNAVAILABLE');
  assert.equal(sanitized.message, 'Action failed');
  assert.equal(JSON.stringify(sanitized).includes('sk-secret-123456789'), false);
  assert.deepEqual(sanitized.recoveryActions, ['restart_backend', 'open_diagnostics']);
});

test('all intent builders keep known sensitive sentinels out of serializable intent/log shapes', () => {
  const secret = 'sk-secret-provider-key-123456789';
  const sourceText = 'sourceText sentinel should not serialize';
  const state = readyState({
    draft: {
      translationProvider: 'deepl',
    },
    progress: {
      providerKeySaved: true,
    },
  });

  const intents = [
    buildProfileCreateIntent(state),
    buildProviderKeySaveIntent({ provider: 'deepl', apiKey: secret }),
    buildCaptureSourcesIntent(),
    buildOcrTestIntent({
      profileId: 'profile-1',
      roi: { ...validRoi(), sourceText },
    }),
    buildTranslationTestIntent({ profileId: 'profile-1', text: sourceText }),
    buildActiveProfileIntent({ profileId: 'profile-1' }),
  ];

  for (const intent of intents) {
    const serialized = JSON.stringify(intent);
    const logSafe = JSON.stringify(safeIntentForLog(intent));
    assert.equal(serialized.includes(secret), false);
    assert.equal(logSafe.includes(secret), false);
    assert.equal(serialized.includes(sourceText), false);
    assert.equal(logSafe.includes(sourceText), false);
  }
});
