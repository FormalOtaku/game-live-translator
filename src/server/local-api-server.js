'use strict';

const http = require('node:http');
const {
  ALLOWED_BIND_ADDRESS,
  ContractError,
  assertLocalhostBind,
  redactSecrets,
} = require('../contracts/security');
const {
  assertCaptureSourcesResponse,
  assertOcrResult,
  assertOcrTestRequest,
  validateRoiRect,
} = require('../contracts/validation');
const { sanitizeSubtitleForOverlay } = require('../core/subtitle-state');
const { OVERLAY_CSP, renderOverlayHtml } = require('./overlay-renderer');
const {
  DEFAULT_APP_WS_PATH,
  createAppStatusWebSocketEndpoint,
  createOverlayWebSocketEndpoint,
  normalizeOverlayState,
  normalizeWebSocketPath,
} = require('./overlay-websocket');
const {
  providerErrorToRuntimeStatus,
  providerErrorRetryable,
} = require('../core/translation-providers');

const DEFAULT_PREFERRED_PORT = 39600;
const DEFAULT_MAX_PORT_ATTEMPTS = 8;
const DEFAULT_VERSION = '0.1.0';
const JSON_BODY_LIMIT_BYTES = 64 * 1024;
const PROFILE_CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

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

const RETRYABLE_API_ERROR_CODES = Object.freeze([
  'BACKEND_NOT_READY',
  'CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE',
  'PORT_UNAVAILABLE',
  'WS_REJECTED',
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
  if (typeof input.retryable === 'boolean') {
    status.retryable = input.retryable;
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

function writeHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(html));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', OVERLAY_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(html);
}

function writeApiError(res, statusCode, code, message, options) {
  writeJson(res, statusCode, buildApiError(code, message, options));
}

function writeMethodNotAllowed(res, allowedMethods = ['GET']) {
  res.setHeader('Allow', allowedMethods.join(', '));
  writeApiError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
}

function profileRepositoryUnavailable() {
  return new ContractError(
    'DB_UNAVAILABLE',
    'Profile repository is not available',
  );
}

function providerKeyStoreUnavailable() {
  return new ContractError(
    'KEYCHAIN_UNAVAILABLE',
    'Provider key store is not available',
  );
}

function captureSourceProviderUnavailable() {
  return new ContractError(
    'CAPTURE_ENUM_FAILED',
    'Capture source enumeration is not available',
  );
}

function ocrTestProviderUnavailable() {
  return new ContractError(
    'OCR_ENGINE_ERROR',
    'OCR engine is not available',
  );
}

function getProfileRepository(repository, methods) {
  if (!isObject(repository)) throw profileRepositoryUnavailable();
  for (const method of methods) {
    if (typeof repository[method] !== 'function') throw profileRepositoryUnavailable();
  }
  return repository;
}

function getProviderKeyStore(store, methods) {
  if (!isObject(store)) throw providerKeyStoreUnavailable();
  for (const method of methods) {
    if (typeof store[method] !== 'function') throw providerKeyStoreUnavailable();
  }
  return store;
}

function getCaptureSourceProvider(provider) {
  if (!isObject(provider) || typeof provider.enumerateCaptureSources !== 'function') {
    throw captureSourceProviderUnavailable();
  }
  return provider;
}

function getOcrTestProvider(provider) {
  if (!isObject(provider) || typeof provider.runOcrTest !== 'function') {
    throw ocrTestProviderUnavailable();
  }
  return provider;
}

function sanitizeCaptureSourcesResponse(payload) {
  return Object.freeze({
    sources: Object.freeze(payload.sources.map((source) => {
      const output = {
        kind: source.kind,
        id: source.id,
        label: source.label,
      };
      if (source.bounds !== undefined) {
        output.bounds = {
          x: source.bounds.x,
          y: source.bounds.y,
          width: source.bounds.width,
          height: source.bounds.height,
        };
      }
      return Object.freeze(output);
    })),
  });
}

function sanitizeOcrResult(payload) {
  const output = {
    text: payload.text,
    normalizedText: payload.normalizedText,
    confidence: payload.confidence,
    durationMs: payload.durationMs,
    accepted: payload.accepted,
  };
  if (payload.rejectionReason !== undefined) {
    output.rejectionReason = payload.rejectionReason;
  }
  return Object.freeze(output);
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (_) {
    throw new ContractError('BAD_REQUEST', 'Invalid URL path segment', {
      fieldErrors: [
        fieldError('path', 'PATH_INVALID', 'URL path segment must be percent-decodable'),
      ],
    });
  }
}

function readJsonBody(req, limitBytes = JSON_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      callback(value);
    }

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        finish(reject, new ContractError('BAD_REQUEST', 'JSON request body is too large', {
          limitBytes,
        }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const rawBody = Buffer.concat(chunks).toString('utf8');
      if (rawBody.trim().length === 0) {
        finish(resolve, {});
        return;
      }
      try {
        finish(resolve, JSON.parse(rawBody));
      } catch (_) {
        finish(reject, new ContractError('BAD_REQUEST', 'Malformed JSON request body', {
          fieldErrors: [
            fieldError('', 'JSON_INVALID', 'Request body must be valid JSON'),
          ],
        }));
      }
    });
    req.on('error', (error) => {
      finish(reject, error);
    });
  });
}

