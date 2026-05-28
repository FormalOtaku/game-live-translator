'use strict';

// T-011-001: dependency-free desktop UI shell route/state contract for the
// future Electron/React renderer. This module is pure JS, performs no I/O,
// stores nothing durably, and has no runtime dependency on the local API server.

const ROUTE_GROUPS = Object.freeze({
  LIVE: 'live',
  TRANSLATION: 'translation',
  OUTPUT: 'output',
  CONFIGURE: 'configure',
  HELP: 'help',
});

const REQUIRED_CAPABILITIES = Object.freeze([
  'loading',
  'empty',
  'error',
  'success',
  'recovery',
]);

function freezeCapabilities() {
  const capabilities = Object.create(null);
  for (const capability of REQUIRED_CAPABILITIES) {
    capabilities[capability] = true;
  }
  return Object.freeze(capabilities);
}

function defineRoute({ id, title, group, requiresSetup, sidebar }) {
  return Object.freeze({
    id,
    title,
    group: group ?? null,
    requiresSetup: requiresSetup === true,
    sidebar: sidebar === true,
    capabilities: freezeCapabilities(),
  });
}

const ROUTE_DEFINITIONS = Object.freeze([
  defineRoute({
    id: 'first-run',
    title: 'First-Run Wizard',
    group: null,
    requiresSetup: false,
    sidebar: false,
  }),
  defineRoute({
    id: 'home',
    title: 'Home / Status',
    group: ROUTE_GROUPS.LIVE,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'capture-setup',
    title: 'Capture Setup',
    group: ROUTE_GROUPS.LIVE,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'ocr-preview',
    title: 'OCR Preview',
    group: ROUTE_GROUPS.LIVE,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'translation-settings',
    title: 'Translation Settings',
    group: ROUTE_GROUPS.TRANSLATION,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'glossary',
    title: 'Glossary',
    group: ROUTE_GROUPS.TRANSLATION,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'overlay-theme',
    title: 'Overlay Theme Editor',
    group: ROUTE_GROUPS.OUTPUT,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'obs-setup',
    title: 'OBS Setup Guide',
    group: ROUTE_GROUPS.OUTPUT,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'profiles',
    title: 'Profiles',
    group: ROUTE_GROUPS.CONFIGURE,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'privacy',
    title: 'Privacy Settings',
    group: ROUTE_GROUPS.CONFIGURE,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'logs-diagnostics',
    title: 'Logs / Diagnostics',
    group: ROUTE_GROUPS.HELP,
    requiresSetup: true,
    sidebar: true,
  }),
  defineRoute({
    id: 'about',
    title: 'About / Support',
    group: ROUTE_GROUPS.HELP,
    requiresSetup: false,
    sidebar: true,
  }),
]);

const ROUTE_REGISTRY = Object.freeze(
  ROUTE_DEFINITIONS.reduce((registry, route) => {
    registry[route.id] = route;
    return registry;
  }, Object.create(null)),
);

const FIRST_CLASS_ROUTE_IDS = Object.freeze(ROUTE_DEFINITIONS.map((route) => route.id));

// Sidebar order matches UI_SPEC.md navigation groups. First-Run is intentionally
// excluded because it is an entry route, not a persistent destination.
const SIDEBAR_ROUTES = Object.freeze(
  ROUTE_DEFINITIONS.filter((route) => route.sidebar).map((route) => route),
);

const FALLBACK_ROUTE_ID = 'home';
const ENTRY_ROUTE_WHEN_INCOMPLETE = 'first-run';
const ENTRY_ROUTE_WHEN_COMPLETE = 'home';

const RUNTIME_STATES = Object.freeze([
  'idle',
  'running',
  'ok',
  'warning',
  'error',
]);

const BACKEND_STATES = Object.freeze([
  'starting',
  'ready',
  'degraded',
  'error',
]);

