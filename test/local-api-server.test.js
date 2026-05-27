'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const {
  buildApiError,
  buildApiErrorFromContractError,
  createLocalApiServer,
  providerErrorRetryable,
  providerErrorToRuntimeStatus,
  resolveCorsOrigin,
} = require('../src/server/local-api-server');
const { ContractError, DEFAULT_PRIVACY_SETTINGS } = require('../src/contracts/security');
const { createSubtitleFrame, OverlayState } = require('../src/core/subtitle-state');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';

function fixedClock() {
  return FIXED_TIME;
}

function requestJson({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    let requestBody = null;
    const requestHeaders = { ...headers };
    if (body !== undefined) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] ?? 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: requestHeaders,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        const parsed = body.length > 0 ? JSON.parse(body) : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, body, parsed });
      });
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}

function requestText({ port, path, method = 'GET', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function listenBlocker() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function makeApiProfile(overrides = {}) {
  return {
    id: 'profile_001',
    name: 'Main Profile',
    gameTitle: 'Game',
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.65,
    captureHz: 2,
    translationProvider: 'deepl',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossary: [
      { id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' },
    ],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function makeApiTheme(overrides = {}) {
  return {
    id: 'custom_theme_001',
    name: 'Custom Theme',
    builtIn: false,
    cssJson: {
      fontFamily: 'Arial',
      fontSizePx: 32,
      textColor: '#ffffff',
      visibleLines: 2,
    },
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function makeApiPrivacySettings(overrides = {}) {
  return {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...overrides,
  };
}

function makeProfileCreatePayload(overrides = {}) {
  return {
    name: 'Created Profile',
    ocrPreset: 'menu_text',
    ocrConfidenceFloor: 0.5,
    captureHz: 0,
    translationProvider: 'echo',
    targetLang: 'en',
    overlayThemeId: 'minimal',
    glossary: [],
    ...overrides,
  };
}

test('createLocalApiServer rejects non-localhost bind addresses before listening', () => {
  const rejected = ['0.0.0.0', '::', '::1', 'localhost', '192.168.1.10', ''];

  for (const bindAddress of rejected) {
    assert.throws(
      () => createLocalApiServer({ bindAddress }),
      (error) =>
        error instanceof ContractError &&
        error.code === 'NON_LOCALHOST_BIND_REJECTED',
      `expected ${bindAddress} to be rejected`,
    );
  }
});

test('GET /health reports selected localhost port and version', async () => {
  const api = createLocalApiServer({ preferredPort: 0, version: 'test-version' });
  const started = await api.start();

  try {
    assert.equal(started.bindAddress, '127.0.0.1');
    assert.equal(started.port, api.port);
    assert.equal(started.overlayUrl, `http://127.0.0.1:${started.port}/overlay`);

    const response = await requestJson({ port: started.port, path: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.parsed, {
      ok: true,
      version: 'test-version',
      port: started.port,
      bindAddress: '127.0.0.1',
    });
  } finally {
    await api.stop();
  }
});

test('server falls back to a later localhost port when preferred port is occupied', async () => {
  const blocker = await listenBlocker();
  const api = createLocalApiServer({
    preferredPort: blocker.port,
    maxPortAttempts: 16,
  });

  try {
    const started = await api.start();
    assert.notEqual(started.port, blocker.port);
    assert.ok(started.port > blocker.port);
    assert.ok(started.port <= blocker.port + 15);

    const response = await requestJson({ port: started.port, path: '/health' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.parsed.port, started.port);
  } finally {
    await api.stop();
    await closeServer(blocker.server);
  }
});

test('server reports PORT_UNAVAILABLE when all port attempts are occupied', async () => {
  const blocker = await listenBlocker();
  const api = createLocalApiServer({
    preferredPort: blocker.port,
    maxPortAttempts: 1,
  });

  try {
    await assert.rejects(
      () => api.start(),
      (error) =>
        error instanceof ContractError &&
        error.code === 'PORT_UNAVAILABLE' &&
        error.details.bindAddress === '127.0.0.1' &&
        error.details.preferredPort === blocker.port &&
        error.details.maxPortAttempts === 1,
    );
  } finally {
    await api.stop();
    await closeServer(blocker.server);
  }
});

test('createLocalApiServer rejects colliding app and overlay websocket paths', () => {
  assert.throws(
    () => createLocalApiServer({ overlayWsPath: '/ws/stream', appWsPath: '/ws/stream' }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'WS_PATH_CONFLICT',
  );
});

test('stop detaches the shared websocket upgrade dispatcher', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  await api.start();

  assert.equal(api.server.listenerCount('upgrade'), 1);
  await api.stop();
  assert.equal(api.server.listenerCount('upgrade'), 0);
});

test('GET /api/status returns AppStatus with sanitized latest subtitle', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  overlayState.connectClient();
  overlayState.connectClient();
  overlayState.publishFrame(createSubtitleFrame({
    id: 'subtitle-1',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: '<script>alert("x")</script>',
    provider: 'echo',
    confidence: 0.9,
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  }));

  const api = createLocalApiServer({
    preferredPort: 0,
    overlayState,
    activeProfileId: 'profile-1',
    runtimeStatus: {
      capture: { state: 'running', message: 'Capturing ROI', updatedAt: FIXED_TIME },
      ocr: { state: 'ok', code: 'OCR_ACCEPTED', updatedAt: Date.parse(FIXED_TIME) },
      translation: {
        state: 'warning',
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        message: 'retry with token: sk-ABCDEFGHIJKLMNOP1234',
        updatedAt: FIXED_TIME,
      },
    },
    clock: fixedClock,
  });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/status' });
    const status = response.parsed;

    assert.equal(response.statusCode, 200);
    assert.equal(status.backend, 'ready');
    assert.equal(status.activeProfileId, 'profile-1');
    assert.equal(status.overlayUrl, `http://127.0.0.1:${started.port}/overlay`);
    assert.equal(status.overlayClients, 2);
    assert.equal(status.capture.state, 'running');
    assert.equal(status.ocr.code, 'OCR_ACCEPTED');
    assert.equal(status.translation.retryable, true);
    assert.equal(status.translation.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(status.translation.message.includes('[REDACTED]'), true);
    assert.equal(status.lastSubtitle.id, 'subtitle-1');
    assert.equal(status.lastSubtitle.escapedText, '&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;');
    assert.equal(Object.hasOwn(status.lastSubtitle, 'sourceText'), false);
  } finally {
    await api.stop();
  }
});

test('GET /api/status without overlay state omits lastSubtitle and uses safe defaults', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    activeProfileId: 123,
    clock: fixedClock,
  });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/status' });
    const status = response.parsed;

    assert.equal(response.statusCode, 200);
    assert.equal(status.backend, 'ready');
    assert.equal(status.activeProfileId, null);
    assert.equal(status.overlayClients, 0);
    assert.equal(Object.hasOwn(status, 'lastSubtitle'), false);
    assert.deepEqual(status.capture, { state: 'idle', updatedAt: FIXED_TIME });
    assert.deepEqual(status.ocr, { state: 'idle', updatedAt: FIXED_TIME });
    assert.deepEqual(status.translation, { state: 'idle', updatedAt: FIXED_TIME });
  } finally {
    await api.stop();
  }
});

test('GET /overlay serves self-contained OBS HTML with sanitized initial subtitle', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  overlayState.publishFrame(createSubtitleFrame({
    id: 'subtitle-overlay',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: '</script><img src=x onerror=alert(1)>',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  }));
  const api = createLocalApiServer({
    preferredPort: 0,
    overlayState,
    overlayThemeId: 'stream_box',
    overlayMaxLines: 2,
  });
  const started = await api.start();

  try {
    const response = await requestText({ port: started.port, path: '/overlay' });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html; charset=utf-8/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(response.body.startsWith('<!doctype html>'));
    assert.match(response.body, /<body data-theme="stream_box">/);
    assert.match(response.body, /--glt-lines: 2;/);
    assert.ok(response.body.includes('&lt;&#x2F;script&gt;&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;'));
    assert.equal(response.body.includes('</script><img'), false);
    assert.equal(response.body.includes('<img src=x'), false);
    assert.equal(response.body.includes('秘密の原文'), false);
    assert.equal(response.body.includes('sourceText'), false);
    assert.equal(response.body.includes('translatedText'), false);
    assert.equal(/<script[^>]+\bsrc=/i.test(response.body), false);
    assert.equal(/<link\b/i.test(response.body), false);
  } finally {
    await api.stop();
  }
});

test('GET /overlay falls back to safe theme and line count defaults', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    overlayThemeId: 'unknown',
    overlayMaxLines: 99,
  });
  const started = await api.start();

  try {
    const response = await requestText({ port: started.port, path: '/overlay' });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<body data-theme="classic_subtitle">/);
    assert.match(response.body, /--glt-lines: 3;/);
    assert.match(response.body, /data-overlay-state="empty"/);
  } finally {
    await api.stop();
  }
});

test('unsupported routes and methods return canonical ApiError envelopes', async () => {
  const api = createLocalApiServer({ preferredPort: 0 });
  const started = await api.start();

  try {
    const missing = await requestJson({ port: started.port, path: '/missing' });
    assert.equal(missing.statusCode, 404);
    assert.match(missing.headers['content-type'], /application\/json/);
    assert.deepEqual(missing.parsed, {
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        retryable: false,
      },
    });

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/health',
      method: 'POST',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'GET');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(wrongMethod.parsed.error.retryable, false);
    assert.equal(Object.hasOwn(wrongMethod.parsed.error, 'stack'), false);

    const wrongOverlayMethod = await requestJson({
      port: started.port,
      path: '/overlay',
      method: 'POST',
    });
    assert.equal(wrongOverlayMethod.statusCode, 405);
    assert.equal(wrongOverlayMethod.headers.allow, 'GET');
    assert.equal(wrongOverlayMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    await api.stop();
  }
});

test('capture source API enumerates sources through the injected provider', async () => {
  const calls = [];
  const sources = [
    {
      kind: 'monitor',
      id: 'monitor:primary',
      label: 'Display 1',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    {
      kind: 'window',
      id: 'window:game',
      label: 'Game Window',
    },
  ];
  const captureSourceProvider = {
    async enumerateCaptureSources() {
      calls.push(['enumerateCaptureSources']);
      return { sources };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    captureSourceProvider,
  });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/capture/sources' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.parsed, { sources });

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/capture/sources',
      method: 'POST',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'GET');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
    assert.deepEqual(calls, [['enumerateCaptureSources']]);
  } finally {
    await api.stop();
  }
});

test('capture source API maps missing and failed providers to redacted CAPTURE_ENUM_FAILED', async () => {
  const missingApi = createLocalApiServer({ preferredPort: 0 });
  const missingStarted = await missingApi.start();

  try {
    const missing = await requestJson({
      port: missingStarted.port,
      path: '/api/capture/sources',
    });
    assert.equal(missing.statusCode, 500);
    assert.equal(missing.parsed.error.code, 'CAPTURE_ENUM_FAILED');
    assert.equal(missing.parsed.error.retryable, false);
    assert.equal(Object.hasOwn(missing.parsed.error, 'stack'), false);
  } finally {
    await missingApi.stop();
  }

  const leakedKey = 'sk-ABCDEFGHIJKLMNOP1234';
  const failingApi = createLocalApiServer({
    preferredPort: 0,
    captureSourceProvider: {
      enumerateCaptureSources() {
        throw new Error(`capture enumeration failed for ${leakedKey}`);
      },
    },
  });
  const failingStarted = await failingApi.start();

  try {
    const failed = await requestJson({
      port: failingStarted.port,
      path: '/api/capture/sources',
    });
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.parsed.error.code, 'CAPTURE_ENUM_FAILED');
    assert.equal(failed.parsed.error.message, 'Capture source enumeration failed');
    assert.equal(JSON.stringify(failed.parsed).includes(leakedKey), false);
    assert.equal(Object.hasOwn(failed.parsed.error, 'stack'), false);
  } finally {
    await failingApi.stop();
  }

  const nonErrorThrowApi = createLocalApiServer({
    preferredPort: 0,
    captureSourceProvider: {
      enumerateCaptureSources() {
        throw `capture enumeration failed for ${leakedKey}`;
      },
    },
  });
  const nonErrorStarted = await nonErrorThrowApi.start();

  try {
    const failed = await requestJson({
      port: nonErrorStarted.port,
      path: '/api/capture/sources',
    });
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.parsed.error.code, 'CAPTURE_ENUM_FAILED');
    assert.equal(failed.parsed.error.message, 'Capture source enumeration failed');
    assert.equal(JSON.stringify(failed.parsed).includes(leakedKey), false);
  } finally {
    await nonErrorThrowApi.stop();
  }
});

