'use strict';

const http = require('node:http');
const {
  ALLOWED_BIND_ADDRESS,
  ContractError,
  assertLocalhostBind,
  redactSecrets,
} = require('../contracts/security');
const { sanitizeSubtitleForOverlay } = require('../core/subtitle-state');

const DEFAULT_PREFERRED_PORT = 39600;
const DEFAULT_MAX_PORT_ATTEMPTS = 8;
const DEFAULT_VERSION = '0.1.0';

const RUNTIME_STATUS_STATES = Object.freeze([
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toIsoTimestamp(value, fallbackClock) {
  const fallback = typeof fallbackClock === 'function' ? fallbackClock() : new Date();
  const candidate = value === undefined ? fallback : value;

  if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
    return candidate.toISOString();
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return new Date(candidate).toISOString();
  }
  if (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))) {
    return new Date(candidate).toISOString();
  }
  return new Date(0).toISOString();
}

function fieldError(field, code, message) {
  return { field, code, message };
}

function validationError(fieldErrors) {
  return new ContractError('VALIDATION_ERROR', 'Local API server validation failed', {
    fieldErrors,
  });
}

function assertPort(value, field, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
    throw validationError([
      fieldError(field, 'PORT_INVALID', `${field} must be an integer between ${allowZero ? 0 : 1} and 65535`),
    ]);
  }
  return value;
}

function normalizePreferredPort(value) {
  const port = value === undefined ? DEFAULT_PREFERRED_PORT : value;
  return assertPort(port, 'preferredPort', { allowZero: true });
}

function normalizeMaxPortAttempts(value) {
  const attempts = value === undefined ? DEFAULT_MAX_PORT_ATTEMPTS : value;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) {
    throw validationError([
      fieldError('maxPortAttempts', 'PORT_ATTEMPTS_INVALID', 'maxPortAttempts must be an integer from 1 to 100'),
    ]);
  }
  return attempts;
}

function buildApiError(code, message, options = {}) {
  const safeMessage = typeof message === 'string' && message.trim().length > 0
    ? redactSecrets(message)
    : code;
  const payload = {
    error: {
      code,
      message: safeMessage,
      retryable: options.retryable === true,
    },
  };
  if (isObject(options.details)) {
    payload.error.details = freezeRedactedDetails(options.details);
  }
  return Object.freeze({
    error: Object.freeze(payload.error),
  });
}

function freezeRedactedDetails(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeRedactedDetails(item)));
  }
  if (!isObject(value)) return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = freezeRedactedDetails(child);
  }
  return Object.freeze(output);
}

function portUnavailableError(error, context) {
  const message = `No localhost port available for ${context.bindAddress}:${context.preferredPort}`;
  return new ContractError('PORT_UNAVAILABLE', message, {
    bindAddress: context.bindAddress,
    preferredPort: context.preferredPort,
    maxPortAttempts: context.maxPortAttempts,
    causeCode: error && error.code,
  });
}

function isLocalHttpOrigin(url) {
  return (
    url.protocol === 'http:' &&
    (url.hostname === ALLOWED_BIND_ADDRESS || url.hostname === 'localhost')
  );
}

function resolveCorsOrigin(origin, options = {}) {
  if (typeof origin !== 'string' || origin.trim() === '') return null;

  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? options.allowedOrigins
    : [];
  if (allowedOrigins.includes(origin)) return origin;

  if (options.allowSamePortLocalhostOrigin === false) return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return null;
  }

  if (!isLocalHttpOrigin(parsed)) return null;
  const originPort = parsed.port === '' ? 80 : Number(parsed.port);
  if (!Number.isInteger(originPort) || originPort !== options.port) return null;
  return origin;
}

function normalizeBackendState(value) {
  return BACKEND_STATES.includes(value) ? value : 'ready';
}

function normalizeActiveProfileId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRuntimeStatus(value, fallbackState, clock) {
  const input = isObject(value) ? value : {};
  const state = RUNTIME_STATUS_STATES.includes(input.state)
    ? input.state
    : fallbackState;
  const status = {
    state,
    updatedAt: toIsoTimestamp(input.updatedAt, clock),
  };
  if (typeof input.message === 'string' && input.message.trim().length > 0) {
    status.message = redactSecrets(input.message);
  }
  if (typeof input.code === 'string' && input.code.trim().length > 0) {
    status.code = input.code.trim();
  }
  return Object.freeze(status);
}

function valueFromOption(value) {
  return typeof value === 'function' ? value() : value;
}

function getOverlaySnapshot(overlayState) {
  if (!isObject(overlayState) || typeof overlayState.snapshot !== 'function') {
    return Object.freeze({ overlayClients: 0, lastSubtitle: null });
  }
  const snapshot = overlayState.snapshot();
  if (!isObject(snapshot)) {
    return Object.freeze({ overlayClients: 0, lastSubtitle: null });
  }

  const overlayClients = Number.isFinite(snapshot.overlayClients)
    ? snapshot.overlayClients
    : 0;
  const lastSubtitle = isObject(snapshot.lastSubtitle)
    ? sanitizeSubtitleForOverlay(snapshot.lastSubtitle)
    : null;
  return Object.freeze({ overlayClients, lastSubtitle });
}

