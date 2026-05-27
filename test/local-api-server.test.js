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
const { ContractError } = require('../src/contracts/security');
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
