'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DESKTOP_IPC_BRIDGE_SCHEMA_VERSION,
  DESKTOP_IPC_CHANNEL,
  IPC_INTENT_TYPES,
  IPC_HOST_COMMANDS,
  IPC_PRIVACY_GUARANTEES,
  createDesktopIpcBridge,
} = require('../src/desktop/ipc-bridge');
const {
  buildHomeActionIntent,
  buildHomeStatusViewModel,
} = require('../src/ui/home-status-actions');
const {
  createCloseoutScreensState,
  buildDiagnosticBundleCopyIntent,
  buildObsSetupActionIntent,
  buildObsSetupViewModel,
  buildPrivacyHostActionIntent,
  applyDiagnosticsBundleResult,
  updatePrivacyDraft,
} = require('../src/ui/closeout-screens');

const FIXED_TIME = '2026-05-28T12:00:00.000Z';
const COMPLETE_SETUP = Object.freeze({
  activeProfileId: 'profile-1',
  providerKeySaved: true,
  captureSourceSelected: true,
  roiSaved: true,
});

function makeRecorder(result) {
  const calls = [];
  const fn = async (payload) => {
    calls.push(payload);
    if (result instanceof Error) throw result;
    return result;
  };
  fn.calls = calls;
  return fn;
}

function makeAppStatus(overrides = {}) {
  return {
    backend: 'ready',
    activeProfileId: 'profile-1',
    overlayUrl: 'http://127.0.0.1:41000/overlay',
    overlayClients: 1,
    capture: { state: 'idle', code: null, retryable: false, updatedAt: FIXED_TIME },
    ocr: { state: 'ok', code: 'OCR_TEST_OK', retryable: false, updatedAt: FIXED_TIME },
    translation: { state: 'ok', code: 'TRANSLATE_TEST_OK', retryable: false, updatedAt: FIXED_TIME },
    ...overrides,
  };
}

function makeHomeViewModel(overrides = {}) {
  return buildHomeStatusViewModel({
    port: 41000,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus(),
    ...overrides,
  });
}

function createDiagnosticBundle() {
  return {
    generatedAt: FIXED_TIME,
    appVersion: '0.1.0',
    backendVersion: '0.1.0',
    os: 'linux',
    activeProfileId: 'profile-1',
    redactedLogs: [
      'provider key [REDACTED]',
      'source text [REDACTED]',
      'translated text [REDACTED]',
    ],
    redactionSummary: {
      apiKeysRemoved: true,
      ocrTextIncluded: false,
      translatedTextIncluded: false,
      imagesIncluded: false,
    },
  };
}

test('desktop IPC constants are frozen and expose the single channel vocabulary', () => {
  assert.equal(DESKTOP_IPC_BRIDGE_SCHEMA_VERSION, 'desktop-ipc-bridge.v1');
  assert.equal(DESKTOP_IPC_CHANNEL, 'gameLiveTranslator:intent');
  assert.equal(Object.isFrozen(IPC_INTENT_TYPES), true);
  assert.equal(Object.isFrozen(IPC_HOST_COMMANDS), true);
  assert.equal(Object.isFrozen(IPC_PRIVACY_GUARANTEES), true);
  assert.deepEqual(IPC_INTENT_TYPES, ['http', 'websocket', 'clipboard.writeText', 'navigate', 'hostCommand']);
  assert.ok(IPC_HOST_COMMANDS.includes('restart_backend'));
  assert.ok(IPC_HOST_COMMANDS.includes('open_url'));
});

test('HTTP intent dispatch accepts local API paths and omits adapter body from result', async () => {
  const http = makeRecorder({ status: 200, body: 'sourceText=private translatedText=private' });
  const bridge = createDesktopIpcBridge({ adapters: { http } });
  const intent = buildHomeActionIntent('refresh_status', makeHomeViewModel());

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.equal(result.intentType, 'http');
  assert.deepEqual(http.calls, [{ method: 'GET', path: '/api/status' }]);
  assert.deepEqual(result.result, { delivered: true, status: 200 });
  assert.equal(JSON.stringify(result).includes('sourceText=private'), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.result), true);

  const health = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    actionId: 'health_check',
    method: 'GET',
    path: '/health',
    sensitive: false,
  });
  assert.equal(health.ok, true);
  assert.deepEqual(http.calls[1], { method: 'GET', path: '/health' });
});

