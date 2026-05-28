'use strict';

const {
  ALLOWED_BIND_ADDRESS,
  ContractError,
  redactSecrets,
} = require('../contracts/security');

const DESKTOP_IPC_BRIDGE_SCHEMA_VERSION = 'desktop-ipc-bridge.v1';
const DESKTOP_IPC_CHANNEL = 'gameLiveTranslator:intent';

const IPC_INTENT_TYPES = Object.freeze([
  'http',
  'websocket',
  'clipboard.writeText',
  'navigate',
  'hostCommand',
]);

const IPC_HTTP_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'DELETE']);

const IPC_HOST_COMMANDS = Object.freeze([
  'restart_backend',
  'open_url',
  'open_debug_folder',
  'clear_debug_data',
  'open_network_troubleshooting',
  'wait_and_retry',
  'retry_last_action',
]);

const IPC_ROUTE_IDS = Object.freeze([
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

const IPC_PRIVACY_GUARANTEES = Object.freeze({
  localhostOnly: true,
  providerKeysSerialized: false,
  rawOcrTextSerialized: false,
  translatedTextSerialized: false,
  screenshotsSerialized: false,
  rawLogsSerialized: false,
  debugPathsSerialized: false,
  stackTracesSerialized: false,
  clipboardTextSerialized: false,
  commandPayloadsSerialized: false,
  gameModification: false,
  fileParsing: false,
  codeInjection: false,
  scriptDistribution: false,
});

const ERROR_MESSAGES = Object.freeze({
  IPC_ADAPTER_FAILED: 'Desktop IPC adapter failed',
  IPC_ADAPTER_UNAVAILABLE: 'Desktop IPC adapter is unavailable',
  IPC_BODY_UNSAFE: 'Desktop IPC body contains unsupported fields',
  IPC_CHANNEL_INVALID: 'Desktop IPC channel is not allowed',
  IPC_CLIPBOARD_TEXT_INVALID: 'Desktop IPC clipboard text is invalid',
  IPC_HOST_COMMAND_SENSITIVE_REJECTED: 'Desktop IPC host command cannot be sensitive',
  IPC_HOST_COMMAND_UNSUPPORTED: 'Desktop IPC host command is not supported',
  IPC_HTTP_METHOD_INVALID: 'Desktop IPC HTTP method is not allowed',
  IPC_HTTP_PATH_INVALID: 'Desktop IPC HTTP path is not allowed',
  IPC_INTENT_INVALID: 'Desktop IPC intent is invalid',
  IPC_INTENT_TYPE_UNSUPPORTED: 'Desktop IPC intent type is not supported',
  IPC_NAVIGATE_ROUTE_INVALID: 'Desktop IPC navigation route is not allowed',
  IPC_OVERLAY_URL_UNTRUSTED: 'Desktop IPC overlay URL is not trusted',
  IPC_STATUS_WS_URL_UNTRUSTED: 'Desktop IPC status WebSocket URL is not trusted',
});

const SAFE_ERROR_DETAIL_KEYS = Object.freeze([
  'actionId',
  'channel',
  'command',
  'field',
  'intentType',
  'method',
  'path',
  'reason',
  'route',
]);

const SENSITIVE_FIELD_PATTERN =
  /(?:api[_-]?key|provider[_-]?key|authorization|bearer|secret|token|sourceText|rawText|ocrText|normalizedText|translatedText|screenshot|imagePath|stack|trace|logs?|debugPayload|debugScreenshotDirectory)/i;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function ownValue(target, key, fallback) {
  return hasOwn(target, key) ? target[key] : fallback;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function copySafeValue(value, path = '') {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new ContractError('IPC_BODY_UNSAFE', 'Unsupported body value', { field: path || null });
  }
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item, index) => copySafeValue(item, `${path}[${index}]`));
  if (!isPlainObject(value)) {
    throw new ContractError('IPC_BODY_UNSAFE', 'Body value must be plain data', { field: path || null });
  }

  const output = {};
  for (const key of Object.keys(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      throw new ContractError('IPC_BODY_UNSAFE', 'Sensitive body field is not allowed', { field: path ? `${path}.${key}` : key });
    }
    output[key] = copySafeValue(value[key], path ? `${path}.${key}` : key);
  }
  return output;
}

