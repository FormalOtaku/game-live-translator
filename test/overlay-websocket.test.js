'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const { createSubtitleFrame, OverlayState } = require('../src/core/subtitle-state');
const { createLocalApiServer } = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:30:00.000Z';

function fixedClock() {
  return FIXED_TIME;
}

function requestJson({ port, path, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, parsed: body ? JSON.parse(body) : null });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function encodeClientFrame(opcode, payload = Buffer.alloc(0)) {
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

    const payload = buffer.subarray(cursor, cursor + length);
    cursor += length;
    frames.push({ opcode, payload });
    offset = cursor;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

function createWaitQueue() {
  const items = [];
  const waiters = [];

  function push(item) {
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(item));
    if (waiterIndex !== -1) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(item);
      return;
    }
    items.push(item);
  }

  function wait(predicate = () => true, timeoutMs = 1000) {
    const itemIndex = items.findIndex(predicate);
    if (itemIndex !== -1) {
      const [item] = items.splice(itemIndex, 1);
      return Promise.resolve(item);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (waiterIndex !== -1) waiters.splice(waiterIndex, 1);
        reject(new Error('Timed out waiting for WebSocket frame'));
      }, timeoutMs);
      waiters.push({ predicate, resolve, timer });
    });
  }

  return { push, wait };
}

function connectOverlaySocket({ port, path = '/ws/overlay', origin }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const messages = createWaitQueue();
    const pongs = createWaitQueue();
    const key = crypto.randomBytes(16).toString('base64');
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let settled = false;

    function fail(error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }

    const client = {
      socket,
      waitForJson: (predicate, timeoutMs) => messages.wait(predicate, timeoutMs),
      waitForPong: (timeoutMs) => pongs.wait(() => true, timeoutMs),
      sendText(value) {
        socket.write(encodeClientFrame(0x1, Buffer.from(value, 'utf8')));
      },
      sendPing(value = 'ping') {
        socket.write(encodeClientFrame(0x9, Buffer.from(value, 'utf8')));
      },
      close() {
        return new Promise((done) => {
          if (socket.destroyed) {
            done();
            return;
          }
          socket.once('close', done);
          socket.write(encodeClientFrame(0x8, Buffer.alloc(0)));
          socket.end();
        });
      },
    };

    function handleFrames(chunk) {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      const parsed = parseServerFrames(frameBuffer);
      frameBuffer = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x1) {
          messages.push(JSON.parse(frame.payload.toString('utf8')));
        } else if (frame.opcode === 0xA) {
          pongs.push(frame.payload.toString('utf8'));
        }
      }
    }

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
      if (!settled) {
        handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
        const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          fail(new Error(header));
          return;
        }
        settled = true;
        resolve(client);
        const remaining = handshakeBuffer.subarray(headerEnd + 4);
        if (remaining.length > 0) handleFrames(remaining);
        return;
      }
      handleFrames(chunk);
    });
    socket.on('error', fail);
  });
}

function requestRawUpgrade({ port, path = '/ws/overlay', headers = [] }) {
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

function waitForCondition(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    async function tick() {
      try {
        const result = await check();
        if (result) {
          resolve(result);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 20);
    }
    tick();
  });
}