test('HTTP capture POST intent forwards only safe body metadata to the localhost adapter', async () => {
  const http = makeRecorder({ status: 202 });
  const bridge = createDesktopIpcBridge({ adapters: { http } });
  const intent = buildHomeActionIntent('start_capture', makeHomeViewModel());

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.deepEqual(http.calls, [{
    method: 'POST',
    path: '/api/capture/start',
    body: { profileId: 'profile-1' },
  }]);
  assert.deepEqual(result.result, { delivered: true, status: 202 });
});

test('HTTP intent rejects remote URLs, unsupported paths, sensitive bodies, and unsupported methods', async () => {
  const bridge = createDesktopIpcBridge({ adapters: { http: makeRecorder({ status: 200 }) } });

  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'GET',
    path: 'http://127.0.0.1:41000/api/status',
  })).error.code, 'IPC_HTTP_PATH_INVALID');
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'GET',
    path: '/overlay',
  })).error.code, 'IPC_HTTP_PATH_INVALID');
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'GET',
    path: '/api/status?debug=1',
  })).error.code, 'IPC_HTTP_PATH_INVALID');
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'GET',
    path: '/api/../debug',
  })).error.code, 'IPC_HTTP_PATH_INVALID');
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'TRACE',
    path: '/api/status',
  })).error.code, 'IPC_HTTP_METHOD_INVALID');
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'POST',
    path: '/api/translate/test',
    body: { apiKey: 'sk-ABCDEFGHIJKLMNOP123456' },
  })).error.code, 'IPC_BODY_UNSAFE');
});

test('WebSocket intent dispatch accepts only trusted app status stream URL', async () => {
  const websocket = makeRecorder({ connected: true });
  const bridge = createDesktopIpcBridge({ adapters: { websocket } });
  const intent = buildHomeActionIntent('connect_status_stream', makeHomeViewModel());

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.deepEqual(websocket.calls, [{
    url: 'ws://127.0.0.1:41000/ws/app',
    port: 41000,
    path: '/ws/app',
  }]);
  assert.deepEqual(result.result, { connected: true });

  const remote = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'websocket',
    url: 'ws://localhost:41000/ws/app',
    path: '/ws/app',
    port: 41000,
  });
  assert.equal(remote.ok, false);
  assert.equal(remote.error.code, 'IPC_STATUS_WS_URL_UNTRUSTED');
});

test('clipboard intent writes trusted overlay URL but never returns copied text', async () => {
  const clipboard = makeRecorder();
  const bridge = createDesktopIpcBridge({ adapters: { clipboard } });
  const intent = buildHomeActionIntent('copy_overlay_url', makeHomeViewModel());

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.equal(clipboard.calls[0].text, 'http://127.0.0.1:41000/overlay');
  assert.equal(clipboard.calls[0].sensitive, false);
  assert.deepEqual(result.result, { written: true, sensitive: false });
  assert.equal(JSON.stringify(result).includes('http://127.0.0.1:41000/overlay'), false);
});

test('sensitive diagnostics clipboard is allowed only for diagnostics copy and logs are redacted', async () => {
  const clipboard = makeRecorder();
  const logs = [];
  const bridge = createDesktopIpcBridge({
    adapters: { clipboard },
    logger: (entry) => logs.push(entry),
  });
  const state = applyDiagnosticsBundleResult(createCloseoutScreensState(), createDiagnosticBundle());
  const intent = buildDiagnosticBundleCopyIntent(state);

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.equal(clipboard.calls.length, 1);
  assert.equal(clipboard.calls[0].sensitive, true);
  assert.ok(clipboard.calls[0].text.includes('"redactionSummary"'));
  assert.deepEqual(result.result, { written: true, sensitive: true });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].type, 'clipboard.writeText');
  assert.equal(logs[0].textRedacted, true);
  assert.equal(JSON.stringify(logs[0]).includes('"redactedLogs"'), false);
  assert.equal(JSON.stringify(result).includes('"redactedLogs"'), false);

  const rejected = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'clipboard.writeText',
    actionId: 'copy_overlay_url',
    text: 'secret',
    sensitive: true,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'IPC_CLIPBOARD_TEXT_INVALID');
});

test('route navigation intent returns route metadata and performs no host side effect', async () => {
  const bridge = createDesktopIpcBridge();
  const intent = buildHomeActionIntent('open_obs_setup', makeHomeViewModel());

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.deepEqual(result.result, {
    navigated: true,
    route: 'obs-setup',
  });
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'navigate',
    route: '../outside',
  })).error.code, 'IPC_NAVIGATE_ROUTE_INVALID');
});

