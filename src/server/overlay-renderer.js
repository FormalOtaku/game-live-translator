'use strict';

const { BUILTIN_THEME_IDS } = require('../contracts/security');
const { sanitizeSubtitleForOverlay } = require('../core/subtitle-state');

const DEFAULT_OVERLAY_THEME_ID = 'classic_subtitle';
const DEFAULT_MAX_LINES = 3;
const DEFAULT_STATUS_PATH = '/api/status';
const DEFAULT_WS_PATH = '/ws/overlay';
const DEFAULT_DISPLAY_MS = 7000;

const OVERLAY_CSP = [
  "default-src 'none'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const THEME_TOKENS = Object.freeze({
  classic_subtitle: Object.freeze({
    anchor: 'end center',
    fontSize: 'clamp(30px, 4.8vw, 78px)',
    fontWeight: '800',
    color: '#ffffff',
    background: 'transparent',
    stroke: '0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 5px 12px rgba(0,0,0,0.82)',
    padding: '0',
    radius: '0',
    maxWidth: 'min(88vw, 1680px)',
  }),
  stream_box: Object.freeze({
    anchor: 'end center',
    fontSize: 'clamp(28px, 4.2vw, 68px)',
    fontWeight: '750',
    color: '#f8fbff',
    background: 'rgba(5, 12, 24, 0.72)',
    stroke: '0 2px 7px rgba(0,0,0,0.95)',
    padding: '0.32em 0.56em',
    radius: '8px',
    maxWidth: 'min(84vw, 1500px)',
  }),
  minimal: Object.freeze({
    anchor: 'end center',
    fontSize: 'clamp(26px, 3.8vw, 60px)',
    fontWeight: '650',
    color: '#ffffff',
    background: 'transparent',
    stroke: '0 3px 10px rgba(0,0,0,0.9)',
    padding: '0',
    radius: '0',
    maxWidth: 'min(82vw, 1360px)',
  }),
});

function clampMaxLines(value) {
  if (!Number.isInteger(value)) return DEFAULT_MAX_LINES;
  if (value < 1) return 1;
  if (value > 3) return 3;
  return value;
}

function normalizeThemeId(value) {
  return BUILTIN_THEME_IDS.includes(value) ? value : DEFAULT_OVERLAY_THEME_ID;
}

