'use strict';

const crypto = require('node:crypto');
const { OverlayState, sanitizeSubtitleForOverlay } = require('../core/subtitle-state');

const DEFAULT_OVERLAY_WS_PATH = '/ws/overlay';
const DEFAULT_APP_WS_PATH = '/ws/app';
const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWebSocketPath(value, fallback = DEFAULT_OVERLAY_WS_PATH) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  return trimmed;
}

function isOverlayState(value) {
  return (
    isObject(value) &&
    typeof value.snapshot === 'function' &&
    typeof value.connectClient === 'function' &&
    typeof value.disconnectClient === 'function'
  );
}

function normalizeOverlayState(value, options = {}) {
  return isOverlayState(value) ? value : new OverlayState({ clock: options.clock });
}

function safeFrameForWire(frame) {
  if (!isObject(frame)) return null;
  // Re-sanitize at the wire boundary even though OverlayState stores sanitized frames.
  const sanitized = sanitizeSubtitleForOverlay(frame);
  const wireFrame = {
    id: sanitized.id,
    profileId: sanitized.profileId,
    translatedText: sanitized.translatedText,
    escapedText: sanitized.escapedText,
    provider: sanitized.provider,
    createdAt: sanitized.createdAt,
    displayMs: sanitized.displayMs,
    themeId: sanitized.themeId,
  };
  if (sanitized.confidence !== undefined) wireFrame.confidence = sanitized.confidence;
  return Object.freeze(wireFrame);
}

function buildSubtitleMessage(frame, options = {}) {
  const wireFrame = safeFrameForWire(frame);
  if (wireFrame === null) {
    return Object.freeze({ type: 'clear', frame: null });
  }
  return Object.freeze({
    type: 'subtitle',
    replay: options.replay === true,
    frame: wireFrame,
  });
}

function buildClearMessage() {
  return Object.freeze({ type: 'clear', frame: null });
}

function encodeWebSocketFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let headerLength = 2;
  if (body.length >= 126 && body.length <= 0xffff) headerLength = 4;
  if (body.length > 0xffff) headerLength = 10;

  const frame = Buffer.alloc(headerLength + body.length);
  frame[0] = 0x80 | opcode;
  if (body.length < 126) {
    frame[1] = body.length;
  } else if (body.length <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(body.length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(body.length), 2);
  }
  body.copy(frame, headerLength);
  return frame;
}

function encodeJsonFrame(payload) {
  return encodeWebSocketFrame(0x1, Buffer.from(JSON.stringify(payload), 'utf8'));
}

function encodeCloseFrame(code = 1000) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return encodeWebSocketFrame(0x8, payload);
}

function socketHeaderIncludes(value, token) {
  if (typeof value !== 'string') return false;
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .includes(token);
}

function isValidWebSocketKey(value) {
  if (typeof value !== 'string') return false;
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch (_) {
    return false;
  }
  return decoded.length === 16;
}

function websocketAccept(key) {
  return crypto
    .createHash('sha1')
    .update(`${key}${WS_GUID}`)
    .digest('base64');
}

function statusText(statusCode) {
  if (statusCode === 403) return 'Forbidden';
  if (statusCode === 404) return 'Not Found';
  return 'Bad Request';
}

function rejectUpgrade(socket, statusCode, code, message) {
  const body = JSON.stringify({
    error: {
      code,
      message,
      retryable: code === 'WS_REJECTED',
    },
  });
  socket.end([
    `HTTP/1.1 ${statusCode} ${statusText(statusCode)}`,
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n'));
}

function validateUpgradeRequest(req) {
  if (req.method !== 'GET') return false;
  if (!socketHeaderIncludes(req.headers.connection, 'upgrade')) return false;
  if (typeof req.headers.upgrade !== 'string' || req.headers.upgrade.toLowerCase() !== 'websocket') return false;
  if (req.headers['sec-websocket-version'] !== '13') return false;
  return isValidWebSocketKey(req.headers['sec-websocket-key']);
}

function parseClientFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) === 0x80;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      const bigLength = buffer.readBigUInt64BE(cursor);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('WebSocket frame too large');
      }
      length = Number(bigLength);
      cursor += 8;
    }

    if (opcode >= 0x8 && length > 125) {
      throw new Error('WebSocket control frame too large');
    }
    if (!masked) throw new Error('Client frame must be masked');
    if (!fin || opcode === 0x0 || opcode === 0x2) throw new Error('Unsupported WebSocket frame');
    if (length > MAX_CLIENT_MESSAGE_BYTES) throw new Error('Client frame too large');
    if (buffer.length - cursor < 4 + length) break;

    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    const payload = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      payload[index] = buffer[cursor + index] ^ mask[index % 4];
    }
    cursor += length;
    frames.push({ opcode, payload });
    offset = cursor;
  }

  return {
    frames,
    remaining: buffer.subarray(offset),
  };
}

