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

function findForbiddenExportFields(value, path = '') {
  const hits = [];
  if (value === null || typeof value !== 'object') return hits;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      hits.push(...findForbiddenExportFields(value[i], `${path}[${i}]`));
    }
    return hits;
  }

  for (const key of Object.keys(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PROFILE_EXPORT_FIELDS.includes(key)) {
      hits.push(nextPath);
    }
    hits.push(...findForbiddenExportFields(value[key], nextPath));
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

function redactSecrets(text) {
  if (text == null) return text;
  let output = String(text);
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return output;
}

function redactDiagnosticLogs(logLines) {
  if (!Array.isArray(logLines)) {
    throw new ContractError(
      'DIAGNOSTICS_FAILED',
      'redactDiagnosticLogs expects an array of log lines',
    );
  }
  return logLines.map((line) => redactSecrets(line));
}

function diagnosticsRedactionSummary() {
  return Object.freeze({
    apiKeysRemoved: true,
    ocrTextIncluded: false,
    translatedTextIncluded: false,
    imagesIncluded: false,
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
  ContractError,
  isLocalhostBind,
  assertLocalhostBind,
  findForbiddenExportFields,
  assertProfileExportSafe,
  apiKeyWriteResponse,
  redactSecrets,
  redactDiagnosticLogs,
  diagnosticsRedactionSummary,
  escapeHtml,
  isBuiltInTheme,
  assertThemeDeletable,
};