function normalizePath(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  return trimmed;
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function sanitizeInitialFrame(frame) {
  if (frame === null || frame === undefined) return null;
  return sanitizeSubtitleForOverlay(frame);
}

function displayMsFromFrame(frame) {
  if (frame === null || !Number.isFinite(frame.displayMs) || frame.displayMs <= 0) {
    return DEFAULT_DISPLAY_MS;
  }
  return frame.displayMs;
}

function renderOverlayStyle(themeId, maxLines) {
  const theme = THEME_TOKENS[themeId] || THEME_TOKENS[DEFAULT_OVERLAY_THEME_ID];
  return `
:root {
  --glt-lines: ${maxLines};
  --glt-font-size: ${theme.fontSize};
  --glt-font-weight: ${theme.fontWeight};
  --glt-color: ${theme.color};
  --glt-background: ${theme.background};
  --glt-stroke: ${theme.stroke};
  --glt-padding: ${theme.padding};
  --glt-radius: ${theme.radius};
  --glt-max-width: ${theme.maxWidth};
}
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}
body {
  font-family: "Segoe UI", "Arial", sans-serif;
  pointer-events: none;
  user-select: none;
}
#glt-overlay-root {
  position: fixed;
  inset: 0;
  display: grid;
  align-items: end;
  justify-items: center;
  box-sizing: border-box;
  padding: min(5vh, 64px) min(5vw, 96px);
}
#glt-subtitle-frame {
  max-width: var(--glt-max-width);
  padding: var(--glt-padding);
  border-radius: var(--glt-radius);
  background: var(--glt-background);
  opacity: 1;
  transform: translateY(0);
  transition: opacity 150ms ease, transform 150ms ease;
}
#glt-subtitle-frame[hidden] {
  display: block;
  opacity: 0;
  transform: translateY(0.35em);
}
#glt-subtitle-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--glt-lines);
  overflow: hidden;
  color: var(--glt-color);
  font-size: var(--glt-font-size);
  font-weight: var(--glt-font-weight);
  line-height: 1.18;
  letter-spacing: 0;
  text-align: center;
  text-wrap: balance;
  overflow-wrap: anywhere;
  word-break: keep-all;
  text-shadow: var(--glt-stroke);
}
@media (prefers-reduced-motion: reduce) {
  #glt-subtitle-frame {
    transition: none;
  }
}
`.trim();
}

function renderOverlayScript(config) {
  return `
(function () {
  'use strict';
  var config = ${safeJsonForScript(config)};
  var frame = document.getElementById('glt-subtitle-frame');
  var text = document.getElementById('glt-subtitle-text');
  var clearTimer = null;
  var retryTimer = null;
  var retryDelay = 300;
  var maxRetryDelay = 5000;

  function setState(state) {
    document.documentElement.setAttribute('data-overlay-state', state);
  }

  function clearSubtitle() {
    if (clearTimer !== null) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
    text.textContent = '';
    frame.hidden = true;
    setState('empty');
  }

  function writeEscaped(value) {
    var safe = typeof value === 'string' ? value : '';
    if (safe.indexOf('<') !== -1 || safe.indexOf('>') !== -1) {
      text.textContent = safe;
      return;
    }
    text.innerHTML = safe;
  }

  function normalizeFrame(message) {
    if (!message || typeof message !== 'object') return null;
    return message.frame || message.subtitle || message.lastSubtitle || message;
  }

  function renderFrame(message) {
    var next = normalizeFrame(message);
    if (!next || typeof next.escapedText !== 'string' || next.escapedText.length === 0) {
      clearSubtitle();
      return;
    }
    writeEscaped(next.escapedText);
    frame.hidden = false;
    setState('live');
    var displayMs = Number(next.displayMs);
    if (!Number.isFinite(displayMs) || displayMs <= 0) displayMs = config.defaultDisplayMs;
    if (clearTimer !== null) window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(clearSubtitle, displayMs);
  }

  function socketUrl(path) {
    var url = new URL(path, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  function connectSocket() {
    if (!('WebSocket' in window)) return;
    var socket = new WebSocket(socketUrl(config.wsPath));
    socket.addEventListener('open', function () {
      retryDelay = 300;
      setState(frame.hidden ? 'connected' : 'live');
    });
    socket.addEventListener('message', function (event) {
      try {
        renderFrame(JSON.parse(event.data));
      } catch (_) {
        setState('bad-message');
      }
    });
    socket.addEventListener('close', function () {
      setState('reconnecting');
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connectSocket, retryDelay);
      retryDelay = Math.min(maxRetryDelay, Math.round(retryDelay * 1.7));
    });
    socket.addEventListener('error', function () {
      setState('reconnecting');
      socket.close();
    });
  }

  function restoreSnapshot() {
    if (!('fetch' in window)) return Promise.resolve();
    return window.fetch(config.statusPath, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('status fetch failed');
        return response.json();
      })
      .then(function (status) {
        if (status && status.lastSubtitle) renderFrame(status.lastSubtitle);
      })
      .catch(function () {
        setState(frame.hidden ? 'waiting' : 'live');
      });
  }

  if (!frame.hidden) {
    var initialDisplayMs = Number(frame.getAttribute('data-display-ms'));
    if (Number.isFinite(initialDisplayMs) && initialDisplayMs > 0) {
      clearTimer = window.setTimeout(clearSubtitle, initialDisplayMs);
    }
  }
  restoreSnapshot().then(connectSocket);
}());
`.trim();
}

function renderOverlayHtml(options = {}) {
  const themeId = normalizeThemeId(options.themeId);
  const maxLines = clampMaxLines(options.maxLines);
  const initialFrame = sanitizeInitialFrame(options.initialFrame);
  const initialText = initialFrame === null ? '' : initialFrame.escapedText;
  const hidden = initialFrame === null || initialText.length === 0;
  const config = Object.freeze({
    statusPath: normalizePath(options.statusPath, DEFAULT_STATUS_PATH),
    wsPath: normalizePath(options.wsPath, DEFAULT_WS_PATH),
    defaultDisplayMs: DEFAULT_DISPLAY_MS,
  });
  const displayMs = displayMsFromFrame(initialFrame);

  return `<!doctype html>
<html lang="en" data-overlay-state="${hidden ? 'empty' : 'live'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${OVERLAY_CSP}">
  <title>Game Live Translator Overlay</title>
  <style>${renderOverlayStyle(themeId, maxLines)}</style>
</head>
<body data-theme="${themeId}">
  <main id="glt-overlay-root" aria-live="polite" aria-atomic="true">
    <section id="glt-subtitle-frame" data-display-ms="${displayMs}"${hidden ? ' hidden' : ''}>
      <div id="glt-subtitle-text">${initialText}</div>
    </section>
  </main>
  <script>${renderOverlayScript(config)}</script>
</body>
</html>`;
}

module.exports = {
  DEFAULT_DISPLAY_MS,
  DEFAULT_MAX_LINES,
  DEFAULT_OVERLAY_THEME_ID,
  DEFAULT_STATUS_PATH,
  DEFAULT_WS_PATH,
  OVERLAY_CSP,
  clampMaxLines,
  normalizeThemeId,
  renderOverlayHtml,
  renderOverlayScript,
  renderOverlayStyle,
  safeJsonForScript,
};