function buildAppStatus(options = {}) {
  const port = assertPort(options.port, 'port');
  const bindAddress = assertLocalhostBind(options.bindAddress ?? ALLOWED_BIND_ADDRESS);
  const clock = options.clock;
  const runtimeStatus = valueFromOption(options.runtimeStatus) ?? {};
  const overlay = getOverlaySnapshot(options.overlayState);
  const status = {
    backend: normalizeBackendState(valueFromOption(options.backendState)),
    activeProfileId: normalizeActiveProfileId(valueFromOption(options.activeProfileId)),
    overlayUrl: `http://${bindAddress}:${port}/overlay`,
    capture: normalizeRuntimeStatus(runtimeStatus.capture, 'idle', clock),
    ocr: normalizeRuntimeStatus(runtimeStatus.ocr, 'idle', clock),
    translation: normalizeRuntimeStatus(runtimeStatus.translation, 'idle', clock),
    overlayClients: overlay.overlayClients,
  };
  if (overlay.lastSubtitle !== null) {
    status.lastSubtitle = overlay.lastSubtitle;
  }
  return Object.freeze(status);
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function writeApiError(res, statusCode, code, message, options) {
  writeJson(res, statusCode, buildApiError(code, message, options));
}

function listenOnPort(server, bindAddress, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      resolve(isObject(address) ? address.port : port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, bindAddress);
  });
}

async function listenWithFallback(server, options) {
  const { bindAddress, preferredPort, maxPortAttempts } = options;
  let lastError = null;
  for (let offset = 0; offset < maxPortAttempts; offset += 1) {
    const port = preferredPort === 0 ? 0 : preferredPort + offset;
    if (port > 65535) break;
    try {
      return await listenOnPort(server, bindAddress, port);
    } catch (error) {
      lastError = error;
      if (!error || error.code !== 'EADDRINUSE' || preferredPort === 0) {
        throw error;
      }
    }
  }
  throw portUnavailableError(lastError, options);
}

function createLocalApiServer(options = {}) {
  const bindAddress = assertLocalhostBind(options.bindAddress ?? ALLOWED_BIND_ADDRESS);
  const preferredPort = normalizePreferredPort(options.preferredPort);
  const maxPortAttempts = normalizeMaxPortAttempts(options.maxPortAttempts);
  const version = typeof options.version === 'string' && options.version.trim().length > 0
    ? options.version.trim()
    : DEFAULT_VERSION;
  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? Object.freeze([...options.allowedOrigins])
    : Object.freeze([]);
  const allowSamePortLocalhostOrigin = options.allowSamePortLocalhostOrigin !== false;
  let selectedPort = null;

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      writeApiError(res, 500, 'INTERNAL_ERROR', error && error.message ? error.message : 'Internal error');
    }
  });

  function handleRequest(req, res) {
    const hasOrigin = typeof req.headers.origin === 'string' && req.headers.origin.trim() !== '';
    const origin = resolveCorsOrigin(req.headers.origin, {
      allowedOrigins,
      allowSamePortLocalhostOrigin,
      port: selectedPort,
    });
    if (hasOrigin) {
      res.setHeader('Vary', 'Origin');
    }
    if (origin !== null) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      if (origin !== null) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      res.end();
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? '/', `http://${bindAddress}:${selectedPort ?? preferredPort}`).pathname;
    } catch (_) {
      writeApiError(res, 400, 'BAD_REQUEST', 'Invalid request URL');
      return;
    }

    if (pathname === '/health') {
      if (req.method !== 'GET') {
        writeApiError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
        return;
      }
      writeJson(res, 200, Object.freeze({
        ok: true,
        version,
        port: selectedPort,
        bindAddress,
      }));
      return;
    }

    if (pathname === '/api/status') {
      if (req.method !== 'GET') {
        writeApiError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
        return;
      }
      writeJson(res, 200, buildAppStatus({
        port: selectedPort,
        bindAddress,
        overlayState: options.overlayState,
        runtimeStatus: options.runtimeStatus,
        backendState: options.backendState,
        activeProfileId: options.activeProfileId,
        clock: options.clock,
      }));
      return;
    }

    writeApiError(res, 404, 'NOT_FOUND', 'Resource not found');
  }

  async function start() {
    selectedPort = await listenWithFallback(server, {
      bindAddress,
      preferredPort,
      maxPortAttempts,
    });
    return Object.freeze({
      port: selectedPort,
      bindAddress,
      origin: `http://${bindAddress}:${selectedPort}`,
      overlayUrl: `http://${bindAddress}:${selectedPort}/overlay`,
    });
  }

  async function stop() {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  return Object.freeze({
    start,
    stop,
    server,
    get port() {
      return selectedPort;
    },
    get bindAddress() {
      return bindAddress;
    },
  });
}

module.exports = {
  DEFAULT_MAX_PORT_ATTEMPTS,
  DEFAULT_PREFERRED_PORT,
  DEFAULT_VERSION,
  RUNTIME_STATUS_STATES,
  BACKEND_STATES,
  buildApiError,
  buildAppStatus,
  createLocalApiServer,
  freezeRedactedDetails,
  normalizeRuntimeStatus,
  resolveCorsOrigin,
};
