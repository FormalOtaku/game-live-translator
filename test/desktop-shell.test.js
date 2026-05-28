'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ROUTE_REGISTRY,
  FIRST_CLASS_ROUTE_IDS,
  SIDEBAR_ROUTES,
  REQUIRED_CAPABILITIES,
  RECOVERY_ACTIONS_BY_CODE,
  SAFE_DEFAULT_RECOVERY_ACTIONS,
  FALLBACK_ROUTE_ID,
  ENTRY_ROUTE_WHEN_INCOMPLETE,
  ENTRY_ROUTE_WHEN_COMPLETE,
  isSetupComplete,
  resolveEntryRoute,
  isFirstClassRoute,
  normalizeRoute,
  isTrustedOverlayUrl,
  sanitizeRuntimeStatus,
  sanitizeLastSubtitle,
  sanitizeAppStatus,
  deriveRecoveryActions,
  buildViewModel,
  createDesktopShell,
} = require('../src/ui/desktop-shell');

const COMPLETE_SETUP = Object.freeze({
  activeProfileId: 'profile-1',
  providerKeySaved: true,
  captureSourceSelected: true,
  roiSaved: true,
});

const REQUIRED_FIRST_CLASS_ROUTES = Object.freeze([
  'first-run',
  'home',
  'capture-setup',
  'ocr-preview',
  'translation-settings',
  'glossary',
  'overlay-theme',
  'obs-setup',
  'profiles',
  'privacy',
  'logs-diagnostics',
  'about',
]);

function makeAppStatus(overrides = {}) {
  return {
    backend: 'ready',
    activeProfileId: 'profile-1',
    overlayUrl: 'http://127.0.0.1:39600/overlay',
    overlayClients: 1,
    capture: { state: 'idle', code: null, retryable: false, updatedAt: 't1' },
    ocr: { state: 'idle', code: null, retryable: false, updatedAt: 't2' },
    translation: { state: 'idle', code: null, retryable: false, updatedAt: 't3' },
    lastSubtitle: null,
    ...overrides,
  };
}

test('desktop shell route registry covers every first-class UI screen', () => {
  for (const id of REQUIRED_FIRST_CLASS_ROUTES) {
    assert.ok(ROUTE_REGISTRY[id], `expected route ${id}`);
    assert.equal(Object.isFrozen(ROUTE_REGISTRY[id]), true);
    assert.equal(Object.isFrozen(ROUTE_REGISTRY[id].capabilities), true);
    for (const capability of REQUIRED_CAPABILITIES) {
      assert.equal(
        ROUTE_REGISTRY[id].capabilities[capability],
        true,
        `expected ${id} capability ${capability}`,
      );
    }
  }
  assert.deepEqual(
    [...FIRST_CLASS_ROUTE_IDS].sort(),
    [...REQUIRED_FIRST_CLASS_ROUTES].sort(),
  );
});

test('sidebar excludes first-run and preserves the UI navigation order', () => {
  const sidebarIds = SIDEBAR_ROUTES.map((route) => route.id);
  assert.deepEqual(sidebarIds, [
    'home',
    'capture-setup',
    'ocr-preview',
    'translation-settings',
    'glossary',
    'overlay-theme',
    'obs-setup',
    'profiles',
    'privacy',
    'logs-diagnostics',
    'about',
  ]);
  assert.equal(sidebarIds.includes('first-run'), false);
  assert.equal(Object.isFrozen(SIDEBAR_ROUTES), true);
});

test('setup completion requires explicit active profile, key, source, and roi', () => {
  assert.equal(isSetupComplete(null), false);
  assert.equal(isSetupComplete({}), false);
  assert.equal(isSetupComplete({ ...COMPLETE_SETUP, activeProfileId: '' }), false);
  assert.equal(isSetupComplete({ ...COMPLETE_SETUP, activeProfileId: '   ' }), false);
  assert.equal(isSetupComplete({ ...COMPLETE_SETUP, providerKeySaved: 1 }), false);
  assert.equal(isSetupComplete({ ...COMPLETE_SETUP, captureSourceSelected: 'yes' }), false);
  assert.equal(isSetupComplete({ ...COMPLETE_SETUP, roiSaved: false }), false);
  assert.equal(isSetupComplete(COMPLETE_SETUP), true);

  const polluted = {};
  Object.setPrototypeOf(polluted, COMPLETE_SETUP);
  assert.equal(isSetupComplete(polluted), false);
});

