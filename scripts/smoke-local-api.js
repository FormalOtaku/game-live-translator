#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const { redactSecrets } = require('../src/contracts/security');
const { createSubtitleFrame, OverlayState } = require('../src/core/subtitle-state');
const { createLocalApiServer } = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SOURCE_SENTINEL = '秘密の原文';
const SECRET_SENTINEL = 'sk-ABCDEFGHIJKLMNOP1234';
const SMOKE_VERSION = 'smoke-v1';
const REQUEST_TIMEOUT_MS = 4000;
const WS_UPGRADE_TIMEOUT_MS = 4000;
const WS_MESSAGE_TIMEOUT_MS = 3000;

function fixedClock() {
  return FIXED_TIME;
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

function assertNoSensitivePayload(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(serialized.includes(SOURCE_SENTINEL), false, `${label} leaked source text`);
  assert.equal(serialized.includes(SECRET_SENTINEL), false, `${label} leaked provider key`);
}

function record(checks, name) {
  checks.push(name);
}

async function runSmoke() {
  const checks = [];
  const overlayState = new OverlayState({ clock: fixedClock });
  overlayState.publishFrame(createSubtitleFrame({
    id: 'smoke-initial',
    profileId: 'smoke-profile',
    sourceText: SOURCE_SENTINEL,
    translatedText: '<script>alert("smoke")</script>',
    provider: 'echo',
    confidence: 0.98,
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  }));

  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    overlayState,
    activeProfileId: 'smoke-profile',
    runtimeStatus: {
      capture: { state: 'running', updatedAt: FIXED_TIME },
      ocr: { state: 'ok', code: 'OCR_ACCEPTED', updatedAt: FIXED_TIME },
      translation: {
        state: 'warning',
        code: 'PROVIDER_RATE_LIMITED',
        retryable: true,
        message: `retry after ${SECRET_SENTINEL}`,
        updatedAt: FIXED_TIME,
      },
    },
    clock: fixedClock,
  });

  let started;
  let appClient;
  let overlayClient;
  try {
    started = await api.start();
    assert.equal(started.bindAddress, '127.0.0.1');
    assert.match(started.overlayUrl, /^http:\/\/127\.0\.0\.1:\d+\/overlay$/);
    record(checks, 'server binds 127.0.0.1 on an ephemeral port');

    const health = await httpRequest({ port: started.port, path: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.parsed, {
      ok: true,
      version: SMOKE_VERSION,
      port: started.port,
      bindAddress: '127.0.0.1',
    });
    record(checks, 'GET /health reports selected localhost port');

    const status = await httpRequest({ port: started.port, path: '/api/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.parsed.backend, 'ready');
    assert.equal(status.parsed.overlayUrl, started.overlayUrl);
    assert.equal(status.parsed.translation.retryable, true);
    assert.equal(status.parsed.lastSubtitle.id, 'smoke-initial');
    assert.equal(Object.hasOwn(status.parsed.lastSubtitle, 'sourceText'), false);
    assertNoSensitivePayload(status.parsed, 'GET /api/status');
    record(checks, 'GET /api/status returns sanitized AppStatus');

    const overlay = await httpRequest({ port: started.port, path: '/overlay' });
    assert.equal(overlay.statusCode, 200);
    assert.match(overlay.headers['content-type'], /text\/html/);
    assert.equal(overlay.headers['cache-control'], 'no-store');
    assert.match(overlay.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(overlay.body.includes('&lt;script&gt;alert(&quot;smoke&quot;)&lt;&#x2F;script&gt;'));
    assert.equal(overlay.body.includes('<script>alert("smoke")</script>'), false);
    assert.equal(/<script[^>]+\bsrc=/i.test(overlay.body), false);
    assert.equal(/<link\b/i.test(overlay.body), false);
    assertNoSensitivePayload(overlay.body, 'GET /overlay');
    record(checks, 'GET /overlay serves self-contained privacy-safe OBS HTML');

    for (const wsPath of ['/ws/app', '/ws/overlay']) {
      const rejected = await httpRequest({ port: started.port, path: wsPath });
      assert.equal(rejected.statusCode, 426);
      assert.deepEqual(rejected.parsed, {
        error: {
          code: 'WS_REJECTED',
          message: 'WebSocket upgrade required',
          retryable: true,
        },
      });
      assertNoSensitivePayload(rejected.parsed, `GET ${wsPath}`);
    }
    record(checks, 'non-upgrade websocket paths return retryable WS_REJECTED');

    appClient = await connectWebSocketClient({
      port: started.port,
      path: '/ws/app',
      origin: `http://127.0.0.1:${started.port}`,
    });
    const appSnapshot = await appClient.waitForJson((message) => message.type === 'status');
    assert.equal(appSnapshot.status.overlayClients, 0);
    assert.equal(appSnapshot.status.lastSubtitle.id, 'smoke-initial');
    assert.equal(Object.hasOwn(appSnapshot.status.lastSubtitle, 'sourceText'), false);
    assertNoSensitivePayload(appSnapshot, 'WS /ws/app snapshot');
    record(checks, 'WS /ws/app sends sanitized AppStatus snapshot');

    overlayClient = await connectWebSocketClient({
      port: started.port,
      path: '/ws/overlay',
      origin: `http://127.0.0.1:${started.port}`,
    });
    const overlayReplay = await overlayClient.waitForJson((message) => message.type === 'subtitle');
    assert.equal(overlayReplay.replay, true);
    assert.equal(overlayReplay.frame.id, 'smoke-initial');
    assert.equal(Object.hasOwn(overlayReplay.frame, 'sourceText'), false);
    assertNoSensitivePayload(overlayReplay, 'WS /ws/overlay replay');
    record(checks, 'WS /ws/overlay replays latest sanitized subtitle');

    const overlayConnected = await appClient.waitForJson(
      (message) => message.type === 'status' && message.status.overlayClients === 1,
    );
    assert.equal(overlayConnected.status.overlayClients, 1);
    assertNoSensitivePayload(overlayConnected, 'WS /ws/app overlay client count');
    record(checks, 'WS /ws/app broadcasts overlay client count');

    overlayState.publishFrame(createSubtitleFrame({
      id: 'smoke-live',
      profileId: 'smoke-profile',
      translatedText: 'Stream ready subtitle',
      provider: 'echo',
      confidence: 0.99,
      createdAt: FIXED_TIME,
      displayMs: 7000,
      themeId: 'classic_subtitle',
    }));
    const overlayLive = await overlayClient.waitForJson(
      (message) => message.type === 'subtitle' && message.frame.id === 'smoke-live',
    );
    const appLive = await appClient.waitForJson(
      (message) => message.type === 'status' &&
        message.status.lastSubtitle &&
        message.status.lastSubtitle.id === 'smoke-live',
    );
    assert.equal(overlayLive.replay, false);
    assert.equal(appLive.status.lastSubtitle.escapedText, 'Stream ready subtitle');
    assertNoSensitivePayload(overlayLive, 'WS /ws/overlay live update');
    assertNoSensitivePayload(appLive, 'WS /ws/app live update');
    record(checks, 'OverlayState publishFrame fans out to overlay and app streams');

    overlayState.clearFrame();
    const overlayClear = await overlayClient.waitForJson((message) => message.type === 'clear');
    const appClear = await appClient.waitForJson(
      (message) => message.type === 'status' && !Object.hasOwn(message.status, 'lastSubtitle'),
    );
    assert.deepEqual(overlayClear, { type: 'clear', frame: null });
    assert.equal(Object.hasOwn(appClear.status, 'lastSubtitle'), false);
    assertNoSensitivePayload(overlayClear, 'WS /ws/overlay clear');
    assertNoSensitivePayload(appClear, 'WS /ws/app clear');
    record(checks, 'OverlayState clearFrame fans out to overlay and app streams');

    return Object.freeze({
      ok: true,
      command: 'npm run smoke:server',
      bindAddress: started.bindAddress,
      port: started.port,
      overlayUrl: started.overlayUrl,
      checks,
    });
  } finally {
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
        ? redactSecrets(error.message)
        : 'Smoke failed';
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:server',
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