function statusCodeForContractError(error) {
  const code = error && error.code;
  if (code === 'PROFILE_NOT_FOUND') return 404;
  if (code === 'THEME_NOT_FOUND') return 404;
  if (code === 'PROVIDER_UNKNOWN') return 400;
  if (code === 'CANNOT_DELETE_ACTIVE_PROFILE') return 409;
  if (
    code === 'CANNOT_UPDATE_BUILT_IN_THEME' ||
    code === 'CANNOT_DELETE_BUILT_IN_THEME' ||
    code === 'THEME_IN_USE'
  ) {
    return 409;
  }
  if (
    code === 'VALIDATION_ERROR' ||
    code === 'BAD_REQUEST' ||
    code === 'IMPORT_SCHEMA_INVALID' ||
    code === 'IMPORT_CONTAINS_FORBIDDEN_FIELD' ||
    code === 'GLOSSARY_IMPORT_INVALID'
  ) {
    return 400;
  }
  if (code === 'ROI_MISSING') return 400;
  if (code === 'DB_UNAVAILABLE') return 503;
  if (code === 'KEYCHAIN_UNAVAILABLE') return 503;
  if (code === 'CAPTURE_ENUM_FAILED') return 500;
  if (code === 'OCR_ENGINE_ERROR') return 500;
  if (code === 'DB_READ_FAILED') return 500;
  return 500;
}