test('capture source API rejects invalid provider output without leaking source values', async () => {
  const providerSecret = 'secret-provider-token';
  const rawOcrSentinel = '秘密のOCR本文';
  const api = createLocalApiServer({
    preferredPort: 0,
    captureSourceProvider: {
      enumerateCaptureSources() {
        return {
          sources: [
            {
              kind: 'game',
              id: '',
              label: 'Game Window',
              apiKey: providerSecret,
              bounds: { x: 0, y: 0, width: 0, height: 720 },
            },
          ],
          rawOcrText: rawOcrSentinel,
        };
      },
    },
  });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/capture/sources' });
    assert.equal(response.statusCode, 500);
    assert.equal(response.parsed.error.code, 'CAPTURE_ENUM_FAILED');
    assert.equal(response.parsed.error.message, 'Capture source enumeration returned an invalid response');
    assert.equal(Array.isArray(response.parsed.error.details.fieldErrors), true);

    const byField = Object.fromEntries(
      response.parsed.error.details.fieldErrors.map((error) => [error.field, error.code]),
    );
    assert.equal(byField.rawOcrText, 'UNKNOWN_CAPTURE_SOURCES_FIELD');
    assert.equal(byField['sources[0].apiKey'], 'UNKNOWN_CAPTURE_SOURCE_FIELD');
    assert.equal(byField['sources[0].kind'], 'CAPTURE_SOURCE_KIND_INVALID');
    assert.equal(byField['sources[0].id'], 'VALIDATION_ERROR');
    assert.equal(byField['sources[0].bounds.width'], 'ROI_INVALID');

    const serialized = JSON.stringify(response.parsed);
    assert.equal(serialized.includes(providerSecret), false);
    assert.equal(serialized.includes(rawOcrSentinel), false);
  } finally {
    await api.stop();
  }
});

test('capture source API inherits local CORS policy without preflight enumeration', async () => {
  const calls = [];
  const captureSourceProvider = {
    enumerateCaptureSources() {
      calls.push(['enumerateCaptureSources']);
      return {
        sources: [
          { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
        ],
      };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    captureSourceProvider,
  });
  const started = await api.start();

  try {
    const allowedOrigin = `http://127.0.0.1:${started.port}`;
    const preflight = await requestJson({
      port: started.port,
      path: '/api/capture/sources',
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
    assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
    assert.deepEqual(calls, []);

    const disallowed = await requestJson({
      port: started.port,
      path: '/api/capture/sources',
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(disallowed.statusCode, 200);
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
    assert.equal(disallowed.headers.vary, 'Origin');
    assert.deepEqual(disallowed.parsed, {
      sources: [
        { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
      ],
    });
    assert.deepEqual(calls, [['enumerateCaptureSources']]);
  } finally {
    await api.stop();
  }
});

test('capture control API starts capture and publishes running AppStatus', async () => {
  const calls = [];
  const captureSource = {
    kind: 'window',
    id: 'window:game',
    label: 'Game Window',
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
  };
  const profile = makeApiProfile({
    id: 'profile_capture',
    captureSource,
    roi: { x: 10, y: 20, width: 640, height: 180 },
    captureHz: 2,
  });
  const api = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    runtimeStatus: {
      ocr: { state: 'idle', updatedAt: FIXED_TIME },
      translation: { state: 'idle', updatedAt: FIXED_TIME },
    },
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return profile;
      },
    },
    captureController: {
      async startCapture(input) {
        calls.push(['startCapture', input]);
        return {
          ok: true,
          screenshotPath: '/tmp/should-not-leak.png',
          rawOcrText: '秘密のOCR本文',
        };
      },
      stopCapture(input) {
        calls.push(['stopCapture', input]);
        return { ok: true };
      },
    },
  });
  const started = await api.start();
  let appClient;

  try {
    appClient = await connectWebSocketClient({ port: started.port });
    await appClient.waitForJson((m) => m.type === 'status');

    const response = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.parsed, { ok: true });
    assert.deepEqual(calls[0], ['getProfile', 'profile_capture']);
    assert.equal(calls[1][0], 'startCapture');
    assert.strictEqual(calls[1][1].profile, profile);
    assert.deepEqual(calls[1][1].captureSource, captureSource);
    assert.equal(JSON.stringify(response.parsed).includes('/tmp/should-not-leak.png'), false);
    assert.equal(JSON.stringify(response.parsed).includes('秘密のOCR本文'), false);

    const status = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.parsed.activeProfileId, 'profile_capture');
    assert.equal(status.parsed.capture.state, 'running');
    assert.equal(status.parsed.capture.code, 'CAPTURE_RUNNING');
    assert.equal(status.parsed.capture.updatedAt, FIXED_TIME);
    assert.equal(status.parsed.ocr.state, 'idle');
    assert.equal(status.parsed.translation.state, 'idle');

    const broadcast = await appClient.waitForJson(
      (m) => m.type === 'status' && m.status.capture.state === 'running',
    );
    assert.equal(broadcast.status.activeProfileId, 'profile_capture');
    assert.equal(broadcast.status.capture.code, 'CAPTURE_RUNNING');

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'GET',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    if (appClient !== undefined && !appClient.socket.destroyed) await appClient.close();
    await api.stop();
  }
});

test('capture control API stops active capture and publishes idle AppStatus', async () => {
  const calls = [];
  const captureSource = { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' };
  const api = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return makeApiProfile({
          id: profileId,
          captureSource,
          captureHz: 3,
        });
      },
    },
    captureController: {
      startCapture(input) {
        calls.push(['startCapture', input]);
        return { ok: true };
      },
      async stopCapture(input) {
        calls.push(['stopCapture', input]);
        return {
          ok: true,
          lastFramePath: 'C:\\secret\\frame.png',
        };
      },
    },
  });
  const started = await api.start();
  let appClient;

  try {
    appClient = await connectWebSocketClient({ port: started.port });
    await appClient.waitForJson((m) => m.type === 'status');

    const start = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(start.statusCode, 200);
    await appClient.waitForJson((m) => m.type === 'status' && m.status.capture.state === 'running');

    const stop = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'POST',
    });
    assert.equal(stop.statusCode, 200);
    assert.deepEqual(stop.parsed, { ok: true });
    assert.deepEqual(calls.map((call) => call[0]), ['getProfile', 'startCapture', 'stopCapture']);
    assert.deepEqual(calls[2][1], { profileId: 'profile_capture' });
    assert.equal(JSON.stringify(stop.parsed).includes('frame.png'), false);

    const status = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(status.parsed.activeProfileId, 'profile_capture');
    assert.equal(status.parsed.capture.state, 'idle');
    assert.equal(status.parsed.capture.code, 'CAPTURE_STOPPED');
    assert.equal(status.parsed.capture.updatedAt, FIXED_TIME);

    const broadcast = await appClient.waitForJson(
      (m) => m.type === 'status' && m.status.capture.code === 'CAPTURE_STOPPED',
    );
    assert.equal(broadcast.status.capture.state, 'idle');

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'GET',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    if (appClient !== undefined && !appClient.socket.destroyed) await appClient.close();
    await api.stop();
  }
});

test('capture control API rejects malformed start requests before repository and controller calls', async () => {
  const calls = [];
  const rawOcrText = '秘密のOCR本文';
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return makeApiProfile({
          id: profileId,
          captureSource: { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
        });
      },
    },
    captureController: {
      startCapture(input) {
        calls.push(['startCapture', input]);
        return { ok: true };
      },
    },
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: '', rawOcrText },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(calls, []);
    assert.equal(JSON.stringify(response.parsed).includes(rawOcrText), false);
  } finally {
    await api.stop();
  }
});

test('capture control API maps profile repository and saved source errors before controller calls', async () => {
  const missingProfileCalls = [];
  const missingProfileApi = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        missingProfileCalls.push(['getProfile', profileId]);
        throw new ContractError('PROFILE_NOT_FOUND', 'Missing profile');
      },
    },
    captureController: {
      startCapture(input) {
        missingProfileCalls.push(['startCapture', input]);
        return { ok: true };
      },
    },
  });
  const missingStarted = await missingProfileApi.start();

  try {
    const response = await requestJson({
      port: missingStarted.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'missing' },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.parsed.error.code, 'PROFILE_NOT_FOUND');
    assert.deepEqual(missingProfileCalls, [['getProfile', 'missing']]);
  } finally {
    await missingProfileApi.stop();
  }

  const unavailableCalls = [];
  const unavailableApi = createLocalApiServer({
    preferredPort: 0,
    captureController: {
      startCapture(input) {
        unavailableCalls.push(['startCapture', input]);
        return { ok: true };
      },
    },
  });
  const unavailableStarted = await unavailableApi.start();

  try {
    const response = await requestJson({
      port: unavailableStarted.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.parsed.error.code, 'DB_UNAVAILABLE');
    assert.deepEqual(unavailableCalls, []);
  } finally {
    await unavailableApi.stop();
  }

  const invalidSourceSecret = 'sk-CAPTURESOURCESECRET12';
  const sourceCalls = [];
  const sourceApi = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile(profileId) {
        sourceCalls.push(['getProfile', profileId]);
        return makeApiProfile({
          id: profileId,
          captureSource: {
            kind: 'window',
            id: '',
            label: 'Game Window',
            apiKey: invalidSourceSecret,
          },
        });
      },
    },
    captureController: {
      startCapture(input) {
        sourceCalls.push(['startCapture', input]);
        return { ok: true };
      },
    },
  });
  const sourceStarted = await sourceApi.start();

  try {
    const response = await requestJson({
      port: sourceStarted.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'CAPTURE_SOURCE_MISSING');
    assert.equal(Array.isArray(response.parsed.error.details.fieldErrors), true);
    assert.equal(JSON.stringify(response.parsed).includes(invalidSourceSecret), false);
    assert.deepEqual(sourceCalls, [['getProfile', 'profile_capture']]);

    const status = await requestJson({ port: sourceStarted.port, path: '/api/status' });
    assert.equal(status.parsed.capture.state, 'error');
    assert.equal(status.parsed.capture.code, 'CAPTURE_SOURCE_MISSING');
    assert.equal(status.parsed.capture.message, 'Capture source is not configured');
    assert.equal(status.parsed.capture.retryable, false);
  } finally {
    await sourceApi.stop();
  }
});

test('capture control API maps controller failures to redacted capture errors and status', async () => {
  const profile = makeApiProfile({
    id: 'profile_capture',
    captureSource: { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
    captureHz: 1,
  });
  const missingControllerApi = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile() {
        return profile;
      },
    },
  });
  const missingStarted = await missingControllerApi.start();

  try {
    const response = await requestJson({
      port: missingStarted.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.parsed.error.code, 'CAPTURE_FAILED');
    assert.equal(Object.hasOwn(response.parsed.error, 'stack'), false);

    const status = await requestJson({ port: missingStarted.port, path: '/api/status' });
    assert.equal(status.parsed.capture.state, 'error');
    assert.equal(status.parsed.capture.code, 'CAPTURE_FAILED');
    assert.equal(status.parsed.capture.updatedAt, FIXED_TIME);
  } finally {
    await missingControllerApi.stop();
  }

  const leakedKey = 'sk-CAPTUREFAILSECRET123';
  const failingApi = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile() {
        return profile;
      },
    },
    captureController: {
      startCapture() {
        throw new Error(`capture failed with ${leakedKey}`);
      },
    },
  });
  const failingStarted = await failingApi.start();

  try {
    const response = await requestJson({
      port: failingStarted.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.parsed.error.code, 'CAPTURE_FAILED');
    assert.equal(response.parsed.error.message, 'Capture start failed');
    assert.equal(JSON.stringify(response.parsed).includes(leakedKey), false);
    const status = await requestJson({ port: failingStarted.port, path: '/api/status' });
    assert.equal(status.parsed.capture.state, 'error');
    assert.equal(status.parsed.capture.code, 'CAPTURE_FAILED');
    assert.equal(JSON.stringify(status.parsed).includes(leakedKey), false);
  } finally {
    await failingApi.stop();
  }

  const retryableApi = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile() {
        return profile;
      },
    },
    captureController: {
      startCapture() {
        throw new ContractError('CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE', `source moved ${leakedKey}`);
      },
    },
  });
  const retryableStarted = await retryableApi.start();

  try {
    const response = await requestJson({
      port: retryableStarted.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.parsed.error.code, 'CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE');
    assert.equal(response.parsed.error.retryable, true);
    assert.equal(JSON.stringify(response.parsed).includes(leakedKey), false);
    const status = await requestJson({ port: retryableStarted.port, path: '/api/status' });
    assert.equal(status.parsed.capture.code, 'CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE');
    assert.equal(status.parsed.capture.retryable, true);
    assert.equal(JSON.stringify(status.parsed).includes(leakedKey), false);
  } finally {
    await retryableApi.stop();
  }
});

