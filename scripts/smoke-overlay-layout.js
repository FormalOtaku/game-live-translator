#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { OVERLAY_CSP, renderOverlayHtml } = require('../src/server/overlay-renderer');
const { createSubtitleFrame } = require('../src/core/subtitle-state');

const SMOKE_SCHEMA_VERSION = 'overlay-layout-smoke.v1';
const SOURCE_SENTINEL = 'レイアウト検証用の原文 sk-OVERLAYLAYOUTKEY1234 C:\\Users\\streamer\\Pictures\\layout-secret.png';
const SECRET_SENTINEL = 'sk-OVERLAYLAYOUTKEY1234';
const SCREENSHOT_SENTINEL = 'C:\\Users\\streamer\\Pictures\\layout-secret.png';
const PROFILE_ID = 'overlay-layout-profile';
const THEME_IDS = Object.freeze(['classic_subtitle', 'stream_box', 'minimal']);
const MAX_LINES = Object.freeze([1, 2, 3]);
const RESOLUTIONS = Object.freeze([
  Object.freeze({ label: '1280x720', width: 1280, height: 720 }),
  Object.freeze({ label: '1920x1080', width: 1920, height: 1080 }),
  Object.freeze({ label: '2560x1440', width: 2560, height: 1440 }),
]);
const SAMPLE_TEXT_BY_LINES = Object.freeze({
  1: 'Open the gate.',
  2: 'Open the ancient gate and keep watch.',
  3: 'The ancient gate creaks open as the hero raises a steady blade for the final trial.',
});
const LINE_HEIGHT = 1.18;
const ROOT_PADDING_VH = 0.05;
const ROOT_PADDING_VW = 0.05;
const ROOT_PADDING_Y_MAX_PX = 64;
const ROOT_PADDING_X_MAX_PX = 96;
const GLYPH_WIDTH_EM = 0.62;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function shortHash(value) {
  return sha256Hex(value).slice(0, 16);
}

function extractStyle(html) {
  const match = html.match(/<style>([\s\S]*?)<\/style>/i);
  assert.ok(match, 'overlay HTML must include an inline style block');
  return match[1];
}

function extractRootTokens(css) {
  const match = css.match(/:root\s*{([\s\S]*?)}/);
  assert.ok(match, 'overlay CSS must include :root tokens');
  const tokens = {};
  for (const declaration of match[1].split(';')) {
    const pair = declaration.trim().match(/^--([a-z0-9-]+):\s*(.+)$/i);
    if (pair) tokens[pair[1]] = pair[2].trim();
  }
  return Object.freeze(tokens);
}

function requiredToken(tokens, name) {
  assert.equal(typeof tokens[name], 'string', `missing CSS token ${name}`);
  assert.notEqual(tokens[name].length, 0, `empty CSS token ${name}`);
  return tokens[name];
}

function resolveClampPx(expression, viewportWidth) {
  const match = expression.match(/^clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/);
  assert.ok(match, `font-size must be clamp(px, vw, px): ${expression}`);
  const minPx = Number(match[1]);
  const preferredPx = Number(match[2]) * viewportWidth / 100;
  const maxPx = Number(match[3]);
  return Math.min(maxPx, Math.max(minPx, preferredPx));
}

