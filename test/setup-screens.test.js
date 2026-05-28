'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  REDACTED,
  DEFAULT_OCR_PRESET,
  DEFAULT_CAPTURE_HZ,
  DEFAULT_TARGET_LANG,
  SETUP_SCREEN_DEFINITIONS,
  SETUP_SCREEN_IDS,
  SETUP_ACTION_IDS,
  PROVIDERS_REQUIRING_KEY,
  SETUP_RECOVERY_ACTIONS_BY_CODE,
  createSetupScreensState,
  updateSetupDraft,
  navigateSetupScreen,
  setSetupPendingAction,
  setSetupScreenError,
  clearSetupScreenError,
  isProviderKeyRequired,
  isValidProvider,
  isValidCaptureHz,
  isValidOcrPreset,
  buildProfileSettingsUpdateIntent,
  buildCaptureSettingsUpdateIntent,
  buildOcrSettingsUpdateIntent,
  buildTranslationSettingsUpdateIntent,
  buildCaptureSourcesIntent,
  buildOcrPreviewIntent,
  buildProviderKeySaveIntent,
  buildTranslationPreviewIntent,
  applyCaptureSourcesResult,
  applyProviderKeySaved,
  applyOcrPreviewResult,
  applyTranslationPreviewResult,
  buildSetupScreensViewModel,
  sanitizeSetupScreenError,
  deriveSetupRecoveryActions,
  safeSetupIntentForLog,
  safeSetupScreensStateForLog,
} = require('../src/ui/setup-screens');

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
  let state = createSetupScreensState({
    profileId: 'profile-1',
    providerKeySaved: true,
    draft: {
      captureSource: validCaptureSource(),
      roi: validRoi(),
      translationProvider: 'deepl',
      ...overrides.draft,
    },
    captureSources: [validCaptureSource()],
    ...overrides.state,
  });
  if (overrides.patch) state = updateSetupDraft(state, overrides.patch);
  return state;
}

test('setup screen constants are frozen and initial state is privacy-safe', () => {
  const state = createSetupScreensState({
    activeScreenId: 'translation-settings',
    profileId: ' profile-1 ',
    draft: {
      apiKey: 'sk-secret-provider-key-123456789',
      testText: 'raw manual test sentence',
      __proto__: { translationProvider: 'deepl' },
    },
    pendingAction: 'run_translation_preview',
  });

  assert.equal(Object.isFrozen(SETUP_SCREEN_DEFINITIONS), true);
  assert.equal(Object.isFrozen(SETUP_SCREEN_IDS), true);
  assert.equal(Object.isFrozen(SETUP_ACTION_IDS), true);
  assert.deepEqual(SETUP_SCREEN_IDS, [
    'capture-setup',
    'ocr-preview',
    'translation-settings',
  ]);
  for (const screen of SETUP_SCREEN_DEFINITIONS) {
    assert.equal(Object.isFrozen(screen), true);
    assert.equal(screen.capabilities.loading, true);
    assert.equal(screen.capabilities.recovery, true);
  }

  assert.equal(state.activeScreenId, 'translation-settings');
  assert.equal(state.profileId, 'profile-1');
  assert.equal(state.draft.ocrPreset, DEFAULT_OCR_PRESET);
  assert.equal(state.draft.captureHz, DEFAULT_CAPTURE_HZ);
  assert.equal(state.draft.targetLang, DEFAULT_TARGET_LANG);
  assert.equal(Object.hasOwn(state.draft, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.draft, 'testText'), false);
  assert.equal(Object.prototype.translationProvider, undefined);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.draft), true);
  assert.equal(Object.isFrozen(state.captureSources), true);

  const viewModel = buildSetupScreensViewModel(state);
  assert.equal(viewModel.translation.providerKeySaved, true);
  assert.equal(viewModel.screens.find((screen) => screen.id === 'translation-settings').current, true);
});

