#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const { ContractError, redactSecrets } = require('../src/contracts/security');
const { createLocalApiServer } = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SOURCE_SENTINEL = '勇者の秘密の翻訳原文';
const TRANSLATED_SENTINEL = 'secret translated smoke output';
const GLOSSARY_SENTINEL = 'secret hero glossary term';
const SECRET_SENTINEL = 'sk-TRANSLATIONSMOKEKEY1234';
const SMOKE_VERSION = 'translation-smoke-v1';
const REQUEST_TIMEOUT_MS = 4000;
const WS_UPGRADE_TIMEOUT_MS = 4000;
const WS_MESSAGE_TIMEOUT_MS = 3000;
const SHORT_WS_MESSAGE_TIMEOUT_MS = 150;
const CACHE_KEY_PATTERN = /v1:(?:echo|deepl):en:[a-f0-9]{64}:[a-f0-9]{64}/u;
const CACHE_KEY_REDACTION_PATTERN = /v1:(?:echo|deepl):en:[a-f0-9]{64}:[a-f0-9]{64}/gu;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixedClock() {
  return FIXED_TIME;
}

function record(checks, name) {
  checks.push(name);
}

function httpJsonRequest({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    let requestBody = null;
    const requestHeaders = { ...headers };
    if (body !== undefined) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: requestHeaders,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        const parsed = responseBody.length > 0 ? JSON.parse(responseBody) : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody, parsed });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`HTTP ${method} ${path} timed out`));
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}

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

function parseServerFrames(buffer) {
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

function connectWebSocketClient({ port, path, origin }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const key = crypto.randomBytes(16).toString('base64');
    const messages = [];
    const waiters = [];
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let settled = false;
    let upgraded = false;
    const upgradeTimer = setTimeout(() => {
      fail(new Error(`WebSocket upgrade timed out for ${path}`));
    }, WS_UPGRADE_TIMEOUT_MS);

    function fail(error) {
      if (!settled) {
        clearTimeout(upgradeTimer);
        settled = true;
        socket.destroy();
        reject(error);
        return;
      }
      socket.destroy();
    }

    function deliver(message) {
      const index = waiters.findIndex((waiter) => waiter.predicate(message));
      if (index !== -1) {
        const [waiter] = waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      messages.push(message);
    }

    function handleFrames(chunk) {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      const parsed = parseServerFrames(frameBuffer);
      frameBuffer = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x1) {
          deliver(JSON.parse(frame.payload.toString('utf8')));
        }
      }
    }

    const client = {
      socket,
      waitForJson(predicate = () => true, timeoutMs = WS_MESSAGE_TIMEOUT_MS) {
        const index = messages.findIndex(predicate);
        if (index !== -1) {
          const [message] = messages.splice(index, 1);
          return Promise.resolve(message);
        }
        return new Promise((resolveWait, rejectWait) => {
          const timer = setTimeout(() => {
            const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolveWait);
            if (waiterIndex !== -1) waiters.splice(waiterIndex, 1);
            rejectWait(new Error(`Timed out waiting for ${path} WebSocket message`));
          }, timeoutMs);
          waiters.push({ predicate, resolve: resolveWait, timer });
        });
      },
      close() {
        return new Promise((done) => {
          if (socket.destroyed) {
            done();
            return;
          }
          const timer = setTimeout(() => {
            socket.destroy();
            done();
          }, 500);
          socket.once('close', () => {
            clearTimeout(timer);
            done();
          });
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
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          fail(new Error(`WebSocket upgrade rejected for ${path}`));
          return;
        }
        upgraded = true;
        if (!settled) {
          clearTimeout(upgradeTimer);
          settled = true;
          resolve(client);
        }
        const remaining = handshakeBuffer.subarray(headerEnd + 4);
        if (remaining.length > 0) handleFrames(remaining);
        return;
      }
      handleFrames(chunk);
    });
    socket.on('error', fail);
  });
}

function assertNoSensitivePayload(value, label, options = {}) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (!options.allowSourceText) {
    assert.equal(serialized.includes(SOURCE_SENTINEL), false, `${label} leaked source text`);
  }
  if (!options.allowTranslatedText) {
  assert.equal(serialized.includes(TRANSLATED_SENTINEL), false, `${label} leaked translated text`);
  }
  assert.equal(serialized.includes(SECRET_SENTINEL), false, `${label} leaked provider key`);
  assert.equal(serialized.includes(GLOSSARY_SENTINEL), false, `${label} leaked glossary term`);
  assert.equal(CACHE_KEY_PATTERN.test(serialized), false, `${label} leaked cache key`);
}

