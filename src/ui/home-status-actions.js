'use strict';

// T-011-003: dependency-free Home / Status renderer contract. This module
// performs no I/O; it turns the desktop shell snapshot into safe view-model
// cards and action intents for the future Electron/React renderer.

const { ContractError } = require('../contracts/security');
const { buildViewModel } = require('./desktop-shell');

const HOME_READINESS_STATES = Object.freeze([
  'loading',
  'ready',
  'warning',
  'error',
]);

const HOME_ACTION_IDS = Object.freeze([
  'refresh_status',
  'connect_status_stream',
  'copy_overlay_url',
  'open_obs_setup',
  'restart_backend',
  'open_capture_setup',
  'open_translation_settings',
  'open_diagnostics',
  'open_profiles',
  'retry',
  'check_network',
  'wait_and_retry',
  'start_capture',
  'stop_capture',
  'refresh_sources',
  'redraw_roi',
  'switch_provider',
  'edit_api_key',
  'copy_diagnostics',
  'rerun_first_run',
]);

const ROUTE_ACTIONS = Object.freeze({
  open_obs_setup: Object.freeze({ route: 'obs-setup' }),
  open_capture_setup: Object.freeze({ route: 'capture-setup' }),
  refresh_sources: Object.freeze({ route: 'capture-setup', command: 'refresh_sources' }),
  redraw_roi: Object.freeze({ route: 'capture-setup', command: 'redraw_roi' }),
  open_translation_settings: Object.freeze({ route: 'translation-settings' }),
  edit_api_key: Object.freeze({ route: 'translation-settings', focus: 'provider-key' }),
  switch_provider: Object.freeze({ route: 'translation-settings', focus: 'provider' }),
  open_diagnostics: Object.freeze({ route: 'logs-diagnostics' }),
  copy_diagnostics: Object.freeze({ route: 'logs-diagnostics', command: 'copy_diagnostics' }),
  open_profiles: Object.freeze({ route: 'profiles' }),
  rerun_first_run: Object.freeze({ route: 'first-run' }),
});

const HOST_COMMAND_ACTIONS = Object.freeze({
  restart_backend: 'restart_backend',
  check_network: 'open_network_troubleshooting',
  wait_and_retry: 'wait_and_retry',
  retry: 'retry_last_action',
});

const ACTION_METADATA = Object.freeze(
  HOME_ACTION_IDS.reduce((metadata, actionId) => {
    metadata[actionId] = Object.freeze({
      id: actionId,
      kind: actionKindFor(actionId),
    });
    return metadata;
  }, Object.create(null)),
);

const CARD_IDS = Object.freeze([
  'backend',
  'overlay',
  'capture',
  'ocr',
  'translation',
]);

const FEEDBACK_STATES = Object.freeze([
  'idle',
  'running',
  'ok',
  'error',
]);

