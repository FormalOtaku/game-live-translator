#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const { redactSecrets } = require('../src/contracts/security');
const { OverlayState } = require('../src/core/subtitle-state');
const {
  SYNTHETIC_OCR_CANDIDATE,
  runSyntheticFirstRunStream,
} = require('../src/core/synthetic-first-run-stream');
const { createLocalApiServer } = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SMOKE_VERSION = 'first-run-stream-smoke-v1';
const PROFILE_ID = 'first-run-profile';
const SUBTITLE_ID = 'first-run-subtitle';
const TRANSLATED_TEXT = 'Hero and Demon King';
const SECRET_SENTINEL = 'sk-FIRSTRUNSTREAMKEY1234';
const SCREENSHOT_SENTINEL = 'C:\\Users\\streamer\\Pictures\\first-run-secret.png';
const REQUEST_TIMEOUT_MS = 4000;
const WS_UPGRADE_TIMEOUT_MS = 4000;
const WS_MESSAGE_TIMEOUT_MS = 3000;

function fixedClock() {
  return FIXED_TIME;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function httpRequest({ port, path, method = 'GET', headers = {} }) {
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
        let parsed = null;
        if (/application\/json/i.test(String(res.headers['content-type']))) {
          parsed = body.length > 0 ? JSON.parse(body) : null;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body, parsed });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`HTTP ${method} ${path} timed out`));
    });
    req.on('error', reject);
    req.end();
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
  assert.equal(serialized.includes(SYNTHETIC_OCR_CANDIDATE.text), false, `${label} leaked source text`);
  assert.equal(serialized.includes(SECRET_SENTINEL), false, `${label} leaked provider key`);
  assert.equal(serialized.includes(SCREENSHOT_SENTINEL), false, `${label} leaked screenshot path`);
  if (options.allowTranslatedText !== true) {
    assert.equal(serialized.includes(TRANSLATED_TEXT), false, `${label} leaked translated text`);
  }
}

function redactSmokeDiagnostic(value) {
  return redactSecrets(String(value))
    .replaceAll(SYNTHETIC_OCR_CANDIDATE.text, '[REDACTED_SOURCE_TEXT]')
    .replaceAll(TRANSLATED_TEXT, '[REDACTED_TRANSLATED_TEXT]')
    .replaceAll(SCREENSHOT_SENTINEL, '[REDACTED_SCREENSHOT_PATH]');
}

function record(checks, name) {
  checks.push(name);
}

function createSyntheticProvider() {
  const calls = [];
  const provider = Object.freeze({
    name: 'echo',
    async translate(input) {
      calls.push(Object.freeze({ ...input }));
      return Object.freeze({
        sourceText: input.sourceText,
        translatedText: TRANSLATED_TEXT,
        provider: 'echo',
        durationMs: 4,
        cacheHit: false,
      });
    },
  });
  return { provider, calls };
}

function firstRunProfile() {
  return Object.freeze({
    id: PROFILE_ID,
    translationProvider: 'echo',
    targetLang: 'en',
    ocrConfidenceFloor: 0.6,
    themeId: 'classic_subtitle',
    subtitleDisplayMs: 7000,
    glossary: [],
  });
}

function smokeRuntimeStatus() {
  return Object.freeze({
    capture: Object.freeze({
      state: 'ok',
      code: 'SYNTHETIC_CAPTURE_OK',
      updatedAt: FIXED_TIME,
    }),
    ocr: Object.freeze({
      state: 'ok',
      code: 'SYNTHETIC_OCR_OK',
      updatedAt: FIXED_TIME,
    }),
    translation: Object.freeze({
      state: 'ok',
      code: 'SYNTHETIC_TRANSLATION_OK',
      message: `synthetic provider ready ${SECRET_SENTINEL}`,
      updatedAt: FIXED_TIME,
    }),
  });
}