function redactSmokeDiagnostic(value) {
  return redactSecrets(String(value))
    .replaceAll(SOURCE_SENTINEL, '[REDACTED_SOURCE_TEXT]')
    .replaceAll(TRANSLATED_SENTINEL, '[REDACTED_TRANSLATED_TEXT]')
    .replaceAll(GLOSSARY_SENTINEL, '[REDACTED_GLOSSARY_TERM]')
    .replace(CACHE_KEY_REDACTION_PATTERN, '[REDACTED_CACHE_KEY]');
}

function makeProfile(overrides = {}) {
  return {
    id: 'profile_translate',
    name: 'Translation Smoke',
    gameTitle: 'Smoke Game',
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.7,
    captureHz: 0,
    translationProvider: 'echo',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossary: [
      { id: 'term_hero', sourceTerm: '勇者', targetTerm: GLOSSARY_SENTINEL },
    ],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function createSmokeProfileRepository() {
  const profiles = new Map([
    ['profile_translate', makeProfile()],
  ]);

  return Object.freeze({
    getProfile(profileId) {
      const profile = profiles.get(profileId);
      if (!profile) {
        throw new ContractError(
          'PROFILE_NOT_FOUND',
          `missing profile ${profileId} key=${SECRET_SENTINEL}`,
        );
      }
      return cloneJson(profile);
    },
  });
}

function createSmokeTranslateTestProvider() {
  return {
    failNext: false,
    calls: [],
    async runTranslateTest({ profile, input }) {
      this.calls.push({
        profileId: profile.id,
        provider: input.provider,
        targetLang: input.targetLang,
        sourceText: input.sourceText,
        glossaryAppliedText: input.glossaryAppliedText,
        cacheKey: input.cacheKey,
      });
      if (this.failNext) {
        this.failNext = false;
        throw new ContractError(
          'PROVIDER_RATE_LIMITED',
          `provider failed key=${SECRET_SENTINEL} source=${SOURCE_SENTINEL} translated=${TRANSLATED_SENTINEL}`,
        );
      }
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText: TRANSLATED_SENTINEL,
        provider: profile.translationProvider,
        durationMs: 12,
        cacheHit: false,
      });
    },
  };
}

async function expectJson(port, path, options, statusCode, privacyOptions = {}) {
  const response = await httpJsonRequest({ port, path, ...options });
  assert.equal(response.statusCode, statusCode, response.body);
  assertNoSensitivePayload(
    response.parsed,
    `${options && options.method ? options.method : 'GET'} ${path}`,
    privacyOptions,
  );
  return response;
}

function assertTranslationStatus(status, { state, code, retryable }) {
  assert.equal(status.translation.state, state);
  assert.equal(status.translation.code, code);
  assert.equal(status.translation.updatedAt, FIXED_TIME);
  if (retryable !== undefined) assert.equal(status.translation.retryable, retryable);
  assertNoSensitivePayload(status, `${state} translation status`);
}

async function assertNoTranslationMutation(appClient, port) {
  await assert.rejects(
    () => appClient.waitForJson(
      (message) => message.type === 'status' && message.status.translation.state !== 'idle',
      SHORT_WS_MESSAGE_TIMEOUT_MS,
    ),
  );
  const status = await expectJson(port, '/api/status', {}, 200);
  assertTranslationStatus(status.parsed, { state: 'idle', code: undefined });
}

