'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  HOME_READINESS_STATES,
  HOME_ACTION_IDS,
  ACTION_METADATA,
  CARD_IDS,
  FEEDBACK_STATES,
  buildHomeStatusViewModel,
  buildHomeActionIntent,
  createHomeActionFeedback,
} = require('../src/ui/home-status-actions');

const COMPLETE_SETUP = Object.freeze({
  activeProfileId: 'profile-1',
  providerKeySaved: true,
  captureSourceSelected: true,
  roiSaved: true,
});

function makeAppStatus(overrides = {}) {
  return {
    backend: 'ready',
    activeProfileId: 'profile-1',
    overlayUrl: 'http://127.0.0.1:39600/overlay',
    overlayClients: 1,
    capture: { state: 'idle', code: null, retryable: false, updatedAt: 't1' },
    ocr: { state: 'ok', code: 'OCR_TEST_OK', retryable: false, updatedAt: 't2' },
    translation: { state: 'ok', code: 'TRANSLATE_TEST_OK', retryable: false, updatedAt: 't3' },
    lastSubtitle: {
      id: 'sub-1',
      profileId: 'profile-1',
      themeId: 'classic_subtitle',
      escapedText: 'Hero arrived',
      sourceText: '勇者が来た',
      translatedText: 'Hero arrived',
      provider: 'deepl',
      createdAt: 't4',
      displayMs: 7000,
    },
    ...overrides,
  };
}

function findAction(viewModel, actionId) {
  return viewModel.actions.find((action) => action.id === actionId);
}

test('home status constants are frozen and cover the action/card vocabulary', () => {
  assert.equal(Object.isFrozen(HOME_READINESS_STATES), true);
  assert.equal(Object.isFrozen(HOME_ACTION_IDS), true);
  assert.equal(Object.isFrozen(CARD_IDS), true);
  assert.equal(Object.isFrozen(FEEDBACK_STATES), true);
  assert.deepEqual(CARD_IDS, ['backend', 'overlay', 'capture', 'ocr', 'translation']);
  for (const actionId of HOME_ACTION_IDS) {
    assert.equal(Object.isFrozen(ACTION_METADATA[actionId]), true);
    assert.equal(ACTION_METADATA[actionId].id, actionId);
  }
});

test('home status view model builds readiness cards from sanitized AppStatus only', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      translation: {
        state: 'error',
        code: 'PROVIDER_KEY_MISSING',
        retryable: false,
        message: 'DeepL key sk-secret-provider-key-123456789',
        updatedAt: 't3',
      },
      providerKey: 'sk-secret-provider-key-123456789',
      stack: 'Error: raw stack',
      screenshotPath: '/tmp/screenshot.png',
    }),
  });

  assert.equal(Object.isFrozen(viewModel), true);
  assert.equal(viewModel.route.id, 'home');
  assert.equal(viewModel.setupComplete, true);
  assert.equal(viewModel.readiness, 'error');
  assert.equal(viewModel.cards.backend.severity, 'ok');
  assert.equal(viewModel.cards.overlay.severity, 'ok');
  assert.equal(viewModel.cards.translation.code, 'PROVIDER_KEY_MISSING');
  assert.equal(viewModel.cards.translation.actions[0].id, 'open_translation_settings');
  assert.equal(viewModel.lastSubtitle.escapedText, 'Hero arrived');

  const serialized = JSON.stringify(viewModel);
  assert.equal(serialized.includes('sk-secret-provider-key-123456789'), false);
  assert.equal(serialized.includes('勇者が来た'), false);
  assert.equal(serialized.includes('translatedText'), false);
  assert.equal(serialized.includes('sourceText'), false);
  assert.equal(serialized.includes('/tmp/screenshot.png'), false);
  assert.equal(serialized.includes('message'), false);
});

test('trusted overlay URL copy intent is enabled and feedback is controlled', () => {
  const feedback = createHomeActionFeedback({
    actionId: 'copy_overlay_url',
    state: 'ok',
    message: 'copied sk-secret-provider-key-123456789 sourceText=raw',
    updatedAt: '2026-05-28T12:00:00.000Z',
  });
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({ overlayClients: 0 }),
    actionFeedback: feedback,
  });

  assert.equal(viewModel.readiness, 'warning');
  assert.equal(viewModel.cards.overlay.state, 'disconnected');
  assert.equal(findAction(viewModel, 'copy_overlay_url').enabled, true);

  const intent = buildHomeActionIntent('copy_overlay_url', viewModel);
  assert.deepEqual(intent, {
    type: 'clipboard.writeText',
    actionId: 'copy_overlay_url',
    text: 'http://127.0.0.1:39600/overlay',
    sensitive: false,
  });
  assert.equal(viewModel.feedback.messageKey, 'home.copy_overlay_url.ok');
  assert.equal(JSON.stringify(viewModel.feedback).includes('sk-secret-provider-key-123456789'), false);
  assert.equal(JSON.stringify(viewModel.feedback).includes('sourceText=raw'), false);
});