test('capture control API maps stop when idle before controller calls', async () => {
  const calls = [];
  const api = createLocalApiServer({
    preferredPort: 0,
    captureController: {
      stopCapture(input) {
        calls.push(['stopCapture', input]);
        return { ok: true };
      },
    },
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'POST',
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.parsed.error.code, 'CAPTURE_NOT_RUNNING');
    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('capture control API serializes concurrent start and stop requests', async () => {
  let startCalls = 0;
  let stopCalls = 0;
  const api = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile(profileId) {
        return makeApiProfile({
          id: profileId,
          captureSource: { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
          captureHz: 2,
        });
      },
    },
    captureController: {
      async startCapture() {
        startCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ok: true };
      },
      async stopCapture() {
        stopCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ok: true };
      },
    },
  });
  const started = await api.start();

  try {
    const startResponses = await Promise.all([
      requestJson({
        port: started.port,
        path: '/api/capture/start',
        method: 'POST',
        body: { profileId: 'profile_capture' },
      }),
      requestJson({
        port: started.port,
        path: '/api/capture/start',
        method: 'POST',
        body: { profileId: 'profile_capture' },
      }),
    ]);
    assert.deepEqual(startResponses.map((response) => response.statusCode).sort(), [200, 409]);
    assert.equal(startResponses.some((response) => response.parsed.error?.code === 'CAPTURE_ALREADY_RUNNING'), true);
    assert.equal(startCalls, 1);

    const stopResponses = await Promise.all([
      requestJson({ port: started.port, path: '/api/capture/stop', method: 'POST' }),
      requestJson({ port: started.port, path: '/api/capture/stop', method: 'POST' }),
    ]);
    assert.deepEqual(stopResponses.map((response) => response.statusCode).sort(), [200, 409]);
    assert.equal(stopResponses.some((response) => response.parsed.error?.code === 'CAPTURE_NOT_RUNNING'), true);
    assert.equal(stopCalls, 1);

    const status = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(status.parsed.capture.state, 'idle');
    assert.equal(status.parsed.capture.code, 'CAPTURE_STOPPED');
  } finally {
    await api.stop();
  }
});

test('capture control API handles stop controller failures without leaking or trapping sessions', async () => {
  const leakedKey = 'sk-STOPCAPTURESECRET123';
  let stopCalls = 0;
  const api = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile(profileId) {
        return makeApiProfile({
          id: profileId,
          captureSource: { kind: 'window', id: 'window:game', label: 'Game Window' },
          captureHz: 2,
        });
      },
    },
    captureController: {
      startCapture() {
        return { ok: true };
      },
      stopCapture() {
        stopCalls += 1;
        if (stopCalls === 1) {
          throw new Error(`stop failed with ${leakedKey}`);
        }
        return { ok: true };
      },
    },
  });
  const started = await api.start();

  try {
    const start = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(start.statusCode, 200);

    const failedStop = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'POST',
    });
    assert.equal(failedStop.statusCode, 500);
    assert.equal(failedStop.parsed.error.code, 'CAPTURE_FAILED');
    assert.equal(failedStop.parsed.error.message, 'Capture stop failed');
    assert.equal(JSON.stringify(failedStop.parsed).includes(leakedKey), false);
    const failedStatus = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(failedStatus.parsed.capture.state, 'error');
    assert.equal(failedStatus.parsed.capture.code, 'CAPTURE_FAILED');
    assert.equal(JSON.stringify(failedStatus.parsed).includes(leakedKey), false);

    const recoveredStop = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'POST',
    });
    assert.equal(recoveredStop.statusCode, 200);
    assert.deepEqual(recoveredStop.parsed, { ok: true });
    assert.equal(stopCalls, 2);
    const recoveredStatus = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(recoveredStatus.parsed.capture.state, 'idle');
    assert.equal(recoveredStatus.parsed.capture.code, 'CAPTURE_STOPPED');
  } finally {
    await api.stop();
  }
});

test('capture control API resyncs idle state when stop controller reports not running', async () => {
  let stopCalls = 0;
  const api = createLocalApiServer({
    preferredPort: 0,
    clock: fixedClock,
    profileRepository: {
      getProfile(profileId) {
        return makeApiProfile({
          id: profileId,
          captureSource: { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
          captureHz: 2,
        });
      },
    },
    captureController: {
      startCapture() {
        return { ok: true };
      },
      stopCapture() {
        stopCalls += 1;
        throw new ContractError('CAPTURE_NOT_RUNNING', 'Native loop already stopped');
      },
    },
  });
  const started = await api.start();

  try {
    const start = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'POST',
      body: { profileId: 'profile_capture' },
    });
    assert.equal(start.statusCode, 200);

    const response = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'POST',
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.parsed.error.code, 'CAPTURE_NOT_RUNNING');
    assert.equal(stopCalls, 1);

    const status = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(status.parsed.capture.state, 'idle');
    assert.equal(status.parsed.capture.code, 'CAPTURE_STOPPED');

    const repeated = await requestJson({
      port: started.port,
      path: '/api/capture/stop',
      method: 'POST',
    });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.parsed.error.code, 'CAPTURE_NOT_RUNNING');
    assert.equal(stopCalls, 1);
  } finally {
    await api.stop();
  }
});

test('capture control API inherits local CORS policy without preflight controller calls', async () => {
  const calls = [];
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return makeApiProfile({
          id: profileId,
          captureSource: { kind: 'monitor', id: 'monitor:primary', label: 'Display 1' },
          captureHz: 2,
        });
      },
    },
    captureController: {
      startCapture(input) {
        calls.push(['startCapture', input]);
        return { ok: true };
      },
      stopCapture(input) {
        calls.push(['stopCapture', input]);
        return { ok: true };
      },
    },
  });
  const started = await api.start();

  try {
    const allowedOrigin = `http://127.0.0.1:${started.port}`;
    for (const path of ['/api/capture/start', '/api/capture/stop']) {
      const preflight = await requestJson({
        port: started.port,
        path,
        method: 'OPTIONS',
        headers: { Origin: allowedOrigin },
      });
      assert.equal(preflight.statusCode, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);
      assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
      assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
    }
    assert.deepEqual(calls, []);

    const disallowed = await requestJson({
      port: started.port,
      path: '/api/capture/start',
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
      body: { profileId: 'profile_capture' },
    });
    assert.equal(disallowed.statusCode, 200);
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
    assert.equal(disallowed.headers.vary, 'Origin');
    assert.deepEqual(disallowed.parsed, { ok: true });
    assert.equal(calls.length, 2);
  } finally {
    await api.stop();
  }
});

test('manual OCR API runs provider with request ROI override and validates result', async () => {
  const calls = [];
  const profile = makeApiProfile({
    id: 'profile_ocr',
    roi: { x: 1, y: 2, width: 300, height: 120 },
  });
  const ocrResult = {
    text: '勇者',
    normalizedText: '勇者',
    confidence: 0.92,
    durationMs: 18.5,
    accepted: true,
  };
  const requestRoi = { x: 10, y: 20, width: 640, height: 180 };
  const repository = {
    getProfile(profileId) {
      calls.push(['getProfile', profileId]);
      return profile;
    },
  };
  const ocrTestProvider = {
    async runOcrTest(input) {
      calls.push(['runOcrTest', input]);
      return ocrResult;
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
    ocrTestProvider,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_ocr', roi: requestRoi },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.parsed, ocrResult);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['getProfile', 'profile_ocr']);
    assert.equal(calls[1][0], 'runOcrTest');
    assert.strictEqual(calls[1][1].profile, profile);
    assert.deepEqual(calls[1][1].roi, requestRoi);
  } finally {
    await api.stop();
  }
});

test('manual OCR API falls back to profile ROI and preserves rejected OCR results', async () => {
  const calls = [];
  const profileRoi = { x: 2, y: 4, width: 320, height: 90 };
  const rejectedResult = {
    text: '',
    normalizedText: '',
    confidence: 0,
    durationMs: 11,
    accepted: false,
    rejectionReason: 'EMPTY_TEXT',
  };
  const repository = {
    getProfile(profileId) {
      calls.push(['getProfile', profileId]);
      return makeApiProfile({ id: profileId, roi: profileRoi });
    },
  };
  const ocrTestProvider = {
    runOcrTest(input) {
      calls.push(['runOcrTest', input]);
      return rejectedResult;
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
    ocrTestProvider,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_ocr' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.parsed, rejectedResult);
    assert.equal(calls[1][0], 'runOcrTest');
    assert.deepEqual(calls[1][1].roi, profileRoi);

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'GET',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    await api.stop();
  }
});

test('manual OCR API rejects malformed requests before repository and provider calls', async () => {
  const calls = [];
  const rawOcrText = '秘密のOCR本文';
  const repository = {
    getProfile(profileId) {
      calls.push(['getProfile', profileId]);
      return makeApiProfile({ id: profileId, roi: { x: 0, y: 0, width: 320, height: 90 } });
    },
  };
  const ocrTestProvider = {
    runOcrTest(input) {
      calls.push(['runOcrTest', input]);
      return {
        text: 'never',
        normalizedText: 'never',
        confidence: 1,
        durationMs: 1,
        accepted: true,
      };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
    ocrTestProvider,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: {
        profileId: '',
        roi: { x: NaN, y: 0, width: -1, height: 0 },
        text: rawOcrText,
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'VALIDATION_ERROR');
    const serialized = JSON.stringify(response.parsed);
    assert.equal(serialized.includes(rawOcrText), false);
    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('manual OCR API maps profile not found and missing ROI before engine calls', async () => {
  const missingProfileCalls = [];
  const missingProfileApi = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        missingProfileCalls.push(['getProfile', profileId]);
        throw new ContractError('PROFILE_NOT_FOUND', 'Missing profile');
      },
    },
    ocrTestProvider: {
      runOcrTest(input) {
        missingProfileCalls.push(['runOcrTest', input]);
        return {
          text: 'never',
          normalizedText: 'never',
          confidence: 1,
          durationMs: 1,
          accepted: true,
        };
      },
    },
  });
  const missingProfileStarted = await missingProfileApi.start();

  try {
    const response = await requestJson({
      port: missingProfileStarted.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'missing' },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.parsed.error.code, 'PROFILE_NOT_FOUND');
    assert.deepEqual(missingProfileCalls, [['getProfile', 'missing']]);
  } finally {
    await missingProfileApi.stop();
  }

  const missingRoiCalls = [];
  const missingRoiApi = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        missingRoiCalls.push(['getProfile', profileId]);
        return makeApiProfile({ id: profileId });
      },
    },
    ocrTestProvider: {
      runOcrTest(input) {
        missingRoiCalls.push(['runOcrTest', input]);
        return {
          text: 'never',
          normalizedText: 'never',
          confidence: 1,
          durationMs: 1,
          accepted: true,
        };
      },
    },
  });
  const missingRoiStarted = await missingRoiApi.start();

  try {
    const response = await requestJson({
      port: missingRoiStarted.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_no_roi' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'ROI_MISSING');
    assert.equal(response.parsed.error.details.fieldErrors[0].field, 'roi');
    assert.deepEqual(missingRoiCalls, [['getProfile', 'profile_no_roi']]);
  } finally {
    await missingRoiApi.stop();
  }
});

