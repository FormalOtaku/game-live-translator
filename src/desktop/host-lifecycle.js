'use strict';

const {
  ALLOWED_BIND_ADDRESS,
  ContractError,
  assertLocalhostBind,
  redactSecrets,
} = require('../contracts/security');
const {
  DEFAULT_APP_WS_PATH,
  DEFAULT_MAX_PORT_ATTEMPTS,
  DEFAULT_PREFERRED_PORT,
  DEFAULT_VERSION,
  buildApiErrorFromContractError,
  createLocalApiServer,
} = require('../server/local-api-server');

const DESKTOP_HOST_LIFECYCLE_SCHEMA_VERSION = 'desktop-host-lifecycle.v1';

const HOST_LIFECYCLE_STATES = Object.freeze([
  'idle',
  'starting',
  'ready',
  'stopping',
  'stopped',
  'error',
]);

const SUPPORTED_HOST_COMMANDS = Object.freeze([
  'restart_backend',
]);

const SAFE_HOST_ERROR_DETAIL_KEYS = Object.freeze([
  'actionId',
  'bindAddress',
  'causeCode',
  'field',
  'maxPortAttempts',
  'preferredPort',
]);

const HOST_ERROR_MESSAGES = Object.freeze({
  HOST_BACKEND_ADAPTER_INVALID: 'Desktop backend adapter is unavailable',
  HOST_BACKEND_PORT_INVALID: 'Desktop backend did not report a usable localhost port',
  HOST_COMMAND_INVALID: 'Host command intent is invalid',
  HOST_COMMAND_SENSITIVE_REJECTED: 'Sensitive host commands are not accepted',
  HOST_COMMAND_UNSUPPORTED: 'Host command is not supported',
  HOST_CONFIG_INVALID: 'Desktop host config is invalid',
  HOST_PORT_ATTEMPTS_INVALID: 'Desktop host port retry count is invalid',
  HOST_PORT_INVALID: 'Desktop host port is invalid',
  HOST_WS_PATH_INVALID: 'Desktop host WebSocket path is invalid',
  INTERNAL_ERROR: 'Desktop backend failed',
  NON_LOCALHOST_BIND_REJECTED: 'Desktop backend must bind to localhost only',
  PORT_UNAVAILABLE: 'No localhost port is available for the desktop backend',
});

const HOST_PRIVACY_GUARANTEES = Object.freeze({
  localhostOnly: true,
  providerKeysSerialized: false,
  rawOcrTextSerialized: false,
  translatedTextSerialized: false,
  screenshotsSerialized: false,
  rawLogsSerialized: false,
  gameModification: false,
  fileParsing: false,
  codeInjection: false,
  scriptDistribution: false,
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function ownValue(target, key, fallback) {
  return hasOwn(target, key) ? target[key] : fallback;
}

function normalizePort(value, field, { allowZero = false } = {}) {
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < min || value > 65535) {
    throw new ContractError('HOST_PORT_INVALID', `${field} must be an integer from ${min} to 65535`, {
      field,
    });
  }
  return value;
}

function normalizePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ContractError('HOST_PORT_ATTEMPTS_INVALID', `${field} must be an integer from 1 to 100`, {
      field,
    });
  }
  return value;
}

function normalizeAppWsPath(value) {
  const path = value === undefined ? DEFAULT_APP_WS_PATH : value;
  if (!isNonEmptyString(path)) {
    throw new ContractError('HOST_WS_PATH_INVALID', 'appWsPath must be a non-empty path', {
      field: 'appWsPath',
    });
  }
  const normalized = path.trim();
  if (
    !normalized.startsWith('/') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    normalized.includes('//') ||
    !/^\/[A-Za-z0-9/_-]+$/.test(normalized)
  ) {
    throw new ContractError('HOST_WS_PATH_INVALID', 'appWsPath must be an absolute WebSocket path', {
      field: 'appWsPath',
    });
  }
  return normalized;
}

function normalizeDesktopHostConfig(input = {}) {
  if (!isPlainObject(input)) {
    throw new ContractError('HOST_CONFIG_INVALID', 'Desktop host config must be an object');
  }
  const bindAddress = assertLocalhostBind(ownValue(input, 'bindAddress', ALLOWED_BIND_ADDRESS));
  const preferredPort = normalizePort(
    ownValue(input, 'preferredPort', DEFAULT_PREFERRED_PORT),
    'preferredPort',
    { allowZero: true },
  );
  const maxPortAttempts = normalizePositiveInteger(
    ownValue(input, 'maxPortAttempts', DEFAULT_MAX_PORT_ATTEMPTS),
    'maxPortAttempts',
  );
  const versionValue = ownValue(input, 'version', DEFAULT_VERSION);
  const version = isNonEmptyString(versionValue) ? versionValue.trim() : DEFAULT_VERSION;
  const appWsPath = normalizeAppWsPath(ownValue(input, 'appWsPath', DEFAULT_APP_WS_PATH));

  return Object.freeze({
    bindAddress,
    preferredPort,
    maxPortAttempts,
    version,
    appWsPath,
  });
}