const RECOVERY_ACTIONS_BY_CODE = Object.freeze({
  PROVIDER_KEY_MISSING: Object.freeze(['open_translation_settings', 'edit_api_key']),
  PROVIDER_AUTH_FAILED: Object.freeze(['edit_api_key', 'open_translation_settings']),
  PROVIDER_RATE_LIMITED: Object.freeze(['wait_and_retry']),
  PROVIDER_QUOTA_EXCEEDED: Object.freeze(['open_translation_settings', 'switch_provider']),
  PROVIDER_NETWORK_ERROR: Object.freeze(['check_network']),
  PROVIDER_RESPONSE_INVALID: Object.freeze(['open_diagnostics']),
  PROVIDER_UNKNOWN: Object.freeze(['open_translation_settings']),
  TARGET_LANG_INVALID: Object.freeze(['open_translation_settings']),

  CAPTURE_SOURCE_MISSING: Object.freeze(['open_capture_setup', 'refresh_sources']),
  CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE: Object.freeze(['refresh_sources']),
  CAPTURE_ALREADY_RUNNING: Object.freeze(['stop_capture']),
  CAPTURE_NOT_RUNNING: Object.freeze(['start_capture']),
  CAPTURE_FAILED: Object.freeze(['restart_backend', 'open_diagnostics']),
  CAPTURE_ENUM_FAILED: Object.freeze(['refresh_sources', 'open_diagnostics']),

  OCR_ENGINE_ERROR: Object.freeze(['open_diagnostics']),
  ROI_MISSING: Object.freeze(['open_capture_setup', 'redraw_roi']),

  PROFILE_NOT_FOUND: Object.freeze(['open_profiles']),
  DB_UNAVAILABLE: Object.freeze(['restart_backend', 'open_diagnostics']),

  BACKEND_NOT_READY: Object.freeze(['wait_and_retry']),
  PORT_UNAVAILABLE: Object.freeze(['restart_backend']),
  WS_REJECTED: Object.freeze(['restart_backend']),
  RUNTIME_STATUS_SOURCE_FAILED: Object.freeze(['restart_backend', 'open_diagnostics']),
  DIAGNOSTICS_FAILED: Object.freeze(['open_diagnostics']),
});

const SAFE_DEFAULT_RECOVERY_ACTIONS = Object.freeze(['open_diagnostics']);
const SETUP_FIELDS = Object.freeze([
  'activeProfileId',
  'providerKeySaved',
  'captureSourceSelected',
  'roiSaved',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isSetupComplete(setup) {
  if (!isPlainObject(setup)) return false;
  return (
    hasOwn(setup, 'activeProfileId') &&
    hasOwn(setup, 'providerKeySaved') &&
    hasOwn(setup, 'captureSourceSelected') &&
    hasOwn(setup, 'roiSaved') &&
    isNonEmptyString(setup.activeProfileId) &&
    setup.providerKeySaved === true &&
    setup.captureSourceSelected === true &&
    setup.roiSaved === true
  );
}

function resolveEntryRoute(setup) {
  return isSetupComplete(setup)
    ? ENTRY_ROUTE_WHEN_COMPLETE
    : ENTRY_ROUTE_WHEN_INCOMPLETE;
}

function isFirstClassRoute(routeId) {
  return typeof routeId === 'string' && hasOwn(ROUTE_REGISTRY, routeId);
}

function normalizeRoute(routeId, options = {}) {
  const setupKnown = hasOwn(options, 'setup');
  const setupComplete = setupKnown ? isSetupComplete(options.setup) : null;

  if (isFirstClassRoute(routeId)) {
    const route = ROUTE_REGISTRY[routeId];
    if (route.requiresSetup && setupKnown && !setupComplete) {
      return ENTRY_ROUTE_WHEN_INCOMPLETE;
    }
    return routeId;
  }

  if (setupKnown && !setupComplete) {
    return ENTRY_ROUTE_WHEN_INCOMPLETE;
  }
  return FALLBACK_ROUTE_ID;
}

function isTrustedOverlayUrl(url, options = {}) {
  if (typeof url !== 'string' || url.trim().length === 0) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }

  if (parsed.protocol !== 'http:') return false;
  if (parsed.hostname !== '127.0.0.1') return false;
  if (parsed.pathname !== '/overlay') return false;
  if (parsed.search !== '' || parsed.hash !== '') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.port === '') return false;

  if (Number.isInteger(options.port) && options.port > 0) {
    return Number(parsed.port) === options.port;
  }
  return true;
}

function sanitizeRuntimeStatus(status) {
  if (!isPlainObject(status)) return null;
  const state = RUNTIME_STATES.includes(status.state) ? status.state : 'idle';
  const code = isNonEmptyString(status.code) ? status.code.trim() : null;
  const updatedAt = isNonEmptyString(status.updatedAt) ? status.updatedAt.trim() : null;
  return Object.freeze({
    state,
    code,
    retryable: status.retryable === true,
    updatedAt,
  });
}

function sanitizeLastSubtitle(frame) {
  if (!isPlainObject(frame)) return null;
  const displayMs = typeof frame.displayMs === 'number' &&
    Number.isFinite(frame.displayMs) &&
    frame.displayMs > 0
    ? frame.displayMs
    : null;

  return Object.freeze({
    id: isNonEmptyString(frame.id) ? frame.id.trim() : null,
    profileId: isNonEmptyString(frame.profileId) ? frame.profileId.trim() : null,
    themeId: isNonEmptyString(frame.themeId) ? frame.themeId.trim() : null,
    createdAt: isNonEmptyString(frame.createdAt) ? frame.createdAt.trim() : null,
    displayMs,
    escapedText: typeof frame.escapedText === 'string' ? frame.escapedText : '',
  });
}

