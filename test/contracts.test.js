'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../src/contracts/security');

const {
  ALLOWED_CAPTURE_HZ,
  ALLOWED_TARGET_LANGS,
  ALLOWED_PROVIDERS,
  validateCaptureHz,
  validateRoiRect,
  validateOcrConfidenceFloor,
  validateTargetLang,
  validateProvider,
  validateProfileCore,
  throwIfErrors,
} = require('../src/contracts/validation');

test('localhost bind: 127.0.0.1 is accepted', () => {
  assert.equal(ALLOWED_BIND_ADDRESS, '127.0.0.1');
  assert.equal(isLocalhostBind('127.0.0.1'), true);
  assert.equal(assertLocalhostBind('127.0.0.1'), '127.0.0.1');
});

test('localhost bind: 0.0.0.0, LAN, loopback aliases, and hostnames are rejected', () => {
  const rejected = ['0.0.0.0', '::', '::1', 'localhost', '192.168.1.10', '', null, undefined];
  for (const address of rejected) {
    assert.equal(isLocalhostBind(address), false, `expected ${address} to be rejected`);
    assert.throws(
      () => assertLocalhostBind(address),
      (error) => error instanceof ContractError && error.code === 'NON_LOCALHOST_BIND_REJECTED',
      `expected throw for ${address}`,
    );
  }
});

test('profile export: clean payload is accepted', () => {
  const payload = {
    schemaVersion: 1,
    profile: {
      id: 'p1',
      name: 'Test',
      captureHz: 2,
      ocrConfidenceFloor: 0.6,
      translationProvider: 'deepl',
      targetLang: 'en',
      overlayThemeId: 'classic_subtitle',
      glossary: [{ id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' }],
    },
    exportedAt: '2026-05-27T00:00:00Z',
  };
  assert.equal(findForbiddenExportFields(payload).length, 0);
  assert.equal(assertProfileExportSafe(payload), true);
});

test('profile export: top-level forbidden fields are rejected', () => {
  for (const field of FORBIDDEN_PROFILE_EXPORT_FIELDS) {
    const payload = { profile: { id: 'p1' }, [field]: 'leaked' };
    assert.throws(
      () => assertProfileExportSafe(payload),
      (error) =>
        error instanceof ContractError &&
        error.code === 'IMPORT_CONTAINS_FORBIDDEN_FIELD' &&
        Array.isArray(error.details.forbiddenFields) &&
        error.details.forbiddenFields.includes(field),
      `expected reject for forbidden field ${field}`,
    );
  }
});

test('profile export: nested forbidden fields inside arrays are rejected', () => {
  const payload = {
    profile: {
      id: 'p1',
      history: [
        { ocrText: 'こんにちは' },
        { translatedText: 'hello' },
      ],
    },
  };
  const hits = findForbiddenExportFields(payload);
  assert.ok(hits.some((path) => path.endsWith('.ocrText')));
  assert.ok(hits.some((path) => path.endsWith('.translatedText')));
  assert.throws(() => assertProfileExportSafe(payload), /forbidden/i);
});

test('profile export: deeply nested apiKey is rejected', () => {
  const payload = {
    profile: { id: 'p1', provider: { config: { apiKey: 'leaked-key' } } },
  };
  assert.throws(
    () => assertProfileExportSafe(payload),
    (error) => error.code === 'IMPORT_CONTAINS_FORBIDDEN_FIELD',
  );
});

test('api key write response is frozen { ok: true } and never contains the key', () => {
  const response = apiKeyWriteResponse();
  assert.deepEqual(response, { ok: true });
  assert.equal(Object.isFrozen(response), true);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('key'), false);
  assert.equal(Object.keys(response).length, 1);
});

test('redactSecrets removes DeepL-style keys, bearer tokens, sk-... keys, and apiKey assignments', () => {
  const samples = [
    'auth: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:fx',
    'Authorization: Bearer abc123XYZ.token-value',
    'api_key=sk-ABCDEFGHIJKLMNOP1234',
    'apiKey: "verysecret-1234567890"',
  ];
  for (const sample of samples) {
    const output = redactSecrets(sample);
    assert.ok(output.includes('[REDACTED]'), `expected REDACTED in: ${output}`);
    assert.equal(output.includes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), false);
    assert.equal(output.includes('sk-ABCDEFGHIJKLMNOP1234'), false);
    assert.equal(output.includes('verysecret-1234567890'), false);
  }
});

test('redactDiagnosticLogs maps arrays and rejects non-arrays', () => {
  const output = redactDiagnosticLogs([
    'startup ok',
    'token: sk-ABCDEFGHIJKLMNOP1234',
  ]);
  assert.equal(output[0], 'startup ok');
  assert.ok(output[1].includes('[REDACTED]'));
  assert.throws(
    () => redactDiagnosticLogs('not-an-array'),
    (error) => error instanceof ContractError && error.code === 'DIAGNOSTICS_FAILED',
  );
});

test('diagnosticsRedactionSummary matches API_SPEC DiagnosticBundle contract', () => {
  const summary = diagnosticsRedactionSummary();
  assert.deepEqual(summary, {
    apiKeysRemoved: true,
    ocrTextIncluded: false,
    translatedTextIncluded: false,
    imagesIncluded: false,
  });
  assert.equal(Object.isFrozen(summary), true);
});