function normalizeActionId(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeIntentType(value) {
  if (!isNonEmptyString(value)) {
    throw new ContractError('IPC_INTENT_TYPE_UNSUPPORTED', 'Intent type is required', { field: 'type' });
  }
  const type = value.trim();
  if (!IPC_INTENT_TYPES.includes(type)) {
    throw new ContractError('IPC_INTENT_TYPE_UNSUPPORTED', 'Intent type is not supported', { intentType: type });
  }
  return type;
}

function assertAllowedKeys(intent, allowedKeys) {
  for (const key of Object.keys(intent)) {
    if (!allowedKeys.includes(key)) {
      throw new ContractError('IPC_INTENT_INVALID', 'Intent contains unsupported field', { field: key });
    }
  }
}

function normalizeChannel(channel) {
  if (!isNonEmptyString(channel) || channel.trim() !== DESKTOP_IPC_CHANNEL) {
    throw new ContractError('IPC_CHANNEL_INVALID', 'IPC channel is not allowed', { channel: isNonEmptyString(channel) ? channel.trim() : null });
  }
  return DESKTOP_IPC_CHANNEL;
}

function normalizeHttpPath(path) {
  if (!isNonEmptyString(path)) {
    throw new ContractError('IPC_HTTP_PATH_INVALID', 'HTTP path is required', { field: 'path' });
  }
  const normalized = path.trim();
  if (
    !normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    normalized.includes('\\') ||
    normalized.includes('://') ||
    normalized.includes('..') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    /\s/.test(normalized)
  ) {
    throw new ContractError('IPC_HTTP_PATH_INVALID', 'HTTP path must be a local path', { field: 'path' });
  }
  if (!(normalized === '/health' || normalized.startsWith('/api/'))) {
    throw new ContractError('IPC_HTTP_PATH_INVALID', 'HTTP path is not allow-listed', { path: normalized });
  }
  return normalized;
}

function normalizeHttpMethod(method) {
  const normalized = isNonEmptyString(method) ? method.trim().toUpperCase() : 'GET';
  if (!IPC_HTTP_METHODS.includes(normalized)) {
    throw new ContractError('IPC_HTTP_METHOD_INVALID', 'HTTP method is not allowed', { method: normalized });
  }
  return normalized;
}

function parseTrustedUrl(rawUrl, errorCode, expectedProtocol, expectedPath) {
  if (!isNonEmptyString(rawUrl)) {
    throw new ContractError(errorCode, 'URL is required', { field: 'url' });
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (_) {
    throw new ContractError(errorCode, 'URL is malformed', { field: 'url' });
  }
  if (
    parsed.protocol !== expectedProtocol ||
    parsed.hostname !== ALLOWED_BIND_ADDRESS ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== expectedPath ||
    parsed.port === ''
  ) {
    throw new ContractError(errorCode, 'URL is not trusted', { field: 'url' });
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ContractError(errorCode, 'URL port is invalid', { field: 'url' });
  }
  return Object.freeze({
    url: `${expectedProtocol}//${ALLOWED_BIND_ADDRESS}:${port}${expectedPath}`,
    port,
    path: expectedPath,
  });
}

function normalizeRoute(value) {
  if (!isNonEmptyString(value)) {
    throw new ContractError('IPC_NAVIGATE_ROUTE_INVALID', 'Navigation route is required', { field: 'route' });
  }
  const route = value.trim();
  if (!IPC_ROUTE_IDS.includes(route)) {
    throw new ContractError('IPC_NAVIGATE_ROUTE_INVALID', 'Navigation route is not allowed', { route });
  }
  return route;
}

function sanitizeDetailValue(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Number.isInteger(value) || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function sanitizeErrorDetails(details) {
  if (!isPlainObject(details)) return null;
  const output = {};
  for (const key of SAFE_ERROR_DETAIL_KEYS) {
    if (!hasOwn(details, key)) continue;
    const value = sanitizeDetailValue(details[key]);
    if (value !== undefined) output[key] = value;
  }
  return Object.keys(output).length > 0 ? Object.freeze(output) : null;
}

function sanitizeIpcError(error) {
  const rawCode = error && typeof error.code === 'string' && error.code.trim().length > 0
    ? error.code.trim()
    : 'IPC_ADAPTER_FAILED';
  const code = hasOwn(ERROR_MESSAGES, rawCode) ? rawCode : 'IPC_ADAPTER_FAILED';
  return Object.freeze({
    code,
    message: ERROR_MESSAGES[code],
    retryable: error && error.retryable === true,
    details: sanitizeErrorDetails(error && error.details),
  });
}

function resultEnvelope({ ok, channel, intentType, actionId, result = null, error = null }) {
  return deepFreeze({
    schemaVersion: DESKTOP_IPC_BRIDGE_SCHEMA_VERSION,
    ok,
    channel,
    intentType,
    actionId,
    result,
    error,
    privacy: IPC_PRIVACY_GUARANTEES,
  });
}

function safeBodyKeys(body) {
  if (!isPlainObject(body)) return Object.freeze([]);
  return Object.freeze(Object.keys(body).sort());
}

function createLogRecord(intent) {
  if (!isPlainObject(intent)) return null;
  const type = isNonEmptyString(intent.type) ? intent.type.trim() : null;
  const record = {
    schemaVersion: DESKTOP_IPC_BRIDGE_SCHEMA_VERSION,
    type,
    actionId: normalizeActionId(ownValue(intent, 'actionId', null)),
    sensitive: ownValue(intent, 'sensitive', false) === true,
  };
  if (type === 'http') {
    record.method = isNonEmptyString(intent.method) ? intent.method.trim().toUpperCase() : 'GET';
    record.path = isNonEmptyString(intent.path) ? intent.path.trim() : null;
    record.bodyKeys = safeBodyKeys(intent.body);
  } else if (type === 'websocket') {
    record.path = isNonEmptyString(intent.path) ? intent.path.trim() : null;
    record.port = Number.isInteger(intent.port) ? intent.port : null;
    record.urlTrustedOnly = true;
  } else if (type === 'clipboard.writeText') {
    record.textRedacted = true;
    record.textLength = typeof intent.text === 'string' ? intent.text.length : 0;
  } else if (type === 'navigate') {
    record.route = isNonEmptyString(intent.route) ? intent.route.trim() : null;
    record.command = isNonEmptyString(intent.command) ? intent.command.trim() : null;
    record.focus = isNonEmptyString(intent.focus) ? intent.focus.trim() : null;
  } else if (type === 'hostCommand') {
    record.command = isNonEmptyString(intent.command) ? intent.command.trim() : null;
    record.urlTrustedOnly = hasOwn(intent, 'url');
  }
  return deepFreeze(record);
}

function normalizeHttpIntent(intent) {
  assertAllowedKeys(intent, ['type', 'actionId', 'method', 'path', 'body', 'sensitive']);
  if (ownValue(intent, 'sensitive', false) !== false) {
    throw new ContractError('IPC_INTENT_INVALID', 'Sensitive HTTP intents are not accepted', { field: 'sensitive' });
  }
  const method = normalizeHttpMethod(ownValue(intent, 'method', 'GET'));
  const path = normalizeHttpPath(ownValue(intent, 'path', null));
  const normalized = { method, path };
  if (hasOwn(intent, 'body')) normalized.body = copySafeValue(intent.body, 'body');
  return deepFreeze(normalized);
}

function normalizeWebSocketIntent(intent) {
  assertAllowedKeys(intent, ['type', 'actionId', 'url', 'path', 'port', 'sensitive']);
  if (ownValue(intent, 'sensitive', false) !== false) {
    throw new ContractError('IPC_INTENT_INVALID', 'Sensitive WebSocket intents are not accepted', { field: 'sensitive' });
  }
  const trusted = parseTrustedUrl(
    ownValue(intent, 'url', null),
    'IPC_STATUS_WS_URL_UNTRUSTED',
    'ws:',
    '/ws/app',
  );
  if (hasOwn(intent, 'path') && intent.path !== '/ws/app') {
    throw new ContractError('IPC_STATUS_WS_URL_UNTRUSTED', 'WebSocket path does not match intent path', { field: 'path' });
  }
  if (hasOwn(intent, 'port') && intent.port !== trusted.port) {
    throw new ContractError('IPC_STATUS_WS_URL_UNTRUSTED', 'WebSocket port does not match intent port', { field: 'port' });
  }
  return trusted;
}

function normalizeClipboardIntent(intent) {
  assertAllowedKeys(intent, ['type', 'actionId', 'text', 'sensitive', 'logSafeBody']);
  const text = ownValue(intent, 'text', null);
  if (!isNonEmptyString(text)) {
    throw new ContractError('IPC_CLIPBOARD_TEXT_INVALID', 'Clipboard text is required', { field: 'text' });
  }
  const sensitive = ownValue(intent, 'sensitive', false) === true;
  if (sensitive && ownValue(intent, 'actionId', null) !== 'copy_diagnostics_bundle') {
    throw new ContractError('IPC_CLIPBOARD_TEXT_INVALID', 'Sensitive clipboard action is not allow-listed', {
      actionId: normalizeActionId(ownValue(intent, 'actionId', null)),
    });
  }
  return Object.freeze({ text, sensitive });
}

function normalizeNavigateIntent(intent) {
  assertAllowedKeys(intent, ['type', 'actionId', 'route', 'command', 'focus', 'sensitive']);
  if (ownValue(intent, 'sensitive', false) !== false) {
    throw new ContractError('IPC_INTENT_INVALID', 'Sensitive navigation intents are not accepted', { field: 'sensitive' });
  }
  const output = { route: normalizeRoute(ownValue(intent, 'route', null)) };
  if (hasOwn(intent, 'command') && isNonEmptyString(intent.command)) output.command = intent.command.trim();
  if (hasOwn(intent, 'focus') && isNonEmptyString(intent.focus)) output.focus = intent.focus.trim();
  return deepFreeze(output);
}

function normalizeHostCommandIntent(intent) {
  assertAllowedKeys(intent, ['type', 'actionId', 'command', 'url', 'sensitive']);
  const sensitive = ownValue(intent, 'sensitive', false);
  if (sensitive !== false) {
    throw new ContractError('IPC_HOST_COMMAND_SENSITIVE_REJECTED', 'Sensitive host commands are not accepted', {
      actionId: normalizeActionId(ownValue(intent, 'actionId', null)),
    });
  }
  const command = isNonEmptyString(ownValue(intent, 'command', null)) ? intent.command.trim() : '';
  if (!IPC_HOST_COMMANDS.includes(command)) {
    throw new ContractError('IPC_HOST_COMMAND_UNSUPPORTED', 'Host command is not allow-listed', { command: command || null });
  }
  if (command === 'open_url') {
    return Object.freeze({
      command,
      trustedUrl: parseTrustedUrl(ownValue(intent, 'url', null), 'IPC_OVERLAY_URL_UNTRUSTED', 'http:', '/overlay'),
    });
  }
  return Object.freeze({ command });
}

function createDesktopIpcBridge(options = {}) {
  const input = isPlainObject(options) ? options : {};
  const adapters = isPlainObject(input.adapters) ? input.adapters : {};
  const lifecycle = input.lifecycle;
  const logger = typeof input.logger === 'function' ? input.logger : null;

  function log(intent) {
    if (logger === null) return;
    try {
      logger(createLogRecord(intent));
    } catch (_) {
      // Logging must not affect host-side dispatch.
    }
  }

  async function dispatchHttp(intent) {
    if (typeof adapters.http !== 'function') {
      throw new ContractError('IPC_ADAPTER_UNAVAILABLE', 'HTTP adapter is unavailable', { intentType: 'http' });
    }
    const request = normalizeHttpIntent(intent);
    const response = await adapters.http(request);
    const status = isPlainObject(response) && Number.isInteger(response.status) ? response.status : null;
    return Object.freeze({ delivered: true, status });
  }

  async function dispatchWebSocket(intent) {
    if (typeof adapters.websocket !== 'function') {
      throw new ContractError('IPC_ADAPTER_UNAVAILABLE', 'WebSocket adapter is unavailable', { intentType: 'websocket' });
    }
    const request = normalizeWebSocketIntent(intent);
    const response = await adapters.websocket(request);
    return Object.freeze({ connected: isPlainObject(response) ? response.connected === true : true });
  }

  async function dispatchClipboard(intent) {
    if (typeof adapters.clipboard !== 'function') {
      throw new ContractError('IPC_ADAPTER_UNAVAILABLE', 'Clipboard adapter is unavailable', { intentType: 'clipboard.writeText' });
    }
    const request = normalizeClipboardIntent(intent);
    await adapters.clipboard(request);
    return Object.freeze({ written: true, sensitive: request.sensitive });
  }

  async function dispatchNavigate(intent) {
    const target = normalizeNavigateIntent(intent);
    return Object.freeze({ navigated: true, ...target });
  }

  async function dispatchHostCommand(intent) {
    const target = normalizeHostCommandIntent(intent);
    if (target.command === 'restart_backend') {
      if (!lifecycle || typeof lifecycle.executeHostCommand !== 'function') {
        throw new ContractError('IPC_ADAPTER_UNAVAILABLE', 'Lifecycle adapter is unavailable', { command: target.command });
      }
      const snapshot = await lifecycle.executeHostCommand({
        type: 'hostCommand',
        actionId: normalizeActionId(ownValue(intent, 'actionId', null)),
        command: 'restart_backend',
        sensitive: false,
      });
      return Object.freeze({
        command: target.command,
        lifecycleState: isPlainObject(snapshot) && isNonEmptyString(snapshot.state) ? snapshot.state : null,
        backendState: isPlainObject(snapshot) && isNonEmptyString(snapshot.backendState) ? snapshot.backendState : null,
      });
    }
    if (target.command === 'open_url') {
      if (typeof adapters.browser !== 'function') {
        throw new ContractError('IPC_ADAPTER_UNAVAILABLE', 'Browser adapter is unavailable', { command: target.command });
      }
      await adapters.browser({ url: target.trustedUrl.url });
      return Object.freeze({ command: target.command, opened: true, urlTrusted: true });
    }
    if (target.command === 'open_debug_folder' || target.command === 'clear_debug_data') {
      if (typeof adapters.privacy !== 'function') {
        throw new ContractError('IPC_ADAPTER_UNAVAILABLE', 'Privacy adapter is unavailable', { command: target.command });
      }
      await adapters.privacy({ command: target.command });
      return Object.freeze({ command: target.command, completed: true });
    }
    if (
      target.command === 'open_network_troubleshooting' ||
      target.command === 'wait_and_retry' ||
      target.command === 'retry_last_action'
    ) {
      if (typeof adapters.troubleshooting === 'function') {
        await adapters.troubleshooting({ command: target.command });
      }
      return Object.freeze({ command: target.command, acknowledged: true });
    }
    throw new ContractError('IPC_HOST_COMMAND_UNSUPPORTED', 'Host command is not allow-listed', { command: target.command });
  }

  async function dispatch(channelInput, intent) {
    let channel = null;
    let intentType = null;
    let actionId = null;
    try {
      channel = normalizeChannel(channelInput);
      if (!isPlainObject(intent)) {
        throw new ContractError('IPC_INTENT_INVALID', 'Intent must be a plain object');
      }
      intentType = normalizeIntentType(ownValue(intent, 'type', null));
      actionId = normalizeActionId(ownValue(intent, 'actionId', null));
      log(intent);

      let result;
      if (intentType === 'http') result = await dispatchHttp(intent);
      else if (intentType === 'websocket') result = await dispatchWebSocket(intent);
      else if (intentType === 'clipboard.writeText') result = await dispatchClipboard(intent);
      else if (intentType === 'navigate') result = await dispatchNavigate(intent);
      else if (intentType === 'hostCommand') result = await dispatchHostCommand(intent);
      return resultEnvelope({ ok: true, channel, intentType, actionId, result });
    } catch (error) {
      return resultEnvelope({
        ok: false,
        channel,
        intentType,
        actionId,
        error: sanitizeIpcError(error),
      });
    }
  }

  function safeIntentForLog(intent) {
    return createLogRecord(intent);
  }

  function describe() {
    return deepFreeze({
      schemaVersion: DESKTOP_IPC_BRIDGE_SCHEMA_VERSION,
      channel: DESKTOP_IPC_CHANNEL,
      intentTypes: IPC_INTENT_TYPES,
      httpMethods: IPC_HTTP_METHODS,
      hostCommands: IPC_HOST_COMMANDS,
      routeIds: IPC_ROUTE_IDS,
      privacy: IPC_PRIVACY_GUARANTEES,
    });
  }

  return Object.freeze({
    dispatch,
    safeIntentForLog,
    describe,
  });
}

module.exports = {
  DESKTOP_IPC_BRIDGE_SCHEMA_VERSION,
  DESKTOP_IPC_CHANNEL,
  IPC_INTENT_TYPES,
  IPC_HTTP_METHODS,
  IPC_HOST_COMMANDS,
  IPC_ROUTE_IDS,
  IPC_PRIVACY_GUARANTEES,
  createDesktopIpcBridge,
};
