'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  REDACTED,
  DEFAULT_THEME_PREVIEW_TEXT,
  OBS_RECOMMENDED_DIMENSIONS,
  CLOSEOUT_SCREEN_DEFINITIONS,
  CLOSEOUT_SCREEN_IDS,
  CLOSEOUT_ACTION_IDS,
  CLOSEOUT_RECOVERY_ACTIONS_BY_CODE,
  DEFAULT_CLOSEOUT_RECOVERY_ACTIONS,
  createCloseoutScreensState,
  updateThemeDraft,
  updatePrivacyDraft,
  navigateCloseoutScreen,
  setCloseoutPendingAction,
  setCloseoutScreenError,
  clearCloseoutScreenError,
  buildThemesListIntent,
  buildThemeCreateIntent,
  buildThemeDuplicateIntent,
  buildThemeUpdateIntent,
  buildThemeDeleteIntent,
  buildProfileThemeUpdateIntent,
  buildPrivacySettingsReadIntent,
  buildPrivacySettingsUpdateIntent,
  buildDiagnosticsBundleIntent,
  buildDiagnosticBundleCopyIntent,
  buildPrivacyHostActionIntent,
  applyThemesResult,
  applyThemeMutationResult,
  applyThemeDeleted,
  applyPrivacySettingsResult,
  applyDiagnosticsBundleResult,
  buildThemeEditorView,
  buildPrivacySettingsView,
  buildDiagnosticsView,
  buildObsSetupViewModel,
  buildObsSetupActionIntent,
  buildCloseoutScreensViewModel,
  sanitizeCloseoutError,
  safeCloseoutIntentForLog,
  safeCloseoutStateForLog,
} = require('../src/ui/closeout-screens');
const { BUILTIN_THEME_IDS } = require('../src/contracts/security');