function resolveMinVwPx(expression, viewportWidth) {
  const match = expression.match(/^min\(\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/);
  assert.ok(match, `max-width must be min(vw, px): ${expression}`);
  return Math.min(Number(match[1]) * viewportWidth / 100, Number(match[2]));
}

function resolveEmPadding(expression, fontSizePx) {
  if (expression === '0') return Object.freeze({ x: 0, y: 0 });
  const match = expression.match(/^([\d.]+)em\s+([\d.]+)em$/);
  assert.ok(match, `padding must be 0 or vertical/horizontal em pair: ${expression}`);
  return Object.freeze({
    y: Number(match[1]) * fontSizePx,
    x: Number(match[2]) * fontSizePx,
  });
}

function safeAreaForResolution(resolution) {
  const paddingX = Math.min(resolution.width * ROOT_PADDING_VW, ROOT_PADDING_X_MAX_PX);
  const paddingY = Math.min(resolution.height * ROOT_PADDING_VH, ROOT_PADDING_Y_MAX_PX);
  return Object.freeze({
    paddingX,
    paddingY,
    width: resolution.width - paddingX * 2,
    height: resolution.height - paddingY * 2,
  });
}

function estimatedLineCount(text, fontSizePx, contentWidthPx) {
  const estimatedWidth = text.length * fontSizePx * GLYPH_WIDTH_EM;
  return Math.max(1, Math.ceil(estimatedWidth / contentWidthPx));
}

function createLayoutFrame(maxLines) {
  const translatedText = SAMPLE_TEXT_BY_LINES[maxLines];
  return createSubtitleFrame({
    id: `layout-${maxLines}`,
    profileId: PROFILE_ID,
    sourceText: SOURCE_SENTINEL,
    translatedText,
    provider: 'echo',
    createdAt: '2026-05-28T10:00:00.000Z',
    displayMs: 7000,
    themeId: 'classic_subtitle',
    includeSourceText: true,
  });
}

function assertNoExternalAssets(html, css) {
  assert.equal(/<script[^>]+\bsrc=/i.test(html), false, 'overlay must not load external scripts');
  assert.equal(/<link\b/i.test(html), false, 'overlay must not load external styles');
  assert.equal(/<(?:img|iframe|object|embed|audio|video)\b/i.test(html), false, 'overlay must not load media assets');
  assert.equal(/@import/i.test(css), false, 'overlay CSS must not import remote CSS');
  assert.equal(/\burl\(/i.test(css), false, 'overlay CSS must not reference url() assets');
}

function assertNoSensitivePayload(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(serialized.includes(SOURCE_SENTINEL), false, `${label} leaked source sentinel`);
  assert.equal(serialized.includes(SECRET_SENTINEL), false, `${label} leaked provider key sentinel`);
  assert.equal(serialized.includes(SCREENSHOT_SENTINEL), false, `${label} leaked screenshot path`);
  for (const sample of Object.values(SAMPLE_TEXT_BY_LINES)) {
    assert.equal(serialized.includes(sample), false, `${label} leaked raw subtitle sample`);
  }
  assert.equal(/\s+at\s+\S+[^\n]*:\d+:\d+/.test(serialized), false, `${label} leaked stack frame`);
  assert.equal(/"debug"\s*:/.test(serialized), false, `${label} leaked debug payload`);
}

function redactSmokeDiagnostic(value) {
  let output = String(value);
  output = output.replaceAll(SOURCE_SENTINEL, '[REDACTED_SOURCE_TEXT]');
  output = output.replaceAll(SECRET_SENTINEL, '[REDACTED_PROVIDER_KEY]');
  output = output.replaceAll(SCREENSHOT_SENTINEL, '[REDACTED_SCREENSHOT_PATH]');
  for (const sample of Object.values(SAMPLE_TEXT_BY_LINES)) {
    output = output.replaceAll(sample, '[REDACTED_SUBTITLE]');
  }
  return output.replace(/\s+at\s+\S+[^\n]*:\d+:\d+/g, ' [REDACTED_STACK_FRAME]');
}

function verifyHtmlContract(html, css, tokens, expectedThemeId, expectedMaxLines) {
  assert.ok(html.startsWith('<!doctype html>'), 'overlay must be a complete HTML document');
  assert.ok(html.includes(OVERLAY_CSP), 'overlay HTML must include the canonical CSP');
  assert.ok(html.includes(`data-theme="${expectedThemeId}"`), 'overlay must render the requested theme');
  assert.ok(html.includes('background: transparent;'), 'overlay viewport must be transparent');
  assert.ok(html.includes('position: fixed;'), 'overlay root must be fixed to the viewport');
  assert.ok(html.includes('overflow: hidden;'), 'overlay must hide scrollbars');
  assert.ok(html.includes('pointer-events: none;'), 'overlay must be non-interactive for OBS');
  assert.ok(css.includes('padding: min(5vh, 64px) min(5vw, 96px);'), 'overlay must keep a broadcast safe area');
  assert.ok(css.includes('-webkit-line-clamp: var(--glt-lines);'), 'overlay must clamp visible lines');
  assert.ok(css.includes('overflow-wrap: anywhere;'), 'overlay must allow emergency wrapping');
  assert.ok(css.includes('text-wrap: balance;'), 'overlay must balance readable lines');
  assert.ok(css.includes('word-break: keep-all;'), 'overlay must avoid aggressive word breaking');
  assert.equal(Number(tokens['glt-lines']), expectedMaxLines, 'line token must match requested maxLines');
  assert.equal(requiredToken(tokens, 'glt-color').startsWith('#'), true, 'theme color must be a hex token');
  assertNoExternalAssets(html, css);
  assert.equal(html.includes(SOURCE_SENTINEL), false, 'overlay HTML must omit debug source text');
  assert.equal(html.includes(SECRET_SENTINEL), false, 'overlay HTML must omit provider keys');
  assert.equal(html.includes(SCREENSHOT_SENTINEL), false, 'overlay HTML must omit screenshot paths');
}

function buildCaseEvidence({ resolution, themeId, maxLines, tokens, html, css }) {
  const safeArea = safeAreaForResolution(resolution);
  const fontSizePx = resolveClampPx(requiredToken(tokens, 'glt-font-size'), resolution.width);
  const contentMaxWidthPx = resolveMinVwPx(requiredToken(tokens, 'glt-max-width'), resolution.width);
  const framePadding = resolveEmPadding(requiredToken(tokens, 'glt-padding'), fontSizePx);
  const translatedText = SAMPLE_TEXT_BY_LINES[maxLines];
  const usedLines = estimatedLineCount(translatedText, fontSizePx, contentMaxWidthPx);
  const textHeightPx = usedLines * fontSizePx * LINE_HEIGHT;
  const blockHeightPx = textHeightPx + framePadding.y * 2;
  const blockWidthPx = contentMaxWidthPx + framePadding.x * 2;
  const clipped = usedLines > maxLines || blockWidthPx > safeArea.width || blockHeightPx > safeArea.height;
  const overlaps = LINE_HEIGHT < 1.1 || maxLines < usedLines;
  const evidence = Object.freeze({
    themeId,
    maxLines,
    fontSizePx: Math.round(fontSizePx),
    contentMaxWidthPx: Math.round(contentMaxWidthPx),
    framePaddingXpx: Math.round(framePadding.x),
    safeWidthPx: Math.round(safeArea.width),
    safeHeightPx: Math.round(safeArea.height),
    usedLines,
    blockWidthPx: Math.round(blockWidthPx),
    blockHeightPx: Math.round(blockHeightPx),
    fitsWithinSafeArea: !clipped,
    clipped,
    overlaps,
    sampleHash: shortHash(translatedText),
    htmlHash: shortHash(html),
    cssHash: shortHash(css),
  });

  assert.ok(usedLines >= 1 && usedLines <= maxLines, `${themeId} ${resolution.label} maxLines=${maxLines} exceeds line clamp`);
  assert.ok(blockWidthPx <= safeArea.width, `${themeId} ${resolution.label} maxLines=${maxLines} exceeds safe width`);
  assert.ok(blockHeightPx <= safeArea.height, `${themeId} ${resolution.label} maxLines=${maxLines} exceeds safe height`);
  assert.equal(overlaps, false, `${themeId} ${resolution.label} maxLines=${maxLines} line overlap risk`);
  return evidence;
}

function buildResolutionEvidence(resolution) {
  const themes = [];
  for (const themeId of THEME_IDS) {
    const maxLinesCases = [];
    let representativeHtmlHash = null;
    let representativeCssHash = null;
    let representativeFontSize = null;
    for (const maxLines of MAX_LINES) {
      const html = renderOverlayHtml({
        themeId,
        maxLines,
        initialFrame: createLayoutFrame(maxLines),
      });
      const css = extractStyle(html);
      const tokens = extractRootTokens(css);
      verifyHtmlContract(html, css, tokens, themeId, maxLines);
      const caseEvidence = buildCaseEvidence({ resolution, themeId, maxLines, tokens, html, css });
      maxLinesCases.push(caseEvidence);
      if (maxLines === 3) {
        representativeHtmlHash = caseEvidence.htmlHash;
        representativeCssHash = caseEvidence.cssHash;
        representativeFontSize = caseEvidence.fontSizePx;
      }
    }
    themes.push(Object.freeze({
      themeId,
      htmlHash: representativeHtmlHash,
      cssHash: representativeCssHash,
      htmlLength: renderOverlayHtml({ themeId, maxLines: 3, initialFrame: createLayoutFrame(3) }).length,
      transparentViewport: true,
      fixedRoot: true,
      scrollbars: false,
      externalAssets: false,
      overflowWrapAnywhere: true,
      textWrapBalance: true,
      lineHeight: LINE_HEIGHT,
      fontSizeResolvedPx: representativeFontSize,
      maxLinesCases: Object.freeze(maxLinesCases),
    }));
  }

  const safeArea = safeAreaForResolution(resolution);
  return Object.freeze({
    resolution: resolution.label,
    width: resolution.width,
    height: resolution.height,
    safeWidthPx: Math.round(safeArea.width),
    safeHeightPx: Math.round(safeArea.height),
    themes: Object.freeze(themes),
  });
}

function runSmoke() {
  const resolutions = Object.freeze(RESOLUTIONS.map(buildResolutionEvidence));
  const evidenceHash = shortHash(resolutions);
  const summary = Object.freeze({
    ok: true,
    command: 'npm run smoke:overlay-layout',
    schemaVersion: SMOKE_SCHEMA_VERSION,
    resolutions,
    totals: Object.freeze({
      resolutions: RESOLUTIONS.length,
      themes: THEME_IDS.length,
      maxLinesCases: MAX_LINES.length,
      layoutCases: RESOLUTIONS.length * THEME_IDS.length * MAX_LINES.length,
    }),
    evidence: Object.freeze({
      evidenceHash,
      sampleHashes: Object.freeze(Object.fromEntries(
        Object.entries(SAMPLE_TEXT_BY_LINES).map(([lines, text]) => [lines, shortHash(text)]),
      )),
    }),
  });
  assertNoSensitivePayload(summary, 'stdout summary');
  return summary;
}

if (require.main === module) {
  try {
    const summary = runSmoke();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    const message = error && typeof error.message === 'string'
      ? redactSmokeDiagnostic(error.message)
      : 'Smoke failed';
    const failure = {
      ok: false,
      command: 'npm run smoke:overlay-layout',
      error: {
        name: 'Error',
        message,
      },
    };
    try {
      assertNoSensitivePayload(failure, 'stderr failure');
      process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    } catch (_) {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:overlay-layout',
        error: { name: 'Error', message: 'Smoke failed after diagnostic redaction' },
      }, null, 2)}\n`);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  runSmoke,
};
