'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  buildApiError,
  createLocalApiServer,
  resolveCorsOrigin,
} = require('../src/server/local-api-server');
const { ContractError } = require('../src/contracts/security');
const { createSubtitleFrame, OverlayState } = require('../src/core/subtitle-state');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';

function fixedClock() {
  return FIXED_TIME;
}

function requestJson({ port, path, method = 'GET', headers = {} }) {
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
        const parsed = body.length > 0 ? JSON.parse(body) : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, body, parsed });
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
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(wrongMethod.parsed.error.retryable, false);
    assert.equal(Object.hasOwn(wrongMethod.parsed.error, 'stack'), false);
  } finally {
    await api.stop();
  }
});

test('unexpected status producer failures return redacted ApiError envelopes', async () => {
  const api = createLocalApiServer({
    preferredPort: 0,
    runtimeStatus: () => {
      throw new Error('token=sk-ABCDEFGHIJKLMNOP1234 failed');
    },
  });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/api/status' });

    assert.equal(response.statusCode, 500);
    assert.equal(response.parsed.error.code, 'INTERNAL_ERROR');
    assert.equal(response.parsed.error.retryable, false);
    assert.equal(response.parsed.error.message.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(response.parsed.error.message.includes('[REDACTED]'), true);
    assert.equal(Object.hasOwn(response.parsed.error, 'stack'), false);
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
    assert.equal(allowed.headers['access-control-allow-methods'], 'GET, OPTIONS');
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