test('manual OCR API preserves profile repository availability errors before engine calls', async () => {
  const unavailableCalls = [];
  const unavailableApi = createLocalApiServer({
    preferredPort: 0,
    ocrTestProvider: {
      runOcrTest(input) {
        unavailableCalls.push(['runOcrTest', input]);
        return {
          text: 'never',
          normalizedText: 'never',
          confidence: 1,
          durationMs: 1,
          accepted: true,
        };
      },
    },
  });
  const unavailableStarted = await unavailableApi.start();

  try {
    const response = await requestJson({
      port: unavailableStarted.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_ocr' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.parsed.error.code, 'DB_UNAVAILABLE');
    assert.deepEqual(unavailableCalls, []);
  } finally {
    await unavailableApi.stop();
  }

  const leakedKey = 'sk-DBUNAVAILABLESECRET12';
  const failingCalls = [];
  const failingApi = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        failingCalls.push(['getProfile', profileId]);
        throw new ContractError('DB_UNAVAILABLE', `DB unavailable ${leakedKey}`);
      },
    },
    ocrTestProvider: {
      runOcrTest(input) {
        failingCalls.push(['runOcrTest', input]);
        return {
          text: 'never',
          normalizedText: 'never',
          confidence: 1,
          durationMs: 1,
          accepted: true,
        };
      },
    },
  });
  const failingStarted = await failingApi.start();

  try {
    const response = await requestJson({
      port: failingStarted.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_ocr' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.parsed.error.code, 'DB_UNAVAILABLE');
    assert.equal(JSON.stringify(response.parsed).includes(leakedKey), false);
    assert.deepEqual(failingCalls, [['getProfile', 'profile_ocr']]);
  } finally {
    await failingApi.stop();
  }
});

test('manual OCR API maps missing and failed engines to redacted OCR_ENGINE_ERROR', async () => {
  const profile = makeApiProfile({ id: 'profile_ocr', roi: { x: 0, y: 0, width: 320, height: 90 } });
  const missingEngineApi = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile() {
        return profile;
      },
    },
  });
  const missingEngineStarted = await missingEngineApi.start();

  try {
    const response = await requestJson({
      port: missingEngineStarted.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_ocr' },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.parsed.error.code, 'OCR_ENGINE_ERROR');
    assert.equal(response.parsed.error.retryable, false);
    assert.equal(Object.hasOwn(response.parsed.error, 'stack'), false);
  } finally {
    await missingEngineApi.stop();
  }

  const leakedKey = 'sk-ABCDEFGHIJKLMNOP1234';
  for (const thrown of [
    new Error(`OCR failed with ${leakedKey}`),
    `OCR failed with ${leakedKey}`,
  ]) {
    const failingApi = createLocalApiServer({
      preferredPort: 0,
      profileRepository: {
        getProfile() {
          return profile;
        },
      },
      ocrTestProvider: {
        runOcrTest() {
          throw thrown;
        },
      },
    });
    const failingStarted = await failingApi.start();

    try {
      const response = await requestJson({
        port: failingStarted.port,
        path: '/api/ocr/test',
        method: 'POST',
        body: { profileId: 'profile_ocr' },
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.parsed.error.code, 'OCR_ENGINE_ERROR');
      assert.equal(response.parsed.error.message, 'OCR engine failed');
      assert.equal(JSON.stringify(response.parsed).includes(leakedKey), false);
      assert.equal(Object.hasOwn(response.parsed.error, 'stack'), false);
    } finally {
      await failingApi.stop();
    }
  }
});

test('manual OCR API rejects invalid engine output without leaking OCR values', async () => {
  const apiKey = 'secret-provider-token';
  const rawOcrText = '秘密のOCR本文';
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        return makeApiProfile({
          id: profileId,
          roi: { x: 0, y: 0, width: 320, height: 90 },
        });
      },
    },
    ocrTestProvider: {
      runOcrTest() {
        return {
          text: rawOcrText,
          normalizedText: rawOcrText,
          confidence: 2,
          durationMs: -1,
          accepted: 'yes',
          rejectionReason: 'RAW_SECRET_REASON',
          apiKey,
        };
      },
    },
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'POST',
      body: { profileId: 'profile_ocr' },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.parsed.error.code, 'OCR_ENGINE_ERROR');
    assert.equal(response.parsed.error.message, 'OCR engine returned an invalid result');
    assert.equal(Array.isArray(response.parsed.error.details.fieldErrors), true);

    const byField = Object.fromEntries(
      response.parsed.error.details.fieldErrors.map((error) => [error.field, error.code]),
    );
    assert.equal(byField.confidence, 'OCR_RESULT_CONFIDENCE_INVALID');
    assert.equal(byField.durationMs, 'OCR_RESULT_DURATION_INVALID');
    assert.equal(byField.accepted, 'OCR_RESULT_ACCEPTED_INVALID');
    assert.equal(byField.apiKey, 'UNKNOWN_OCR_RESULT_FIELD');
    const serialized = JSON.stringify(response.parsed);
    assert.equal(serialized.includes(apiKey), false);
    assert.equal(serialized.includes(rawOcrText), false);
  } finally {
    await api.stop();
  }
});

test('manual OCR API inherits local CORS policy without preflight OCR calls', async () => {
  const calls = [];
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return makeApiProfile({
          id: profileId,
          roi: { x: 0, y: 0, width: 320, height: 90 },
        });
      },
    },
    ocrTestProvider: {
      runOcrTest(input) {
        calls.push(['runOcrTest', input]);
        return {
          text: '勇者',
          normalizedText: '勇者',
          confidence: 0.9,
          durationMs: 12,
          accepted: true,
        };
      },
    },
  });
  const started = await api.start();

  try {
    const allowedOrigin = `http://127.0.0.1:${started.port}`;
    const preflight = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
    assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
    assert.deepEqual(calls, []);

    const disallowed = await requestJson({
      port: started.port,
      path: '/api/ocr/test',
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
      body: { profileId: 'profile_ocr' },
    });
    assert.equal(disallowed.statusCode, 200);
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
    assert.equal(disallowed.headers.vary, 'Origin');
    assert.equal(disallowed.parsed.normalizedText, '勇者');
    assert.equal(calls.length, 2);
  } finally {
    await api.stop();
  }
});

test('translate test API runs provider with prepared input and validates result', async () => {
  const calls = [];
  const profile = makeApiProfile({
    id: 'profile_translate',
    translationProvider: 'echo',
    glossary: [{ id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' }],
  });
  const translationResult = {
    sourceText: '勇者が現れた',
    translatedText: 'A hero has appeared',
    provider: 'echo',
    durationMs: 9,
    cacheHit: false,
  };
  const repository = {
    getProfile(profileId) {
      calls.push(['getProfile', profileId]);
      return profile;
    },
  };
  const translateTestProvider = {
    async runTranslateTest(args) {
      calls.push(['runTranslateTest', args]);
      return translationResult;
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
    translateTestProvider,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'profile_translate', text: '勇者が現れた' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.parsed, translationResult);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['getProfile', 'profile_translate']);
    assert.equal(calls[1][0], 'runTranslateTest');
    assert.strictEqual(calls[1][1].profile, profile);
    const passedInput = calls[1][1].input;
    assert.equal(passedInput.provider, 'echo');
    assert.equal(passedInput.targetLang, 'en');
    assert.equal(typeof passedInput.cacheKey, 'string');
    assert.equal(passedInput.cacheKey.startsWith('v1:echo:en:'), true);
    assert.equal(typeof passedInput.sourceText, 'string');
    assert.equal(typeof passedInput.glossaryAppliedText, 'string');
    assert.equal(passedInput.glossaryAppliedText.includes('hero'), true);
  } finally {
    await api.stop();
  }
});

test('translate test API serializes only canonical TranslationResult fields', async () => {
  const profile = makeApiProfile({ id: 'profile_translate', translationProvider: 'echo' });
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile() {
        return profile;
      },
    },
    translateTestProvider: {
      runTranslateTest() {
        return {
          sourceText: 'src',
          translatedText: 'dst',
          provider: 'echo',
          durationMs: 5,
          cacheHit: false,
        };
      },
    },
  });
  const started = await api.start();
  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'profile_translate', text: 'hi' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.parsed).sort(), [
      'cacheHit', 'durationMs', 'provider', 'sourceText', 'translatedText',
    ]);
  } finally {
    await api.stop();
  }
});

test('translate test API rejects malformed requests before repository and provider calls', async () => {
  const calls = [];
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return makeApiProfile({ id: profileId });
      },
    },
    translateTestProvider: {
      runTranslateTest(args) {
        calls.push(['runTranslateTest', args]);
        return {
          sourceText: 'x', translatedText: 'y', provider: 'echo', durationMs: 0, cacheHit: false,
        };
      },
    },
  });
  const started = await api.start();
  try {
    const rawText = '秘密のテキスト';
    const empty = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: '', text: '' },
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.parsed.error.code, 'VALIDATION_ERROR');

    const unknown = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'p1', text: rawText, extra: 'nope' },
    });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.parsed.error.code, 'VALIDATION_ERROR');
    assert.equal(JSON.stringify(unknown.parsed).includes(rawText), false);

    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('translate test API preserves PROFILE_NOT_FOUND and DB_UNAVAILABLE before provider calls', async () => {
  const missingCalls = [];
  const missingApi = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        missingCalls.push(['getProfile', profileId]);
        throw new ContractError('PROFILE_NOT_FOUND', 'Missing profile');
      },
    },
    translateTestProvider: {
      runTranslateTest(args) {
        missingCalls.push(['runTranslateTest', args]);
        return {
          sourceText: 'x', translatedText: 'y', provider: 'echo', durationMs: 0, cacheHit: false,
        };
      },
    },
  });
  const missingStarted = await missingApi.start();
  try {
    const response = await requestJson({
      port: missingStarted.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'missing', text: 'hi' },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.parsed.error.code, 'PROFILE_NOT_FOUND');
    assert.deepEqual(missingCalls, [['getProfile', 'missing']]);
  } finally {
    await missingApi.stop();
  }

  const unavailableCalls = [];
  const unavailableApi = createLocalApiServer({
    preferredPort: 0,
    translateTestProvider: {
      runTranslateTest(args) {
        unavailableCalls.push(['runTranslateTest', args]);
        return {
          sourceText: 'x', translatedText: 'y', provider: 'echo', durationMs: 0, cacheHit: false,
        };
      },
    },
  });
  const unavailableStarted = await unavailableApi.start();
  try {
    const response = await requestJson({
      port: unavailableStarted.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'p1', text: 'hi' },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.parsed.error.code, 'DB_UNAVAILABLE');
    assert.deepEqual(unavailableCalls, []);
  } finally {
    await unavailableApi.stop();
  }
});

test('translate test API reports PROVIDER_UNKNOWN when no translate provider is installed', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        return makeApiProfile({ id: profileId, translationProvider: 'echo' });
      },
    },
  });
  const started = await api.start();
  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'profile_translate', text: 'hi' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'PROVIDER_UNKNOWN');
    assert.equal(response.parsed.error.retryable, false);
  } finally {
    await api.stop();
  }
});

