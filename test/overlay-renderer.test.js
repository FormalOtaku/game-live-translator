'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MAX_LINES,
  DEFAULT_OVERLAY_THEME_ID,
  DEFAULT_STATUS_PATH,
  DEFAULT_WS_PATH,
  OVERLAY_CSP,
  clampMaxLines,
  normalizeThemeId,
  renderOverlayHtml,
  safeJsonForScript,
} = require('../src/server/overlay-renderer');
const { createSubtitleFrame } = require('../src/core/subtitle-state');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';

function maliciousFrame() {
  return createSubtitleFrame({
    id: 'subtitle-danger',
    profileId: 'profile-1',
    sourceText: '秘密の原文',
    translatedText: '</script><img src=x onerror=alert(1)>',
    provider: 'echo',
    createdAt: FIXED_TIME,
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  });
}

test('renderOverlayHtml returns a complete transparent OBS overlay document', () => {
  const html = renderOverlayHtml();

  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<html lang="en" data-overlay-state="empty">/);
  assert.match(html, /background: transparent;/);
  assert.match(html, /pointer-events: none;/);
  assert.match(html, /position: fixed;/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Content-Security-Policy/);
  assert.ok(html.includes(OVERLAY_CSP));
  assert.ok(html.includes("frame-ancestors 'none'"));
});

test('overlay HTML has no external asset tags or remote dependencies', () => {
  const html = renderOverlayHtml();

  assert.equal(/<script[^>]+\bsrc=/i.test(html), false);
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/<(?:img|iframe|object|embed|audio|video)\b/i.test(html), false);
  assert.equal(/@import/i.test(html), false);
  assert.equal(/https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(html), false);
  assert.equal(/analytics|telemetry|beacon/i.test(html), false);
});

test('initial subtitle is sanitized through escapedText and omits debug fields', () => {
  const html = renderOverlayHtml({ initialFrame: maliciousFrame() });

  assert.ok(html.includes('&lt;&#x2F;script&gt;&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;'));
  assert.ok(html.includes('data-display-ms="7000"'));
  assert.equal(html.includes('</script><img'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('秘密の原文'), false);
  assert.equal(html.includes('sourceText'), false);
  assert.equal(html.includes('translatedText'), false);
});

test('runtime script reads escapedText only and guards raw angle brackets', () => {
  const html = renderOverlayHtml();

  assert.ok(html.includes('next.escapedText'));
  assert.ok(html.includes("safe.indexOf('<')"));
  assert.ok(html.includes('text.textContent = safe'));
  assert.ok(html.includes('text.innerHTML = safe'));
  assert.equal(html.includes('sourceText'), false);
  assert.equal(html.includes('translatedText'), false);
});

test('overlay shell restores status and connects overlay websocket path', () => {
  const html = renderOverlayHtml({
    statusPath: '/api/status',
    wsPath: '/ws/overlay',
  });

  assert.ok(html.includes(`"statusPath":"${DEFAULT_STATUS_PATH}"`));
  assert.ok(html.includes(`"wsPath":"${DEFAULT_WS_PATH}"`));
  assert.ok(html.includes('window.fetch(config.statusPath'));
  assert.ok(html.includes('new WebSocket(socketUrl(config.wsPath))'));
  assert.ok(html.includes('Math.min(maxRetryDelay'));
});

test('theme and max line normalization are constrained to documented values', () => {
  assert.equal(normalizeThemeId('minimal'), 'minimal');
  assert.equal(normalizeThemeId('bad_theme'), DEFAULT_OVERLAY_THEME_ID);
  assert.equal(clampMaxLines(1), 1);
  assert.equal(clampMaxLines(2), 2);
  assert.equal(clampMaxLines(3), 3);
  assert.equal(clampMaxLines(0), 1);
  assert.equal(clampMaxLines(10), DEFAULT_MAX_LINES);

  const minimal = renderOverlayHtml({ themeId: 'minimal', maxLines: 1 });
  assert.match(minimal, /<body data-theme="minimal">/);
  assert.match(minimal, /--glt-lines: 1;/);

  const fallback = renderOverlayHtml({ themeId: 'unknown', maxLines: 99 });
  assert.match(fallback, /<body data-theme="classic_subtitle">/);
  assert.match(fallback, /--glt-lines: 3;/);
});

test('safeJsonForScript prevents script-breaking sequences in inline config', () => {
  const json = safeJsonForScript({
    statusPath: '/api/status',
    wsPath: '/ws/overlay',
    value: '</script><script>alert(1)</script>&',
  });

  assert.equal(json.includes('</script>'), false);
  assert.equal(json.includes('<script>'), false);
  assert.equal(json.includes('&'), false);
  assert.ok(json.includes('\\u003C/script\\u003E'));
  assert.ok(json.includes('\\u0026'));
});