function createWebSocketClientHub(options = {}) {
  const path = normalizeWebSocketPath(options.path);
  const isOriginAllowed = typeof options.isOriginAllowed === 'function'
    ? options.isOriginAllowed
    : () => true;
  const onAccept = typeof options.onAccept === 'function' ? options.onAccept : null;
  const onText = typeof options.onText === 'function' ? options.onText : null;
  const onClose = typeof options.onClose === 'function' ? options.onClose : null;
  const clients = new Set();

  function sendFrame(client, frame) {
    if (client.closed || client.socket.destroyed) return false;
    try {
      client.socket.write(frame);
      return true;
    } catch (_) {
      closeClient(client, 1011);
      return false;
    }
  }

  function sendJson(client, payload) {
    return sendFrame(client, encodeJsonFrame(payload));
  }

  function closeClient(client, code = 1000) {
    if (client.closed) return;
    client.closed = true;
    try {
      if (!client.socket.destroyed) {
        client.socket.write(encodeCloseFrame(code));
        client.socket.end();
      }
    } catch (_) {
      client.socket.destroy();
    }
    removeClient(client);
  }

  function removeClient(client) {
    if (client.removed) return;
    client.removed = true;
    clients.delete(client);
    if (onClose !== null) {
      try {
        onClose(client);
      } catch (_) {
        // Subscriber failures must not cascade.
      }
    }
  }

  function broadcast(payload) {
    const frame = encodeJsonFrame(payload);
    for (const client of [...clients]) {
      sendFrame(client, frame);
    }
  }

  function handleClientText(client, payload) {
    const message = payload.toString('utf8').trim();
    if (message === '' || message === 'ping') {
      sendJson(client, Object.freeze({ type: 'pong' }));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (_) {
      if (onText !== null) onText(client, message, null);
      return;
    }
    if (isObject(parsed) && parsed.type === 'ping') {
      sendJson(client, Object.freeze({ type: 'pong' }));
      return;
    }
    if (onText !== null) onText(client, message, parsed);
  }

  function handleClientFrame(client, frame) {
    if (frame.opcode === 0x8) {
      closeClient(client, 1000);
      return;
    }
    if (frame.opcode === 0x9) {
      sendFrame(client, encodeWebSocketFrame(0xA, frame.payload));
      return;
    }
    if (frame.opcode === 0xA) {
      return;
    }
    if (frame.opcode === 0x1) {
      handleClientText(client, frame.payload);
      return;
    }
    closeClient(client, 1003);
  }

  function handleClientData(client, chunk) {
    if (client.closed) return;
    client.buffer = Buffer.concat([client.buffer, chunk]);
    try {
      const parsed = parseClientFrames(client.buffer);
      client.buffer = parsed.remaining;
      for (const frame of parsed.frames) {
        handleClientFrame(client, frame);
        if (client.closed) return;
      }
    } catch (_) {
      closeClient(client, 1002);
    }
  }

  function acceptClient(req, socket, head) {
    const accept = websocketAccept(req.headers['sec-websocket-key']);
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));

    const client = {
      socket,
      buffer: Buffer.alloc(0),
      closed: false,
      removed: false,
      send(payload) {
        return sendJson(client, payload);
      },
      close(code = 1000) {
        closeClient(client, code);
      },
    };
    clients.add(client);

    socket.on('data', (chunk) => handleClientData(client, chunk));
    socket.on('close', () => removeClient(client));
    socket.on('end', () => removeClient(client));
    socket.on('error', () => removeClient(client));

    if (Buffer.isBuffer(head) && head.length > 0) {
      handleClientData(client, head);
    }
    if (onAccept !== null && !client.closed) {
      try {
        onAccept(client);
      } catch (_) {
        closeClient(client, 1011);
      }
    }
  }

  function handleUpgrade(req, socket, head) {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch (_) {
      rejectUpgrade(socket, 400, 'WS_REJECTED', 'Invalid WebSocket request URL');
      return;
    }
    if (pathname !== path) {
      rejectUpgrade(socket, 404, 'NOT_FOUND', 'Resource not found');
      return;
    }
    if (typeof req.headers.origin === 'string' && !isOriginAllowed(req.headers.origin)) {
      rejectUpgrade(socket, 403, 'WS_REJECTED', 'WebSocket origin rejected');
      return;
    }
    if (!validateUpgradeRequest(req)) {
      rejectUpgrade(socket, 400, 'WS_REJECTED', 'Invalid WebSocket upgrade request');
      return;
    }
    acceptClient(req, socket, head);
  }

  function close() {
    for (const client of [...clients]) {
      closeClient(client, 1001);
    }
  }

  return Object.freeze({
    close,
    handleUpgrade,
    broadcast,
    path,
    get clientCount() {
      return clients.size;
    },
  });
}