test('translate test API maps invalid profile provider and target language before provider calls', async () => {
  const calls = [];
  const cases = [
    {
      profile: makeApiProfile({ id: 'profile_bad_provider', translationProvider: 'google' }),
      body: { profileId: 'profile_bad_provider', text: 'hi' },
      code: 'PROVIDER_UNKNOWN',
    },
    {
      profile: makeApiProfile({ id: 'profile_bad_lang', targetLang: 'fr' }),
      body: { profileId: 'profile_bad_lang', text: 'hi' },
      code: 'TARGET_LANG_INVALID',
    },
  ];

  for (const testCase of cases) {
    const api = createLocalApiServer({
      preferredPort: 0,
      profileRepository: {
        getProfile(profileId) {
          calls.push(['getProfile', profileId]);
          return testCase.profile;
        },
      },
      translateTestProvider: {
        runTranslateTest(args) {
          calls.push(['runTranslateTest', args]);
          return {
            sourceText: 's',
            translatedText: 't',
            provider: 'echo',
            durationMs: 1,
            cacheHit: false,
          };
        },
      },
    });
    const started = await api.start();
    try {
      const response = await requestJson({
        port: started.port,
        path: '/api/translate/test',
        method: 'POST',
        body: testCase.body,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.parsed.error.code, testCase.code);
    } finally {
      await api.stop();
    }
  }

  assert.deepEqual(calls, [
    ['getProfile', 'profile_bad_provider'],
    ['getProfile', 'profile_bad_lang'],
  ]);
});

test('translate test API maps provider ContractError codes to retryable privacy-safe ApiError', async () => {
  const leakedKey = 'sk-TRANSLATESECRETKEY1234';
  const profile = makeApiProfile({ id: 'profile_translate', translationProvider: 'deepl' });
  const cases = [
    { code: 'PROVIDER_KEY_MISSING', status: 503, retryable: false },
    { code: 'PROVIDER_AUTH_FAILED', status: 502, retryable: false },
    { code: 'PROVIDER_RATE_LIMITED', status: 429, retryable: true },
    { code: 'PROVIDER_QUOTA_EXCEEDED', status: 429, retryable: false },
    { code: 'PROVIDER_NETWORK_ERROR', status: 502, retryable: true },
    { code: 'PROVIDER_RESPONSE_INVALID', status: 502, retryable: false },
    { code: 'PROVIDER_UNKNOWN', status: 400, retryable: false },
    { code: 'TARGET_LANG_INVALID', status: 400, retryable: false },
  ];

  for (const { code, status, retryable } of cases) {
    const api = createLocalApiServer({
      preferredPort: 0,
      profileRepository: { getProfile: () => profile },
      translateTestProvider: {
        runTranslateTest() {
          throw new ContractError(code, `provider failed with ${leakedKey}`);
        },
      },
    });
    const started = await api.start();
    try {
      const response = await requestJson({
        port: started.port,
        path: '/api/translate/test',
        method: 'POST',
        body: { profileId: 'profile_translate', text: 'hi' },
      });
      assert.equal(response.statusCode, status, `status for ${code}`);
      assert.equal(response.parsed.error.code, code);
      assert.equal(response.parsed.error.retryable, retryable, `retryable for ${code}`);
      assert.equal(JSON.stringify(response.parsed).includes(leakedKey), false);
    } finally {
      await api.stop();
    }
  }
});

test('translate test API collapses unknown thrown values to PROVIDER_UNKNOWN', async () => {
  const profile = makeApiProfile({ id: 'profile_translate', translationProvider: 'echo' });
  const leakedKey = 'sk-UNKNOWNTRANSLATELEAK1';
  for (const thrown of [
    new Error(`upstream blew up with ${leakedKey}`),
    `text exception ${leakedKey}`,
  ]) {
    const api = createLocalApiServer({
      preferredPort: 0,
      profileRepository: { getProfile: () => profile },
      translateTestProvider: {
        runTranslateTest() {
          throw thrown;
        },
      },
    });
    const started = await api.start();
    try {
      const response = await requestJson({
        port: started.port,
        path: '/api/translate/test',
        method: 'POST',
        body: { profileId: 'profile_translate', text: 'hi' },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.parsed.error.code, 'PROVIDER_UNKNOWN');
      assert.equal(response.parsed.error.retryable, false);
      assert.equal(JSON.stringify(response.parsed).includes(leakedKey), false);
    } finally {
      await api.stop();
    }
  }
});

test('translate test API rejects invalid provider output without leaking translated text', async () => {
  const profile = makeApiProfile({ id: 'profile_translate', translationProvider: 'echo' });
  const leakedKey = 'sk-RESPONSEINVALIDLEAK';
  const rawText = '秘密の翻訳本文';
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: { getProfile: () => profile },
    translateTestProvider: {
      runTranslateTest() {
        return {
          sourceText: rawText,
          translatedText: rawText,
          provider: 'echo',
          durationMs: -1,
          cacheHit: 'no',
          apiKey: leakedKey,
        };
      },
    },
  });
  const started = await api.start();
  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'profile_translate', text: 'hi' },
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.parsed.error.code, 'PROVIDER_RESPONSE_INVALID');
    assert.equal(Array.isArray(response.parsed.error.details.fieldErrors), true);
    const byField = Object.fromEntries(
      response.parsed.error.details.fieldErrors.map((error) => [error.field, error.code]),
    );
    assert.equal(byField.durationMs, 'TRANSLATION_RESULT_DURATION_INVALID');
    assert.equal(byField.cacheHit, 'TRANSLATION_RESULT_CACHE_HIT_INVALID');
    assert.equal(byField.apiKey, 'UNKNOWN_TRANSLATION_RESULT_FIELD');
    const serialized = JSON.stringify(response.parsed);
    assert.equal(serialized.includes(rawText), false);
    assert.equal(serialized.includes(leakedKey), false);
  } finally {
    await api.stop();
  }
});

test('translate test API rejects provider mismatch without serializing translation output', async () => {
  const profile = makeApiProfile({ id: 'profile_translate', translationProvider: 'deepl' });
  const rawText = '秘密のprovider mismatch本文';
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: { getProfile: () => profile },
    translateTestProvider: {
      runTranslateTest() {
        return {
          sourceText: rawText,
          translatedText: rawText,
          provider: 'echo',
          durationMs: 4,
          cacheHit: false,
        };
      },
    },
  });
  const started = await api.start();
  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'POST',
      body: { profileId: 'profile_translate', text: 'hi' },
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.parsed.error.code, 'PROVIDER_RESPONSE_INVALID');
    assert.equal(response.parsed.error.details.fieldErrors[0].field, 'provider');
    assert.equal(response.parsed.error.details.fieldErrors[0].code, 'TRANSLATION_PROVIDER_MISMATCH');
    assert.equal(JSON.stringify(response.parsed).includes(rawText), false);
  } finally {
    await api.stop();
  }
});

test('translate test API inherits local CORS policy and method handling without provider calls', async () => {
  const calls = [];
  const profile = makeApiProfile({ id: 'profile_translate', translationProvider: 'echo' });
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: {
      getProfile(profileId) {
        calls.push(['getProfile', profileId]);
        return profile;
      },
    },
    translateTestProvider: {
      runTranslateTest(args) {
        calls.push(['runTranslateTest', args]);
        return {
          sourceText: 's',
          translatedText: 't',
          provider: 'echo',
          durationMs: 1,
          cacheHit: false,
        };
      },
    },
  });
  const started = await api.start();
  try {
    const allowedOrigin = `http://127.0.0.1:${started.port}`;
    const preflight = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
    assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type');
    assert.deepEqual(calls, []);

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/translate/test',
      method: 'GET',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('profile API lists and creates profiles through the injected repository', async () => {
  const calls = [];
  const createdProfile = makeApiProfile({ id: 'profile_created', name: 'Created Profile' });
  const repository = {
    listProfiles() {
      calls.push(['listProfiles']);
      return [makeApiProfile()];
    },
    createProfile(payload) {
      calls.push(['createProfile', payload]);
      return createdProfile;
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const list = await requestJson({ port: started.port, path: '/api/profiles' });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.parsed, { profiles: [makeApiProfile()] });

    const payload = makeProfileCreatePayload();
    const create = await requestJson({
      port: started.port,
      path: '/api/profiles',
      method: 'POST',
      body: payload,
    });
    assert.equal(create.statusCode, 201);
    assert.deepEqual(create.parsed, createdProfile);
    assert.deepEqual(calls, [
      ['listProfiles'],
      ['createProfile', payload],
    ]);
  } finally {
    await api.stop();
  }
});

test('profile API gets updates deletes activates and exports profiles', async () => {
  const calls = [];
  const repository = {
    getProfile(profileId) {
      calls.push(['getProfile', profileId]);
      return makeApiProfile({ id: profileId });
    },
    updateProfile(profileId, payload) {
      calls.push(['updateProfile', profileId, payload]);
      return makeApiProfile({ id: profileId, name: payload.name });
    },
    deleteProfile(profileId) {
      calls.push(['deleteProfile', profileId]);
      return { ok: true };
    },
    setActiveProfile(profileId) {
      calls.push(['setActiveProfile', profileId]);
      return { ok: true };
    },
    exportProfile(profileId) {
      calls.push(['exportProfile', profileId]);
      return {
        schemaVersion: 1,
        profile: makeApiProfile({ id: profileId }),
        exportedAt: FIXED_TIME,
        forbiddenFieldsPolicy: 'reject_api_keys_ocr_text_translation_text_images_logs',
      };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const get = await requestJson({ port: started.port, path: '/api/profiles/profile_001' });
    assert.equal(get.statusCode, 200);
    assert.equal(get.parsed.id, 'profile_001');

    const updatePayload = { name: 'Renamed' };
    const update = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001',
      method: 'PUT',
      body: updatePayload,
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.parsed.name, 'Renamed');

    const activate = await requestJson({
      port: started.port,
      path: '/api/profiles/active',
      method: 'PUT',
      body: { profileId: 'profile_001' },
    });
    assert.equal(activate.statusCode, 200);
    assert.deepEqual(activate.parsed, { ok: true });

    const exported = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001/export',
    });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.parsed.schemaVersion, 1);
    assert.equal(JSON.stringify(exported.parsed).includes('apiKey'), false);
    assert.equal(JSON.stringify(exported.parsed).includes('translatedText'), false);

    const deleted = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001',
      method: 'DELETE',
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.parsed, { ok: true });

    assert.deepEqual(calls, [
      ['getProfile', 'profile_001'],
      ['updateProfile', 'profile_001', updatePayload],
      ['setActiveProfile', 'profile_001'],
      ['exportProfile', 'profile_001'],
      ['deleteProfile', 'profile_001'],
    ]);
  } finally {
    await api.stop();
  }
});