test('entry route is first-run until setup is complete, then home', () => {
  assert.equal(resolveEntryRoute(null), ENTRY_ROUTE_WHEN_INCOMPLETE);
  assert.equal(resolveEntryRoute({}), ENTRY_ROUTE_WHEN_INCOMPLETE);
  assert.equal(resolveEntryRoute(COMPLETE_SETUP), ENTRY_ROUTE_WHEN_COMPLETE);
  assert.equal(ENTRY_ROUTE_WHEN_INCOMPLETE, 'first-run');
  assert.equal(ENTRY_ROUTE_WHEN_COMPLETE, 'home');
});

test('route normalization accepts known ids and never echoes unknown input', () => {
  assert.equal(isFirstClassRoute('home'), true);
  assert.equal(isFirstClassRoute('missing'), false);
  assert.equal(isFirstClassRoute(undefined), false);
  assert.equal(normalizeRoute('glossary'), 'glossary');
  assert.equal(normalizeRoute('missing'), FALLBACK_ROUTE_ID);
  assert.equal(normalizeRoute(null), FALLBACK_ROUTE_ID);
  assert.equal(normalizeRoute(42), FALLBACK_ROUTE_ID);
  assert.equal(normalizeRoute('__proto__'), FALLBACK_ROUTE_ID);
  assert.equal(normalizeRoute('<script>'), FALLBACK_ROUTE_ID);
  assert.equal(normalizeRoute('home', { setup: {} }), 'first-run');
  assert.equal(normalizeRoute('glossary', { setup: {} }), 'first-run');
  assert.equal(normalizeRoute('missing', { setup: {} }), 'first-run');
  assert.equal(normalizeRoute('first-run', { setup: {} }), 'first-run');
  assert.equal(normalizeRoute('about', { setup: {} }), 'about');
  assert.equal(normalizeRoute('glossary', { setup: COMPLETE_SETUP }), 'glossary');
});

test('overlay URL trust requires exact 127.0.0.1 overlay path and optional port match', () => {
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay'), true);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay', { port: null }), true);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay', { port: 0 }), true);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay', { port: undefined }), true);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay', { port: 39600 }), true);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay', { port: 40000 }), false);
  assert.equal(isTrustedOverlayUrl('http://localhost:39600/overlay'), false);
  assert.equal(isTrustedOverlayUrl('http://0.0.0.0:39600/overlay'), false);
  assert.equal(isTrustedOverlayUrl('http://192.168.1.5:39600/overlay'), false);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1/overlay'), false);
  assert.equal(isTrustedOverlayUrl('https://127.0.0.1:39600/overlay'), false);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/api/status'), false);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay?x=1'), false);
  assert.equal(isTrustedOverlayUrl('http://127.0.0.1:39600/overlay#x'), false);
  assert.equal(isTrustedOverlayUrl('http://u:p@127.0.0.1:39600/overlay'), false);
  assert.equal(isTrustedOverlayUrl('not a url'), false);
  assert.equal(isTrustedOverlayUrl(null), false);
  assert.equal(isTrustedOverlayUrl(12345), false);
});

test('runtime status sanitization strips messages and debug payloads', () => {
  const sanitized = sanitizeRuntimeStatus({
    state: 'error',
    code: 'PROVIDER_KEY_MISSING',
    retryable: false,
    message: 'provider key sk-secret-12345 should not appear',
    updatedAt: '2026-05-28T12:00:00.000Z',
    sourceText: 'RAW_SOURCE_TEXT',
    providerResponse: { body: 'do not leak' },
  });

  assert.deepEqual(sanitized, {
    state: 'error',
    code: 'PROVIDER_KEY_MISSING',
    retryable: false,
    updatedAt: '2026-05-28T12:00:00.000Z',
  });
  assert.equal(Object.hasOwn(sanitized, 'message'), false);
  assert.equal(Object.hasOwn(sanitized, 'sourceText'), false);
  assert.equal(Object.hasOwn(sanitized, 'providerResponse'), false);
  assert.equal(sanitizeRuntimeStatus({ state: 'invalid', code: '', retryable: 1 }).state, 'idle');
  assert.equal(sanitizeRuntimeStatus(null), null);
});