test('draft updates are allow-listed and sanitize nested capture fields', () => {
  const state = updateSetupDraft(createSetupScreensState(), {
    captureSource: {
      ...validCaptureSource(),
      apiKey: 'not copied',
      bounds: { ...validRoi(), screenshotPath: '/tmp/not-copied.png' },
    },
    roi: { ...validRoi(), sourceText: 'not copied' },
    captureHz: 4,
    ocrPreset: 'high_contrast',
    ocrConfidenceFloor: 0.72,
    translationProvider: 'echo',
    targetLang: 'en',
    apiKey: 'ignored',
  });

  assert.equal(state.draft.captureHz, 4);
  assert.equal(state.draft.ocrPreset, 'high_contrast');
  assert.equal(state.draft.translationProvider, 'echo');
  assert.equal(Object.hasOwn(state.draft, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.draft.captureSource, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.draft.captureSource.bounds, 'screenshotPath'), false);
  assert.equal(Object.hasOwn(state.draft.roi, 'sourceText'), false);
  assert.equal(Object.isFrozen(state.draft.captureSource.bounds), true);
  assert.equal(isProviderKeyRequired('deepl'), true);
  assert.equal(isProviderKeyRequired('echo'), false);
  assert.equal(isValidProvider('deepl'), true);
  assert.equal(isValidCaptureHz(0), true);
  assert.equal(isValidOcrPreset('adv_textbox'), true);
  assert.deepEqual([...PROVIDERS_REQUIRING_KEY], ['deepl']);
});

test('navigation and pending action normalization stay within the setup vocabulary', () => {
  let state = createSetupScreensState();
  state = navigateSetupScreen(state, 'ocr-preview');
  state = setSetupPendingAction(state, 'refresh_sources');
  assert.equal(state.activeScreenId, 'ocr-preview');
  assert.equal(state.pendingAction, 'refresh_sources');

  state = navigateSetupScreen(state, '__proto__');
  state = setSetupPendingAction(state, 'not-an-action');
  assert.equal(state.activeScreenId, 'capture-setup');
  assert.equal(state.pendingAction, null);
});