test('profile API maps repository errors to canonical redacted ApiError responses', async () => {
  const repository = {
    getProfile() {
      throw new ContractError('PROFILE_NOT_FOUND', 'Missing profile');
    },
    deleteProfile() {
      throw new ContractError('CANNOT_DELETE_ACTIVE_PROFILE', 'Active profile cannot be deleted');
    },
    updateProfile() {
      throw new ContractError('VALIDATION_ERROR', 'token=sk-ABCDEFGHIJKLMNOP1234 failed', {
        fieldErrors: [
          {
            field: 'apiKey',
            code: 'UNKNOWN_PROFILE_FIELD',
            message: 'apiKey=secretsecret123 is not allowed',
          },
        ],
      });
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const missing = await requestJson({ port: started.port, path: '/api/profiles/missing' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.parsed.error.code, 'PROFILE_NOT_FOUND');
    assert.equal(missing.parsed.error.retryable, false);

    const conflict = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001',
      method: 'DELETE',
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.parsed.error.code, 'CANNOT_DELETE_ACTIVE_PROFILE');

    const invalid = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001',
      method: 'PUT',
      body: { apiKey: 'secretsecret123' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.parsed.error.code, 'VALIDATION_ERROR');
    assert.equal(Array.isArray(invalid.parsed.error.details.fieldErrors), true);
    const serialized = JSON.stringify(invalid.parsed);
    assert.equal(serialized.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(serialized.includes('secretsecret123'), false);
    assert.equal(serialized.includes('[REDACTED]'), true);
    assert.equal(Object.hasOwn(invalid.parsed.error, 'stack'), false);
  } finally {
    await api.stop();
  }
});

test('profile API reports DB_UNAVAILABLE when no profile repository is installed', async () => {
  const api = createLocalApiServer({ preferredPort: 0 });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/profiles' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.parsed.error.code, 'DB_UNAVAILABLE');
    assert.equal(response.parsed.error.retryable, false);
  } finally {
    await api.stop();
  }
});

test('theme API lists creates gets updates and deletes themes through the injected repository', async () => {
  const calls = [];
  const createdTheme = makeApiTheme({ id: 'theme_created', name: 'Created Theme' });
  const repository = {
    listThemes() {
      calls.push(['listThemes']);
      return [makeApiTheme({ id: 'classic_subtitle', builtIn: true })];
    },
    createTheme(payload) {
      calls.push(['createTheme', payload]);
      return createdTheme;
    },
    getTheme(themeId) {
      calls.push(['getTheme', themeId]);
      return makeApiTheme({ id: themeId });
    },
    updateTheme(themeId, payload) {
      calls.push(['updateTheme', themeId, payload]);
      return makeApiTheme({ id: themeId, name: payload.name });
    },
    deleteTheme(themeId) {
      calls.push(['deleteTheme', themeId]);
      return { ok: true };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const list = await requestJson({ port: started.port, path: '/api/themes' });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.parsed, {
      themes: [makeApiTheme({ id: 'classic_subtitle', builtIn: true })],
    });

    const createPayload = { name: 'Created Theme', baseThemeId: 'classic_subtitle' };
    const create = await requestJson({
      port: started.port,
      path: '/api/themes',
      method: 'POST',
      body: createPayload,
    });
    assert.equal(create.statusCode, 201);
    assert.deepEqual(create.parsed, createdTheme);

    const get = await requestJson({ port: started.port, path: '/api/themes/custom%20theme' });
    assert.equal(get.statusCode, 200);
    assert.equal(get.parsed.id, 'custom theme');

    const updatePayload = { name: 'Readable Theme' };
    const update = await requestJson({
      port: started.port,
      path: '/api/themes/custom%20theme',
      method: 'PUT',
      body: updatePayload,
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.parsed.name, 'Readable Theme');

    const deleted = await requestJson({
      port: started.port,
      path: '/api/themes/custom%20theme',
      method: 'DELETE',
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.parsed, { ok: true });

    const wrongCollectionMethod = await requestJson({
      port: started.port,
      path: '/api/themes',
      method: 'PUT',
    });
    assert.equal(wrongCollectionMethod.statusCode, 405);
    assert.equal(wrongCollectionMethod.headers.allow, 'GET, POST');

    assert.deepEqual(calls, [
      ['listThemes'],
      ['createTheme', createPayload],
      ['getTheme', 'custom theme'],
      ['updateTheme', 'custom theme', updatePayload],
      ['deleteTheme', 'custom theme'],
    ]);
  } finally {
    await api.stop();
  }
});

test('glossary API exports and imports through the injected repository', async () => {
  const calls = [];
  const glossary = [{ id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' }];
  const repository = {
    exportGlossary(profileId) {
      calls.push(['exportGlossary', profileId]);
      return { terms: glossary, format: 'json' };
    },
    importGlossary(profileId, payload) {
      calls.push(['importGlossary', profileId, payload]);
      return { terms: glossary, rejected: [] };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const exported = await requestJson({
      port: started.port,
      path: '/api/profiles/profile%20001/glossary/export',
    });
    assert.equal(exported.statusCode, 200);
    assert.deepEqual(exported.parsed, { terms: glossary, format: 'json' });

    const importPayload = { format: 'csv', content: 'sourceTerm,targetTerm\n勇者,hero' };
    const imported = await requestJson({
      port: started.port,
      path: '/api/profiles/profile%20001/glossary/import',
      method: 'POST',
      body: importPayload,
    });
    assert.equal(imported.statusCode, 200);
    assert.deepEqual(imported.parsed, { terms: glossary, rejected: [] });

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/profiles/profile%20001/glossary/import',
      method: 'GET',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');

    assert.deepEqual(calls, [
      ['exportGlossary', 'profile 001'],
      ['importGlossary', 'profile 001', importPayload],
    ]);
  } finally {
    await api.stop();
  }
});

test('theme and glossary APIs map repository errors to canonical redacted responses', async () => {
  const repository = {
    getTheme() {
      throw new ContractError('THEME_NOT_FOUND', 'Missing theme');
    },
    updateTheme() {
      throw new ContractError(
        'CANNOT_UPDATE_BUILT_IN_THEME',
        'token=sk-ABCDEFGHIJKLMNOP1234 cannot update theme',
        { themeId: 'minimal' },
      );
    },
    deleteTheme(themeId) {
      if (themeId === 'in_use') {
        throw new ContractError('THEME_IN_USE', 'Theme has active profiles', {
          themeId,
          profileId: 'profile_001',
        });
      }
      throw new ContractError('CANNOT_DELETE_BUILT_IN_THEME', 'Built-in theme cannot be deleted');
    },
    importGlossary() {
      throw new ContractError('GLOSSARY_IMPORT_INVALID', 'api_key=secretsecret123 rejected', {
        rejected: [
          {
            row: 2,
            code: 'CSV_ROW_INVALID',
            message: 'token=sk-ABCDEFGHIJKLMNOP1234 bad row',
          },
        ],
      });
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const missing = await requestJson({ port: started.port, path: '/api/themes/missing' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.parsed.error.code, 'THEME_NOT_FOUND');

    const updateConflict = await requestJson({
      port: started.port,
      path: '/api/themes/minimal',
      method: 'PUT',
      body: { name: 'Nope' },
    });
    assert.equal(updateConflict.statusCode, 409);
    assert.equal(updateConflict.parsed.error.code, 'CANNOT_UPDATE_BUILT_IN_THEME');

    const builtInDelete = await requestJson({
      port: started.port,
      path: '/api/themes/stream_box',
      method: 'DELETE',
    });
    assert.equal(builtInDelete.statusCode, 409);
    assert.equal(builtInDelete.parsed.error.code, 'CANNOT_DELETE_BUILT_IN_THEME');

    const inUseDelete = await requestJson({
      port: started.port,
      path: '/api/themes/in_use',
      method: 'DELETE',
    });
    assert.equal(inUseDelete.statusCode, 409);
    assert.equal(inUseDelete.parsed.error.code, 'THEME_IN_USE');
    assert.equal(inUseDelete.parsed.error.details.profileId, 'profile_001');

    const glossaryImport = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001/glossary/import',
      method: 'POST',
      body: { format: 'json', content: '[]' },
    });
    assert.equal(glossaryImport.statusCode, 400);
    assert.equal(glossaryImport.parsed.error.code, 'GLOSSARY_IMPORT_INVALID');

    const serialized = JSON.stringify([updateConflict.parsed, glossaryImport.parsed]);
    assert.equal(serialized.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(serialized.includes('secretsecret123'), false);
    assert.equal(serialized.includes('[REDACTED]'), true);
  } finally {
    await api.stop();
  }
});

test('theme and glossary APIs report DB_UNAVAILABLE when repository methods are absent', async () => {
  const api = createLocalApiServer({ preferredPort: 0 });
  const started = await api.start();

  try {
    const themes = await requestJson({ port: started.port, path: '/api/themes' });
    assert.equal(themes.statusCode, 503);
    assert.equal(themes.parsed.error.code, 'DB_UNAVAILABLE');

    const glossary = await requestJson({
      port: started.port,
      path: '/api/profiles/profile_001/glossary/export',
    });
    assert.equal(glossary.statusCode, 503);
    assert.equal(glossary.parsed.error.code, 'DB_UNAVAILABLE');
  } finally {
    await api.stop();
  }
});

test('privacy settings API gets and updates through the injected repository', async () => {
  const calls = [];
  const storedSettings = makeApiPrivacySettings({
    saveRecentTranslations: true,
    recentTranslationLimit: 10,
  });
  const updatedSettings = makeApiPrivacySettings({
    saveRecentOcrText: true,
    recentOcrLimit: 6,
    saveRecentTranslations: true,
    recentTranslationLimit: 4,
  });
  const repository = {
    getPrivacySettings() {
      calls.push(['getPrivacySettings']);
      return storedSettings;
    },
    savePrivacySettings(payload) {
      calls.push(['savePrivacySettings', payload]);
      return updatedSettings;
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const get = await requestJson({
      port: started.port,
      path: '/api/settings/privacy',
    });
    assert.equal(get.statusCode, 200);
    assert.deepEqual(get.parsed, storedSettings);

    const putPayload = makeApiPrivacySettings({
      saveRecentOcrText: true,
      recentOcrLimit: 6,
    });
    const put = await requestJson({
      port: started.port,
      path: '/api/settings/privacy',
      method: 'PUT',
      body: putPayload,
    });
    assert.equal(put.statusCode, 200);
    assert.deepEqual(put.parsed, updatedSettings);

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/settings/privacy',
      method: 'POST',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'GET, PUT');

    assert.deepEqual(calls, [
      ['getPrivacySettings'],
      ['savePrivacySettings', putPayload],
    ]);
  } finally {
    await api.stop();
  }
});

test('privacy settings API rejects malformed JSON before repository calls', async () => {
  const calls = [];
  const repository = {
    savePrivacySettings(payload) {
      calls.push(['savePrivacySettings', payload]);
      return makeApiPrivacySettings();
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/settings/privacy',
      method: 'PUT',
      body: '{"saveRecentOcrText":',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'BAD_REQUEST');
    assert.equal(response.parsed.error.details.fieldErrors[0].code, 'JSON_INVALID');
    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('provider key API writes and deletes through the injected write-only store', async () => {
  const calls = [];
  const providerKeyStore = {
    async saveProviderKey(provider, payload) {
      calls.push(['saveProviderKey', provider, payload]);
      return { ok: true };
    },
    async deleteProviderKey(provider) {
      calls.push(['deleteProviderKey', provider]);
      return { ok: true };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    providerKeyStore,
  });
  const started = await api.start();

  try {
    const payload = { provider: 'deepl', apiKey: 'secret-token-value' };
    const saved = await requestJson({
      port: started.port,
      path: '/api/keys/deepl',
      method: 'PUT',
      body: payload,
    });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.parsed, { ok: true });

    const deleted = await requestJson({
      port: started.port,
      path: '/api/keys/deepl',
      method: 'DELETE',
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.parsed, { ok: true });

    const wrongMethod = await requestJson({
      port: started.port,
      path: '/api/keys/deepl',
      method: 'GET',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'PUT, DELETE');

    assert.deepEqual(calls, [
      ['saveProviderKey', 'deepl', payload],
      ['deleteProviderKey', 'deepl'],
    ]);
    assert.equal(JSON.stringify([saved.parsed, deleted.parsed]).includes('secret-token-value'), false);
  } finally {
    await api.stop();
  }
});

test('privacy and key APIs map unavailable stores and keychain errors', async () => {
  const unavailableApi = createLocalApiServer({ preferredPort: 0 });
  const unavailableStarted = await unavailableApi.start();

  try {
    const privacy = await requestJson({
      port: unavailableStarted.port,
      path: '/api/settings/privacy',
    });
    assert.equal(privacy.statusCode, 503);
    assert.equal(privacy.parsed.error.code, 'DB_UNAVAILABLE');

    const key = await requestJson({
      port: unavailableStarted.port,
      path: '/api/keys/deepl',
      method: 'PUT',
      body: { apiKey: 'secret-token-value' },
    });
    assert.equal(key.statusCode, 503);
    assert.equal(key.parsed.error.code, 'KEYCHAIN_UNAVAILABLE');
  } finally {
    await unavailableApi.stop();
  }

  const leakedKey = 'sk-ABCDEFGHIJKLMNOP1234';
  const redactingStore = {
    async saveProviderKey(provider, payload) {
      if (provider === 'unknown') {
        throw new ContractError('PROVIDER_UNKNOWN', 'provider is not supported', {
          provider,
        });
      }
      throw new ContractError(
        'KEYCHAIN_UNAVAILABLE',
        `cannot store ${payload.apiKey}`,
        { provider, raw: payload.apiKey, bearer: `Bearer ${leakedKey}` },
      );
    },
    async deleteProviderKey() {
      throw new ContractError('KEYCHAIN_UNAVAILABLE', 'delete failed');
    },
  };
  const redactingApi = createLocalApiServer({
    preferredPort: 0,
    providerKeyStore: redactingStore,
  });
  const redactingStarted = await redactingApi.start();

  try {
    const unknown = await requestJson({
      port: redactingStarted.port,
      path: '/api/keys/unknown',
      method: 'PUT',
      body: { apiKey: leakedKey },
    });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.parsed.error.code, 'PROVIDER_UNKNOWN');

    const keychain = await requestJson({
      port: redactingStarted.port,
      path: '/api/keys/deepl',
      method: 'PUT',
      body: { apiKey: leakedKey },
    });
    assert.equal(keychain.statusCode, 503);
    assert.equal(keychain.parsed.error.code, 'KEYCHAIN_UNAVAILABLE');

    const deleted = await requestJson({
      port: redactingStarted.port,
      path: '/api/keys/deepl',
      method: 'DELETE',
    });
    assert.equal(deleted.statusCode, 503);
    assert.equal(deleted.parsed.error.code, 'KEYCHAIN_UNAVAILABLE');

    const serialized = JSON.stringify([unknown.parsed, keychain.parsed, deleted.parsed]);
    assert.equal(serialized.includes(leakedKey), false);
    assert.equal(serialized.includes('[REDACTED]'), true);
  } finally {
    await redactingApi.stop();
  }
});

test('provider key API rejects malformed JSON before store calls', async () => {
  const calls = [];
  const providerKeyStore = {
    async saveProviderKey(provider, payload) {
      calls.push(['saveProviderKey', provider, payload]);
      return { ok: true };
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    providerKeyStore,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/keys/deepl',
      method: 'PUT',
      body: '{"apiKey":',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'BAD_REQUEST');
    assert.equal(response.parsed.error.details.fieldErrors[0].code, 'JSON_INVALID');
    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('profile API rejects malformed JSON before repository calls', async () => {
  const calls = [];
  const repository = {
    createProfile(payload) {
      calls.push(payload);
      return makeApiProfile({ id: 'profile_created' });
    },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    profileRepository: repository,
  });
  const started = await api.start();

  try {
    const response = await requestJson({
      port: started.port,
      path: '/api/profiles',
      method: 'POST',
      body: '{"name":',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.parsed.error.code, 'BAD_REQUEST');
    assert.equal(response.parsed.error.details.fieldErrors[0].code, 'JSON_INVALID');
    assert.deepEqual(calls, []);
  } finally {
    await api.stop();
  }
});

test('GET /api/status turns runtime status producer failures into redacted status snapshots', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    runtimeStatus: () => {
      throw new Error('token=sk-ABCDEFGHIJKLMNOP1234 failed');
    },
    clock: fixedClock,
  });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/status' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.parsed.backend, 'error');
    assert.equal(response.parsed.translation.state, 'error');
    assert.equal(response.parsed.translation.code, 'RUNTIME_STATUS_SOURCE_FAILED');
    assert.equal(response.parsed.translation.retryable, false);
    assert.equal(response.parsed.translation.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(response.parsed.translation.message.includes('[REDACTED]'), true);
    assert.equal(Object.hasOwn(response.parsed.translation, 'stack'), false);
  } finally {
    await api.stop();
  }
});

test('CORS never uses wildcard and only echoes configured or same-port local origins', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    allowedOrigins: ['app://game-live-translator'],
  });
  const started = await api.start();

  try {
    const disallowed = await requestJson({
      port: started.port,
      path: '/health',
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
    assert.equal(disallowed.headers.vary, 'Origin');

    const electron = await requestJson({
      port: started.port,
      path: '/health',
      headers: { Origin: 'app://game-live-translator' },
    });
    assert.equal(electron.headers['access-control-allow-origin'], 'app://game-live-translator');
    assert.equal(electron.headers.vary, 'Origin');

    const samePort = `http://127.0.0.1:${started.port}`;
    const local = await requestJson({
      port: started.port,
      path: '/health',
      headers: { Origin: samePort },
    });
    assert.equal(local.headers['access-control-allow-origin'], samePort);

    const localhost = `http://localhost:${started.port}`;
    const localhostResponse = await requestJson({
      port: started.port,
      path: '/health',
      headers: { Origin: localhost },
    });
    assert.equal(localhostResponse.headers['access-control-allow-origin'], localhost);

    for (const response of [disallowed, electron, local, localhostResponse]) {
      assert.notEqual(response.headers['access-control-allow-origin'], '*');
    }
  } finally {
    await api.stop();
  }
});

test('OPTIONS preflight only exposes allowed methods for allowed local origins', async () => {
  const api = createLocalApiServer({ preferredPort: 0 });
  const started = await api.start();

  try {
    const disallowed = await requestJson({
      port: started.port,
      path: '/health',
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(disallowed.statusCode, 204);
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
    assert.equal(disallowed.headers['access-control-allow-methods'], undefined);
    assert.equal(disallowed.headers.vary, 'Origin');

    const allowedOrigin = `http://127.0.0.1:${started.port}`;
    const allowed = await requestJson({
      port: started.port,
      path: '/health',
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(allowed.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
    assert.equal(allowed.headers['access-control-allow-headers'], 'Content-Type');
  } finally {
    await api.stop();
  }
});

test('resolveCorsOrigin rejects mismatched ports and remote origins', () => {
  assert.equal(
    resolveCorsOrigin('http://127.0.0.1:39600', { port: 39600 }),
    'http://127.0.0.1:39600',
  );
  assert.equal(resolveCorsOrigin('http://127.0.0.1:39601', { port: 39600 }), null);
  assert.equal(resolveCorsOrigin('http://192.168.1.10:39600', { port: 39600 }), null);
  assert.equal(resolveCorsOrigin('*', { port: 39600 }), null);
});

test('buildApiError redacts secrets in messages and freezes payloads', () => {
  const payload = buildApiError('PROVIDER_NETWORK_ERROR', 'token=sk-ABCDEFGHIJKLMNOP1234 failed', {
    retryable: true,
    details: {
      nested: ['Bearer abc123XYZ.token-value'],
    },
  });

  assert.equal(payload.error.retryable, true);
  assert.equal(payload.error.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
  assert.equal(payload.error.message.includes('[REDACTED]'), true);
  assert.equal(payload.error.details.nested[0].includes('abc123XYZ'), false);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.error), true);
  assert.equal(Object.isFrozen(payload.error.details), true);
  assert.equal(Object.isFrozen(payload.error.details.nested), true);
});

function encodeMaskedClientFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const headerLength = body.length < 126 ? 2 : 4;
  const frame = Buffer.alloc(headerLength + 4 + body.length);
  frame[0] = 0x80 | opcode;
  if (body.length < 126) {
    frame[1] = 0x80 | body.length;
  } else {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(body.length, 2);
  }
  const maskOffset = headerLength;
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  mask.copy(frame, maskOffset);
  for (let index = 0; index < body.length; index += 1) {
    frame[maskOffset + 4 + index] = body[index] ^ mask[index % 4];
  }
  return frame;
}

function parseServerWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    if (buffer.length - cursor < length) break;
    frames.push({ opcode, payload: buffer.subarray(cursor, cursor + length) });
    offset = cursor + length;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function connectWebSocketClient({ port, path = '/ws/app', origin }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const key = crypto.randomBytes(16).toString('base64');
    const messageItems = [];
    const messageWaiters = [];
    const pongItems = [];
    const pongWaiters = [];
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let upgraded = false;

    function deliverMessage(parsed) {
      const idx = messageWaiters.findIndex((w) => w.predicate(parsed));
      if (idx !== -1) {
        const [waiter] = messageWaiters.splice(idx, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(parsed);
        return;
      }
      messageItems.push(parsed);
    }
    function deliverPong(payload) {
      const waiter = pongWaiters.shift();
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(payload);
        return;
      }
      pongItems.push(payload);
    }

    function handleFrames(chunk) {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      const parsed = parseServerWsFrames(frameBuffer);
      frameBuffer = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x1) {
          deliverMessage(JSON.parse(frame.payload.toString('utf8')));
        } else if (frame.opcode === 0xA) {
          deliverPong(frame.payload.toString('utf8'));
        }
      }
    }

    const client = {
      socket,
      waitForJson(predicate = () => true, timeoutMs = 1000) {
        const idx = messageItems.findIndex(predicate);
        if (idx !== -1) {
          const [item] = messageItems.splice(idx, 1);
          return Promise.resolve(item);
        }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const widx = messageWaiters.findIndex((w) => w.resolve === res);
            if (widx !== -1) messageWaiters.splice(widx, 1);
            rej(new Error('Timed out waiting for /ws/app frame'));
          }, timeoutMs);
          messageWaiters.push({ predicate, resolve: res, timer });
        });
      },
      waitForPong(timeoutMs = 1000) {
        if (pongItems.length > 0) return Promise.resolve(pongItems.shift());
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const widx = pongWaiters.findIndex((w) => w.resolve === res);
            if (widx !== -1) pongWaiters.splice(widx, 1);
            rej(new Error('Timed out waiting for /ws/app pong'));
          }, timeoutMs);
          pongWaiters.push({ resolve: res, timer });
        });
      },
      sendText(value) {
        socket.write(encodeMaskedClientFrame(0x1, Buffer.from(value, 'utf8')));
      },
      sendPing(value = 'ping') {
        socket.write(encodeMaskedClientFrame(0x9, Buffer.from(value, 'utf8')));
      },
      close() {
        return new Promise((done) => {
          if (socket.destroyed) {
            done();
            return;
          }
          socket.once('close', done);
          socket.write(encodeMaskedClientFrame(0x8, Buffer.alloc(0)));
          socket.end();
        });
      },
    };

    socket.once('connect', () => {
      const headers = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${key}`,
      ];
      if (origin !== undefined) headers.push(`Origin: ${origin}`);
      headers.push('', '');
      socket.write(headers.join('\r\n'));
    });
    socket.on('data', (chunk) => {
      if (!upgraded) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const idx = handshakeBuffer.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const header = handshakeBuffer.subarray(0, idx).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          reject(new Error(header));
          return;
        }
        upgraded = true;
        const remaining = handshakeBuffer.subarray(idx + 4);
        resolve(client);
        if (remaining.length > 0) handleFrames(remaining);
        return;
      }
      handleFrames(chunk);
    });
    socket.on('error', reject);
  });
}

function rawUpgrade({ port, path = '/ws/app', headers = [] }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        ...headers,
        '',
        '',
      ].join('\r\n'));
    });
    let body = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      body += chunk;
    });
    socket.on('end', () => resolve(body));
    socket.on('error', reject);
  });
}

function waitForSocketClose(socket) {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', resolve);
  });
}

test('GET /ws/app without upgrade returns canonical WS_REJECTED ApiError', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/ws/app' });
    assert.equal(response.statusCode, 426);
    assert.match(response.headers['content-type'], /application\/json/);
    assert.deepEqual(response.parsed, {
      error: {
        code: 'WS_REJECTED',
        message: 'WebSocket upgrade required',
        retryable: true,
      },
    });
  } finally {
    await api.stop();
  }
});

test('/ws/app sends sanitized AppStatus snapshot on connect', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  overlayState.publishFrame(createSubtitleFrame({
    id: 'subtitle-app',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: '<script>alert("x")</script>',
    provider: 'echo',
    confidence: 0.9,
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  }));
  const api = createLocalApiServer({
    preferredPort: 0,
    overlayState,
    activeProfileId: 'profile-1',
    runtimeStatus: {
      capture: { state: 'running', updatedAt: FIXED_TIME },
      ocr: { state: 'ok', updatedAt: FIXED_TIME },
      translation: {
        state: 'warning',
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        message: 'retry with token: sk-ABCDEFGHIJKLMNOP1234',
        updatedAt: FIXED_TIME,
      },
    },
    clock: fixedClock,
  });
  const started = await api.start();
  let client;
  try {
    client = await connectWebSocketClient({ port: started.port, origin: `http://127.0.0.1:${started.port}` });
    const message = await client.waitForJson((m) => m.type === 'status');
    assert.equal(message.type, 'status');
    const { status } = message;
    assert.equal(status.backend, 'ready');
    assert.equal(status.activeProfileId, 'profile-1');
    assert.equal(status.overlayUrl, `http://127.0.0.1:${started.port}/overlay`);
    assert.equal(status.translation.retryable, true);
    assert.equal(status.translation.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(status.translation.message.includes('[REDACTED]'), true);
    assert.equal(status.lastSubtitle.escapedText, '&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;');
    assert.equal(Object.hasOwn(status.lastSubtitle, 'sourceText'), false);
    const serialized = JSON.stringify(message);
    assert.equal(serialized.includes('秘密の原文'), false);
    assert.equal(serialized.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
  } finally {
    if (client !== undefined && !client.socket.destroyed) await client.close();
    await api.stop();
  }
});

test('/ws/app turns runtime status producer failures into redacted status snapshots', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    runtimeStatus: () => {
      throw new Error('status token=sk-ABCDEFGHIJKLMNOP1234 failed');
    },
    clock: fixedClock,
  });
  const started = await api.start();
  let client;
  try {
    client = await connectWebSocketClient({ port: started.port });
    const message = await client.waitForJson((m) => m.type === 'status');

    assert.equal(message.status.backend, 'error');
    assert.equal(message.status.translation.state, 'error');
    assert.equal(message.status.translation.code, 'RUNTIME_STATUS_SOURCE_FAILED');
    assert.equal(message.status.translation.retryable, false);
    assert.equal(message.status.translation.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(message.status.translation.message.includes('[REDACTED]'), true);
  } finally {
    if (client !== undefined && !client.socket.destroyed) await client.close();
    await api.stop();
  }
});

test('/ws/app broadcasts new AppStatus when runtime status is republished and when overlay state changes', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  let runtimeStatus = {
    capture: { state: 'idle', updatedAt: FIXED_TIME },
    ocr: { state: 'idle', updatedAt: FIXED_TIME },
    translation: { state: 'idle', updatedAt: FIXED_TIME },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    overlayState,
    runtimeStatus: () => runtimeStatus,
    clock: fixedClock,
  });
  const started = await api.start();
  let appClient;
  try {
    appClient = await connectWebSocketClient({ port: started.port });
    const initial = await appClient.waitForJson((m) => m.type === 'status');
    assert.equal(initial.status.overlayClients, 0);
    assert.equal(initial.status.translation.state, 'idle');

    runtimeStatus = {
      capture: { state: 'running', updatedAt: FIXED_TIME },
      ocr: { state: 'ok', updatedAt: FIXED_TIME },
      translation: {
        state: 'warning',
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        updatedAt: FIXED_TIME,
      },
    };
    api.publishStatus();
    const rebroadcast = await appClient.waitForJson(
      (m) => m.type === 'status' && m.status.translation.state === 'warning',
    );
    assert.equal(rebroadcast.status.translation.code, 'PROVIDER_RATE_LIMITED');
    assert.equal(rebroadcast.status.translation.retryable, true);

    overlayState.publishFrame(createSubtitleFrame({
      id: 'subtitle-broadcast',
      profileId: 'profile-1',
      translatedText: 'Live broadcast line',
      provider: 'echo',
      createdAt: FIXED_TIME,
      displayMs: 7000,
      themeId: 'classic_subtitle',
    }));
    const broadcast = await appClient.waitForJson(
      (m) => m.type === 'status' && m.status.lastSubtitle && m.status.lastSubtitle.id === 'subtitle-broadcast',
    );
    assert.equal(broadcast.status.lastSubtitle.escapedText, 'Live broadcast line');

    overlayState.clearFrame();
    const cleared = await appClient.waitForJson(
      (m) => m.type === 'status' && !Object.hasOwn(m.status, 'lastSubtitle'),
    );
    assert.equal(Object.hasOwn(cleared.status, 'lastSubtitle'), false);
  } finally {
    if (appClient !== undefined && !appClient.socket.destroyed) await appClient.close();
    await api.stop();
  }
});