test('subtitle sanitization exposes escapedText and frame metadata only', () => {
  const sanitized = sanitizeLastSubtitle({
    id: 'sub-1',
    profileId: 'profile-1',
    themeId: 'classic_subtitle',
    sourceText: 'RAW_SOURCE_TEXT',
    translatedText: '<script>alert(1)</script>',
    escapedText: '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;',
    provider: 'deepl',
    providerKey: 'sk-secret',
    createdAt: '2026-05-28T12:00:00.000Z',
    displayMs: 7000,
    confidence: 0.9,
  });

  assert.deepEqual(sanitized, {
    id: 'sub-1',
    profileId: 'profile-1',
    themeId: 'classic_subtitle',
    createdAt: '2026-05-28T12:00:00.000Z',
    displayMs: 7000,
    escapedText: '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;',
  });
  assert.equal(Object.hasOwn(sanitized, 'sourceText'), false);
  assert.equal(Object.hasOwn(sanitized, 'translatedText'), false);
  assert.equal(Object.hasOwn(sanitized, 'provider'), false);
  assert.equal(Object.hasOwn(sanitized, 'providerKey'), false);
  assert.equal(Object.hasOwn(sanitized, 'confidence'), false);
  assert.equal(Object.isFrozen(sanitized), true);
});

test('app status sanitization distrusts non-local overlay URLs and drops raw fields', () => {
  const sanitized = sanitizeAppStatus(
    makeAppStatus({
      overlayUrl: 'http://192.168.1.5:39600/overlay',
      overlayClients: 2,
      translation: {
        state: 'error',
        code: 'PROVIDER_KEY_MISSING',
        retryable: false,
        message: 'sk-secret',
        updatedAt: 't3',
      },
      lastSubtitle: {
        id: 'sub-1',
        profileId: 'profile-1',
        themeId: 'classic_subtitle',
        escapedText: 'Hello',
        sourceText: 'RAW_SOURCE_TEXT',
        translatedText: 'Hello',
        provider: 'deepl',
        createdAt: 't4',
        displayMs: 7000,
      },
    }),
    { port: 39600 },
  );

  assert.equal(sanitized.overlayUrl, null);
  assert.equal(sanitized.overlayUrlTrusted, false);
  assert.equal(sanitized.overlayClients, 2);
  assert.equal(sanitized.translation.code, 'PROVIDER_KEY_MISSING');
  assert.equal(Object.hasOwn(sanitized.translation, 'message'), false);
  assert.equal(Object.hasOwn(sanitized.lastSubtitle, 'sourceText'), false);
  assert.equal(Object.hasOwn(sanitized.lastSubtitle, 'translatedText'), false);
  assert.equal(Object.hasOwn(sanitized.lastSubtitle, 'provider'), false);

  const trusted = sanitizeAppStatus(makeAppStatus(), { port: 39600 });
  assert.equal(trusted.overlayUrl, 'http://127.0.0.1:39600/overlay');
  assert.equal(trusted.overlayUrlTrusted, true);

  const collapsed = sanitizeAppStatus(makeAppStatus({ backend: 'mystery' }), { port: 39600 });
  assert.equal(collapsed.backend, 'starting');
  assert.equal(sanitizeAppStatus(makeAppStatus({ overlayClients: -1 })).overlayClients, 0);
  assert.equal(sanitizeAppStatus(null), null);
});

test('recovery actions use code and retryable only, not message text', () => {
  assert.deepEqual(deriveRecoveryActions({ state: 'idle' }), []);
  assert.deepEqual(deriveRecoveryActions({ state: 'ok' }), []);
  assert.deepEqual(deriveRecoveryActions({ state: 'running' }), []);

  assert.deepEqual(
    deriveRecoveryActions({
      state: 'error',
      code: 'PROVIDER_KEY_MISSING',
      retryable: false,
    }),
    ['open_translation_settings', 'edit_api_key'],
  );

  const network = deriveRecoveryActions({
    state: 'error',
    code: 'PROVIDER_NETWORK_ERROR',
    retryable: true,
  });
  assert.equal(network[0], 'retry');
  assert.ok(network.includes('check_network'));

  assert.deepEqual(
    deriveRecoveryActions({
      state: 'error',
      code: 'NEW_CODE',
      retryable: true,
    }),
    ['retry', 'open_diagnostics'],
  );
  assert.deepEqual(
    deriveRecoveryActions({
      state: 'error',
      code: 'NEW_CODE',
      retryable: false,
    }),
    [...SAFE_DEFAULT_RECOVERY_ACTIONS],
  );
  assert.deepEqual(
    deriveRecoveryActions({
      state: 'warning',
      code: 'CAPTURE_SOURCE_MISSING',
      retryable: false,
    }),
    ['open_capture_setup', 'refresh_sources'],
  );
  assert.deepEqual(
    deriveRecoveryActions({
      state: 'warning',
      code: 'UNKNOWN_WARNING',
      retryable: true,
    }),
    ['retry', 'open_diagnostics'],
  );

  const messageOnly = deriveRecoveryActions({
    state: 'error',
    code: 'PROVIDER_AUTH_FAILED',
    retryable: false,
    message: 'please retry',
  });
  assert.equal(messageOnly.includes('retry'), false);
});

