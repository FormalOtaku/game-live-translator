#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const { ContractError, redactSecrets } = require('../src/contracts/security');
const { createSubtitleFrame, OverlayState } = require('../src/core/subtitle-state');
const {
  buildApiErrorFromContractError,
  createLocalApiServer,
} = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SMOKE_VERSION = 'backend-recovery-smoke-v1';
const PROFILE_ID = 'backend-recovery-profile';
const SUBTITLE_ID = 'backend-recovery-subtitle';
const SOURCE_SENTINEL = '再起動前の原文';
const TRANSLATED_TEXT = 'Recovered overlay subtitle';
const SECRET_SENTINEL = 'sk-BACKENDRECOVERYKEY1234';
const SCREENSHOT_SENTINEL = 'C:\\Users\\streamer\\Pictures\\backend-recovery-secret.png';
const REQUEST_TIMEOUT_MS = 4000;
const WS_UPGRADE_TIMEOUT_MS = 4000;
const WS_MESSAGE_TIMEOUT_MS = 3000;
const MAX_PORT_ATTEMPTS = 8;
const SURFACE_RETRY_ATTEMPTS = 4;
const SURFACE_RETRY_DELAY_MS = 75;

function fixedClock() {
  return FIXED_TIME;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    req.on('error', (error) => {
      const contextual = new Error(`HTTP ${method} ${path} failed: ${error.message}`);
      contextual.cause = error;
      reject(contextual);
    });
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
  assert.equal(serialized.includes(SOURCE_SENTINEL), false, `${label} leaked source text`);
  assert.equal(serialized.includes(SECRET_SENTINEL), false, `${label} leaked provider key`);
  assert.equal(serialized.includes(SCREENSHOT_SENTINEL), false, `${label} leaked screenshot path`);
  if (options.allowTranslatedText !== true) {
    assert.equal(serialized.includes(TRANSLATED_TEXT), false, `${label} leaked translated text`);
  }
}

function redactSmokeDiagnostic(value) {
  return redactSecrets(String(value))
    .replaceAll(SOURCE_SENTINEL, '[REDACTED_SOURCE_TEXT]')
    .replaceAll(TRANSLATED_TEXT, '[REDACTED_TRANSLATED_TEXT]')
    .replaceAll(SCREENSHOT_SENTINEL, '[REDACTED_SCREENSHOT_PATH]')
    .replace(/\s+at\s+\S+[^\n]*:\d+:\d+/g, ' [REDACTED_STACK_FRAME]');
}

function isTransientSurfaceError(error) {
  const message = String(error && error.message ? error.message : '');
  return (
    message.includes('socket hang up') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED') ||
    message.includes('timed out')
  );
}

function record(checks, name) {
  checks.push(name);
}

function recoveryRuntimeStatus() {
  return Object.freeze({
    capture: Object.freeze({
      state: 'ok',
      code: 'RECOVERY_CAPTURE_READY',
      updatedAt: FIXED_TIME,
    }),
    ocr: Object.freeze({
      state: 'ok',
      code: 'RECOVERY_OCR_READY',
      updatedAt: FIXED_TIME,
    }),
    translation: Object.freeze({
      state: 'ok',
      code: 'RECOVERY_TRANSLATION_READY',
      message: `backend recovery provider ready ${SECRET_SENTINEL}`,
      updatedAt: FIXED_TIME,
    }),
  });
}

function createRecoveryOverlayState(subtitleId = SUBTITLE_ID) {
  const overlayState = new OverlayState({ clock: fixedClock });
  overlayState.publishFrame(createSubtitleFrame({
    id: subtitleId,
    profileId: PROFILE_ID,
    sourceText: SOURCE_SENTINEL,
    translatedText: TRANSLATED_TEXT,
    provider: 'echo',
    confidence: 0.94,
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  }));
  return overlayState;
}