async function runSmoke() {
  const checks = [];
  const repository = createSmokeProfileRepository();
  const translateTestProvider = createSmokeTranslateTestProvider();
  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    profileRepository: repository,
    translateTestProvider,
    activeProfileId: 'profile_translate',
    clock: fixedClock,
  });

  let started;
  let appClient;
  try {
    started = await api.start();
    assert.equal(started.bindAddress, '127.0.0.1');
    record(checks, 'server binds 127.0.0.1 on an ephemeral port');

    const health = await expectJson(started.port, '/health', {}, 200);
    assert.deepEqual(health.parsed, {
      ok: true,
      version: SMOKE_VERSION,
      port: started.port,
      bindAddress: '127.0.0.1',
    });
    record(checks, 'GET /health reports selected localhost port');

    appClient = await connectWebSocketClient({ port: started.port, path: '/ws/app' });
    const initial = await appClient.waitForJson((message) => message.type === 'status');
    assert.equal(initial.status.translation.state, 'idle');
    assertNoSensitivePayload(initial.status, 'initial app status');

    const allowedOrigin = `http://127.0.0.1:${started.port}`;
    const preflight = await httpJsonRequest({
      port: started.port,
      path: '/api/translate/test',
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);

    const wrongMethod = await expectJson(started.port, '/api/translate/test', {
      method: 'GET',
    }, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');

    const malformed = await expectJson(started.port, '/api/translate/test', {
      method: 'POST',
      body: { profileId: '', text: '', extra: SOURCE_SENTINEL },
    }, 400);
    assert.equal(malformed.parsed.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(translateTestProvider.calls, []);
    await assertNoTranslationMutation(appClient, started.port);
    record(checks, 'translate test preflight method and malformed requests do not mutate status');

    const missingProfile = await expectJson(started.port, '/api/translate/test', {
      method: 'POST',
      body: { profileId: 'missing_profile', text: SOURCE_SENTINEL },
    }, 404);
    assert.equal(missingProfile.parsed.error.code, 'PROFILE_NOT_FOUND');
    assert.equal(missingProfile.parsed.error.retryable, false);
    assert.deepEqual(translateTestProvider.calls, []);
    const missingRunning = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.translation.state === 'running',
    );
    assertTranslationStatus(missingRunning.status, {
      state: 'running',
      code: 'TRANSLATE_TEST_RUNNING',
      retryable: false,
    });
    const missingError = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.translation.state === 'error',
    );
    assertTranslationStatus(missingError.status, {
      state: 'error',
      code: 'PROFILE_NOT_FOUND',
      retryable: false,
    });
    const missingStatus = await expectJson(started.port, '/api/status', {}, 200);
    assertTranslationStatus(missingStatus.parsed, {
      state: 'error',
      code: 'PROFILE_NOT_FOUND',
      retryable: false,
    });
    record(checks, 'missing profile returns redacted error status before provider call');

    const success = await expectJson(started.port, '/api/translate/test', {
      method: 'POST',
      body: { profileId: 'profile_translate', text: SOURCE_SENTINEL },
    }, 200, { allowSourceText: true, allowTranslatedText: true });
    assert.deepEqual(success.parsed, {
      sourceText: SOURCE_SENTINEL,
      translatedText: TRANSLATED_SENTINEL,
      provider: 'echo',
      durationMs: 12,
      cacheHit: false,
    });
    assert.equal(translateTestProvider.calls.length, 1);
    assert.equal(translateTestProvider.calls[0].provider, 'echo');
    assert.equal(translateTestProvider.calls[0].targetLang, 'en');
    assert.equal(translateTestProvider.calls[0].sourceText, SOURCE_SENTINEL);
    assert.equal(translateTestProvider.calls[0].glossaryAppliedText.includes(GLOSSARY_SENTINEL), true);
    assert.equal(translateTestProvider.calls[0].cacheKey.startsWith('v1:echo:en:'), true);
    assertNoSensitivePayload(success.parsed, 'translation success response metadata', {
      allowSourceText: true,
      allowTranslatedText: true,
    });

    const running = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.translation.state === 'running',
    );
    assertTranslationStatus(running.status, {
      state: 'running',
      code: 'TRANSLATE_TEST_RUNNING',
      retryable: false,
    });
    const ok = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.translation.state === 'ok',
    );
    assertTranslationStatus(ok.status, {
      state: 'ok',
      code: 'TRANSLATE_TEST_OK',
      retryable: false,
    });
    const okStatus = await expectJson(started.port, '/api/status', {}, 200);
    assertTranslationStatus(okStatus.parsed, {
      state: 'ok',
      code: 'TRANSLATE_TEST_OK',
      retryable: false,
    });
    record(checks, 'translate success validates result input preparation and running-ok status');

    translateTestProvider.failNext = true;
    const failure = await expectJson(started.port, '/api/translate/test', {
      method: 'POST',
      body: { profileId: 'profile_translate', text: SOURCE_SENTINEL },
    }, 429);
    assert.equal(failure.parsed.error.code, 'PROVIDER_RATE_LIMITED');
    assert.equal(failure.parsed.error.retryable, true);
    assert.equal(translateTestProvider.calls.length, 2);

    const failureRunning = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.translation.state === 'running',
    );
    assertTranslationStatus(failureRunning.status, {
      state: 'running',
      code: 'TRANSLATE_TEST_RUNNING',
      retryable: false,
    });
    const errorFrame = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.translation.state === 'error',
    );
    assertTranslationStatus(errorFrame.status, {
      state: 'error',
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
    });
    const errorStatus = await expectJson(started.port, '/api/status', {}, 200);
    assertTranslationStatus(errorStatus.parsed, {
      state: 'error',
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
    });
    record(checks, 'translate provider failure returns retryable error and running-error status');

    return Object.freeze({
      ok: true,
      command: 'npm run smoke:translation',
      bindAddress: started.bindAddress,
      port: started.port,
      checks,
    });
  } finally {
    if (appClient !== undefined && !appClient.socket.destroyed) {
      await appClient.close();
    }
    await api.stop();
  }
}

if (require.main === module) {
  runSmoke()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      const message = error && typeof error.message === 'string'
        ? redactSmokeDiagnostic(error.message)
        : 'Translation API smoke failed';
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:translation',
        error: {
          name: error && error.name ? error.name : 'Error',
          message,
        },
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  runSmoke,
};