test('capture source enumeration intent and result application are sanitized', () => {
  const intent = buildCaptureSourcesIntent();
  assert.deepEqual(safeSetupIntentForLog(intent), {
    method: 'GET',
    path: '/api/capture/sources',
    sensitive: false,
  });

  const state = applyCaptureSourcesResult(createSetupScreensState(), {
    sources: [
      {
        ...validCaptureSource({ label: 'Private Banking Window' }),
        apiKey: 'sk-secret-provider-key-123456789',
        bounds: { ...validRoi(), sourceText: 'not copied' },
      },
    ],
    providerResponse: 'not copied',
  });

  assert.equal(state.captureSources.length, 1);
  assert.equal(state.captureSources[0].label, 'Private Banking Window');
  assert.equal(Object.hasOwn(state.captureSources[0], 'apiKey'), false);
  assert.equal(Object.hasOwn(state.captureSources[0].bounds, 'sourceText'), false);
  assert.equal(JSON.stringify(state).includes('sk-secret-provider-key-123456789'), false);
  assert.equal(JSON.stringify(state).includes('providerResponse'), false);
  const safeState = safeSetupScreensStateForLog(state);
  assert.equal(safeState.captureSources[0].label, REDACTED);
  assert.equal(JSON.stringify(safeState).includes('Private Banking Window'), false);

  assert.throws(
    () => applyCaptureSourcesResult(state, { sources: [{ kind: 'window', id: '', label: 'Bad' }] }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors.some((fieldError) => fieldError.field === 'sources[0].id'),
  );
  assert.throws(
    () => applyCaptureSourcesResult(state, { sources: 'not-array' }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
});

test('profile update intents use allow-listed screen fields and validators', () => {
  const state = readyState({
    draft: {
      captureHz: 3,
      ocrPreset: 'pixel_font_dark_bg',
      ocrConfidenceFloor: 0.65,
      targetLang: 'en',
    },
  });

  const capture = buildCaptureSettingsUpdateIntent(state);
  assert.equal(capture.method, 'PUT');
  assert.equal(capture.path, '/api/profiles/profile-1');
  assert.deepEqual(Object.keys(capture.body).sort(), ['captureHz', 'captureSource', 'roi']);
  assert.equal(capture.body.captureHz, 3);
  assert.equal(Object.hasOwn(capture.body.captureSource, 'apiKey'), false);
  assert.equal(safeSetupIntentForLog(capture).body.captureSource.label, REDACTED);

  const ocr = buildOcrSettingsUpdateIntent(state);
  assert.deepEqual(ocr.body, {
    ocrPreset: 'pixel_font_dark_bg',
    ocrConfidenceFloor: 0.65,
  });

  const translation = buildTranslationSettingsUpdateIntent(state);
  assert.deepEqual(translation.body, {
    translationProvider: 'deepl',
    targetLang: 'en',
  });

  const custom = buildProfileSettingsUpdateIntent(state, {
    fields: ['translationProvider', 'targetLang', 'apiKey', 'translationProvider'],
  });
  assert.deepEqual(custom.body, {
    translationProvider: 'deepl',
    targetLang: 'en',
  });

  const missingProfile = updateSetupDraft(createSetupScreensState(), {
    captureSource: validCaptureSource(),
    roi: validRoi(),
  });
  assert.throws(
    () => buildCaptureSettingsUpdateIntent(missingProfile),
    (error) => error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].field === 'profileId',
  );
  assert.throws(
    () => buildCaptureSettingsUpdateIntent(createSetupScreensState({ profileId: 'profile-1' })),
    (error) => error.code === 'CAPTURE_SOURCE_MISSING',
  );
  assert.throws(
    () => buildCaptureSettingsUpdateIntent(updateSetupDraft(
      createSetupScreensState({ profileId: 'profile-1' }),
      { captureSource: validCaptureSource() },
    )),
    (error) => error.code === 'ROI_MISSING',
  );
  assert.throws(
    () => buildTranslationSettingsUpdateIntent(readyState({ draft: { translationProvider: 'bad' } })),
    (error) => error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors.some((fieldError) => fieldError.code === 'PROVIDER_UNKNOWN'),
  );
});

test('OCR preview intent and result retain visible text only outside log-safe snapshots', () => {
  let state = readyState();
  const intent = buildOcrPreviewIntent(state, {
    roi: { ...validRoi(), apiKey: 'not copied' },
  });

  assert.equal(intent.method, 'POST');
  assert.equal(intent.path, '/api/ocr/test');
  assert.deepEqual(intent.body, { profileId: 'profile-1', roi: validRoi() });
  assert.equal(JSON.stringify(intent).includes('apiKey'), false);

  state = applyOcrPreviewResult(state, {
    text: '秘密のOCRテキスト',
    normalizedText: '秘密のOCRテキスト',
    confidence: 0.91,
    durationMs: 12,
    accepted: true,
  });

  assert.equal(state.ocrPreview.text, '秘密のOCRテキスト');
  assert.equal(buildSetupScreensViewModel(state).ocr.preview.normalizedText, '秘密のOCRテキスト');
  const safe = safeSetupScreensStateForLog(state);
  assert.equal(safe.ocrPreview.text, REDACTED);
  assert.equal(safe.ocrPreview.normalizedText, REDACTED);
  assert.equal(JSON.stringify(safe).includes('秘密のOCRテキスト'), false);

  const rejected = applyOcrPreviewResult(state, {
    text: '',
    normalizedText: '',
    confidence: 0.1,
    durationMs: 8,
    accepted: false,
    rejectionReason: 'CONFIDENCE_TOO_LOW',
  });
  assert.equal(rejected.ocrPreview.accepted, false);
  assert.equal(rejected.ocrPreview.rejectionReason, 'CONFIDENCE_TOO_LOW');

  assert.throws(
    () => applyOcrPreviewResult(state, {
      text: 'raw bad OCR text',
      normalizedText: 'raw bad OCR text',
      confidence: 2,
      durationMs: 0,
      accepted: true,
      apiKey: 'sk-secret-provider-key-123456789',
    }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      !JSON.stringify(error).includes('raw bad OCR text') &&
      !JSON.stringify(error).includes('sk-secret-provider-key-123456789'),
  );
});

test('provider key intent is write-only and provider-key progress is state-only', () => {
  const secret = 'sk-secret-provider-key-123456789';
  const intent = buildProviderKeySaveIntent({ provider: 'deepl', apiKey: secret });

  assert.equal(intent.method, 'PUT');
  assert.equal(intent.path, '/api/keys/deepl');
  assert.equal(intent.sensitive, true);
  assert.equal(JSON.stringify(intent).includes(secret), false);
  assert.deepEqual(safeSetupIntentForLog(intent), {
    method: 'PUT',
    path: '/api/keys/deepl',
    sensitive: true,
    body: { apiKey: REDACTED },
  });
  assert.deepEqual(intent.makeBody(), { apiKey: secret });
  assert.equal(Object.isFrozen(intent.makeBody()), true);

  const state = applyProviderKeySaved(readyState({ state: { providerKeySaved: false } }), {
    ok: true,
    apiKey: secret,
  });
  assert.equal(state.providerKeySaved, true);
  assert.equal(JSON.stringify(state).includes(secret), false);

  assert.throws(
    () => buildProviderKeySaveIntent({ provider: 'echo', apiKey: secret }),
    (error) => error.code === 'PROVIDER_KEY_NOT_REQUIRED' &&
      !JSON.stringify(error).includes(secret),
  );
  assert.throws(
    () => applyProviderKeySaved(state, { ok: false, apiKey: secret }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      !JSON.stringify(error).includes(secret),
  );
});

test('translation preview intent keeps source text out of serializable descriptors', () => {
  let state = readyState();
  const sourceText = 'raw source sentence for translation';
  const intent = buildTranslationPreviewIntent(state, { text: sourceText });

  assert.equal(intent.method, 'POST');
  assert.equal(intent.path, '/api/translate/test');
  assert.equal(intent.sensitive, true);
  assert.equal(JSON.stringify(intent).includes(sourceText), false);
  assert.equal(Object.keys(intent).includes('text'), false);
  assert.deepEqual(safeSetupIntentForLog(intent), {
    method: 'POST',
    path: '/api/translate/test',
    sensitive: true,
    body: { profileId: 'profile-1', text: REDACTED },
  });
  const firstBody = intent.makeBody();
  const secondBody = intent.makeBody();
  assert.deepEqual(firstBody, { profileId: 'profile-1', text: sourceText });
  assert.deepEqual(secondBody, firstBody);
  assert.notEqual(secondBody, firstBody);
  assert.equal(Object.isFrozen(firstBody), true);

  state = applyTranslationPreviewResult(state, {
    sourceText,
    translatedText: 'translated visible preview',
    provider: 'deepl',
    durationMs: 24,
    cacheHit: false,
  });

  assert.equal(state.translationPreview.translatedText, 'translated visible preview');
  assert.equal(Object.hasOwn(state.translationPreview, 'sourceText'), false);
  assert.equal(JSON.stringify(state).includes(sourceText), false);
  const safe = safeSetupScreensStateForLog(state);
  assert.equal(safe.translationPreview.translatedText, REDACTED);
  assert.equal(JSON.stringify(safe).includes('translated visible preview'), false);

  assert.throws(
    () => buildTranslationPreviewIntent(state, { text: '   ' }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].field === 'text',
  );
  assert.throws(
    () => applyTranslationPreviewResult(state, {
      sourceText,
      translatedText: 'translated bad sentinel',
      provider: 'bad-provider',
      durationMs: 0,
      cacheHit: false,
      apiKey: 'sk-secret-provider-key-123456789',
    }),
    (error) => error.code === 'VALIDATION_ERROR' &&
      !JSON.stringify(error).includes(sourceText) &&
      !JSON.stringify(error).includes('translated bad sentinel') &&
      !JSON.stringify(error).includes('sk-secret-provider-key-123456789'),
  );
});

test('view model exposes screen-specific actions and disabled reasons', () => {
  const empty = buildSetupScreensViewModel(createSetupScreensState());
  assert.equal(empty.capture.empty, true);
  assert.equal(empty.capture.actions.find((action) => action.id === 'refresh_sources').enabled, true);
  assert.equal(empty.capture.actions.find((action) => action.id === 'save_capture_settings').enabled, false);
  assert.equal(empty.capture.actions.find((action) => action.id === 'run_ocr_preview').enabled, false);
  assert.equal(empty.translation.actions.find((action) => action.id === 'run_translation_preview').enabled, false);

  const vm = buildSetupScreensViewModel(readyState());
  assert.equal(vm.capture.empty, false);
  assert.equal(vm.capture.actions.find((action) => action.id === 'save_capture_settings').enabled, true);
  assert.equal(vm.ocr.actions.find((action) => action.id === 'run_ocr_preview').enabled, true);
  assert.equal(vm.translation.providerKeyRequired, true);
  assert.equal(vm.translation.actions.find((action) => action.id === 'save_provider_key').enabled, true);
  assert.equal(Object.isFrozen(vm), true);
  assert.equal(Object.isFrozen(vm.capture.actions[0]), true);
});

test('sanitized setup errors derive recovery from code and retryable only', () => {
  let state = readyState();
  state = setSetupScreenError(state, 'translation-settings', {
    error: {
      code: 'PROVIDER_NETWORK_ERROR',
      message: 'Network failed for sk-secret-provider-key-123456789 and raw source text',
      retryable: true,
      details: {
        fieldErrors: [
          {
            field: 'apiKey',
            code: 'VALIDATION_ERROR',
            message: 'apiKey sk-secret-provider-key-123456789 invalid',
            value: 'sk-secret-provider-key-123456789',
          },
        ],
      },
    },
  });

  const error = buildSetupScreensViewModel(state).translation.error;
  assert.equal(error.code, 'PROVIDER_NETWORK_ERROR');
  assert.deepEqual(error.recoveryActions, ['retry', 'check_network']);
  assert.equal(error.fieldErrors[0].field, 'apiKey');
  assert.equal(Object.hasOwn(error.fieldErrors[0], 'value'), false);
  assert.equal(JSON.stringify(error).includes('sk-secret-provider-key-123456789'), false);

  state = clearSetupScreenError(state, 'translation-settings');
  assert.equal(buildSetupScreensViewModel(state).translation.error, null);

  const plain = new Error('raw stack mentions sk-secret-provider-key-123456789');
  plain.code = 'OCR_ENGINE_ERROR';
  const sanitized = sanitizeSetupScreenError(plain);
  assert.equal(sanitized.code, 'OCR_ENGINE_ERROR');
  assert.equal(sanitized.message, 'Action failed');
  assert.deepEqual(sanitized.recoveryActions, ['open_diagnostics']);
  assert.deepEqual(sanitizeSetupScreenError(sanitized), sanitized);
  assert.deepEqual(
    deriveSetupRecoveryActions({
      code: 'CAPTURE_ENUM_FAILED',
      retryable: true,
      message: 'ignored message mentions retry',
    }),
    ['retry', 'refresh_sources', 'open_diagnostics'],
  );
  assert.equal(Object.isFrozen(SETUP_RECOVERY_ACTIONS_BY_CODE.PROVIDER_AUTH_FAILED), true);
});

test('log-safe intent and state outputs exclude known sensitive sentinels', () => {
  const secret = 'sk-secret-provider-key-123456789';
  const sourceText = 'sourceText sentinel should not serialize';
  let state = readyState();
  state = applyOcrPreviewResult(state, {
    text: sourceText,
    normalizedText: sourceText,
    confidence: 0.8,
    durationMs: 11,
    accepted: true,
  });
  state = applyTranslationPreviewResult(state, {
    sourceText,
    translatedText: 'translated sentinel should not serialize in log-safe state',
    provider: 'deepl',
    durationMs: 22,
    cacheHit: true,
  });

  const intents = [
    buildCaptureSourcesIntent(),
    buildCaptureSettingsUpdateIntent(state),
    buildOcrSettingsUpdateIntent(state),
    buildTranslationSettingsUpdateIntent(state),
    buildOcrPreviewIntent(state),
    buildProviderKeySaveIntent({ provider: 'deepl', apiKey: secret }),
    buildTranslationPreviewIntent(state, { text: sourceText }),
  ];

  for (const intent of intents) {
    const serialized = JSON.stringify(intent);
    const logSafe = JSON.stringify(safeSetupIntentForLog(intent));
    assert.equal(serialized.includes(secret), false);
    assert.equal(logSafe.includes(secret), false);
    assert.equal(serialized.includes(sourceText), false);
    assert.equal(logSafe.includes(sourceText), false);
  }

  const safeState = JSON.stringify(safeSetupScreensStateForLog(state));
  assert.equal(safeState.includes(secret), false);
  assert.equal(safeState.includes(sourceText), false);
  assert.equal(safeState.includes('translated sentinel'), false);
});