test('restart_backend host command routes through lifecycle and returns sanitized state only', async () => {
  const lifecycleCalls = [];
  const lifecycle = {
    async executeHostCommand(intent) {
      lifecycleCalls.push(intent);
      return {
        state: 'ready',
        backendState: 'ready',
        overlayUrl: 'http://127.0.0.1:41000/overlay',
        secretInternal: 'sourceText=private translatedText=private',
      };
    },
  };
  const bridge = createDesktopIpcBridge({ lifecycle });
  const viewModel = makeHomeViewModel({
    appStatus: makeAppStatus({
      backend: 'error',
      translation: {
        state: 'error',
        code: 'PORT_UNAVAILABLE',
        retryable: true,
        updatedAt: FIXED_TIME,
      },
    }),
  });
  const intent = buildHomeActionIntent('restart_backend', viewModel);

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.deepEqual(lifecycleCalls, [{
    type: 'hostCommand',
    actionId: 'restart_backend',
    command: 'restart_backend',
    sensitive: false,
  }]);
  assert.deepEqual(result.result, {
    command: 'restart_backend',
    lifecycleState: 'ready',
    backendState: 'ready',
  });
  assert.equal(JSON.stringify(result).includes('sourceText=private'), false);
});

test('OBS open_url host command accepts only trusted overlay URL', async () => {
  const browser = makeRecorder();
  const bridge = createDesktopIpcBridge({ adapters: { browser } });
  const viewModel = buildObsSetupViewModel({
    port: 41000,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus(),
  });
  const intent = buildObsSetupActionIntent('open_overlay_browser', viewModel);

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.deepEqual(browser.calls, [{ url: 'http://127.0.0.1:41000/overlay' }]);
  assert.deepEqual(result.result, { command: 'open_url', opened: true, urlTrusted: true });

  const remote = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'hostCommand',
    actionId: 'open_overlay_browser',
    command: 'open_url',
    url: 'http://localhost:41000/overlay',
  });
  assert.equal(remote.ok, false);
  assert.equal(remote.error.code, 'IPC_OVERLAY_URL_UNTRUSTED');

  const wrongPath = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'hostCommand',
    actionId: 'open_overlay_browser',
    command: 'open_url',
    url: 'http://127.0.0.1:41000/admin',
  });
  assert.equal(wrongPath.ok, false);
  assert.equal(wrongPath.error.code, 'IPC_OVERLAY_URL_UNTRUSTED');
});

test('privacy debug host commands call adapter with command only and never serialize debug paths', async () => {
  const privacy = makeRecorder();
  const bridge = createDesktopIpcBridge({ adapters: { privacy } });
  const state = updatePrivacyDraft(createCloseoutScreensState(), {
    saveDebugScreenshots: true,
    debugScreenshotDirectory: '/home/user/private-debug',
    debugRetentionDays: 1,
  });
  const openIntent = buildPrivacyHostActionIntent('open_debug_folder', state);
  const clearIntent = buildPrivacyHostActionIntent('clear_debug_data', state);

  const opened = await bridge.dispatch(DESKTOP_IPC_CHANNEL, openIntent);
  const cleared = await bridge.dispatch(DESKTOP_IPC_CHANNEL, clearIntent);

  assert.equal(opened.ok, true);
  assert.equal(cleared.ok, true);
  assert.deepEqual(privacy.calls, [
    { command: 'open_debug_folder' },
    { command: 'clear_debug_data' },
  ]);
  assert.equal(JSON.stringify(opened).includes('/home/user/private-debug'), false);
  assert.equal(JSON.stringify(cleared).includes('/home/user/private-debug'), false);
});

test('troubleshooting host commands are acknowledged without arbitrary payloads', async () => {
  const troubleshooting = makeRecorder();
  const bridge = createDesktopIpcBridge({ adapters: { troubleshooting } });
  const intent = buildHomeActionIntent('check_network', makeHomeViewModel({
    appStatus: makeAppStatus({
      translation: {
        state: 'error',
        code: 'PROVIDER_NETWORK_ERROR',
        retryable: true,
        updatedAt: FIXED_TIME,
      },
    }),
  }));

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, intent);

  assert.equal(result.ok, true);
  assert.deepEqual(troubleshooting.calls, [{ command: 'open_network_troubleshooting' }]);
  assert.deepEqual(result.result, { command: 'open_network_troubleshooting', acknowledged: true });
});