function toIsoTimestamp(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

function trustedOverlayUrl(bindAddress, port) {
  if (bindAddress !== ALLOWED_BIND_ADDRESS || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return `http://${ALLOWED_BIND_ADDRESS}:${port}/overlay`;
}

function trustedAppWsUrl(bindAddress, port, appWsPath) {
  if (bindAddress !== ALLOWED_BIND_ADDRESS || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return `ws://${ALLOWED_BIND_ADDRESS}:${port}${appWsPath}`;
}

function safeHostErrorMessage(code) {
  return HOST_ERROR_MESSAGES[code] || HOST_ERROR_MESSAGES.INTERNAL_ERROR;
}

function sanitizeSafeDetailValue(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Number.isInteger(value) || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function sanitizeFieldErrors(fieldErrors) {
  if (!Array.isArray(fieldErrors)) return undefined;
  const sanitized = fieldErrors
    .filter(isPlainObject)
    .map((fieldError) => {
      const output = {};
      const field = sanitizeSafeDetailValue(fieldError.field);
      const code = sanitizeSafeDetailValue(fieldError.code);
      if (field !== undefined) output.field = field;
      if (code !== undefined) output.code = code;
      return Object.freeze(output);
    })
    .filter((fieldError) => Object.keys(fieldError).length > 0);
  return sanitized.length > 0 ? Object.freeze(sanitized) : undefined;
}

function sanitizeHostErrorDetails(details) {
  if (!isPlainObject(details)) return null;
  const output = {};
  for (const key of SAFE_HOST_ERROR_DETAIL_KEYS) {
    if (!hasOwn(details, key)) continue;
    const value = sanitizeSafeDetailValue(details[key]);
    if (value !== undefined) output[key] = value;
  }
  if (hasOwn(details, 'fieldErrors')) {
    const fieldErrors = sanitizeFieldErrors(details.fieldErrors);
    if (fieldErrors !== undefined) output.fieldErrors = fieldErrors;
  }
  return Object.keys(output).length > 0 ? Object.freeze(output) : null;
}

function sanitizeHostError(error) {
  const apiError = buildApiErrorFromContractError(error);
  const payload = apiError.error;
  const sanitized = {
    code: payload.code,
    message: safeHostErrorMessage(payload.code),
    retryable: payload.retryable === true,
    details: sanitizeHostErrorDetails(payload.details),
  };
  return Object.freeze(sanitized);
}

function normalizeHostCommandIntent(intent) {
  if (!isPlainObject(intent)) {
    throw new ContractError('HOST_COMMAND_INVALID', 'Host command intent must be an object');
  }
  if (ownValue(intent, 'type', null) !== 'hostCommand') {
    throw new ContractError('HOST_COMMAND_INVALID', 'Host command intent type must be hostCommand', {
      field: 'type',
    });
  }
  const sensitive = ownValue(intent, 'sensitive', undefined);
  if (sensitive !== undefined && sensitive !== false) {
    throw new ContractError('HOST_COMMAND_SENSITIVE_REJECTED', 'Sensitive host commands are not accepted', {
      actionId: isNonEmptyString(ownValue(intent, 'actionId', null)) ? intent.actionId.trim() : null,
    });
  }
  const commandValue = ownValue(intent, 'command', '');
  const command = isNonEmptyString(commandValue) ? commandValue.trim() : '';
  if (!SUPPORTED_HOST_COMMANDS.includes(command)) {
    throw new ContractError('HOST_COMMAND_UNSUPPORTED', 'Host command is not supported by lifecycle contract', {
      field: 'command',
    });
  }
  return Object.freeze({
    type: 'hostCommand',
    command,
    actionId: isNonEmptyString(ownValue(intent, 'actionId', null)) ? intent.actionId.trim() : null,
  });
}

function createDesktopHostLifecycle(options = {}) {
  const lifecycleOptions = isPlainObject(options) ? options : {};
  const configInput = hasOwn(lifecycleOptions, 'config') ? lifecycleOptions.config : lifecycleOptions;
  const config = normalizeDesktopHostConfig(configInput);
  const apiFactory = typeof lifecycleOptions.apiFactory === 'function'
    ? lifecycleOptions.apiFactory
    : createLocalApiServer;
  const clock = typeof lifecycleOptions.clock === 'function' ? lifecycleOptions.clock : () => new Date();
  const serverOptions = isPlainObject(lifecycleOptions.serverOptions) ? lifecycleOptions.serverOptions : {};

  let api = null;
  let state = 'idle';
  let port = null;
  let overlayUrl = null;
  let appWsUrl = null;
  let restartCount = 0;
  let generation = 0;
  let lastError = null;
  let startedAt = null;
  let stoppedAt = null;
  let updatedAt = toIsoTimestamp(clock);

  function transition(nextState) {
    state = nextState;
    updatedAt = toIsoTimestamp(clock);
  }

  function clearApiReference() {
    api = null;
    port = null;
    overlayUrl = null;
    appWsUrl = null;
  }

  function backendStateForSnapshot() {
    if (state === 'ready') return 'ready';
    if (state === 'error') return 'error';
    if (state === 'stopped') return 'degraded';
    return 'starting';
  }

  function snapshot() {
    const backendState = backendStateForSnapshot();
    return Object.freeze({
      schemaVersion: DESKTOP_HOST_LIFECYCLE_SCHEMA_VERSION,
      state,
      backend: backendState,
      backendState,
      bindAddress: config.bindAddress,
      preferredPort: config.preferredPort,
      maxPortAttempts: config.maxPortAttempts,
      port,
      overlayUrl,
      overlayUrlTrusted: overlayUrl !== null,
      appWsUrl,
      appWsPath: config.appWsPath,
      restartCount,
      generation,
      startedAt,
      stoppedAt,
      updatedAt,
      lastError,
      privacy: HOST_PRIVACY_GUARANTEES,
    });
  }

  async function stopCurrentApiForCleanup() {
    const currentApi = api;
    if (currentApi === null) return true;
    try {
      await currentApi.stop();
      if (api === currentApi) clearApiReference();
      return true;
    } catch (error) {
      lastError = sanitizeHostError(error);
      transition('error');
      return false;
    }
  }

  async function start() {
    if (state === 'ready' && api !== null) return snapshot();
    if (api !== null) {
      transition('stopping');
      const stopped = await stopCurrentApiForCleanup();
      if (!stopped) return snapshot();
    }
    transition('starting');
    lastError = null;
    let nextApi = null;
    try {
      nextApi = apiFactory({
        ...serverOptions,
        bindAddress: config.bindAddress,
        preferredPort: config.preferredPort,
        maxPortAttempts: config.maxPortAttempts,
        version: config.version,
        appWsPath: config.appWsPath,
      });
      if (!nextApi || typeof nextApi.start !== 'function' || typeof nextApi.stop !== 'function') {
        throw new ContractError('HOST_BACKEND_ADAPTER_INVALID', 'Backend adapter must expose start and stop');
      }
      const started = await nextApi.start();
      const selectedPort = Number.isInteger(started && started.port) ? started.port : nextApi.port;
      if (!Number.isInteger(selectedPort) || selectedPort <= 0 || selectedPort > 65535) {
        throw new ContractError('HOST_BACKEND_PORT_INVALID', 'Backend adapter must report a localhost port', {
          field: 'port',
        });
      }
      api = nextApi;
      port = selectedPort;
      overlayUrl = trustedOverlayUrl(config.bindAddress, port);
      appWsUrl = trustedAppWsUrl(config.bindAddress, port, config.appWsPath);
      generation += 1;
      startedAt = toIsoTimestamp(clock);
      stoppedAt = null;
      transition('ready');
      return snapshot();
    } catch (error) {
      if (nextApi !== null && typeof nextApi.stop === 'function') {
        try {
          await nextApi.stop();
        } catch (_) {
          // Preserve the original startup failure; stop cleanup failures are not
          // user-actionable and must not leak adapter details into snapshots.
        }
      }
      clearApiReference();
      lastError = sanitizeHostError(error);
      stoppedAt = null;
      transition('error');
      return snapshot();
    }
  }

  async function stop() {
    if (api === null) {
      clearApiReference();
      stoppedAt = toIsoTimestamp(clock);
      transition('stopped');
      return snapshot();
    }

    transition('stopping');
    const stopped = await stopCurrentApiForCleanup();
    if (!stopped) return snapshot();
    lastError = null;
    stoppedAt = toIsoTimestamp(clock);
    transition('stopped');
    return snapshot();
  }

  async function restart() {
    if (api !== null) {
      const stopped = await stop();
      if (stopped.state === 'error') return stopped;
    }
    const generationBeforeStart = generation;
    const started = await start();
    if (started.state === 'ready' && generation > generationBeforeStart) {
      restartCount += 1;
    }
    return snapshot();
  }

  async function executeHostCommand(intent) {
    const command = normalizeHostCommandIntent(intent);
    if (command.command === 'restart_backend') {
      return restart();
    }
    throw new ContractError('HOST_COMMAND_UNSUPPORTED', 'Host command is not supported by lifecycle contract', {
      command: command.command,
    });
  }

  return Object.freeze({
    config,
    snapshot,
    start,
    stop,
    restart,
    executeHostCommand,
  });
}

module.exports = {
  DESKTOP_HOST_LIFECYCLE_SCHEMA_VERSION,
  HOST_LIFECYCLE_STATES,
  HOST_PRIVACY_GUARANTEES,
  SUPPORTED_HOST_COMMANDS,
  createDesktopHostLifecycle,
  normalizeDesktopHostConfig,
  normalizeHostCommandIntent,
  sanitizeHostError,
  trustedAppWsUrl,
  trustedOverlayUrl,
};