async function runSmoke() {
  const checks = [];
  const overlayState = new OverlayState({ clock: fixedClock });
  const { provider, calls } = createSyntheticProvider();
  const profile = firstRunProfile();
  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    overlayState,
    activeProfileId: PROFILE_ID,
    runtimeStatus: smokeRuntimeStatus,
    clock: fixedClock,
  });

  let started;
  let appClient;
  let overlayClient;
  let lateOverlayClient;
  try {
    started = await api.start();
    assert.equal(started.bindAddress, '127.0.0.1');
    assert.match(started.overlayUrl, /^http:\/\/127\.0\.0\.1:\d+\/overlay$/);
    record(checks, 'server binds localhost and reports OBS overlay URL');

    const health = await httpRequest({ port: started.port, path: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.parsed, {
      ok: true,
      version: SMOKE_VERSION,
      port: started.port,
      bindAddress: '127.0.0.1',
    });
    assertNoSensitivePayload(health.parsed, 'GET /health');
    record(checks, 'GET /health reports selected localhost port');

    const initialStatus = await httpRequest({ port: started.port, path: '/api/status' });
    assert.equal(initialStatus.statusCode, 200);
    assert.equal(initialStatus.parsed.backend, 'ready');
    assert.equal(initialStatus.parsed.activeProfileId, PROFILE_ID);
    assert.equal(initialStatus.parsed.overlayUrl, started.overlayUrl);
    assert.equal(initialStatus.parsed.overlayClients, 0);
    assert.equal(Object.hasOwn(initialStatus.parsed, 'lastSubtitle'), false);
    assert.equal(initialStatus.parsed.translation.message.includes(SECRET_SENTINEL), false);
    assertNoSensitivePayload(initialStatus.parsed, 'initial GET /api/status');
    record(checks, 'initial GET /api/status is sanitized and empty');

    appClient = await connectWebSocketClient({
      port: started.port,
      path: '/ws/app',
      origin: `http://127.0.0.1:${started.port}`,
    });
    const appSnapshot = await appClient.waitForJson((message) => message.type === 'status');
    assert.equal(appSnapshot.status.overlayClients, 0);
    assert.equal(Object.hasOwn(appSnapshot.status, 'lastSubtitle'), false);
    assertNoSensitivePayload(appSnapshot, 'WS /ws/app initial snapshot');
    record(checks, 'WS /ws/app sends empty sanitized snapshot');

    overlayClient = await connectWebSocketClient({
      port: started.port,
      path: '/ws/overlay',
      origin: `http://127.0.0.1:${started.port}`,
    });
    const overlayConnected = await appClient.waitForJson(
      (message) => message.type === 'status' && message.status.overlayClients === 1,
    );
    assert.equal(Object.hasOwn(overlayConnected.status, 'lastSubtitle'), false);
    assertNoSensitivePayload(overlayConnected, 'WS /ws/app overlay client count');
    record(checks, 'WS /ws/app broadcasts overlay client count');

    const summary = await runSyntheticFirstRunStream({
      profile,
      provider,
      overlayState,
      clock: fixedClock,
      idFactory: () => SUBTITLE_ID,
    });
    assert.equal(summary.failure, null);
    assert.equal(summary.stage, 'overlay');
    assert.equal(summary.withinBudget, true);
    assert.equal(summary.overlayPublished, true);
    assert.equal(summary.subtitle.id, SUBTITLE_ID);
    assertNoSensitivePayload(summary, 'synthetic summary');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceText, SYNTHETIC_OCR_CANDIDATE.text);
    assert.equal(calls[0].targetLang, 'en');
    record(checks, 'synthetic OCR translation pipeline publishes overlay frame');

    const overlayLive = await overlayClient.waitForJson(
      (message) => message.type === 'subtitle' && message.frame.id === SUBTITLE_ID,
    );
    assert.equal(overlayLive.replay, false);
    assert.equal(overlayLive.frame.profileId, PROFILE_ID);
    assert.equal(overlayLive.frame.escapedText, TRANSLATED_TEXT);
    assert.equal(overlayLive.frame.provider, 'echo');
    assert.equal(Object.hasOwn(overlayLive.frame, 'sourceText'), false);
    assertNoSensitivePayload(overlayLive, 'WS /ws/overlay live subtitle', { allowTranslatedText: true });
    record(checks, 'WS /ws/overlay receives live sanitized subtitle');

    const appLive = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.lastSubtitle &&
        message.status.lastSubtitle.id === SUBTITLE_ID,
    );
    assert.equal(appLive.status.lastSubtitle.escapedText, TRANSLATED_TEXT);
    assert.equal(Object.hasOwn(appLive.status.lastSubtitle, 'sourceText'), false);
    assertNoSensitivePayload(appLive, 'WS /ws/app subtitle status', { allowTranslatedText: true });
    record(checks, 'WS /ws/app broadcasts subtitle status');

    const statusAfterPublish = await httpRequest({ port: started.port, path: '/api/status' });
    assert.equal(statusAfterPublish.statusCode, 200);
    assert.equal(statusAfterPublish.parsed.lastSubtitle.id, SUBTITLE_ID);
    assert.equal(statusAfterPublish.parsed.lastSubtitle.escapedText, TRANSLATED_TEXT);
    assert.equal(Object.hasOwn(statusAfterPublish.parsed.lastSubtitle, 'sourceText'), false);
    assertNoSensitivePayload(statusAfterPublish.parsed, 'post-publish GET /api/status', {
      allowTranslatedText: true,
    });
    record(checks, 'post-publish GET /api/status exposes latest sanitized subtitle');

    const overlay = await httpRequest({ port: started.port, path: '/overlay' });
    assert.equal(overlay.statusCode, 200);
    assert.match(overlay.headers['content-type'], /text\/html/);
    assert.equal(overlay.headers['cache-control'], 'no-store');
    assert.match(overlay.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(overlay.body.includes(TRANSLATED_TEXT));
    assert.equal(/<script[^>]+\bsrc=/i.test(overlay.body), false);
    assert.equal(/<link\b/i.test(overlay.body), false);
    assert.equal(/<img\b/i.test(overlay.body), false);
    assertNoSensitivePayload(overlay.body, 'GET /overlay after publish', { allowTranslatedText: true });
    record(checks, 'GET /overlay serves self-contained visible subtitle HTML');

    lateOverlayClient = await connectWebSocketClient({
      port: started.port,
      path: '/ws/overlay',
      origin: `http://127.0.0.1:${started.port}`,
    });
    const overlayReplay = await lateOverlayClient.waitForJson(
      (message) => message.type === 'subtitle' && message.frame.id === SUBTITLE_ID,
    );
    assert.equal(overlayReplay.replay, true);
    assert.equal(overlayReplay.frame.escapedText, TRANSLATED_TEXT);
    assert.equal(Object.hasOwn(overlayReplay.frame, 'sourceText'), false);
    assertNoSensitivePayload(overlayReplay, 'late WS /ws/overlay replay', { allowTranslatedText: true });
    record(checks, 'late WS /ws/overlay replays latest sanitized subtitle');

    const stdoutSummary = Object.freeze({
      ok: true,
      command: 'npm run smoke:first-run-stream',
      bindAddress: started.bindAddress,
      port: started.port,
      overlayUrl: started.overlayUrl,
      harness: Object.freeze({
        schemaVersion: summary.schemaVersion,
        stage: summary.stage,
        withinBudget: summary.withinBudget,
        overlayPublished: summary.overlayPublished,
        durationMs: summary.durationMs,
        maxDurationMs: summary.maxDurationMs,
        subtitle: Object.freeze({
          id: summary.subtitle.id,
          provider: summary.subtitle.provider,
          themeId: summary.subtitle.themeId,
          displayMs: summary.subtitle.displayMs,
          translatedTextSha256: summary.subtitle.translatedTextSha256,
          escapedTextSha256: summary.subtitle.escapedTextSha256,
        }),
        privacy: summary.privacy,
      }),
      checks,
      evidence: Object.freeze({
        overlayHtmlSha256: sha256Hex(overlay.body),
        liveFrameEscapedTextSha256: sha256Hex(overlayLive.frame.escapedText),
        replayFrameEscapedTextSha256: sha256Hex(overlayReplay.frame.escapedText),
      }),
    });
    assertNoSensitivePayload(stdoutSummary, 'stdout summary');
    return stdoutSummary;
  } finally {
    if (lateOverlayClient !== undefined && !lateOverlayClient.socket.destroyed) await lateOverlayClient.close();
    if (overlayClient !== undefined && !overlayClient.socket.destroyed) await overlayClient.close();
    if (appClient !== undefined && !appClient.socket.destroyed) await appClient.close();
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
        : 'Smoke failed';
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:first-run-stream',
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