test('view model gates incomplete setup-required routes to first-run', () => {
  const vm = buildViewModel({
    route: 'glossary',
    appStatus: makeAppStatus(),
    port: 39600,
    setup: { activeProfileId: '', providerKeySaved: false },
  });
  assert.equal(vm.route.id, 'first-run');
  assert.equal(vm.setupComplete, false);
  assert.equal(vm.status.overlayUrlTrusted, true);

  const about = buildViewModel({
    route: 'about',
    appStatus: makeAppStatus(),
    port: 39600,
    setup: { activeProfileId: '', providerKeySaved: false },
  });
  assert.equal(about.route.id, 'about');
  assert.equal(about.setupComplete, false);
});

test('view model routes complete setup to requested route and remains redacted', () => {
  const vm = buildViewModel({
    route: 'translation-settings',
    setup: COMPLETE_SETUP,
    port: 39600,
    appStatus: makeAppStatus({
      translation: {
        state: 'error',
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        message: 'sk-secret-leak',
        updatedAt: 't',
      },
    }),
  });

  assert.equal(vm.route.id, 'translation-settings');
  assert.equal(vm.setupComplete, true);
  assert.equal(vm.status.overlayUrlTrusted, true);
  assert.equal(vm.recoveries.translation[0], 'retry');
  assert.ok(vm.recoveries.translation.includes('wait_and_retry'));
  const serialized = JSON.stringify(vm);
  assert.equal(serialized.includes('sk-secret-leak'), false);
  assert.equal(serialized.includes('message'), false);
});

test('view model falls back to home for unknown route after setup completion', () => {
  const vm = buildViewModel({
    route: '../../../etc/passwd',
    setup: COMPLETE_SETUP,
  });
  assert.equal(vm.route.id, FALLBACK_ROUTE_ID);
});

test('view model defaults to home when route is omitted after setup completion', () => {
  const vm = buildViewModel({ setup: COMPLETE_SETUP });
  assert.equal(vm.route.id, ENTRY_ROUTE_WHEN_COMPLETE);
});

test('desktop shell harness navigates, consumes status, updates setup, and rechecks port trust', () => {
  const shell = createDesktopShell({
    port: 39600,
    setup: COMPLETE_SETUP,
    initialRoute: 'home',
  });

  assert.equal(shell.snapshot().route.id, 'home');
  assert.equal(shell.navigate('glossary').route.id, 'glossary');

  const consumed = shell.consumeAppStatus(makeAppStatus());
  assert.equal(consumed.status.overlayUrlTrusted, true);
  assert.equal(consumed.status.overlayUrl, 'http://127.0.0.1:39600/overlay');

  assert.equal(shell.navigate('missing-route').route.id, FALLBACK_ROUTE_ID);
  assert.equal(shell.updateSetup({ providerKeySaved: false }).route.id, 'first-run');
  const polluted = shell.updateSetup({
    ['__proto__']: {
      activeProfileId: 'polluted',
      providerKeySaved: true,
      captureSourceSelected: true,
      roiSaved: true,
    },
  });
  assert.equal(polluted.setupComplete, false);
  assert.equal(polluted.route.id, 'first-run');
  assert.equal(Object.prototype.activeProfileId, undefined);
  shell.updateSetup(COMPLETE_SETUP);

  const portChanged = shell.setPort(40000);
  assert.equal(portChanged.status.overlayUrlTrusted, false);
  assert.equal(portChanged.status.overlayUrl, null);
});

test('recovery action registry is immutable', () => {
  for (const code of Object.keys(RECOVERY_ACTIONS_BY_CODE)) {
    assert.equal(Object.isFrozen(RECOVERY_ACTIONS_BY_CODE[code]), true);
  }
  assert.equal(Object.isFrozen(SAFE_DEFAULT_RECOVERY_ACTIONS), true);
});
