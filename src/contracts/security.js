'use strict';

// Foundational security/privacy contract helpers for v1 invariants from
// PRODUCT_SPEC.md and API_SPEC.md. These deterministic helpers keep high-risk
// behavior testable before the Electron/Python surfaces exist.

const ALLOWED_BIND_ADDRESS = '127.0.0.1';

const FORBIDDEN_PROFILE_EXPORT_FIELDS = Object.freeze([
  'apiKey',
  'apiKeys',
  'providerApiKey',
  'providerKeys',
  'secrets',
  'ocrText',
  'ocrTextHistory',
  'recentOcrText',
  'translatedText',
  'translatedTextHistory',
  'recentTranslations',
  'images',
  'screenshots',
  'screenshotPaths',
  'logs',
  'logPayloads',
  'debugScreenshots',
]);

const BUILTIN_THEME_IDS = Object.freeze([
  'classic_subtitle',
  'stream_box',
  'minimal',
]);

// Privacy-first defaults for PrivacySettings. The v1 invariant from
// PRODUCT_SPEC.md is that default settings persist no OCR text, no translated
// text, and no captured screenshots. Limits/retention are zeroed so that
// callers cannot inadvertently re-enable persistence by toggling the boolean
// alone without an explicit numeric budget.
const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  saveRecentOcrText: false,
  recentOcrLimit: 0,
  saveRecentTranslations: false,
  recentTranslationLimit: 0,
  saveDebugScreenshots: false,
  debugRetentionDays: 0,
});

class ContractError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isLocalhostBind(address) {
  return address === ALLOWED_BIND_ADDRESS;
}

function assertLocalhostBind(address) {
  if (!isLocalhostBind(address)) {
    throw new ContractError(
      'NON_LOCALHOST_BIND_REJECTED',
      `Bind address must be ${ALLOWED_BIND_ADDRESS}; received ${String(address)}`,
      { bindAddress: address },
    );
  }
  return ALLOWED_BIND_ADDRESS;
}

function findForbiddenExportFields(value, path = '', seen = new WeakSet()) {
  const hits = [];
  if (value === null || typeof value !== 'object') return hits;
  if (seen.has(value)) return hits;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      hits.push(...findForbiddenExportFields(value[i], `${path}[${i}]`, seen));
    }
    return hits;
  }

  for (const key of Object.keys(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PROFILE_EXPORT_FIELDS.includes(key)) {
      hits.push(nextPath);
    }
    hits.push(...findForbiddenExportFields(value[key], nextPath, seen));
  }

  return hits;
}

function assertProfileExportSafe(payload) {
  const hits = findForbiddenExportFields(payload);
  if (hits.length > 0) {
    throw new ContractError(
      'IMPORT_CONTAINS_FORBIDDEN_FIELD',
      'Profile export/import contained forbidden fields',
      { forbiddenFields: hits },
    );
  }
  return true;
}

function apiKeyWriteResponse() {
  return Object.freeze({ ok: true });
}

const SECRET_PATTERNS = Object.freeze([
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?::fx)?/g,
  /\b[Bb]earer\s+[A-Za-z0-9._-]+/g,
  /\b(?:api[_-]?key|access[_-]?token|secret|token)\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}['"]?/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
]);

const REDACTION_PLACEHOLDER = '[REDACTED]';

function normalizeDiagnosticFieldKey(key) {
  return String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

const DIAGNOSTIC_SENSITIVE_FIELD_KEYS = Object.freeze([
  'apikey',
  'apikeys',
  'providerapikey',
  'providerkeys',
  'authorization',
  'bearer',
  'secret',
  'secrets',
  'token',
  'accesstoken',
  'sourceText',
  'rawText',
  'ocrText',
  'normalizedText',
  'debugText',
  'translatedText',
  'translatedDebug',
  'recentOcrText',
  'recentTranslations',
  'image',
  'images',
  'imagePath',
  'screenshot',
  'screenshots',
  'screenshotPath',
  'screenshotPaths',
  'debugScreenshots',
  'stack',
  'trace',
  'errorStack',
  'providerResponse',
  'providerResponseBody',
  'logPayloads',
  '__proto__',
  'prototype',
  'constructor',
]);

const DIAGNOSTIC_SENSITIVE_NORMALIZED_FIELD_KEYS = Object.freeze(
  DIAGNOSTIC_SENSITIVE_FIELD_KEYS.map(normalizeDiagnosticFieldKey),
);

// Conservative by design: this may over-redact key names containing sensitive
// tokens such as "image" or "token", which is safer for copyable diagnostics.
const DIAGNOSTIC_SERIALIZED_FIELD_PATTERN =
  /(["']?(?:api[_-]?key|apiKeys|provider[_-]?api[_-]?key|providerKeys|authorization|bearer|secret|secrets|token|access[_-]?token|accessToken|sourceText|rawText|ocrText|normalizedText|debugText|translatedText|translatedDebug|recentOcrText|recentTranslations|image|images|imagePath|screenshot|screenshots|screenshotPath|screenshotPaths|debugScreenshots|stack|trace|errorStack|providerResponse|providerResponseBody|logPayloads|__proto__|prototype|constructor)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\[[^\]]*\]|\{[^}]*\}|[^,;\s}]+)/gi;

const ERROR_STACK_HEADER_PATTERN =
  /^(?:[A-Za-z_$][A-Za-z0-9_$]*Error|Error):[^\r\n]*(?=\r?\n\s*at\s+)/gm;

// The path-only branch is intentionally gated behind a literal "at " stack
// prefix to avoid broad path/URL redaction in ordinary log messages.
const STACK_FRAME_PATTERN =
  /\bat\s+(?:[A-Za-z0-9_.$<>/\\-]+\s+\([^)]*\)|(?:[A-Za-z]:)?[^\s()]+:[0-9]+:[0-9]+|[A-Za-z0-9_.$<>/\\-]+:[0-9]+:[0-9]+)/g;

function redactSecrets(text) {
  if (text == null) return text;
  let output = String(text);
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return output;
}

function isSensitiveDiagnosticField(key) {
  const normalized = normalizeDiagnosticFieldKey(key);
  if (DIAGNOSTIC_SENSITIVE_NORMALIZED_FIELD_KEYS.includes(normalized)) return true;
  return (
    normalized.includes('apikey') ||
    normalized.includes('providerkey') ||
    normalized.includes('accesstoken') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('screenshot') ||
    normalized.includes('imageref') ||
    normalized.includes('imagepath') ||
    normalized.includes('ocrtext') ||
    normalized.includes('sourcetext') ||
    normalized.includes('translatedtext') ||
    normalized.includes('providerresponse') ||
    normalized === 'proto' ||
    normalized === 'prototype' ||
    normalized === 'constructor' ||
    normalized === 'stack' ||
    normalized === 'trace' ||
    normalized === 'errorstack'
  );
}

function redactDiagnosticString(value) {
  if (value == null) return '';
  return redactSecrets(String(value))
    .replace(
      DIAGNOSTIC_SERIALIZED_FIELD_PATTERN,
      (match, prefix) => `${prefix}${REDACTION_PLACEHOLDER}`,
    )
    .replace(ERROR_STACK_HEADER_PATTERN, REDACTION_PLACEHOLDER)
    .replace(STACK_FRAME_PATTERN, REDACTION_PLACEHOLDER);
}

function redactDiagnosticPayload(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactDiagnosticString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTION_PLACEHOLDER;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticPayload(entry, seen));
  }

  const output = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveDiagnosticField(key)
      ? REDACTION_PLACEHOLDER
      : redactDiagnosticPayload(entry, seen);
  }
  return output;
}