test('/ws/app fans out status broadcasts to multiple app clients', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  let runtimeStatus = {
    capture: { state: 'idle', updatedAt: FIXED_TIME },
    ocr: { state: 'idle', updatedAt: FIXED_TIME },
    translation: { state: 'idle', updatedAt: FIXED_TIME },
  };
  const api = createLocalApiServer({
    preferredPort: 0,
    overlayState,
    runtimeStatus: () => runtimeStatus,
    clock: fixedClock,
  });
  const started = await api.start();
  let first;
  let second;
  try {
    first = await connectWebSocketClient({ port: started.port });
    second = await connectWebSocketClient({ port: started.port });
    await first.waitForJson((m) => m.type === 'status');
    await second.waitForJson((m) => m.type === 'status');

    runtimeStatus = {
      capture: { state: 'running', updatedAt: FIXED_TIME },
      ocr: { state: 'ok', updatedAt: FIXED_TIME },
      translation: { state: 'idle', updatedAt: FIXED_TIME },
    };
    api.publishStatus();
    const firstRuntime = await first.waitForJson(
      (m) => m.type === 'status' && m.status.capture.state === 'running',
    );
    const secondRuntime = await second.waitForJson(
      (m) => m.type === 'status' && m.status.capture.state === 'running',
    );
    assert.equal(firstRuntime.status.capture.state, 'running');
    assert.equal(secondRuntime.status.capture.state, 'running');

    overlayState.publishFrame(createSubtitleFrame({
      id: 'subtitle-fanout',
      profileId: 'profile-1',
      translatedText: 'Fanout line',
      provider: 'echo',
      createdAt: FIXED_TIME,
      displayMs: 7000,
      themeId: 'classic_subtitle',
    }));
    const firstOverlay = await first.waitForJson(
      (m) => m.type === 'status' && m.status.lastSubtitle && m.status.lastSubtitle.id === 'subtitle-fanout',
    );
    const secondOverlay = await second.waitForJson(
      (m) => m.type === 'status' && m.status.lastSubtitle && m.status.lastSubtitle.id === 'subtitle-fanout',
    );
    assert.equal(firstOverlay.status.lastSubtitle.escapedText, 'Fanout line');
    assert.equal(secondOverlay.status.lastSubtitle.escapedText, 'Fanout line');
  } finally {
    if (first !== undefined && !first.socket.destroyed) await first.close();
    if (second !== undefined && !second.socket.destroyed) await second.close();
    await api.stop();
  }
});