function writeContractError(res, error) {
  if (!(error instanceof ContractError)) {
    writeApiError(res, 500, 'INTERNAL_ERROR', error && error.message ? error.message : 'Internal error');
    return;
  }
  const code = typeof error.code === 'string' && error.code.trim().length > 0
    ? error.code
    : 'INTERNAL_ERROR';
  const retryable = providerErrorRetryable(code) || RETRYABLE_API_ERROR_CODES.includes(code);
  writeJson(res, statusCodeForContractError(error), buildApiError(
    code,
    typeof error.message === 'string' ? error.message : code,
    {
      retryable,
      details: error.details,
    },
  ));
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
  const overlayState = normalizeOverlayState(options.overlayState, { clock: options.clock });
  const overlayWsPath = normalizeWebSocketPath(valueFromOption(options.overlayWsPath));
  const appWsPath = normalizeWebSocketPath(valueFromOption(options.appWsPath), DEFAULT_APP_WS_PATH);
  if (appWsPath === overlayWsPath) {
    throw validationError([
      fieldError('appWsPath', 'WS_PATH_CONFLICT', 'appWsPath must differ from overlayWsPath'),
    ]);
  }
  const version = typeof options.version === 'string' && options.version.trim().length > 0
    ? options.version.trim()
    : DEFAULT_VERSION;
  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? Object.freeze([...options.allowedOrigins])
    : Object.freeze([]);
  const allowSamePortLocalhostOrigin = options.allowSamePortLocalhostOrigin !== false;
  const profileRepository = options.profileRepository;
  const providerKeyStore = options.providerKeyStore;
  const captureSourceProvider = options.captureSourceProvider;
  const ocrTestProvider = options.ocrTestProvider;
  let selectedPort = null;
  let upgradeAttached = false;

  const server = http.createServer((req, res) => {
    Promise.resolve(handleRequest(req, res)).catch((error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      writeApiError(res, 500, 'INTERNAL_ERROR', error && error.message ? error.message : 'Internal error');
    });
  });
  const isOriginAllowedForWs = (origin) => resolveCorsOrigin(origin, {
    allowedOrigins,
    allowSamePortLocalhostOrigin,
    port: selectedPort,
  }) !== null;

  const overlayWebSocket = createOverlayWebSocketEndpoint({
    path: overlayWsPath,
    overlayState,
    clock: options.clock,
    isOriginAllowed: isOriginAllowedForWs,
  });

  function runtimeStatusSourceFailure(error) {
    const updatedAt = toIsoTimestamp(undefined, options.clock);
    const message = error && typeof error.message === 'string'
      ? error.message
      : 'Runtime status unavailable';
    return Object.freeze({
      capture: Object.freeze({ state: 'idle', updatedAt }),
      ocr: Object.freeze({ state: 'idle', updatedAt }),
      translation: Object.freeze({
        state: 'error',
        code: 'RUNTIME_STATUS_SOURCE_FAILED',
        message: redactSecrets(message),
        retryable: false,
        updatedAt,
      }),
    });
  }

  function currentAppStatusSafe() {
    let runtimeStatus = options.runtimeStatus;
    let backendState = options.backendState;
    let activeProfileId = options.activeProfileId;
    try {
      runtimeStatus = valueFromOption(options.runtimeStatus);
    } catch (error) {
      runtimeStatus = runtimeStatusSourceFailure(error);
      backendState = 'error';
      activeProfileId = null;
    }
    try {
      return buildAppStatus({
        port: selectedPort,
        bindAddress,
        overlayState,
        runtimeStatus,
        backendState,
        activeProfileId,
        clock: options.clock,
      });
    } catch (error) {
      try {
        return buildAppStatus({
          port: selectedPort,
          bindAddress,
          overlayState,
          runtimeStatus: runtimeStatusSourceFailure(error),
          backendState: 'error',
          activeProfileId: null,
          clock: options.clock,
        });
      } catch (_) {
        return null;
      }
    }
  }

  const appStatusWebSocket = createAppStatusWebSocketEndpoint({
    path: appWsPath,
    overlayState,
    isOriginAllowed: isOriginAllowedForWs,
    buildSnapshot: currentAppStatusSafe,
  });

  function rejectUpgrade(socket, statusCode, statusName, code, message) {
    const body = JSON.stringify({
      error: { code, message, retryable: code === 'WS_REJECTED' },
    });
    try {
      socket.end([
        `HTTP/1.1 ${statusCode} ${statusName}`,
        'Content-Type: application/json; charset=utf-8',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        body,
      ].join('\r\n'));
    } catch (_) {
      socket.destroy();
    }
  }

  function dispatchUpgrade(req, socket, head) {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', `http://${bindAddress}:${selectedPort ?? preferredPort}`).pathname;
    } catch (_) {
      rejectUpgrade(socket, 400, 'Bad Request', 'WS_REJECTED', 'Invalid WebSocket request URL');
      return;
    }
    if (pathname === overlayWsPath) {
      overlayWebSocket.handleUpgrade(req, socket, head);
      return;
    }
    if (pathname === appWsPath) {
      appStatusWebSocket.handleUpgrade(req, socket, head);
      return;
    }
    rejectUpgrade(socket, 404, 'Not Found', 'NOT_FOUND', 'Resource not found');
  }

  function attachUpgradeDispatcher() {
    if (upgradeAttached) return;
    server.on('upgrade', dispatchUpgrade);
    upgradeAttached = true;
  }

  function detachUpgradeDispatcher() {
    if (!upgradeAttached) return;
    server.off('upgrade', dispatchUpgrade);
    upgradeAttached = false;
  }

  attachUpgradeDispatcher();
  overlayWebSocket.start();
  appStatusWebSocket.start();

  async function enumerateCaptureSources() {
    const provider = getCaptureSourceProvider(captureSourceProvider);
    let payload;
    try {
      payload = await provider.enumerateCaptureSources();
    } catch (_) {
      throw new ContractError('CAPTURE_ENUM_FAILED', 'Capture source enumeration failed');
    }

    try {
      assertCaptureSourcesResponse(payload);
    } catch (error) {
      const details = error instanceof ContractError &&
        isObject(error.details) &&
        Array.isArray(error.details.fieldErrors)
        ? { fieldErrors: error.details.fieldErrors }
        : undefined;
      throw new ContractError(
        'CAPTURE_ENUM_FAILED',
        'Capture source enumeration returned an invalid response',
        details,
      );
    }
    return sanitizeCaptureSourcesResponse(payload);
  }

  function resolveOcrTestRoi(payload, profile) {
    if (payload.roi !== undefined) return payload.roi;
    const roi = isObject(profile) ? profile.roi : undefined;
    if (validateRoiRect(roi, 'roi').length === 0) return roi;
    throw new ContractError('ROI_MISSING', 'OCR ROI is required before running a manual test', {
      fieldErrors: [
        fieldError(
          'roi',
          'ROI_MISSING',
          'roi must be supplied in the request or saved on the profile',
        ),
      ],
    });
  }

  async function runManualOcrTest(payload) {
    assertOcrTestRequest(payload);
    const repository = getProfileRepository(profileRepository, ['getProfile']);
    const profile = repository.getProfile(payload.profileId);
    const roi = resolveOcrTestRoi(payload, profile);
    const provider = getOcrTestProvider(ocrTestProvider);

    let result;
    try {
      result = await provider.runOcrTest({ profile, roi });
    } catch (_) {
      throw new ContractError('OCR_ENGINE_ERROR', 'OCR engine failed');
    }

    try {
      assertOcrResult(result);
    } catch (error) {
      const details = error instanceof ContractError &&
        isObject(error.details) &&
        Array.isArray(error.details.fieldErrors)
        ? { fieldErrors: error.details.fieldErrors }
        : undefined;
      throw new ContractError(
        'OCR_ENGINE_ERROR',
        'OCR engine returned an invalid result',
        details,
      );
    }
    return sanitizeOcrResult(result);
  }

  async function handleCaptureRoute(pathname, req, res) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'capture') return false;

    try {
      if (segments.length === 3 && segments[2] === 'sources') {
        if (req.method !== 'GET') {
          writeMethodNotAllowed(res, ['GET']);
          return true;
        }
        writeJson(res, 200, await enumerateCaptureSources());
        return true;
      }
    } catch (error) {
      writeContractError(res, error);
      return true;
    }

    return false;
  }

  async function handleOcrRoute(pathname, req, res) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'ocr') return false;

    try {
      if (segments.length === 3 && segments[2] === 'test') {
        if (req.method !== 'POST') {
          writeMethodNotAllowed(res, ['POST']);
          return true;
        }
        const payload = await readJsonBody(req);
        writeJson(res, 200, await runManualOcrTest(payload));
        return true;
      }
    } catch (error) {
      writeContractError(res, error);
      return true;
    }

    return false;
  }

  async function handleProfileRoute(pathname, req, res) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'profiles') return false;

    try {
      if (segments.length === 2) {
        if (req.method === 'GET') {
          const repository = getProfileRepository(profileRepository, ['listProfiles']);
          writeJson(res, 200, Object.freeze({ profiles: repository.listProfiles() }));
          return true;
        }
        if (req.method === 'POST') {
          const repository = getProfileRepository(profileRepository, ['createProfile']);
          const payload = await readJsonBody(req);
          writeJson(res, 201, repository.createProfile(payload));
          return true;
        }
        writeMethodNotAllowed(res, ['GET', 'POST']);
        return true;
      }

      if (segments.length === 3 && segments[2] === 'active') {
        if (req.method !== 'PUT') {
          writeMethodNotAllowed(res, ['PUT']);
          return true;
        }
        const repository = getProfileRepository(profileRepository, ['setActiveProfile']);
        const payload = await readJsonBody(req);
        if (!isObject(payload) || typeof payload.profileId !== 'string') {
          throw new ContractError('VALIDATION_ERROR', 'profileId is required', {
            fieldErrors: [
              fieldError('profileId', 'VALIDATION_ERROR', 'profileId must be a non-empty string'),
            ],
          });
        }
        writeJson(res, 200, repository.setActiveProfile(payload.profileId));
        return true;
      }

      if (segments.length === 3 && segments[2] === 'import') return false;

      if (segments.length === 5 && segments[3] === 'glossary' && segments[4] === 'export') {
        if (req.method !== 'GET') {
          writeMethodNotAllowed(res, ['GET']);
          return true;
        }
        const repository = getProfileRepository(profileRepository, ['exportGlossary']);
        writeJson(res, 200, repository.exportGlossary(decodePathSegment(segments[2])));
        return true;
      }

      if (segments.length === 5 && segments[3] === 'glossary' && segments[4] === 'import') {
        if (req.method !== 'POST') {
          writeMethodNotAllowed(res, ['POST']);
          return true;
        }
        const repository = getProfileRepository(profileRepository, ['importGlossary']);
        const payload = await readJsonBody(req);
        writeJson(res, 200, repository.importGlossary(decodePathSegment(segments[2]), payload));
        return true;
      }

      if (segments.length === 4 && segments[3] === 'export') {
        if (req.method !== 'GET') {
          writeMethodNotAllowed(res, ['GET']);
          return true;
        }
        const repository = getProfileRepository(profileRepository, ['exportProfile']);
        writeJson(res, 200, repository.exportProfile(decodePathSegment(segments[2])));
        return true;
      }

      if (segments.length === 3) {
        const profileId = decodePathSegment(segments[2]);
        if (req.method === 'GET') {
          const repository = getProfileRepository(profileRepository, ['getProfile']);
          writeJson(res, 200, repository.getProfile(profileId));
          return true;
        }
        if (req.method === 'PUT') {
          const repository = getProfileRepository(profileRepository, ['updateProfile']);
          const payload = await readJsonBody(req);
          writeJson(res, 200, repository.updateProfile(profileId, payload));
          return true;
        }
        if (req.method === 'DELETE') {
          const repository = getProfileRepository(profileRepository, ['deleteProfile']);
          writeJson(res, 200, repository.deleteProfile(profileId));
          return true;
        }
        writeMethodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
        return true;
      }
    } catch (error) {
      writeContractError(res, error);
      return true;
    }

    return false;
  }

  async function handleThemeRoute(pathname, req, res) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'themes') return false;

    try {
      if (segments.length === 2) {
        if (req.method === 'GET') {
          const repository = getProfileRepository(profileRepository, ['listThemes']);
          writeJson(res, 200, Object.freeze({ themes: repository.listThemes() }));
          return true;
        }
        if (req.method === 'POST') {
          const repository = getProfileRepository(profileRepository, ['createTheme']);
          const payload = await readJsonBody(req);
          writeJson(res, 201, repository.createTheme(payload));
          return true;
        }
        writeMethodNotAllowed(res, ['GET', 'POST']);
        return true;
      }

      if (segments.length === 3) {
        const themeId = decodePathSegment(segments[2]);
        if (req.method === 'GET') {
          const repository = getProfileRepository(profileRepository, ['getTheme']);
          writeJson(res, 200, repository.getTheme(themeId));
          return true;
        }
        if (req.method === 'PUT') {
          const repository = getProfileRepository(profileRepository, ['updateTheme']);
          const payload = await readJsonBody(req);
          writeJson(res, 200, repository.updateTheme(themeId, payload));
          return true;
        }
        if (req.method === 'DELETE') {
          const repository = getProfileRepository(profileRepository, ['deleteTheme']);
          writeJson(res, 200, repository.deleteTheme(themeId));
          return true;
        }
        writeMethodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
        return true;
      }
    } catch (error) {
      writeContractError(res, error);
      return true;
    }

    return false;
  }

  async function handleSettingsRoute(pathname, req, res) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'settings') return false;

    try {
      if (segments.length === 3 && segments[2] === 'privacy') {
        if (req.method === 'GET') {
          const repository = getProfileRepository(profileRepository, ['getPrivacySettings']);
          writeJson(res, 200, repository.getPrivacySettings());
          return true;
        }
        if (req.method === 'PUT') {
          const repository = getProfileRepository(profileRepository, ['savePrivacySettings']);
          const payload = await readJsonBody(req);
          writeJson(res, 200, repository.savePrivacySettings(payload));
          return true;
        }
        writeMethodNotAllowed(res, ['GET', 'PUT']);
        return true;
      }
    } catch (error) {
      writeContractError(res, error);
      return true;
    }

    return false;
  }

  async function handleProviderKeyRoute(pathname, req, res) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'keys') return false;

    try {
      if (segments.length === 3) {
        const provider = decodePathSegment(segments[2]);
        if (req.method === 'PUT') {
          const store = getProviderKeyStore(providerKeyStore, ['saveProviderKey']);
          const payload = await readJsonBody(req);
          writeJson(res, 200, await store.saveProviderKey(provider, payload));
          return true;
        }
        if (req.method === 'DELETE') {
          const store = getProviderKeyStore(providerKeyStore, ['deleteProviderKey']);
          writeJson(res, 200, await store.deleteProviderKey(provider));
          return true;
        }
        writeMethodNotAllowed(res, ['PUT', 'DELETE']);
        return true;
      }
    } catch (error) {
      writeContractError(res, error);
      return true;
    }

    return false;
  }

  async function handleRequest(req, res) {
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
        res.setHeader('Access-Control-Allow-Methods', PROFILE_CORS_METHODS);
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
        writeMethodNotAllowed(res);
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

    if (pathname === '/overlay') {
      if (req.method !== 'GET') {
        writeMethodNotAllowed(res);
        return;
      }
      const overlay = getOverlaySnapshot(overlayState);
      writeHtml(res, 200, renderOverlayHtml({
        initialFrame: overlay.lastSubtitle,
        themeId: valueFromOption(options.overlayThemeId),
        maxLines: valueFromOption(options.overlayMaxLines),
        statusPath: valueFromOption(options.overlayStatusPath),
        wsPath: overlayWsPath,
      }));
      return;
    }

    if (pathname === overlayWsPath || pathname === appWsPath) {
      writeApiError(res, 426, 'WS_REJECTED', 'WebSocket upgrade required', { retryable: true });
      return;
    }

    if (pathname === '/api/status') {
      if (req.method !== 'GET') {
        writeMethodNotAllowed(res);
        return;
      }
      const status = currentAppStatusSafe();
      if (status === null) {
        writeApiError(res, 500, 'INTERNAL_ERROR', 'Status unavailable');
        return;
      }
      writeJson(res, 200, status);
      return;
    }

    if (await handleProfileRoute(pathname, req, res)) return;
    if (await handleCaptureRoute(pathname, req, res)) return;
    if (await handleOcrRoute(pathname, req, res)) return;
    if (await handleThemeRoute(pathname, req, res)) return;
    if (await handleSettingsRoute(pathname, req, res)) return;
    if (await handleProviderKeyRoute(pathname, req, res)) return;

    writeApiError(res, 404, 'NOT_FOUND', 'Resource not found');
  }

  async function start() {
    attachUpgradeDispatcher();
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
    appStatusWebSocket.close();
    overlayWebSocket.close();
    detachUpgradeDispatcher();
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  function publishStatus() {
    if (selectedPort === null) return;
    appStatusWebSocket.publish();
  }

  return Object.freeze({
    start,
    stop,
    server,
    overlayState,
    publishStatus,
    get port() {
      return selectedPort;
    },
    get bindAddress() {
      return bindAddress;
    },
    get appWsPath() {
      return appWsPath;
    },
    get overlayWsPath() {
      return overlayWsPath;
    },
    get appStatusClientCount() {
      return appStatusWebSocket.clientCount;
    },
  });
}

function buildApiErrorFromContractError(error, options = {}) {
  if (!error || typeof error !== 'object') {
    return buildApiError('INTERNAL_ERROR', 'Internal error', { retryable: false });
  }
  const code = typeof error.code === 'string' && error.code.trim().length > 0
    ? error.code
    : 'INTERNAL_ERROR';
  const retryable = typeof options.retryable === 'boolean'
    ? options.retryable
    : providerErrorRetryable(code) || RETRYABLE_API_ERROR_CODES.includes(code);
  return buildApiError(code, typeof error.message === 'string' ? error.message : code, {
    retryable,
    details: error.details,
  });
}

module.exports = {
  DEFAULT_APP_WS_PATH,
  DEFAULT_MAX_PORT_ATTEMPTS,
  DEFAULT_PREFERRED_PORT,
  DEFAULT_VERSION,
  RUNTIME_STATUS_STATES,
  BACKEND_STATES,
  buildApiError,
  buildApiErrorFromContractError,
  buildAppStatus,
  createLocalApiServer,
  freezeRedactedDetails,
  normalizeRuntimeStatus,
  providerErrorToRuntimeStatus,
  providerErrorRetryable,
  resolveCorsOrigin,
  writeHtml,
  writeMethodNotAllowed,
};