test('untrusted overlay URLs are unavailable and never copied or serialized', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      overlayUrl: 'http://192.168.1.10:39600/overlay',
      overlayClients: 3,
    }),
  });

  assert.equal(viewModel.readiness, 'error');
  assert.equal(viewModel.cards.overlay.overlayUrl, null);
  assert.equal(viewModel.cards.overlay.overlayUrlTrusted, false);
  assert.equal(findAction(viewModel, 'copy_overlay_url').enabled, false);
  assert.equal(JSON.stringify(viewModel).includes('192.168.1.10'), false);
  assert.throws(
    () => buildHomeActionIntent('copy_overlay_url', viewModel),
    (error) => error.code === 'HOME_ACTION_UNAVAILABLE' &&
      error.details.reason === 'overlay_url_untrusted',
  );
});

test('active capture with healthy backend, overlay, OCR, and translation is ready', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      overlayClients: 1,
      capture: { state: 'running', code: 'CAPTURE_RUNNING', retryable: false, updatedAt: 't1' },
      ocr: { state: 'ok', code: 'OCR_TEST_OK', retryable: false, updatedAt: 't2' },
      translation: { state: 'ok', code: 'TRANSLATE_TEST_OK', retryable: false, updatedAt: 't3' },
    }),
  });

  assert.equal(viewModel.readiness, 'ready');
  assert.equal(viewModel.cards.capture.state, 'running');
  assert.equal(viewModel.cards.capture.severity, 'ok');
  assert.equal(findAction(viewModel, 'stop_capture').enabled, true);
});

test('status refresh and app-status stream intents use only the selected localhost port', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      overlayUrl: 'http://127.0.0.1:39600/overlay',
    }),
  });

  assert.deepEqual(buildHomeActionIntent('refresh_status', viewModel), {
    type: 'http',
    actionId: 'refresh_status',
    method: 'GET',
    path: '/api/status',
    sensitive: false,
  });
  assert.deepEqual(buildHomeActionIntent('connect_status_stream', viewModel), {
    type: 'websocket',
    actionId: 'connect_status_stream',
    url: 'ws://127.0.0.1:39600/ws/app',
    path: '/ws/app',
    port: 39600,
    sensitive: false,
  });

  const missingPort = buildHomeStatusViewModel({
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus(),
  });
  assert.equal(findAction(missingPort, 'connect_status_stream').enabled, false);
  assert.throws(
    () => buildHomeActionIntent('connect_status_stream', missingPort),
    (error) => error.code === 'HOME_ACTION_UNAVAILABLE' &&
      error.details.reason === 'port_missing',
  );
});

test('home status can render backend recovery before setup is complete when explicit', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: {},
    backendRecovery: true,
    appStatus: makeAppStatus({
      backend: 'error',
      activeProfileId: null,
      overlayUrl: 'http://127.0.0.1:39600/overlay',
      capture: { state: 'idle', code: null, retryable: false, updatedAt: 't1' },
      ocr: { state: 'idle', code: null, retryable: false, updatedAt: 't2' },
      translation: { state: 'idle', code: null, retryable: false, updatedAt: 't3' },
    }),
  });

  assert.equal(viewModel.route.id, 'home');
  assert.equal(viewModel.setupComplete, false);
  assert.equal(viewModel.readiness, 'error');
  assert.equal(findAction(viewModel, 'restart_backend').enabled, true);
  assert.equal(findAction(viewModel, 'copy_diagnostics').enabled, true);
  assert.equal(findAction(viewModel, 'rerun_first_run').enabled, true);
  assert.deepEqual(buildHomeActionIntent('copy_diagnostics', viewModel), {
    type: 'navigate',
    actionId: 'copy_diagnostics',
    route: 'logs-diagnostics',
    command: 'copy_diagnostics',
    sensitive: false,
  });
  assert.deepEqual(buildHomeActionIntent('rerun_first_run', viewModel), {
    type: 'navigate',
    actionId: 'rerun_first_run',
    route: 'first-run',
    sensitive: false,
  });
});