test('/ws/app broadcasts overlay client-count changes when overlay clients connect and disconnect', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  const api = createLocalApiServer({ preferredPort: 0, overlayState, clock: fixedClock });
  const started = await api.start();
  let appClient;
  let overlayClient;
  try {
    appClient = await connectWebSocketClient({ port: started.port });
    const initial = await appClient.waitForJson((m) => m.type === 'status');
    assert.equal(initial.status.overlayClients, 0);

    overlayClient = await connectWebSocketClient({ port: started.port, path: '/ws/overlay' });
    const onConnect = await appClient.waitForJson(
      (m) => m.type === 'status' && m.status.overlayClients === 1,
    );
    assert.equal(onConnect.status.overlayClients, 1);

    await overlayClient.close();
    overlayClient = undefined;
    const onDisconnect = await appClient.waitForJson(
      (m) => m.type === 'status' && m.status.overlayClients === 0,
    );
    assert.equal(onDisconnect.status.overlayClients, 0);
  } finally {
    if (overlayClient !== undefined && !overlayClient.socket.destroyed) await overlayClient.close();
    if (appClient !== undefined && !appClient.socket.destroyed) await appClient.close();
    await api.stop();
  }
});

test('/ws/app rejects disallowed origins with 403 WS_REJECTED', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();
  try {
    const response = await rawUpgrade({
      port: started.port,
      path: '/ws/app',
      headers: [
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
        'Origin: https://evil.example.com',
      ],
    });
    assert.match(response, /^HTTP\/1\.1 403 Forbidden/);
    assert.match(response, /"code":"WS_REJECTED"/);
    assert.match(response, /WebSocket origin rejected/);
  } finally {
    await api.stop();
  }
});

test('/ws/app responds to text and control pings without leaking client payloads', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();
  let client;
  try {
    client = await connectWebSocketClient({ port: started.port });
    await client.waitForJson((m) => m.type === 'status');

    client.sendText(JSON.stringify({ type: 'ping', secret: 'sk-ABCDEFGHIJKLMNOP1234' }));
    const pong = await client.waitForJson((m) => m.type === 'pong');
    assert.deepEqual(pong, { type: 'pong' });

    client.sendPing('probe');
    assert.equal(await client.waitForPong(), 'probe');
  } finally {
    if (client !== undefined && !client.socket.destroyed) await client.close();
    await api.stop();
  }
});

test('/ws/app rejects oversized text and control frames', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();
  let textClient;
  let controlClient;
  try {
    textClient = await connectWebSocketClient({ port: started.port });
    await textClient.waitForJson((m) => m.type === 'status');
    textClient.sendText('x'.repeat((16 * 1024) + 1));
    await waitForSocketClose(textClient.socket);
    assert.equal(textClient.socket.destroyed, true);
    textClient = undefined;

    controlClient = await connectWebSocketClient({ port: started.port });
    await controlClient.waitForJson((m) => m.type === 'status');
    controlClient.sendPing('x'.repeat(126));
    await waitForSocketClose(controlClient.socket);
    assert.equal(controlClient.socket.destroyed, true);
    controlClient = undefined;
  } finally {
    if (textClient !== undefined && !textClient.socket.destroyed) await textClient.close();
    if (controlClient !== undefined && !controlClient.socket.destroyed) await controlClient.close();
    await api.stop();
  }
});

test('providerErrorToRuntimeStatus maps retryable and non-retryable provider errors with redacted messages', () => {
  const retryable = providerErrorToRuntimeStatus(
    new ContractError('PROVIDER_RATE_LIMITED', 'rate-limited token=sk-ABCDEFGHIJKLMNOP1234'),
    { clock: fixedClock },
  );
  assert.equal(retryable.state, 'error');
  assert.equal(retryable.code, 'PROVIDER_RATE_LIMITED');
  assert.equal(retryable.retryable, true);
  assert.equal(retryable.updatedAt, FIXED_TIME);
  assert.equal(retryable.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
  assert.equal(retryable.message.includes('[REDACTED]'), true);

  const network = providerErrorToRuntimeStatus(
    new ContractError('PROVIDER_NETWORK_ERROR', 'DeepL upstream error'),
    { clock: fixedClock },
  );
  assert.equal(network.retryable, true);

  const auth = providerErrorToRuntimeStatus(
    new ContractError('PROVIDER_AUTH_FAILED', 'DeepL rejected the API key'),
    { clock: fixedClock },
  );
  assert.equal(auth.retryable, false);
  assert.equal(auth.code, 'PROVIDER_AUTH_FAILED');

  const keyMissing = providerErrorToRuntimeStatus(
    new ContractError('PROVIDER_KEY_MISSING', 'DeepL API key is not configured'),
    { clock: fixedClock },
  );
  assert.equal(keyMissing.retryable, false);

  const unknown = providerErrorToRuntimeStatus(null, { clock: fixedClock });
  assert.equal(unknown.code, 'PROVIDER_UNKNOWN');
  assert.equal(unknown.retryable, false);

  const unrecognized = providerErrorToRuntimeStatus(
    new ContractError('SOMETHING_ELSE', 'unknown provider failure'),
    { clock: fixedClock },
  );
  assert.equal(unrecognized.code, 'PROVIDER_UNKNOWN');
  assert.equal(unrecognized.retryable, false);
});

test('providerErrorRetryable agrees with the documented retryable subset', () => {
  for (const code of ['PROVIDER_RATE_LIMITED', 'PROVIDER_NETWORK_ERROR']) {
    assert.equal(providerErrorRetryable({ code }), true);
    assert.equal(providerErrorRetryable(code), true);
  }
  for (const code of [
    'PROVIDER_KEY_MISSING',
    'PROVIDER_AUTH_FAILED',
    'PROVIDER_QUOTA_EXCEEDED',
    'PROVIDER_RESPONSE_INVALID',
    'PROVIDER_UNKNOWN',
    'TARGET_LANG_INVALID',
  ]) {
    assert.equal(providerErrorRetryable({ code }), false);
    assert.equal(providerErrorRetryable(code), false);
  }
  assert.equal(providerErrorRetryable(null), false);
  assert.equal(providerErrorRetryable(undefined), false);
});

test('buildApiErrorFromContractError preserves code and uses provider retryability without parsing messages', () => {
  const retryable = buildApiErrorFromContractError(
    new ContractError('PROVIDER_NETWORK_ERROR', 'DeepL upstream error'),
  );
  assert.equal(retryable.error.code, 'PROVIDER_NETWORK_ERROR');
  assert.equal(retryable.error.retryable, true);

  const nonRetryable = buildApiErrorFromContractError(
    new ContractError('PROVIDER_KEY_MISSING', 'DeepL API key is not configured'),
  );
  assert.equal(nonRetryable.error.retryable, false);

  const websocketRejected = buildApiErrorFromContractError(
    new ContractError('WS_REJECTED', 'WebSocket upgrade required'),
  );
  assert.equal(websocketRejected.error.retryable, true);

  const overridden = buildApiErrorFromContractError(
    new ContractError('PROVIDER_NETWORK_ERROR', 'msg'),
    { retryable: false },
  );
  assert.equal(overridden.error.retryable, false);
});