test('bridge rejects unsupported channel, inherited payloads, unknown fields, and unsupported commands', async () => {
  const bridge = createDesktopIpcBridge();
  assert.equal((await bridge.dispatch('attacker:intent', {
    type: 'navigate',
    route: 'home',
  })).error.code, 'IPC_CHANNEL_INVALID');

  const inherited = Object.create({ type: 'navigate', route: 'home' });
  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, inherited)).error.code, 'IPC_INTENT_INVALID');

  assert.equal((await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'navigate',
    route: 'home',
    payload: 'rm -rf /',
  })).error.code, 'IPC_INTENT_INVALID');

  const unsupported = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'hostCommand',
    command: 'execute_shell',
    payload: 'rm -rf /',
  });
  assert.equal(unsupported.error.code, 'IPC_INTENT_INVALID');
  assert.equal(JSON.stringify(unsupported).includes('rm -rf'), false);
});

test('sensitive host commands and missing adapters fail with sanitized errors', async () => {
  const bridge = createDesktopIpcBridge();
  const sensitive = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'hostCommand',
    command: 'restart_backend',
    sensitive: true,
  });
  assert.equal(sensitive.error.code, 'IPC_HOST_COMMAND_SENSITIVE_REJECTED');

  const missing = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'hostCommand',
    command: 'restart_backend',
  });
  assert.equal(missing.error.code, 'IPC_ADAPTER_UNAVAILABLE');
  assert.deepEqual(missing.error.details, { command: 'restart_backend' });
});

test('adapter failures are sanitized without stack traces, raw messages, or paths', async () => {
  const failure = new Error('apiKey=sk-ABCDEFGHIJKLMNOP123456 at /home/user/private.js');
  failure.stack = 'Error: apiKey=sk-ABCDEFGHIJKLMNOP123456\n    at /home/user/private.js:1:1';
  const bridge = createDesktopIpcBridge({
    adapters: {
      http: async () => {
        throw failure;
      },
    },
  });

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'http',
    method: 'GET',
    path: '/api/status',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'IPC_ADAPTER_FAILED');
  const serialized = JSON.stringify({
    error: result.error,
    result: result.result,
  });
  assert.equal(serialized.includes('sk-ABCDEFGHIJKLMNOP123456'), false);
  assert.equal(serialized.includes('/home/user/private.js'), false);
  assert.equal(serialized.includes('stack'), false);
});

test('safeIntentForLog redacts clipboard text and exposes only safe metadata', () => {
  const bridge = createDesktopIpcBridge();
  const log = bridge.safeIntentForLog({
    type: 'clipboard.writeText',
    actionId: 'copy_diagnostics_bundle',
    text: 'sourceText=private translatedText=private apiKey=sk-ABCDEFGHIJKLMNOP123456',
    sensitive: true,
  });

  assert.equal(log.type, 'clipboard.writeText');
  assert.equal(log.actionId, 'copy_diagnostics_bundle');
  assert.equal(log.textRedacted, true);
  assert.equal(log.sensitive, true);
  assert.equal(JSON.stringify(log).includes('sourceText=private'), false);
  assert.equal(JSON.stringify(log).includes('sk-ABCDEFGHIJKLMNOP123456'), false);
  assert.equal(Object.isFrozen(log), true);
});

test('describe and result envelopes are frozen and privacy-safe', async () => {
  const bridge = createDesktopIpcBridge({
    adapters: { clipboard: makeRecorder() },
  });
  const description = bridge.describe();
  assert.equal(Object.isFrozen(description), true);
  assert.equal(description.channel, DESKTOP_IPC_CHANNEL);
  assert.equal(description.privacy.clipboardTextSerialized, false);

  const result = await bridge.dispatch(DESKTOP_IPC_CHANNEL, {
    type: 'clipboard.writeText',
    actionId: 'copy_overlay_url',
    text: 'http://127.0.0.1:41000/overlay',
    sensitive: false,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.privacy), true);
  assert.equal(result.schemaVersion, DESKTOP_IPC_BRIDGE_SCHEMA_VERSION);
  assert.equal(result.privacy.providerKeysSerialized, false);
  assert.equal(result.privacy.rawOcrTextSerialized, false);
  assert.equal(result.privacy.translatedTextSerialized, false);
  assert.equal(result.privacy.screenshotsSerialized, false);
});