function createOverlayWebSocketEndpoint(options = {}) {
  const overlayState = normalizeOverlayState(options.overlayState, { clock: options.clock });
  let attachedServer = null;
  let unsubscribe = null;

  const hub = createWebSocketClientHub({
    path: normalizeWebSocketPath(options.path, DEFAULT_OVERLAY_WS_PATH),
    isOriginAllowed: options.isOriginAllowed,
    onAccept(client) {
      overlayState.connectClient();
      const snapshot = overlayState.snapshot();
      if (isObject(snapshot.lastSubtitle)) {
        client.send(buildSubtitleMessage(snapshot.lastSubtitle, { replay: true }));
      }
    },
    onClose() {
      overlayState.disconnectClient();
    },
  });

  function handleOverlayEvent(event) {
    if (!isObject(event)) return;
    if (event.type === 'frame' && isObject(event.snapshot) && isObject(event.snapshot.lastSubtitle)) {
      hub.broadcast(buildSubtitleMessage(event.snapshot.lastSubtitle, { replay: false }));
      return;
    }
    if (event.type === 'clear') {
      hub.broadcast(buildClearMessage());
    }
  }

  function start() {
    if (unsubscribe === null && typeof overlayState.subscribe === 'function') {
      unsubscribe = overlayState.subscribe(handleOverlayEvent);
    }
  }

  function attach(server) {
    attachedServer = server;
    attachedServer.on('upgrade', hub.handleUpgrade);
    start();
  }

  function close() {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    if (attachedServer !== null) {
      attachedServer.off('upgrade', hub.handleUpgrade);
      attachedServer = null;
    }
    hub.close();
  }

  return Object.freeze({
    attach,
    start,
    close,
    handleUpgrade: hub.handleUpgrade,
    path: hub.path,
    overlayState,
    get clientCount() {
      return hub.clientCount;
    },
  });
}

function createAppStatusWebSocketEndpoint(options = {}) {
  const buildSnapshot = typeof options.buildSnapshot === 'function'
    ? options.buildSnapshot
    : () => null;
  const overlayState = isOverlayState(options.overlayState) ? options.overlayState : null;
  let attachedServer = null;
  let unsubscribe = null;

  function makeMessage() {
    const status = buildSnapshot();
    return Object.freeze({
      type: 'status',
      status: status === undefined ? null : status,
    });
  }

  const hub = createWebSocketClientHub({
    path: normalizeWebSocketPath(options.path, DEFAULT_APP_WS_PATH),
    isOriginAllowed: options.isOriginAllowed,
    onAccept(client) {
      client.send(makeMessage());
    },
  });

  function publish() {
    hub.broadcast(makeMessage());
  }

  function start() {
    if (unsubscribe === null && overlayState !== null && typeof overlayState.subscribe === 'function') {
      unsubscribe = overlayState.subscribe(() => publish());
    }
  }

  function attach(server) {
    attachedServer = server;
    attachedServer.on('upgrade', hub.handleUpgrade);
    start();
  }

  function close() {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    if (attachedServer !== null) {
      attachedServer.off('upgrade', hub.handleUpgrade);
      attachedServer = null;
    }
    hub.close();
  }

  return Object.freeze({
    attach,
    start,
    close,
    handleUpgrade: hub.handleUpgrade,
    path: hub.path,
    publish,
    get clientCount() {
      return hub.clientCount;
    },
  });
}

module.exports = {
  DEFAULT_APP_WS_PATH,
  DEFAULT_OVERLAY_WS_PATH,
  MAX_CLIENT_MESSAGE_BYTES,
  buildClearMessage,
  buildSubtitleMessage,
  createAppStatusWebSocketEndpoint,
  createOverlayWebSocketEndpoint,
  createWebSocketClientHub,
  encodeJsonFrame,
  encodeWebSocketFrame,
  normalizeOverlayState,
  normalizeWebSocketPath,
  parseClientFrames,
  safeFrameForWire,
};