test('escapeHtml escapes script payloads and dangerous characters', () => {
  const malicious = `<script>alert("x")</script>&'\`=/`;
  const output = escapeHtml(malicious);
  assert.equal(output.includes('<script>'), false);
  assert.equal(output.includes('</script>'), false);
  assert.equal(output.includes('"'), false);
  assert.equal(output.includes("'"), false);
  assert.equal(output.includes('`'), false);
  assert.equal(output.includes('='), false);
  assert.equal(output.includes('/'), false);
  assert.ok(output.startsWith('&lt;script&gt;'));
});

test('escapeHtml is stable on plain and empty inputs', () => {
  assert.equal(escapeHtml('hello world'), 'hello world');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('captureHz: 0..4 inclusive accepted', () => {
  for (const hz of ALLOWED_CAPTURE_HZ) {
    assert.deepEqual(validateCaptureHz(hz), []);
  }
});

test('captureHz: out-of-range rejected', () => {
  for (const bad of [-1, 5, 1.5, '1', null, undefined, NaN]) {
    const errors = validateCaptureHz(bad);
    assert.equal(errors.length, 1, `expected error for ${String(bad)}`);
    assert.equal(errors[0].code, 'CAPTURE_HZ_INVALID');
  }
});

test('RoiRect: well-formed rect accepted', () => {
  assert.deepEqual(validateRoiRect({ x: 0, y: 0, width: 100, height: 50 }), []);
});

test('RoiRect: rejects non-finite, zero, and negative dimensions', () => {
  assert.ok(validateRoiRect({ x: 0, y: 0, width: 0, height: 10 }).some((error) => error.field === 'roi.width'));
  assert.ok(validateRoiRect({ x: 0, y: 0, width: 10, height: -1 }).some((error) => error.field === 'roi.height'));
  assert.ok(validateRoiRect({ x: Infinity, y: 0, width: 10, height: 10 }).some((error) => error.field === 'roi.x'));
  assert.ok(validateRoiRect(null).length > 0);
  assert.ok(validateRoiRect('bad').length > 0);
});

test('ocrConfidenceFloor: values in [0, 1] accepted and out-of-range rejected', () => {
  for (const ok of [0, 0.5, 1]) {
    assert.deepEqual(validateOcrConfidenceFloor(ok), []);
  }
  for (const bad of [-0.0001, 1.0001, NaN, '0.5', null]) {
    const errors = validateOcrConfidenceFloor(bad);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'OCR_CONFIDENCE_FLOOR_INVALID');
  }
});

test('targetLang: only "en" allowed in v1', () => {
  assert.deepEqual(ALLOWED_TARGET_LANGS, ['en']);
  assert.deepEqual(validateTargetLang('en'), []);
  for (const bad of ['ja', 'EN', '', null, undefined]) {
    const errors = validateTargetLang(bad);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'TARGET_LANG_INVALID');
  }
});

test('provider: deepl and echo allowed, others rejected', () => {
  assert.deepEqual(ALLOWED_PROVIDERS, ['deepl', 'echo']);
  for (const ok of ['deepl', 'echo']) {
    assert.deepEqual(validateProvider(ok), []);
  }
  for (const bad of ['google', 'openai', '', null, undefined]) {
    const errors = validateProvider(bad);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'PROVIDER_UNKNOWN');
  }
});

test('validateProfileCore aggregates field errors', () => {
  const errors = validateProfileCore({
    captureHz: 9,
    ocrConfidenceFloor: 2,
    targetLang: 'ja',
    translationProvider: 'google',
    roi: { x: 0, y: 0, width: 0, height: 0 },
  });
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('captureHz'));
  assert.ok(fields.includes('ocrConfidenceFloor'));
  assert.ok(fields.includes('targetLang'));
  assert.ok(fields.includes('translationProvider'));
  assert.ok(fields.includes('roi.width'));
  assert.ok(fields.includes('roi.height'));
});

test('throwIfErrors raises VALIDATION_ERROR with fieldErrors details', () => {
  const errors = validateProfileCore({
    captureHz: 9,
    ocrConfidenceFloor: 2,
    targetLang: 'ja',
    translationProvider: 'google',
  });
  assert.throws(
    () => throwIfErrors(errors),
    (error) =>
      error instanceof ContractError &&
      error.code === 'VALIDATION_ERROR' &&
      Array.isArray(error.details.fieldErrors) &&
      error.details.fieldErrors.length === errors.length,
  );
  assert.doesNotThrow(() => throwIfErrors([]));
});

test('built-in theme ids match API_SPEC v1 contract', () => {
  assert.deepEqual([...BUILTIN_THEME_IDS], [
    'classic_subtitle',
    'stream_box',
    'minimal',
  ]);
  for (const id of BUILTIN_THEME_IDS) {
    assert.equal(isBuiltInTheme(id), true);
  }
  assert.equal(isBuiltInTheme('my_custom_theme'), false);
});

test('assertThemeDeletable rejects built-ins and allows custom themes', () => {
  assert.throws(
    () => assertThemeDeletable({ id: 'classic_subtitle', builtIn: true }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'CANNOT_DELETE_BUILT_IN_THEME',
  );
  assert.throws(
    () => assertThemeDeletable({ id: 'something', builtIn: true }),
    (error) => error.code === 'CANNOT_DELETE_BUILT_IN_THEME',
  );
  assert.throws(
    () => assertThemeDeletable({ id: 'minimal', builtIn: false }),
    (error) => error.code === 'CANNOT_DELETE_BUILT_IN_THEME',
  );
  assert.equal(assertThemeDeletable({ id: 'custom_1', builtIn: false }), true);
  assert.throws(
    () => assertThemeDeletable(null),
    (error) => error.code === 'THEME_NOT_FOUND',
  );
});