function sanitizeAppStatus(status, options = {}) {
  if (!isPlainObject(status)) return null;
  const overlayUrlTrusted = isTrustedOverlayUrl(status.overlayUrl, {
    port: options.port,
  });
  const overlayClients = Number.isInteger(status.overlayClients) &&
    status.overlayClients >= 0
    ? status.overlayClients
    : 0;

  return Object.freeze({
    backend: BACKEND_STATES.includes(status.backend) ? status.backend : 'starting',
    activeProfileId: isNonEmptyString(status.activeProfileId)
      ? status.activeProfileId.trim()
      : null,
    overlayUrl: overlayUrlTrusted ? status.overlayUrl : null,
    overlayUrlTrusted,
    overlayClients,
    capture: sanitizeRuntimeStatus(status.capture),
    ocr: sanitizeRuntimeStatus(status.ocr),
    translation: sanitizeRuntimeStatus(status.translation),
    lastSubtitle: sanitizeLastSubtitle(status.lastSubtitle),
  });
}

function deriveRecoveryActions(runtimeStatus) {
  if (!isPlainObject(runtimeStatus)) return Object.freeze([]);
  if (runtimeStatus.state !== 'error' && runtimeStatus.state !== 'warning') {
    return Object.freeze([]);
  }

  const code = isNonEmptyString(runtimeStatus.code) ? runtimeStatus.code.trim() : null;
  const base = code && hasOwn(RECOVERY_ACTIONS_BY_CODE, code)
    ? [...RECOVERY_ACTIONS_BY_CODE[code]]
    : [...SAFE_DEFAULT_RECOVERY_ACTIONS];

  if (runtimeStatus.retryable === true && !base.includes('retry')) {
    base.unshift('retry');
  }
  return Object.freeze(base);
}

function buildViewModel(input = {}) {
  const setup = isPlainObject(input.setup) ? input.setup : null;
  const sanitizedStatus = sanitizeAppStatus(input.appStatus, { port: input.port });
  const setupComplete = isSetupComplete(setup);
  let resolvedRouteId;

  if (input.route === undefined || input.route === null) {
    resolvedRouteId = setupComplete
      ? ENTRY_ROUTE_WHEN_COMPLETE
      : ENTRY_ROUTE_WHEN_INCOMPLETE;
  } else {
    resolvedRouteId = normalizeRoute(input.route, { setup });
  }

  const route = ROUTE_REGISTRY[resolvedRouteId] || ROUTE_REGISTRY[FALLBACK_ROUTE_ID];
  const capture = sanitizedStatus ? sanitizedStatus.capture : null;
  const ocr = sanitizedStatus ? sanitizedStatus.ocr : null;
  const translation = sanitizedStatus ? sanitizedStatus.translation : null;

  return Object.freeze({
    route: Object.freeze({
      id: route.id,
      title: route.title,
      group: route.group,
      capabilities: route.capabilities,
    }),
    sidebar: SIDEBAR_ROUTES,
    setupComplete,
    status: sanitizedStatus,
    recoveries: Object.freeze({
      capture: deriveRecoveryActions(capture),
      ocr: deriveRecoveryActions(ocr),
      translation: deriveRecoveryActions(translation),
    }),
  });
}

function createDesktopShell(initial = {}) {
  const state = {
    port: Number.isInteger(initial.port) && initial.port > 0 ? initial.port : null,
    setup: isPlainObject(initial.setup) ? { ...initial.setup } : null,
    requestedRoute: isNonEmptyString(initial.initialRoute) ? initial.initialRoute.trim() : null,
    appStatus: isPlainObject(initial.appStatus) ? initial.appStatus : null,
  };

  function snapshot() {
    return buildViewModel({
      route: state.requestedRoute,
      appStatus: state.appStatus,
      setup: state.setup,
      port: state.port,
    });
  }

  return Object.freeze({
    snapshot,
    getViewModel: snapshot,
    navigate(routeId) {
      state.requestedRoute = isNonEmptyString(routeId) ? routeId.trim() : null;
      return snapshot();
    },
    consumeAppStatus(nextStatus) {
      state.appStatus = isPlainObject(nextStatus) ? nextStatus : null;
      return snapshot();
    },
    updateSetup(partial) {
      const merged = state.setup ? { ...state.setup } : {};
      if (isPlainObject(partial)) {
        for (const key of SETUP_FIELDS) {
          if (!hasOwn(partial, key)) continue;
          merged[key] = partial[key];
        }
      }
      state.setup = merged;
      return snapshot();
    },
    setPort(nextPort) {
      state.port = Number.isInteger(nextPort) && nextPort > 0 ? nextPort : null;
      return snapshot();
    },
  });
}

module.exports = {
  ROUTE_GROUPS,
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
};