function redactDiagnosticLogLine(line) {
  if (typeof line === 'string') return redactDiagnosticString(line);
  if (line == null) return '';
  if (typeof line === 'object') {
    return JSON.stringify(redactDiagnosticPayload(line));
  }
  return redactDiagnosticString(String(line));
}

function redactDiagnosticLogs(logLines) {
  if (!Array.isArray(logLines)) {
    throw new ContractError(
      'DIAGNOSTICS_FAILED',
      'redactDiagnosticLogs expects an array of log lines',
    );
  }
  return logLines.map((line) => redactDiagnosticLogLine(line));
}

function diagnosticsRedactionSummary() {
  return Object.freeze({
    apiKeysRemoved: true,
    ocrTextIncluded: false,
    translatedTextIncluded: false,
    imagesIncluded: false,
  });
}

function isoTimestampFromClock(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new ContractError('DIAGNOSTICS_FAILED', 'Diagnostic bundle clock returned an invalid date');
  }
  return date.toISOString();
}

function requireDiagnosticString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ContractError('DIAGNOSTICS_FAILED', `${field} must be a non-empty string`);
  }
  return value;
}

function buildDiagnosticBundle(options = {}) {
  const {
    appVersion,
    backendVersion,
    os,
    activeProfileId = null,
    logLines = [],
    clock,
  } = options;

  if (
    activeProfileId !== null &&
    (typeof activeProfileId !== 'string' || activeProfileId.trim().length === 0)
  ) {
    throw new ContractError(
      'DIAGNOSTICS_FAILED',
      'activeProfileId must be a non-empty string or null',
    );
  }

  return Object.freeze({
    generatedAt: isoTimestampFromClock(clock),
    appVersion: requireDiagnosticString(appVersion, 'appVersion'),
    backendVersion: requireDiagnosticString(backendVersion, 'backendVersion'),
    os: requireDiagnosticString(os, 'os'),
    activeProfileId,
    redactedLogs: Object.freeze(redactDiagnosticLogs(logLines)),
    redactionSummary: diagnosticsRedactionSummary(),
  });
}

const HTML_ESCAPE_MAP = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
});

function escapeHtml(text) {
  if (text == null) return '';
  return String(text).replace(/[&<>"'`=/]/g, (character) => HTML_ESCAPE_MAP[character]);
}

function isBuiltInTheme(themeId) {
  return BUILTIN_THEME_IDS.includes(themeId);
}

function assertThemeDeletable(theme) {
  if (theme == null || typeof theme !== 'object') {
    throw new ContractError('THEME_NOT_FOUND', 'Theme record missing');
  }
  if (theme.builtIn === true || isBuiltInTheme(theme.id)) {
    throw new ContractError(
      'CANNOT_DELETE_BUILT_IN_THEME',
      'Built-in themes cannot be deleted; duplicate to a custom theme instead',
      { themeId: theme.id },
    );
  }
  return true;
}

module.exports = {
  ALLOWED_BIND_ADDRESS,
  FORBIDDEN_PROFILE_EXPORT_FIELDS,
  BUILTIN_THEME_IDS,
  DEFAULT_PRIVACY_SETTINGS,
  ContractError,
  isLocalhostBind,
  assertLocalhostBind,
  findForbiddenExportFields,
  assertProfileExportSafe,
  apiKeyWriteResponse,
  redactSecrets,
  redactDiagnosticString,
  redactDiagnosticPayload,
  redactDiagnosticLogs,
  diagnosticsRedactionSummary,
  buildDiagnosticBundle,
  escapeHtml,
  isBuiltInTheme,
  assertThemeDeletable,
};