function customTheme(overrides = {}) {
  return {
    id: 'custom-1',
    name: 'Custom Theme',
    builtIn: false,
    cssJson: { color: '#fff', background: '#000' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function builtInTheme(overrides = {}) {
  return {
    id: BUILTIN_THEME_IDS[0],
    name: 'Built-in',
    builtIn: true,
    cssJson: { color: '#fff' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function validDiagnosticBundle(overrides = {}) {
  return {
    generatedAt: '2026-05-28T12:00:00.000Z',
    appVersion: '0.1.0',
    backendVersion: '0.1.0',
    os: 'linux',
    activeProfileId: 'profile-1',
    redactedLogs: ['ok'],
    redactionSummary: {
      apiKeysRemoved: true,
      ocrTextIncluded: false,
      translatedTextIncluded: false,
      imagesIncluded: false,
    },
    ...overrides,
  };
}

test('constants are frozen and initial state is privacy-safe', () => {
  assert.equal(Object.isFrozen(CLOSEOUT_SCREEN_DEFINITIONS), true);
  assert.equal(Object.isFrozen(CLOSEOUT_SCREEN_IDS), true);
  assert.equal(Object.isFrozen(CLOSEOUT_ACTION_IDS), true);
  assert.equal(Object.isFrozen(CLOSEOUT_RECOVERY_ACTIONS_BY_CODE), true);
  assert.deepEqual(CLOSEOUT_SCREEN_IDS, [
    'overlay-theme',
    'obs-setup',
    'privacy',
    'logs-diagnostics',
  ]);
  for (const screen of CLOSEOUT_SCREEN_DEFINITIONS) {
    assert.equal(Object.isFrozen(screen), true);
    assert.equal(screen.capabilities.loading, true);
    assert.equal(screen.capabilities.empty, true);
    assert.equal(screen.capabilities.error, true);
    assert.equal(screen.capabilities.success, true);
    assert.equal(screen.capabilities.recovery, true);
  }

  const state = createCloseoutScreensState({
    themeDraft: {
      apiKey: 'sk-secret-provider-key-123456789',
      previewText: 'visible transient text',
      __proto__: { name: 'polluted' },
    },
    privacyDraft: {
      saveRecentOcrText: false,
      recentOcrLimit: 0,
      saveRecentTranslations: false,
      recentTranslationLimit: 0,
      saveDebugScreenshots: false,
      debugRetentionDays: 0,
      apiKey: 'sk-secret-provider-key-123456789',
    },
    pendingAction: 'copy_diagnostics_bundle',
  });

  assert.equal(state.activeScreenId, 'overlay-theme');
  assert.deepEqual([...state.themes], []);
  assert.equal(state.selectedThemeId, null);
  assert.equal(Object.hasOwn(state.themeDraft, 'apiKey'), false);
  assert.equal(Object.hasOwn(state.privacyDraft, 'apiKey'), false);
  assert.equal(Object.prototype.name, undefined);
  assert.deepEqual(state.privacySettings, {
    saveRecentOcrText: false,
    recentOcrLimit: 0,
    saveRecentTranslations: false,
    recentTranslationLimit: 0,
    saveDebugScreenshots: false,
    debugRetentionDays: 0,
  });
  assert.equal(state.diagnosticBundle, null);
  assert.equal(state.pendingAction, 'copy_diagnostics_bundle');
  assert.equal(Object.isFrozen(state), true);
});

test('navigation and pending action normalization stay within the closeout vocabulary', () => {
  const initial = createCloseoutScreensState();
  assert.equal(navigateCloseoutScreen(initial, 'privacy').activeScreenId, 'privacy');
  assert.equal(navigateCloseoutScreen(initial, 'not-a-screen').activeScreenId, 'overlay-theme');
  assert.equal(navigateCloseoutScreen(initial, '').activeScreenId, 'overlay-theme');
  assert.equal(setCloseoutPendingAction(initial, 'create_theme').pendingAction, 'create_theme');
  assert.equal(setCloseoutPendingAction(initial, 'nope').pendingAction, null);
});

test('set and clear closeout screen errors sanitize secrets and derive recovery from code', () => {
  const initial = createCloseoutScreensState();
  const withError = setCloseoutScreenError(initial, 'privacy', {
    code: 'DB_WRITE_FAILED',
    message: 'failed apiKey=sk-secretvaluehere1234',
    retryable: true,
    recoveryActions: ['open_profiles'],
  });

  assert.equal(withError.errors.privacy.code, 'DB_WRITE_FAILED');
  assert.doesNotMatch(withError.errors.privacy.message, /sk-/);
  assert.deepEqual(withError.errors.privacy.recoveryActions, ['retry', 'open_diagnostics']);

  const cleared = clearCloseoutScreenError(withError, 'privacy');
  assert.equal(Object.hasOwn(cleared.errors, 'privacy'), false);
});

test('theme read/create/duplicate intents validate body shape', () => {
  assert.deepEqual(buildThemesListIntent(), {
    type: 'http',
    actionId: 'refresh_themes',
    sensitive: false,
    method: 'GET',
    path: '/api/themes',
  });

  const create = buildThemeCreateIntent({
    name: 'My Theme',
    cssJson: { color: '#fff' },
  });
  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/api/themes');
  assert.deepEqual(create.body, { name: 'My Theme', cssJson: { color: '#fff' } });

  const duplicate = buildThemeDuplicateIntent({
    name: 'My Theme Copy',
    baseThemeId: BUILTIN_THEME_IDS[0],
  });
  assert.equal(duplicate.actionId, 'duplicate_theme');
  assert.equal(duplicate.path, '/api/themes');
  assert.equal(duplicate.body.baseThemeId, BUILTIN_THEME_IDS[0]);

  assert.throws(() => buildThemeCreateIntent({ name: '' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => buildThemeCreateIntent({ name: 'X' }), { code: 'VALIDATION_ERROR' });
  assert.throws(
    () => buildThemeCreateIntent({
      name: 'X',
      cssJson: { apiKey: 'sk-xxxxxxxxxxxxxxxxxxx' },
    }),
    { code: 'VALIDATION_ERROR' },
  );
});

test('theme update/delete intents reject built-ins and no-draft updates', () => {
  const builtIn = createCloseoutScreensState({
    themes: [builtInTheme()],
    selectedThemeId: BUILTIN_THEME_IDS[0],
  });
  assert.throws(() => buildThemeUpdateIntent(builtIn), {
    code: 'CANNOT_UPDATE_BUILT_IN_THEME',
  });
  assert.throws(() => buildThemeDeleteIntent(builtIn), {
    code: 'CANNOT_DELETE_BUILT_IN_THEME',
  });

  const custom = createCloseoutScreensState({
    themes: [customTheme()],
    selectedThemeId: 'custom-1',
  });
  assert.throws(() => buildThemeUpdateIntent(custom), { code: 'VALIDATION_ERROR' });

  const withDraft = updateThemeDraft(custom, { name: 'Renamed' });
  const update = buildThemeUpdateIntent(withDraft);
  assert.equal(update.method, 'PUT');
  assert.equal(update.path, '/api/themes/custom-1');
  assert.deepEqual(update.body, { name: 'Renamed' });

  const remove = buildThemeDeleteIntent(custom);
  assert.equal(remove.method, 'DELETE');
  assert.equal(remove.path, '/api/themes/custom-1');

  assert.throws(() => buildThemeDeleteIntent(createCloseoutScreensState()), {
    code: 'THEME_NOT_FOUND',
  });
});

test('profile theme apply intent validates profileId and overlayThemeId only', () => {
  const intent = buildProfileThemeUpdateIntent({
    profileId: 'profile-1',
    overlayThemeId: 'custom-1',
    apiKey: 'sk-secret-provider-key-123456789',
  });
  assert.equal(intent.method, 'PUT');
  assert.equal(intent.path, '/api/profiles/profile-1');
  assert.deepEqual(intent.body, { overlayThemeId: 'custom-1' });
  assert.equal(JSON.stringify(intent).includes('sk-secret-provider-key-123456789'), false);

  assert.throws(
    () => buildProfileThemeUpdateIntent({ profileId: '', overlayThemeId: 'x' }),
    { code: 'VALIDATION_ERROR' },
  );
  assert.throws(
    () => buildProfileThemeUpdateIntent({ profileId: 'p', overlayThemeId: '' }),
    { code: 'VALIDATION_ERROR' },
  );
});

test('theme editor view disables update_theme without a draft change and on built-ins', () => {
  const custom = createCloseoutScreensState({
    themes: [customTheme()],
    selectedThemeId: 'custom-1',
  });
  const update = buildThemeEditorView(custom).actions.find((action) => action.id === 'update_theme');
  assert.equal(update.enabled, false);
  assert.equal(update.unavailableReason, 'validation_error');

  const withName = updateThemeDraft(custom, { name: 'Renamed' });
  assert.equal(
    buildThemeEditorView(withName).actions.find((action) => action.id === 'update_theme').enabled,
    true,
  );

  const builtIn = createCloseoutScreensState({
    themes: [builtInTheme()],
    selectedThemeId: BUILTIN_THEME_IDS[0],
  });
  const view = buildThemeEditorView(builtIn);
  assert.equal(view.editable, false);
  assert.equal(view.actions.find((action) => action.id === 'update_theme').enabled, false);
  assert.equal(view.actions.find((action) => action.id === 'delete_theme').enabled, false);
});

test('theme result application validates response shapes and keeps selection coherent', () => {
  const initial = createCloseoutScreensState();
  const next = applyThemesResult(initial, { themes: [customTheme()] });
  assert.equal(next.themes.length, 1);
  assert.equal(next.selectedThemeId, 'custom-1');

  assert.throws(() => applyThemesResult(initial, { themes: 'not-an-array' }), {
    code: 'VALIDATION_ERROR',
  });
  assert.throws(() => applyThemesResult(initial, { themes: [{ ...customTheme(), unknown: 1 }] }), {
    code: 'VALIDATION_ERROR',
  });

  const mutated = applyThemeMutationResult(next, customTheme({ name: 'Renamed' }));
  assert.equal(mutated.themes[0].name, 'Renamed');
  assert.deepEqual(mutated.themes.map((theme) => theme.id), ['custom-1']);

  const ordered = createCloseoutScreensState({
    themes: [
      customTheme({ id: 'theme-b', name: 'B' }),
      customTheme({ id: 'theme-a', name: 'A' }),
    ],
    selectedThemeId: 'theme-b',
  });
  const orderedUpdate = applyThemeMutationResult(
    ordered,
    customTheme({ id: 'theme-b', name: 'B Updated' }),
  );
  assert.deepEqual(orderedUpdate.themes.map((theme) => theme.id), ['theme-b', 'theme-a']);
  const orderedAppend = applyThemeMutationResult(
    orderedUpdate,
    customTheme({ id: 'theme-c', name: 'C' }),
  );
  assert.deepEqual(orderedAppend.themes.map((theme) => theme.id), [
    'theme-b',
    'theme-a',
    'theme-c',
  ]);

  assert.throws(() => applyThemeMutationResult(next, { id: 'x' }), {
    code: 'VALIDATION_ERROR',
  });

  const deleted = applyThemeDeleted(next, { ok: true, themeId: 'custom-1' });
  assert.equal(deleted.themes.length, 0);
  assert.equal(deleted.selectedThemeId, null);

  const withBuiltIn = createCloseoutScreensState({
    themes: [builtInTheme(), customTheme()],
    selectedThemeId: BUILTIN_THEME_IDS[0],
  });
  const builtInDeleted = applyThemeDeleted(withBuiltIn, {
    ok: true,
    themeId: BUILTIN_THEME_IDS[0],
  });
  assert.deepEqual(builtInDeleted.themes.map((theme) => theme.id), [
    BUILTIN_THEME_IDS[0],
    'custom-1',
  ]);
  assert.equal(builtInDeleted.selectedThemeId, BUILTIN_THEME_IDS[0]);

  assert.throws(() => applyThemeDeleted(next, { ok: false }), { code: 'VALIDATION_ERROR' });
});

test('OBS view trusts only sanitized 127.0.0.1 overlay URLs and emits status/stream intents', () => {
  const port = 51234;
  const setup = {
    activeProfileId: 'profile-1',
    providerKeySaved: true,
    captureSourceSelected: true,
    roiSaved: true,
  };
  const ok = buildObsSetupViewModel({
    port,
    setup,
    appStatus: {
      backend: 'ready',
      overlayUrl: `http://127.0.0.1:${port}/overlay`,
      overlayClients: 0,
    },
  });

  assert.equal(ok.route.id, 'obs-setup');
  assert.equal(ok.state, 'disconnected');
  assert.equal(ok.overlayUrlTrusted, true);
  assert.equal(ok.overlayUrl, `http://127.0.0.1:${port}/overlay`);
  assert.deepEqual(ok.recommendedDimensions, OBS_RECOMMENDED_DIMENSIONS);
  assert.equal(buildObsSetupActionIntent('refresh_status', ok).path, '/api/status');
  assert.equal(
    buildObsSetupActionIntent('connect_status_stream', ok).url,
    `ws://127.0.0.1:${port}/ws/app`,
  );
  assert.equal(buildObsSetupActionIntent('copy_overlay_url', ok).text, ok.overlayUrl);
  assert.match(buildObsSetupActionIntent('copy_obs_settings', ok).text, /"width": 1920/);
  assert.equal(buildObsSetupActionIntent('open_overlay_browser', ok).url, ok.overlayUrl);

  const bad = buildObsSetupViewModel({
    port,
    setup,
    appStatus: {
      backend: 'ready',
      overlayUrl: 'http://attacker.example/overlay',
      overlayClients: 1,
    },
  });
  assert.equal(bad.overlayUrlTrusted, false);
  assert.equal(bad.overlayUrl, null);
  assert.equal(JSON.stringify(bad).includes('attacker.example'), false);
  assert.throws(() => buildObsSetupActionIntent('copy_overlay_url', bad), {
    code: 'CLOSEOUT_ACTION_UNAVAILABLE',
  });

  const wrongPort = buildObsSetupViewModel({
    port,
    setup,
    appStatus: {
      backend: 'ready',
      overlayUrl: `http://127.0.0.1:${port + 1}/overlay`,
      overlayClients: 1,
    },
  });
  assert.equal(wrongPort.overlayUrlTrusted, false);
});

test('OBS status stream and refresh require a numeric localhost port', () => {
  const noPort = buildObsSetupViewModel({
    port: null,
    appStatus: { backend: 'starting', overlayUrl: null, overlayClients: 0 },
  });
  assert.throws(() => buildObsSetupActionIntent('refresh_status', noPort), {
    code: 'CLOSEOUT_ACTION_UNAVAILABLE',
  });
  assert.throws(() => buildObsSetupActionIntent('connect_status_stream', noPort), {
    code: 'CLOSEOUT_ACTION_UNAVAILABLE',
  });
});

test('privacy view warns when persistence is enabled and validates save budgets', () => {
  const state = createCloseoutScreensState({
    privacySettings: {
      saveRecentOcrText: true,
      recentOcrLimit: 50,
      saveRecentTranslations: true,
      recentTranslationLimit: 50,
      saveDebugScreenshots: true,
      debugRetentionDays: 7,
      debugScreenshotDirectory: '/home/user/Game Live Translator/debug',
    },
  });
  const view = buildPrivacySettingsView(state);
  assert.deepEqual(view.warnings, [
    'ocr_text_persistence',
    'translation_persistence',
    'debug_screenshot_persistence',
  ]);
  assert.equal(view.requiresExplicitOptIn, true);
  assert.equal(view.valid, true);
  assert.equal(view.actions.find((action) => action.id === 'open_debug_folder').enabled, true);
  assert.equal(
    view.actions.find((action) => action.id === 'disable_debug_persistence').enabled,
    true,
  );

  const bad = createCloseoutScreensState({
    privacyDraft: {
      saveRecentOcrText: true,
      recentOcrLimit: 0,
      saveRecentTranslations: false,
      recentTranslationLimit: 0,
      saveDebugScreenshots: false,
      debugRetentionDays: 0,
    },
  });
  assert.equal(buildPrivacySettingsView(bad).valid, false);
  assert.throws(() => buildPrivacySettingsUpdateIntent(bad), {
    code: 'VALIDATION_ERROR',
  });
});

test('privacy read/update and host intents stay path-safe', () => {
  const read = buildPrivacySettingsReadIntent();
  assert.equal(read.method, 'GET');
  assert.equal(read.path, '/api/settings/privacy');

  const withDir = createCloseoutScreensState({
    privacyDraft: {
      saveRecentOcrText: false,
      recentOcrLimit: 0,
      saveRecentTranslations: false,
      recentTranslationLimit: 0,
      saveDebugScreenshots: false,
      debugRetentionDays: 0,
      debugScreenshotDirectory: '/var/lib/debug',
    },
  });
  const update = buildPrivacySettingsUpdateIntent(withDir);
  assert.equal(update.method, 'PUT');
  assert.equal(update.path, '/api/settings/privacy');
  assert.equal(update.body.debugScreenshotDirectory, '/var/lib/debug');

  const open = buildPrivacyHostActionIntent('open_debug_folder', withDir);
  assert.equal(open.type, 'hostCommand');
  assert.equal(open.actionId, 'open_debug_folder');
  assert.equal(JSON.stringify(open).includes('/var/lib/debug'), false);
  assert.equal(buildPrivacyHostActionIntent('clear_debug_data', withDir).actionId, 'clear_debug_data');
  const clearWithoutDir = buildPrivacyHostActionIntent(
    'clear_debug_data',
    createCloseoutScreensState(),
  );
  assert.equal(clearWithoutDir.actionId, 'clear_debug_data');
  assert.equal(JSON.stringify(clearWithoutDir).includes('/var/lib/debug'), false);

  assert.throws(
    () => buildPrivacyHostActionIntent('open_debug_folder', createCloseoutScreensState()),
    { code: 'CLOSEOUT_ACTION_UNAVAILABLE' },
  );
  assert.throws(() => buildPrivacyHostActionIntent('refresh_themes', withDir), {
    code: 'CLOSEOUT_ACTION_UNAVAILABLE',
  });
});

test('applyPrivacySettingsResult mirrors validated settings into the draft', () => {
  const settings = {
    saveRecentOcrText: true,
    recentOcrLimit: 3,
    saveRecentTranslations: false,
    recentTranslationLimit: 0,
    saveDebugScreenshots: false,
    debugRetentionDays: 0,
  };
  const next = applyPrivacySettingsResult(createCloseoutScreensState(), settings);
  assert.equal(next.privacySettings.saveRecentOcrText, true);
  assert.equal(next.privacyDraft.recentOcrLimit, 3);
  const oversized = applyPrivacySettingsResult(createCloseoutScreensState(), {
    ...settings,
    apiKey: 'sk-secret-provider-key-123456789',
    sourceText: 'raw OCR text',
  });
  assert.equal(Object.hasOwn(oversized.privacySettings, 'apiKey'), false);
  assert.equal(Object.hasOwn(oversized.privacyDraft, 'sourceText'), false);
  assert.equal(JSON.stringify(oversized).includes('sk-secret-provider-key-123456789'), false);

  assert.throws(
    () => applyPrivacySettingsResult(createCloseoutScreensState(), {
      ...settings,
      saveRecentOcrText: 'yes',
    }),
    { code: 'VALIDATION_ERROR' },
  );
});

test('diagnostics bundle is validated, re-redacted, and copied as sensitive clipboard text', () => {
  const dirty = validDiagnosticBundle({
    redactedLogs: [
      'normal line',
      'leak Bearer abcdef1234567890token',
      'sk-AAAAAAAAAAAAAAAAA',
      'sourceText: raw OCR line translatedText: translated line screenshotPath=/tmp/a.png',
    ],
  });
  const applied = applyDiagnosticsBundleResult(createCloseoutScreensState(), dirty);
  for (const line of applied.diagnosticBundle.redactedLogs) {
    assert.doesNotMatch(line, /\bBearer\b/);
    assert.doesNotMatch(line, /sk-[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(line, /raw OCR line/);
    assert.doesNotMatch(line, /translated line/);
    assert.doesNotMatch(line, /\/tmp\/a\.png/);
  }

  assert.throws(
    () => applyDiagnosticsBundleResult(createCloseoutScreensState(), {
      ...dirty,
      appVersion: '',
    }),
    { code: 'VALIDATION_ERROR' },
  );

  const copy = buildDiagnosticBundleCopyIntent(applied);
  assert.equal(copy.type, 'clipboard.writeText');
  assert.equal(copy.sensitive, true);
  assert.ok(typeof copy.text === 'string' && copy.text.length > 0);
  assert.doesNotMatch(copy.text, /\bBearer\b/);
  assert.doesNotMatch(copy.text, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(copy.text, /raw OCR line/);
  assert.doesNotMatch(copy.text, /translated line/);
  assert.doesNotMatch(copy.text, /\/tmp\/a\.png/);
  assert.equal(copy.logSafeBody.redactedLogCount, applied.diagnosticBundle.redactedLogs.length);
  assert.equal(Array.isArray(copy.logSafeBody.redactedLogs), false);

  assert.throws(() => buildDiagnosticBundleCopyIntent(createCloseoutScreensState()), {
    code: 'DIAGNOSTICS_FAILED',
  });
});

test('diagnostics view exposes preview lines but log-safe copy summaries expose counts only', () => {
  const state = applyDiagnosticsBundleResult(
    createCloseoutScreensState(),
    validDiagnosticBundle({ redactedLogs: ['a', 'b', 'c'] }),
  );
  const view = buildDiagnosticsView(state);
  assert.equal(view.summary.redactedLogCount, 3);
  assert.equal(view.previewLines.length, 3);
  assert.equal(view.empty, false);
  assert.equal(view.actions.find((action) => action.id === 'copy_diagnostics_bundle').enabled, true);

  const emptyView = buildDiagnosticsView(createCloseoutScreensState());
  assert.equal(emptyView.empty, true);
  assert.equal(
    emptyView.actions.find((action) => action.id === 'copy_diagnostics_bundle').enabled,
    false,
  );

  const fetch = buildDiagnosticsBundleIntent();
  assert.equal(fetch.method, 'GET');
  assert.equal(fetch.path, '/api/diagnostics/bundle');
});

test('safe state log excludes sensitive closeout sentinels and diagnostic logs', () => {
  let state = createCloseoutScreensState({
    themes: [
      customTheme({
        cssJson: {
          color: '#fff',
          apiKey: 'sk-secretvaluehere12345',
          sourceText: 'raw OCR string',
          translatedText: 'translated string',
          screenshotPath: '/tmp/secret.png',
          providerResponse: '{"choices":[]}',
        },
      }),
    ],
    selectedThemeId: 'custom-1',
    themeDraft: {
      name: 'Bearer abcdef1234567890token',
      cssJson: { secretToken: 'sk-AAAAAAAAAAAAAAAAA' },
      previewText: 'raw subtitle text from game',
    },
    privacySettings: {
      saveRecentOcrText: true,
      recentOcrLimit: 5,
      saveRecentTranslations: false,
      recentTranslationLimit: 0,
      saveDebugScreenshots: true,
      debugRetentionDays: 1,
      debugScreenshotDirectory: '/home/user/secret-debug',
    },
  });
  state = applyDiagnosticsBundleResult(
    state,
    validDiagnosticBundle({ redactedLogs: ['Bearer leakedtokenshouldgo'] }),
  );

  const safe = safeCloseoutStateForLog(state);
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(serialized, /\bBearer\b/);
  assert.doesNotMatch(serialized, /raw OCR string/);
  assert.doesNotMatch(serialized, /translated string/);
  assert.doesNotMatch(serialized, /raw subtitle text from game/);
  assert.doesNotMatch(serialized, /\/tmp\/secret\.png/);
  assert.doesNotMatch(serialized, /\/home\/user\/secret-debug/);
  assert.doesNotMatch(serialized, /Bearer leakedtokenshouldgo/);
  assert.equal(safe.diagnosticBundle.redactedLogCount, 1);
  assert.equal(Array.isArray(safe.diagnosticBundle.redactedLogs), false);
  assert.equal(safe.themeDraft.previewText, REDACTED);
});

test('safe intent log redacts body fields, sensitive clipboard text, and debug paths', () => {
  const sensitiveIntent = buildDiagnosticBundleCopyIntent(
    applyDiagnosticsBundleResult(createCloseoutScreensState(), validDiagnosticBundle()),
  );
  const safe = safeCloseoutIntentForLog(sensitiveIntent);
  assert.equal(safe.sensitive, true);
  assert.equal(safe.text, REDACTED);
  assert.equal(safe.body.redactedLogCount, 1);

  const createIntent = buildThemeCreateIntent({
    name: 'My Theme apiKey=sk-AAAAAAAAAAAAAAAAA',
    cssJson: { color: '#fff' },
  });
  assert.doesNotMatch(JSON.stringify(safeCloseoutIntentForLog(createIntent)), /sk-[A-Za-z0-9]{8,}/);

  const privacyIntent = buildPrivacySettingsUpdateIntent(
    createCloseoutScreensState({
      privacyDraft: {
        saveRecentOcrText: false,
        recentOcrLimit: 0,
        saveRecentTranslations: false,
        recentTranslationLimit: 0,
        saveDebugScreenshots: false,
        debugRetentionDays: 0,
        debugScreenshotDirectory: '/home/user/secret-debug',
      },
    }),
  );
  assert.equal(
    safeCloseoutIntentForLog(privacyIntent).body.debugScreenshotDirectory,
    REDACTED,
  );
});

test('sanitizeCloseoutError derives recovery actions from contract code only', () => {
  assert.deepEqual(
    sanitizeCloseoutError({ code: 'THEME_NOT_FOUND', retryable: false }).recoveryActions,
    CLOSEOUT_RECOVERY_ACTIONS_BY_CODE.THEME_NOT_FOUND,
  );
  assert.deepEqual(
    sanitizeCloseoutError({ code: 'CANNOT_DELETE_BUILT_IN_THEME', retryable: false }).recoveryActions,
    ['duplicate_theme'],
  );

  const apiShape = sanitizeCloseoutError({
    error: {
      code: 'DB_UNAVAILABLE',
      message: 'sqlite open failed apiKey=sk-secretvaluehere1234',
      retryable: true,
    },
  });
  assert.ok(apiShape.recoveryActions.includes('retry'));
  assert.ok(apiShape.recoveryActions.includes('restart_backend'));
  assert.doesNotMatch(apiShape.message, /sk-/);

  assert.deepEqual(
    sanitizeCloseoutError({ code: 'UNKNOWN_CODE_X', retryable: false }).recoveryActions,
    DEFAULT_CLOSEOUT_RECOVERY_ACTIONS,
  );
  assert.equal(sanitizeCloseoutError(null), null);
});

test('view model bundles all four screens and exposes pending state', () => {
  const state = createCloseoutScreensState({
    themes: [customTheme(), builtInTheme()],
    selectedThemeId: 'custom-1',
    pendingAction: 'fetch_diagnostics_bundle',
  });
  const view = buildCloseoutScreensViewModel(state, {
    port: 51234,
    setup: {
      activeProfileId: 'profile-1',
      providerKeySaved: true,
      captureSourceSelected: true,
      roiSaved: true,
    },
    appStatus: {
      backend: 'ready',
      overlayUrl: 'http://127.0.0.1:51234/overlay',
      overlayClients: 1,
    },
  });
  assert.deepEqual(view.screens.map((screen) => screen.id), [...CLOSEOUT_SCREEN_IDS]);
  assert.equal(view.theme.editable, true);
  assert.equal(view.obs.state, 'connected');
  assert.equal(view.privacy.id, 'privacy');
  assert.equal(view.diagnostics.id, 'logs-diagnostics');
  assert.equal(view.pendingAction, 'fetch_diagnostics_bundle');
  assert.equal(Object.isFrozen(view), true);
});

test('default theme preview is the safe placeholder for theme previews', () => {
  const view = buildThemeEditorView(createCloseoutScreensState({
    themes: [customTheme()],
    selectedThemeId: 'custom-1',
  }));
  assert.equal(view.preview.text, DEFAULT_THEME_PREVIEW_TEXT);
  assert.equal(view.preview.containsSensitiveText, false);

  const customPreviewState = updateThemeDraft(
    createCloseoutScreensState({ themes: [customTheme()], selectedThemeId: 'custom-1' }),
    { previewText: 'Visible transient OCR text' },
  );
  const customPreview = buildThemeEditorView(customPreviewState);
  assert.equal(customPreview.preview.containsSensitiveText, true);
  assert.equal(
    safeCloseoutStateForLog(customPreviewState).themeDraft.previewText,
    REDACTED,
  );
});