async function listenBlocker(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function closeServer(server) {
  if (server === undefined || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function reservePreferredPort() {
  const blocker = await listenBlocker(0);
  const { port } = blocker;
  await closeServer(blocker.server);
  return port;
}

async function listenBlockerWithFallbackRoom() {
  const maxPreferredPort = 65535 - MAX_PORT_ATTEMPTS;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const blocker = await listenBlocker(0);
    if (blocker.port <= maxPreferredPort) return blocker;
    await closeServer(blocker.server);
  }
  throw new Error('Could not reserve a preferred port with fallback room');
}

async function startBackend({ preferredPort, maxPortAttempts = MAX_PORT_ATTEMPTS, overlayState }) {
  const api = createLocalApiServer({
    preferredPort,
    maxPortAttempts,
    version: SMOKE_VERSION,
    overlayState,
    activeProfileId: PROFILE_ID,
    runtimeStatus: recoveryRuntimeStatus,
    clock: fixedClock,
  });
  const started = await api.start();
  return { api, started };
}

async function stopBackend(api) {
  if (api === undefined) return;
  await api.stop();
}

async function surfaceRequest(label, request) {
  let lastError = null;
  for (let attempt = 1; attempt <= SURFACE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await httpRequest(request);
    } catch (error) {
      lastError = error;
      if (attempt === SURFACE_RETRY_ATTEMPTS || !isTransientSurfaceError(error)) break;
      await sleep(SURFACE_RETRY_DELAY_MS * attempt);
    }
  }
  const contextual = new Error(`${label}: ${lastError.message}`);
  contextual.cause = lastError;
  throw contextual;
}

async function verifyBackendSurfaces({ started, expectedSubtitleId, label }) {
  let overlayClient;
  try {
    const health = await surfaceRequest(label, { port: started.port, path: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.parsed, {
      ok: true,
      version: SMOKE_VERSION,
      port: started.port,
      bindAddress: '127.0.0.1',
    });
    assertNoSensitivePayload(health.parsed, 'GET /health');

    const status = await surfaceRequest(label, { port: started.port, path: '/api/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.parsed.backend, 'ready');
    assert.equal(status.parsed.activeProfileId, PROFILE_ID);
    assert.equal(status.parsed.overlayUrl, started.overlayUrl);
    assert.equal(status.parsed.translation.message.includes(SECRET_SENTINEL), false);
    assert.equal(status.parsed.translation.message.includes('[REDACTED]'), true);
    assert.equal(status.parsed.lastSubtitle.id, expectedSubtitleId);
    assert.equal(status.parsed.lastSubtitle.escapedText, TRANSLATED_TEXT);
    assert.equal(Object.hasOwn(status.parsed.lastSubtitle, 'sourceText'), false);
    assertNoSensitivePayload(status.parsed, 'GET /api/status', { allowTranslatedText: true });

    const overlay = await surfaceRequest(label, { port: started.port, path: '/overlay' });
    assert.equal(overlay.statusCode, 200);
    assert.match(overlay.headers['content-type'], /text\/html/);
    assert.equal(overlay.headers['cache-control'], 'no-store');
    assert.match(overlay.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(overlay.body.includes(TRANSLATED_TEXT));
    assert.equal(/<script[^>]+\bsrc=/i.test(overlay.body), false);
    assert.equal(/<link\b/i.test(overlay.body), false);
    assert.equal(/<img\b/i.test(overlay.body), false);
    assertNoSensitivePayload(overlay.body, 'GET /overlay', { allowTranslatedText: true });

    overlayClient = await connectWebSocketClient({
      port: started.port,
      path: '/ws/overlay',
      origin: started.origin,
    });
    const overlayReplay = await overlayClient.waitForJson(
      (message) => message.type === 'subtitle' && message.frame.id === expectedSubtitleId,
    );
    assert.equal(overlayReplay.replay, true);
    assert.equal(overlayReplay.frame.escapedText, TRANSLATED_TEXT);
    assert.equal(Object.hasOwn(overlayReplay.frame, 'sourceText'), false);
    assertNoSensitivePayload(overlayReplay, 'WS /ws/overlay replay', { allowTranslatedText: true });

    return Object.freeze({
      overlayHtmlSha256: sha256Hex(overlay.body),
      replayFrameEscapedTextSha256: sha256Hex(overlayReplay.frame.escapedText),
    });
  } finally {
    if (overlayClient !== undefined && !overlayClient.socket.destroyed) await overlayClient.close();
  }
}

async function runSmoke() {
  const checks = [];
  const preferredPort = await reservePreferredPort();
  const evidence = {};

  const firstOverlayState = createRecoveryOverlayState(`${SUBTITLE_ID}-first`);
  const first = await startBackend({ preferredPort, overlayState: firstOverlayState });
  try {
    assert.equal(first.started.bindAddress, '127.0.0.1');
    assert.equal(first.started.port, preferredPort);
    assert.equal(first.started.overlayUrl, `http://127.0.0.1:${preferredPort}/overlay`);
    record(checks, 'explicit preferred port starts on localhost');
    const firstEvidence = await verifyBackendSurfaces({
      started: first.started,
      expectedSubtitleId: `${SUBTITLE_ID}-first`,
      label: 'initial backend',
    });
    evidence.initialOverlayHtmlSha256 = firstEvidence.overlayHtmlSha256;
    record(checks, 'initial backend serves status overlay and websocket replay');
  } finally {
    await stopBackend(first.api);
  }

  const restartedOverlayState = createRecoveryOverlayState(SUBTITLE_ID);
  const restarted = await startBackend({ preferredPort, overlayState: restartedOverlayState });
  try {
    assert.equal(restarted.started.port, preferredPort);
    record(checks, 'restart reuses preferred localhost port');
    const restartedEvidence = await verifyBackendSurfaces({
      started: restarted.started,
      expectedSubtitleId: SUBTITLE_ID,
      label: 'restarted backend',
    });
    evidence.restartedOverlayHtmlSha256 = restartedEvidence.overlayHtmlSha256;
    evidence.restartedReplayFrameEscapedTextSha256 = restartedEvidence.replayFrameEscapedTextSha256;
    record(checks, 'restarted backend reports trusted status and overlay HTML');
    record(checks, 'restarted overlay websocket replays sanitized subtitle');
  } finally {
    await stopBackend(restarted.api);
  }

  const fallbackBlocker = await listenBlockerWithFallbackRoom();
  let fallback;
  try {
    fallback = await startBackend({
      preferredPort: fallbackBlocker.port,
      maxPortAttempts: MAX_PORT_ATTEMPTS,
      overlayState: createRecoveryOverlayState(`${SUBTITLE_ID}-fallback`),
    });
    assert.notEqual(fallback.started.port, fallbackBlocker.port);
    assert.ok(fallback.started.port > fallbackBlocker.port);
    assert.ok(fallback.started.port <= fallbackBlocker.port + MAX_PORT_ATTEMPTS - 1);
    record(checks, 'occupied preferred port falls back to later localhost port');
    const fallbackEvidence = await verifyBackendSurfaces({
      started: fallback.started,
      expectedSubtitleId: `${SUBTITLE_ID}-fallback`,
      label: 'fallback backend',
    });
    evidence.fallbackOverlayHtmlSha256 = fallbackEvidence.overlayHtmlSha256;
    record(checks, 'fallback backend reports selected localhost port');
  } finally {
    await stopBackend(fallback && fallback.api);
    await closeServer(fallbackBlocker.server);
  }

  const exhaustedBlocker = await listenBlockerWithFallbackRoom();
  let portUnavailable;
  try {
    const api = createLocalApiServer({
      preferredPort: exhaustedBlocker.port,
      maxPortAttempts: 1,
      version: SMOKE_VERSION,
      overlayState: createRecoveryOverlayState(`${SUBTITLE_ID}-unavailable`),
      activeProfileId: PROFILE_ID,
      runtimeStatus: recoveryRuntimeStatus,
      clock: fixedClock,
    });
    try {
      await api.start();
      assert.fail('expected PORT_UNAVAILABLE');
    } catch (error) {
      assert.ok(error instanceof ContractError);
      assert.equal(error.code, 'PORT_UNAVAILABLE');
      const apiError = buildApiErrorFromContractError(error);
      assert.equal(apiError.error.code, 'PORT_UNAVAILABLE');
      assert.equal(apiError.error.retryable, true);
      assert.equal(apiError.error.details.bindAddress, '127.0.0.1');
      assert.equal(apiError.error.details.preferredPort, exhaustedBlocker.port);
      assert.equal(apiError.error.details.maxPortAttempts, 1);
      portUnavailable = Object.freeze({
        code: apiError.error.code,
        retryable: apiError.error.retryable,
        details: Object.freeze({
          bindAddress: apiError.error.details.bindAddress,
          preferredPort: apiError.error.details.preferredPort,
          maxPortAttempts: apiError.error.details.maxPortAttempts,
        }),
      });
    } finally {
      await stopBackend(api);
    }
    record(checks, 'exhausted port attempts return retryable PORT_UNAVAILABLE');
  } finally {
    await closeServer(exhaustedBlocker.server);
  }

  const recovered = await startBackend({
    preferredPort: exhaustedBlocker.port,
    overlayState: createRecoveryOverlayState(`${SUBTITLE_ID}-recovered`),
  });
  try {
    assert.equal(recovered.started.port, exhaustedBlocker.port);
    const recoveredEvidence = await verifyBackendSurfaces({
      started: recovered.started,
      expectedSubtitleId: `${SUBTITLE_ID}-recovered`,
      label: 'recovered backend',
    });
    evidence.recoveredOverlayHtmlSha256 = recoveredEvidence.overlayHtmlSha256;
    record(checks, 'released preferred port starts after conflict clears');
  } finally {
    await stopBackend(recovered.api);
  }

  const stdoutSummary = Object.freeze({
    ok: true,
    command: 'npm run smoke:backend-recovery',
    bindAddress: '127.0.0.1',
    preferredPort,
    restartedPort: preferredPort,
    fallback: Object.freeze({
      preferredPort: fallbackBlocker.port,
      selectedPort: fallback.started.port,
      maxPortAttempts: MAX_PORT_ATTEMPTS,
    }),
    portUnavailable,
    recoveredPort: exhaustedBlocker.port,
    checks,
    evidence: Object.freeze(evidence),
  });
  assertNoSensitivePayload(stdoutSummary, 'stdout summary');
  return stdoutSummary;
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
      const failure = {
        ok: false,
        command: 'npm run smoke:backend-recovery',
        error: {
          name: error && error.name ? error.name : 'Error',
          message,
        },
      };
      try {
        assertNoSensitivePayload(failure, 'stderr failure');
        process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
      } catch (_) {
        process.stderr.write(`${JSON.stringify({
          ok: false,
          command: 'npm run smoke:backend-recovery',
          error: {
            name: 'Error',
            message: 'Smoke failed after diagnostic redaction',
          },
        }, null, 2)}\n`);
      }
      process.exitCode = 1;
    });
}

module.exports = {
  runSmoke,
};