test('capture start and stop intents use only sanitized active profile state', () => {
  const idle = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({ activeProfileId: ' profile-capture ' }),
  });
  assert.deepEqual(buildHomeActionIntent('start_capture', idle), {
    type: 'http',
    actionId: 'start_capture',
    method: 'POST',
    path: '/api/capture/start',
    sensitive: false,
    body: { profileId: 'profile-capture' },
  });
  assert.throws(
    () => buildHomeActionIntent('stop_capture', idle),
    (error) => error.code === 'HOME_ACTION_UNAVAILABLE' &&
      error.details.reason === 'capture_not_running',
  );

  const running = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      activeProfileId: 'profile-capture',
      capture: { state: 'running', code: 'CAPTURE_RUNNING', retryable: false, updatedAt: 't1' },
    }),
  });
  assert.equal(findAction(running, 'start_capture').enabled, false);
  assert.equal(findAction(running, 'start_capture').unavailableReason, 'capture_running');
  assert.deepEqual(buildHomeActionIntent('stop_capture', running), {
    type: 'http',
    actionId: 'stop_capture',
    method: 'POST',
    path: '/api/capture/stop',
    sensitive: false,
  });

  const noProfile = buildHomeStatusViewModel({ port: 39600, setup: {}, appStatus: null });
  assert.equal(findAction(noProfile, 'start_capture').enabled, false);
});

test('recovery action intents map to navigation and host commands without message parsing', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      capture: {
        state: 'warning',
        code: 'CAPTURE_SOURCE_MISSING',
        retryable: false,
        message: 'retry and sk-secret-provider-key-123456789',
        updatedAt: 't1',
      },
      translation: {
        state: 'error',
        code: 'PROVIDER_NETWORK_ERROR',
        retryable: true,
        message: 'please retry',
        updatedAt: 't3',
      },
      backend: 'degraded',
    }),
  });

  assert.deepEqual(buildHomeActionIntent('open_capture_setup', viewModel), {
    type: 'navigate',
    actionId: 'open_capture_setup',
    route: 'capture-setup',
    sensitive: false,
  });
  assert.deepEqual(buildHomeActionIntent('refresh_sources', viewModel), {
    type: 'navigate',
    actionId: 'refresh_sources',
    route: 'capture-setup',
    command: 'refresh_sources',
    sensitive: false,
  });
  assert.deepEqual(buildHomeActionIntent('check_network', viewModel), {
    type: 'hostCommand',
    actionId: 'check_network',
    command: 'open_network_troubleshooting',
    sensitive: false,
  });
  assert.deepEqual(buildHomeActionIntent('retry', viewModel), {
    type: 'hostCommand',
    actionId: 'retry',
    command: 'retry_last_action',
    sensitive: false,
  });
  assert.deepEqual(buildHomeActionIntent('restart_backend', viewModel), {
    type: 'hostCommand',
    actionId: 'restart_backend',
    command: 'restart_backend',
    sensitive: false,
  });

  const providerKeyMissing = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      translation: {
        state: 'error',
        code: 'PROVIDER_KEY_MISSING',
        retryable: false,
        updatedAt: 't3',
      },
    }),
  });
  assert.deepEqual(buildHomeActionIntent('open_translation_settings', providerKeyMissing), {
    type: 'navigate',
    actionId: 'open_translation_settings',
    route: 'translation-settings',
    sensitive: false,
  });
  assert.equal(JSON.stringify(viewModel).includes('please retry'), false);
});

test('home view model and intents stay frozen and reject unknown actions safely', () => {
  const viewModel = buildHomeStatusViewModel({
    port: 39600,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus(),
  });

  assert.equal(Object.isFrozen(viewModel.cards), true);
  assert.equal(Object.isFrozen(viewModel.cards.overlay.actions), true);
  assert.equal(Object.isFrozen(viewModel.actions), true);
  assert.equal(Object.isFrozen(buildHomeActionIntent('open_obs_setup', viewModel)), true);
  assert.deepEqual(buildHomeActionIntent('open_obs_setup', viewModel), {
    type: 'navigate',
    actionId: 'open_obs_setup',
    route: 'obs-setup',
    sensitive: false,
  });
  assert.throws(
    () => buildHomeActionIntent('__proto__', viewModel),
    (error) => error.code === 'HOME_ACTION_UNAVAILABLE' &&
      error.details.reason === 'unknown_action',
  );
});