function actionKindFor(actionId) {
  if (actionId === 'refresh_status') return 'http';
  if (actionId === 'connect_status_stream') return 'websocket';
  if (actionId === 'copy_overlay_url') return 'clipboard';
  if (actionId === 'start_capture' || actionId === 'stop_capture') return 'http';
  if (Object.prototype.hasOwnProperty.call(ROUTE_ACTIONS, actionId)) return 'navigate';
  if (Object.prototype.hasOwnProperty.call(HOST_COMMAND_ACTIONS, actionId)) return 'hostCommand';
  return 'unknown';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizePort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function normalizeActionId(actionId) {
  if (!isNonEmptyString(actionId)) return null;
  const trimmed = actionId.trim();
  return HOME_ACTION_IDS.includes(trimmed) ? trimmed : null;
}

function normalizeActiveProfileId(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function freezeAction(actionId, enabled, reason = null) {
  const normalized = normalizeActionId(actionId);
  if (normalized === null) return null;
  return Object.freeze({
    id: normalized,
    kind: ACTION_METADATA[normalized].kind,
    enabled: enabled === true,
    unavailableReason: enabled === true ? null : reason || 'unavailable',
  });
}

function severityForRuntimeStatus(id, status) {
  if (!isPlainObject(status)) return 'loading';
  if (status.state === 'error') return 'error';
  if (status.state === 'warning') return 'warning';
  if (status.state === 'running') return id === 'capture' ? 'ok' : 'running';
  if (status.state === 'ok') return 'ok';
  return 'idle';
}

function buildBackendCard(status, validPort) {
  if (!status) {
    return Object.freeze({
      id: 'backend',
      state: 'loading',
      severity: 'loading',
      backend: 'starting',
      actions: Object.freeze([
        freezeAction('refresh_status', validPort, 'port_missing'),
        freezeAction('restart_backend', true),
        freezeAction('open_diagnostics', true),
      ].filter(Boolean)),
    });
  }

  const backend = status.backend;
  const severity = backend === 'ready'
    ? 'ok'
    : backend === 'degraded'
      ? 'warning'
      : backend === 'error'
        ? 'error'
        : 'loading';
  const actions = [
    freezeAction('refresh_status', validPort, 'port_missing'),
  ];
  if (backend === 'degraded' || backend === 'error') {
    actions.push(freezeAction('restart_backend', true));
    actions.push(freezeAction('open_diagnostics', true));
    actions.push(freezeAction('copy_diagnostics', true));
  }

  return Object.freeze({
    id: 'backend',
    state: backend,
    severity,
    backend,
    actions: Object.freeze(actions.filter(Boolean)),
  });
}

function buildOverlayCard(status) {
  if (!status) {
    return Object.freeze({
      id: 'overlay',
      state: 'loading',
      severity: 'loading',
      overlayUrl: null,
      overlayUrlTrusted: false,
      overlayClients: 0,
      actions: Object.freeze([
        freezeAction('copy_overlay_url', false, 'overlay_url_unavailable'),
        freezeAction('open_obs_setup', true),
      ].filter(Boolean)),
    });
  }

  const trusted = status.overlayUrlTrusted === true && isNonEmptyString(status.overlayUrl);
  const clients = Number.isInteger(status.overlayClients) && status.overlayClients >= 0
    ? status.overlayClients
    : 0;
  const state = trusted
    ? clients > 0
      ? 'connected'
      : 'disconnected'
    : 'unavailable';
  const severity = trusted
    ? clients > 0
      ? 'ok'
      : 'warning'
    : 'error';

  return Object.freeze({
    id: 'overlay',
    state,
    severity,
    overlayUrl: trusted ? status.overlayUrl : null,
    overlayUrlTrusted: trusted,
    overlayClients: clients,
    actions: Object.freeze([
      freezeAction('copy_overlay_url', trusted, 'overlay_url_untrusted'),
      freezeAction('open_obs_setup', true),
      trusted ? null : freezeAction('restart_backend', true),
      trusted ? null : freezeAction('open_diagnostics', true),
    ].filter(Boolean)),
  });
}

function buildRuntimeCard(id, runtimeStatus, recoveryActions, activeProfileId) {
  const status = isPlainObject(runtimeStatus)
    ? runtimeStatus
    : { state: 'idle', code: null, retryable: false, updatedAt: null };
  const statusActions = [];

  if (id === 'capture') {
    if (status.state === 'running') {
      statusActions.push(freezeAction('stop_capture', true));
    } else {
      statusActions.push(freezeAction(
        'start_capture',
        isNonEmptyString(activeProfileId),
        'active_profile_missing',
      ));
    }
  }

  if (Array.isArray(recoveryActions)) {
    for (const actionId of recoveryActions) {
      const normalized = normalizeActionId(actionId);
      if (normalized === null) continue;
      statusActions.push(freezeAction(
        normalized,
        normalized === 'start_capture'
          ? isNonEmptyString(activeProfileId)
          : true,
        normalized === 'start_capture' ? 'active_profile_missing' : null,
      ));
    }
  }

  return Object.freeze({
    id,
    state: status.state,
    severity: severityForRuntimeStatus(id, status),
    code: status.code || null,
    retryable: status.retryable === true,
    updatedAt: status.updatedAt || null,
    actions: Object.freeze(dedupeActions(statusActions)),
  });
}

function dedupeActions(actions) {
  const seen = new Set();
  const result = [];
  for (const action of actions) {
    if (!isPlainObject(action) || seen.has(action.id)) continue;
    seen.add(action.id);
    result.push(action);
  }
  return result;
}

function deriveHomeReadiness(cards) {
  if (!isPlainObject(cards)) return 'loading';
  const values = CARD_IDS.map((id) => cards[id]).filter(Boolean);
  if (values.some((card) => card.severity === 'error')) return 'error';
  if (values.some((card) => card.severity === 'loading')) return 'loading';
  if (values.some((card) => card.severity === 'warning' || card.severity === 'running')) {
    return 'warning';
  }
  return 'ready';
}

function actionExists(actions, actionId) {
  return actions.some((action) => action.id === actionId);
}

function buildHomeActions(cards, validPort, activeProfileId, setupComplete) {
  const captureRunning = cards.capture && cards.capture.state === 'running';
  const actions = [
    freezeAction('refresh_status', validPort, 'port_missing'),
    freezeAction('connect_status_stream', validPort, 'port_missing'),
    freezeAction('copy_overlay_url', cards.overlay.overlayUrlTrusted, 'overlay_url_untrusted'),
    freezeAction('open_obs_setup', true),
  ];

  for (const cardId of CARD_IDS) {
    const card = cards[cardId];
    if (!isPlainObject(card) || !Array.isArray(card.actions)) continue;
    for (const action of card.actions) actions.push(action);
  }

  if (!actionExists(actions.filter(Boolean), 'start_capture')) {
    actions.push(freezeAction(
      'start_capture',
      !captureRunning && isNonEmptyString(activeProfileId),
      captureRunning ? 'capture_running' : 'active_profile_missing',
    ));
  }
  if (!actionExists(actions.filter(Boolean), 'stop_capture')) {
    actions.push(freezeAction('stop_capture', captureRunning, 'capture_not_running'));
  }
  if (setupComplete !== true) {
    actions.push(freezeAction('rerun_first_run', true));
  }

  return Object.freeze(dedupeActions(actions.filter(Boolean)));
}

function feedbackMessageKey(actionId, state) {
  const normalizedAction = normalizeActionId(actionId) || 'unknown';
  const normalizedState = FEEDBACK_STATES.includes(state) ? state : 'idle';
  return `home.${normalizedAction}.${normalizedState}`;
}

function createHomeActionFeedback(input = {}) {
  const actionId = normalizeActionId(input.actionId);
  const state = FEEDBACK_STATES.includes(input.state) ? input.state : 'idle';
  const code = isNonEmptyString(input.code) ? input.code.trim() : null;
  const updatedAt = isNonEmptyString(input.updatedAt) ? input.updatedAt.trim() : null;
  return Object.freeze({
    actionId,
    state,
    code,
    messageKey: feedbackMessageKey(actionId, state),
    updatedAt,
  });
}

function sanitizeFeedback(input) {
  if (!isPlainObject(input)) return null;
  return createHomeActionFeedback(input);
}

function buildHomeStatusViewModel(input = {}) {
  const port = normalizePort(input.port);
  const shellView = buildViewModel({
    route: 'home',
    appStatus: input.appStatus,
    setup: input.setup,
    port,
    backendRecovery: input.backendRecovery === true,
  });
  const status = shellView.status;
  const activeProfileId = normalizeActiveProfileId(status && status.activeProfileId) ||
    normalizeActiveProfileId(isPlainObject(input.setup) ? input.setup.activeProfileId : null);

  const cards = Object.freeze({
    backend: buildBackendCard(status, port !== null),
    overlay: buildOverlayCard(status),
    capture: buildRuntimeCard(
      'capture',
      status && status.capture,
      shellView.recoveries.capture,
      activeProfileId,
    ),
    ocr: buildRuntimeCard('ocr', status && status.ocr, shellView.recoveries.ocr, activeProfileId),
    translation: buildRuntimeCard(
      'translation',
      status && status.translation,
      shellView.recoveries.translation,
      activeProfileId,
    ),
  });

  return Object.freeze({
    route: shellView.route,
    setupComplete: shellView.setupComplete,
    port,
    readiness: deriveHomeReadiness(cards),
    activeProfileId,
    cards,
    lastSubtitle: status ? status.lastSubtitle : null,
    actions: buildHomeActions(cards, port !== null, activeProfileId, shellView.setupComplete),
    feedback: sanitizeFeedback(input.actionFeedback),
  });
}

function getAction(viewModel, actionId) {
  if (!isPlainObject(viewModel) || !Array.isArray(viewModel.actions)) return null;
  const normalized = normalizeActionId(actionId);
  if (normalized === null) return null;
  return viewModel.actions.find((action) => action.id === normalized) || null;
}

function unavailableAction(actionId, reason = 'unavailable') {
  return new ContractError('HOME_ACTION_UNAVAILABLE', 'Home action is unavailable', {
    actionId: normalizeActionId(actionId),
    reason,
  });
}

function requireEnabledAction(viewModel, actionId) {
  const action = getAction(viewModel, actionId);
  if (!action) throw unavailableAction(actionId, 'unknown_action');
  if (action.enabled !== true) {
    throw unavailableAction(actionId, action.unavailableReason || 'unavailable');
  }
  return action;
}

function frozenHttpIntent(actionId, method, path, body) {
  const intent = {
    type: 'http',
    actionId,
    method,
    path,
    sensitive: false,
  };
  if (body !== undefined) intent.body = Object.freeze({ ...body });
  return Object.freeze(intent);
}

function routeIntent(actionId, routeConfig) {
  const intent = {
    type: 'navigate',
    actionId,
    route: routeConfig.route,
    sensitive: false,
  };
  if (routeConfig.command) intent.command = routeConfig.command;
  if (routeConfig.focus) intent.focus = routeConfig.focus;
  return Object.freeze(intent);
}

function buildHomeActionIntent(actionId, viewModel) {
  const normalized = normalizeActionId(actionId);
  requireEnabledAction(viewModel, normalized);

  if (normalized === 'refresh_status') {
    return frozenHttpIntent(normalized, 'GET', '/api/status');
  }

  if (normalized === 'connect_status_stream') {
    const port = normalizePort(viewModel.port);
    if (port === null) throw unavailableAction(normalized, 'port_missing');
    return Object.freeze({
      type: 'websocket',
      actionId: normalized,
      url: `ws://127.0.0.1:${port}/ws/app`,
      path: '/ws/app',
      port,
      sensitive: false,
    });
  }

  if (normalized === 'copy_overlay_url') {
    const overlay = viewModel.cards && viewModel.cards.overlay;
    if (!isPlainObject(overlay) || overlay.overlayUrlTrusted !== true || !isNonEmptyString(overlay.overlayUrl)) {
      throw unavailableAction(normalized, 'overlay_url_untrusted');
    }
    return Object.freeze({
      type: 'clipboard.writeText',
      actionId: normalized,
      text: overlay.overlayUrl,
      sensitive: false,
    });
  }

  if (normalized === 'start_capture') {
    const profileId = normalizeActiveProfileId(viewModel.activeProfileId);
    if (profileId === null) throw unavailableAction(normalized, 'active_profile_missing');
    return frozenHttpIntent(normalized, 'POST', '/api/capture/start', { profileId });
  }

  if (normalized === 'stop_capture') {
    return frozenHttpIntent(normalized, 'POST', '/api/capture/stop');
  }

  if (hasOwn(ROUTE_ACTIONS, normalized)) {
    return routeIntent(normalized, ROUTE_ACTIONS[normalized]);
  }

  if (hasOwn(HOST_COMMAND_ACTIONS, normalized)) {
    return Object.freeze({
      type: 'hostCommand',
      actionId: normalized,
      command: HOST_COMMAND_ACTIONS[normalized],
      sensitive: false,
    });
  }

  throw unavailableAction(normalized, 'unknown_action');
}

module.exports = {
  HOME_READINESS_STATES,
  HOME_ACTION_IDS,
  ACTION_METADATA,
  CARD_IDS,
  FEEDBACK_STATES,
  buildHomeStatusViewModel,
  buildHomeActionIntent,
  createHomeActionFeedback,
};