test('GET /ws/overlay without upgrade returns canonical WS_REJECTED ApiError', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();

  try {
    const response = await requestJson({ port: started.port, path: '/ws/overlay' });

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

test('overlay websocket replays latest sanitized subtitle and tracks client counters', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  overlayState.publishFrame(createSubtitleFrame({
    id: 'subtitle-replay',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: '<script>alert("x")</script>',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  }));
  const api = createLocalApiServer({ preferredPort: 0, overlayState, clock: fixedClock });
  const started = await api.start();
  let client;

  try {
    client = await connectOverlaySocket({
      port: started.port,
      origin: `http://127.0.0.1:${started.port}`,
    });
    const replay = await client.waitForJson((message) => message.type === 'subtitle');

    assert.equal(replay.replay, true);
    assert.equal(replay.frame.id, 'subtitle-replay');
    assert.equal(replay.frame.escapedText, '&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;');
    assert.equal(Object.hasOwn(replay.frame, 'sourceText'), false);
    assert.equal(JSON.stringify(replay).includes('秘密の原文'), false);

    const connected = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(connected.parsed.overlayClients, 1);

    await client.close();
    await waitForCondition(async () => {
      const response = await requestJson({ port: started.port, path: '/api/status' });
      return response.parsed.overlayClients === 0;
    });
  } finally {
    if (client !== undefined && !client.socket.destroyed) await client.close();
    await api.stop();
  }
});

test('overlay websocket rejects disallowed origins before subscribing', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();

  try {
    const response = await requestRawUpgrade({
      port: started.port,
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
    const status = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(status.parsed.overlayClients, 0);
  } finally {
    await api.stop();
  }
});

test('overlay websocket broadcasts publishFrame and clearFrame to connected clients', async () => {
  const overlayState = new OverlayState({ clock: fixedClock });
  const api = createLocalApiServer({ preferredPort: 0, overlayState, clock: fixedClock });
  const started = await api.start();
  let first;
  let second;

  try {
    first = await connectOverlaySocket({ port: started.port });
    second = await connectOverlaySocket({ port: started.port });

    overlayState.publishFrame(createSubtitleFrame({
      id: 'subtitle-live',
      profileId: 'profile-1',
      sourceText: '原文',
      translatedText: '</script><b>Live line</b>',
      provider: 'echo',
      createdAt: FIXED_TIME,
      displayMs: 7000,
      themeId: 'stream_box',
      includeSourceText: true,
    }));

    const firstLive = await first.waitForJson((message) => message.frame && message.frame.id === 'subtitle-live');
    const secondLive = await second.waitForJson((message) => message.frame && message.frame.id === 'subtitle-live');
    assert.equal(firstLive.replay, false);
    assert.equal(secondLive.frame.escapedText, '&lt;&#x2F;script&gt;&lt;b&gt;Live line&lt;&#x2F;b&gt;');
    assert.equal(JSON.stringify(firstLive).includes('原文'), false);

    overlayState.clearFrame();
    const firstClear = await first.waitForJson((message) => message.type === 'clear');
    const secondClear = await second.waitForJson((message) => message.type === 'clear');
    assert.deepEqual(firstClear, { type: 'clear', frame: null });
    assert.deepEqual(secondClear, { type: 'clear', frame: null });
  } finally {
    if (first !== undefined && !first.socket.destroyed) await first.close();
    if (second !== undefined && !second.socket.destroyed) await second.close();
    await api.stop();
  }
});

test('overlay websocket handles text ping and control ping without logging payloads', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();
  let client;

  try {
    client = await connectOverlaySocket({ port: started.port });
    client.sendText(JSON.stringify({ type: 'ping', secret: 'sk-ABCDEFGHIJKLMNOP1234' }));
    const pong = await client.waitForJson((message) => message.type === 'pong');
    assert.deepEqual(pong, { type: 'pong' });

    client.sendPing('probe');
    assert.equal(await client.waitForPong(), 'probe');
  } finally {
    if (client !== undefined && !client.socket.destroyed) await client.close();
    await api.stop();
  }
});

test('overlay websocket rejects oversized control frames and decrements counters once', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();
  let client;

  try {
    client = await connectOverlaySocket({ port: started.port });
    const connected = await requestJson({ port: started.port, path: '/api/status' });
    assert.equal(connected.parsed.overlayClients, 1);

    client.sendPing('x'.repeat(126));
    await new Promise((resolve) => {
      client.socket.once('close', resolve);
    });
    await waitForCondition(async () => {
      const response = await requestJson({ port: started.port, path: '/api/status' });
      return response.parsed.overlayClients === 0;
    });
  } finally {
    if (client !== undefined && !client.socket.destroyed) await client.close();
    await api.stop();
  }
});

test('overlay websocket rejects invalid upgrade requests', async () => {
  const api = createLocalApiServer({ preferredPort: 0, clock: fixedClock });
  const started = await api.start();

  try {
    const response = await requestRawUpgrade({
      port: started.port,
      headers: [
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Version: 12',
      ],
    });

    assert.match(response, /^HTTP\/1\.1 400 Bad Request/);
    assert.match(response, /"code":"WS_REJECTED"/);
    assert.match(response, /"retryable":true/);
  } finally {
    await api.stop();
  }
});
