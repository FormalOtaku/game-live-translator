'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
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
  ALLOWED_OCR_PRESETS,
  ALLOWED_GLOSSARY_IMPORT_FORMATS,
  ALLOWED_OCR_REJECTION_REASONS,
  PROFILE_EXPORT_SCHEMA_VERSION,
  PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
  validateCaptureHz,
  validateRoiRect,
  validateOcrConfidenceFloor,
  validateTargetLang,
  validateProvider,
  validateProfileCore,
  validateProfileCreateRequest,
  assertProfileCreateRequest,
  validateProfileUpdateRequest,
  assertProfileUpdateRequest,
  validateCaptureSourcesResponse,
  assertCaptureSourcesResponse,
  validateCaptureStartRequest,
  assertCaptureStartRequest,
  validateOcrTestRequest,
  assertOcrTestRequest,
  validateTranslateTestRequest,
  assertTranslateTestRequest,
  validateOcrResult,
  assertOcrResult,
  validateTranslationResult,
  assertTranslationResult,
  validateThemeCssJson,
  validateOverlayThemeCreateRequest,
  assertOverlayThemeCreateRequest,
  validateOverlayThemeUpdateRequest,
  assertOverlayThemeUpdateRequest,
  validateGlossaryImportRequest,
  assertGlossaryImportRequest,
  validatePrivacySettings,
  assertPrivacySettings,
  validateProviderKeyWriteRequest,
  assertProviderKeyWriteRequest,
  validateProfileExport,
  assertProfileExport,
  throwIfErrors,
} = require('../src/contracts/validation');

function makeValidProfileCreateRequest(overrides = {}) {
  return {
    name: 'Test Profile',
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.6,
    captureHz: 2,
    translationProvider: 'deepl',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossary: [],
    ...overrides,
  };
}

function makeValidProfile(overrides = {}) {
  return {
    ...makeValidProfileCreateRequest(),
    id: 'p1',
    createdAt: '2026-05-28T00:00:00Z',
    updatedAt: '2026-05-28T00:00:00Z',
    ...overrides,
  };
}

function makeValidProfileExport(overrides = {}) {
  return {
    schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
    profile: makeValidProfile(),
    exportedAt: '2026-05-28T00:00:00Z',
    forbiddenFieldsPolicy: PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
    ...overrides,
  };
}

function makeValidPrivacySettings(overrides = {}) {
  return { ...DEFAULT_PRIVACY_SETTINGS, ...overrides };
}

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

test('profile export: recursive scan handles cyclic in-process objects safely', () => {
  const payload = { profile: { id: 'p1' } };
  payload.profile.self = payload;
  payload.profile.config = { apiKey: 'leaked-key' };
  const hits = findForbiddenExportFields(payload);
  assert.deepEqual(hits, ['profile.config.apiKey']);
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

test('ProfileCreateRequest: a well-formed request is accepted', () => {
  assert.deepEqual(validateProfileCreateRequest(makeValidProfileCreateRequest()), []);
  assert.equal(
    typeof assertProfileCreateRequest(makeValidProfileCreateRequest()),
    'object',
  );
});

test('ProfileCreateRequest: missing required fields produce VALIDATION_ERROR field entries', () => {
  for (const field of [
    'name',
    'ocrPreset',
    'ocrConfidenceFloor',
    'captureHz',
    'translationProvider',
    'targetLang',
    'overlayThemeId',
    'glossary',
  ]) {
    const payload = makeValidProfileCreateRequest();
    delete payload[field];
    const errors = validateProfileCreateRequest(payload);
    assert.ok(
      errors.some((error) => error.field === field),
      `expected missing-field error for ${field}`,
    );
    assert.throws(
      () => assertProfileCreateRequest(payload),
      (error) =>
        error instanceof ContractError && error.code === 'VALIDATION_ERROR',
    );
  }
});

test('ProfileCreateRequest: captureHz/targetLang/provider violations bubble up with controlled codes', () => {
  const errors = validateProfileCreateRequest(
    makeValidProfileCreateRequest({
      captureHz: 5,
      targetLang: 'ja',
      translationProvider: 'google',
      ocrPreset: 'fancy_preset',
      name: '   ',
    }),
  );
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.captureHz, 'CAPTURE_HZ_INVALID');
  assert.equal(byField.targetLang, 'TARGET_LANG_INVALID');
  assert.equal(byField.translationProvider, 'PROVIDER_UNKNOWN');
  assert.equal(byField.ocrPreset, 'OCR_PRESET_INVALID');
  assert.equal(byField.name, 'VALIDATION_ERROR');
});

test('ProfileCreateRequest: unknown writable fields are rejected', () => {
  const errors = validateProfileCreateRequest(
    makeValidProfileCreateRequest({
      apiKey: 'secret',
      debugScreenshots: ['/tmp/shot.png'],
    }),
  );
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.apiKey, 'UNKNOWN_PROFILE_FIELD');
  assert.equal(byField.debugScreenshots, 'UNKNOWN_PROFILE_FIELD');
});

test('ProfileCreateRequest: roi must be finite and strictly positive when present', () => {
  const errors = validateProfileCreateRequest(
    makeValidProfileCreateRequest({ roi: { x: 0, y: 0, width: 0, height: -1 } }),
  );
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('roi.width'));
  assert.ok(fields.includes('roi.height'));
});

test('ProfileCreateRequest: captureSource requires kind/id/label and validates bounds', () => {
  const errors = validateProfileCreateRequest(
    makeValidProfileCreateRequest({
      captureSource: {
        kind: 'webcam',
        id: '',
        label: '',
        bounds: { x: 0, y: 0, width: 0, height: 10 },
        apiKey: 'sk-ABCDEFGHIJKLMNOP1234',
      },
    }),
  );
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('captureSource.kind'));
  assert.ok(fields.includes('captureSource.id'));
  assert.ok(fields.includes('captureSource.label'));
  assert.ok(fields.includes('captureSource.bounds.width'));
  assert.ok(fields.includes('captureSource.apiKey'));
  assert.equal(JSON.stringify(errors).includes('sk-ABCDEFGHIJKLMNOP1234'), false);
});

test('CaptureSourcesResponse: validates monitor and window entries', () => {
  const payload = {
    sources: [
      {
        kind: 'monitor',
        id: 'monitor:1',
        label: 'Display 1',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      {
        kind: 'window',
        id: 'window:game',
        label: 'Game Window',
      },
    ],
  };

  assert.deepEqual(validateCaptureSourcesResponse(payload), []);
  assert.strictEqual(assertCaptureSourcesResponse(payload), payload);
});

test('CaptureSourcesResponse: rejects bad entries and does not leak values', () => {
  const secret = 'sk-ABCDEFGHIJKLMNOP1234';
  const errors = validateCaptureSourcesResponse({
    sources: [
      {
        kind: 'browser',
        id: '',
        label: secret,
        bounds: { x: 0, y: 0, width: 0, height: Infinity },
        apiKey: secret,
      },
    ],
    apiKey: secret,
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.apiKey, 'UNKNOWN_CAPTURE_SOURCES_FIELD');
  assert.equal(byField['sources[0].apiKey'], 'UNKNOWN_CAPTURE_SOURCE_FIELD');
  assert.equal(byField['sources[0].kind'], 'CAPTURE_SOURCE_KIND_INVALID');
  assert.equal(byField['sources[0].id'], 'VALIDATION_ERROR');
  assert.equal(byField['sources[0].bounds.width'], 'ROI_INVALID');
  assert.equal(byField['sources[0].bounds.height'], 'ROI_INVALID');
  assert.equal(JSON.stringify(errors).includes(secret), false);
});

test('CaptureSourcesResponse: rejects non-object and non-array source envelopes', () => {
  assert.throws(
    () => assertCaptureSourcesResponse(null),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );

  const errors = validateCaptureSourcesResponse({
    sources: { kind: 'monitor', id: 'monitor:1', label: 'Display 1' },
    extra: true,
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.extra, 'UNKNOWN_CAPTURE_SOURCES_FIELD');
  assert.equal(byField.sources, 'VALIDATION_ERROR');
});

test('CaptureStartRequest: requires only profileId', () => {
  const payload = { profileId: 'profile_main' };
  assert.deepEqual(validateCaptureStartRequest(payload), []);
  assert.strictEqual(assertCaptureStartRequest(payload), payload);

  const errors = validateCaptureStartRequest({
    profileId: '',
    roi: { x: 0, y: 0, width: 100, height: 100 },
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.profileId, 'VALIDATION_ERROR');
  assert.equal(byField.roi, 'UNKNOWN_CAPTURE_START_FIELD');
  assert.throws(
    () => assertCaptureStartRequest(null),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );
});

test('OcrTestRequest: accepts profileId with optional ROI override', () => {
  const payload = {
    profileId: 'profile_main',
    roi: { x: 10, y: 20, width: 300, height: 80 },
  };
  assert.deepEqual(validateOcrTestRequest(payload), []);
  assert.strictEqual(assertOcrTestRequest(payload), payload);
  assert.deepEqual(validateOcrTestRequest({ profileId: 'profile_main' }), []);
});

test('OcrTestRequest: rejects unknown fields and invalid ROI without leaking raw OCR text', () => {
  const rawOcrText = '秘密の原文';
  const errors = validateOcrTestRequest({
    profileId: '',
    roi: { x: NaN, y: 0, width: -1, height: 0 },
    text: rawOcrText,
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.profileId, 'VALIDATION_ERROR');
  assert.equal(byField.text, 'UNKNOWN_OCR_TEST_FIELD');
  assert.equal(byField['roi.x'], 'ROI_INVALID');
  assert.equal(byField['roi.width'], 'ROI_INVALID');
  assert.equal(byField['roi.height'], 'ROI_INVALID');
  assert.equal(JSON.stringify(errors).includes(rawOcrText), false);
});

test('TranslateTestRequest: requires only profileId and text', () => {
  const payload = { profileId: 'profile_main', text: '勇者が来た' };
  assert.deepEqual(validateTranslateTestRequest(payload), []);
  assert.strictEqual(assertTranslateTestRequest(payload), payload);

  const errors = validateTranslateTestRequest({
    profileId: '',
    text: '',
    targetLang: 'en',
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.profileId, 'VALIDATION_ERROR');
  assert.equal(byField.text, 'VALIDATION_ERROR');
  assert.equal(byField.targetLang, 'UNKNOWN_TRANSLATE_TEST_FIELD');
  assert.throws(
    () => assertTranslateTestRequest(null),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );
});

test('TranslateTestRequest: keeps field errors value-free', () => {
  const secret = 'sk-ABCDEFGHIJKLMNOP1234';
  const rawText = '秘密の原文';
  const errors = validateTranslateTestRequest({
    profileId: secret,
    text: rawText,
    debugPayload: { sourceText: rawText, apiKey: secret },
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.debugPayload, 'UNKNOWN_TRANSLATE_TEST_FIELD');
  assert.equal(JSON.stringify(errors).includes(secret), false);
  assert.equal(JSON.stringify(errors).includes(rawText), false);
});

test('ProfileCreateRequest: glossary entries require id/sourceTerm/targetTerm', () => {
  const errors = validateProfileCreateRequest(
    makeValidProfileCreateRequest({
      glossary: [{ id: '', sourceTerm: '', targetTerm: 'hero' }],
    }),
  );
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('glossary[0].id'));
  assert.ok(fields.includes('glossary[0].sourceTerm'));
});

test('ProfileUpdateRequest: partial updates of any single field are accepted', () => {
  for (const [field, value] of [
    ['name', 'Renamed'],
    ['captureHz', 3],
    ['translationProvider', 'echo'],
    ['ocrConfidenceFloor', 0.42],
  ]) {
    assert.deepEqual(
      validateProfileUpdateRequest({ [field]: value }),
      [],
      `expected ${field} update to be accepted`,
    );
    assert.deepEqual(assertProfileUpdateRequest({ [field]: value }), { [field]: value });
  }
});

test('ProfileUpdateRequest: invalid field values surface the same controlled codes as create', () => {
  const errors = validateProfileUpdateRequest({
    captureHz: 7,
    targetLang: 'ja',
    translationProvider: 'google',
  });
  const codes = errors.map((error) => error.code);
  assert.ok(codes.includes('CAPTURE_HZ_INVALID'));
  assert.ok(codes.includes('TARGET_LANG_INVALID'));
  assert.ok(codes.includes('PROVIDER_UNKNOWN'));
});

test('ProfileUpdateRequest: empty body and unknown fields are rejected', () => {
  const empty = validateProfileUpdateRequest({});
  assert.equal(empty.length, 1);
  assert.equal(empty[0].code, 'VALIDATION_ERROR');

  const unknown = validateProfileUpdateRequest({ apiKey: 'secret', mysteryField: 1 });
  const fields = unknown.map((error) => error.field);
  assert.ok(fields.includes('apiKey'));
  assert.ok(fields.includes('mysteryField'));
  for (const error of unknown) {
    assert.equal(error.code, 'UNKNOWN_PROFILE_FIELD');
  }

  const unknownUndefined = validateProfileUpdateRequest({ apiKey: undefined, name: 'x' });
  assert.ok(
    unknownUndefined.some(
      (error) => error.field === 'apiKey' && error.code === 'UNKNOWN_PROFILE_FIELD',
    ),
  );
});

test('ProfileUpdateRequest: rejects non-object payloads via VALIDATION_ERROR', () => {
  for (const bad of [null, undefined, 'string', 42, []]) {
    assert.throws(
      () => assertProfileUpdateRequest(bad),
      (error) =>
        error instanceof ContractError && error.code === 'VALIDATION_ERROR',
    );
  }
});

test('ProfileExport: clean export is accepted with no errors', () => {
  const payload = makeValidProfileExport();
  assert.deepEqual(validateProfileExport(payload), []);
  assert.strictEqual(assertProfileExport(payload), payload);
});

test('ProfileExport: wrong schemaVersion/policy/exportedAt fail with controlled codes', () => {
  const errors = validateProfileExport(
    makeValidProfileExport({
      schemaVersion: 2,
      forbiddenFieldsPolicy: 'allow_everything',
      exportedAt: '',
    }),
  );
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.schemaVersion, 'IMPORT_SCHEMA_INVALID');
  assert.equal(byField.forbiddenFieldsPolicy, 'IMPORT_SCHEMA_INVALID');
  assert.equal(byField.exportedAt, 'IMPORT_SCHEMA_INVALID');
});

test('ProfileExport: non-object profile payloads fail with IMPORT_SCHEMA_INVALID', () => {
  for (const badProfile of [null, 'oops']) {
    const errors = validateProfileExport(
      makeValidProfileExport({ profile: badProfile }),
    );
    assert.ok(
      errors.some(
        (error) => error.field === 'profile' && error.code === 'IMPORT_SCHEMA_INVALID',
      ),
    );
  }
});

test('ProfileExport: any forbidden field anywhere is rejected with IMPORT_CONTAINS_FORBIDDEN_FIELD', () => {
  for (const field of FORBIDDEN_PROFILE_EXPORT_FIELDS) {
    const payload = makeValidProfileExport();
    payload.profile = { ...payload.profile, history: [{ [field]: 'leaked' }] };
    const errors = validateProfileExport(payload);
    assert.ok(
      errors.some(
        (error) =>
          error.code === 'IMPORT_CONTAINS_FORBIDDEN_FIELD' &&
          error.field.endsWith(`.${field}`),
      ),
      `expected forbidden-field rejection for ${field}`,
    );
    assert.throws(
      () => assertProfileExport(payload),
      (error) =>
        error instanceof ContractError && error.code === 'VALIDATION_ERROR',
    );
  }
});

test('ProfileExport: top-level forbidden fields are rejected through the export validator', () => {
  const payload = makeValidProfileExport({ apiKey: 'leaked-key' });
  const errors = validateProfileExport(payload);
  assert.ok(
    errors.some(
      (error) =>
        error.field === 'apiKey' &&
        error.code === 'IMPORT_CONTAINS_FORBIDDEN_FIELD',
    ),
  );
});

test('ProfileExport: forbidden profile fields prefer forbidden-field errors over duplicate unknown-field errors', () => {
  const payload = makeValidProfileExport({
    profile: { ...makeValidProfile(), apiKey: 'leaked-key' },
  });
  const errors = validateProfileExport(payload);
  assert.equal(
    errors.some(
      (error) => error.field === 'profile.apiKey' && error.code === 'UNKNOWN_PROFILE_FIELD',
    ),
    false,
  );
  assert.ok(
    errors.some(
      (error) =>
        error.field === 'profile.apiKey' &&
        error.code === 'IMPORT_CONTAINS_FORBIDDEN_FIELD',
    ),
  );
});

test('ProfileExport: profile must be a complete Profile with id/createdAt/updatedAt', () => {
  const payload = makeValidProfileExport({ profile: { ...makeValidProfile(), id: '', createdAt: '', updatedAt: '' } });
  const errors = validateProfileExport(payload);
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField['profile.id'], 'IMPORT_SCHEMA_INVALID');
  assert.equal(byField['profile.createdAt'], 'IMPORT_SCHEMA_INVALID');
  assert.equal(byField['profile.updatedAt'], 'IMPORT_SCHEMA_INVALID');
});

test('ProfileExport: shape errors propagate through validateProfileCreateRequest with profile.* prefix', () => {
  const payload = makeValidProfileExport({
    profile: { ...makeValidProfile(), captureHz: 9, targetLang: 'ja' },
  });
  const errors = validateProfileExport(payload);
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('profile.captureHz'));
  assert.ok(fields.includes('profile.targetLang'));
});

test('PrivacySettings: default settings persist no OCR text/translations/screenshots', () => {
  assert.equal(DEFAULT_PRIVACY_SETTINGS.saveRecentOcrText, false);
  assert.equal(DEFAULT_PRIVACY_SETTINGS.saveRecentTranslations, false);
  assert.equal(DEFAULT_PRIVACY_SETTINGS.saveDebugScreenshots, false);
  assert.equal(DEFAULT_PRIVACY_SETTINGS.recentOcrLimit, 0);
  assert.equal(DEFAULT_PRIVACY_SETTINGS.recentTranslationLimit, 0);
  assert.equal(DEFAULT_PRIVACY_SETTINGS.debugRetentionDays, 0);
  assert.equal(Object.isFrozen(DEFAULT_PRIVACY_SETTINGS), true);
  assert.deepEqual(validatePrivacySettings(DEFAULT_PRIVACY_SETTINGS), []);
});

test('PrivacySettings: invalid booleans, limits, retention, and directory are rejected', () => {
  const errors = validatePrivacySettings({
    saveRecentOcrText: 'yes',
    recentOcrLimit: -1,
    saveRecentTranslations: 1,
    recentTranslationLimit: 1.5,
    saveDebugScreenshots: null,
    debugScreenshotDirectory: '',
    debugRetentionDays: -3,
  });
  const fields = errors.map((error) => error.field);
  for (const expected of [
    'saveRecentOcrText',
    'recentOcrLimit',
    'saveRecentTranslations',
    'recentTranslationLimit',
    'saveDebugScreenshots',
    'debugScreenshotDirectory',
    'debugRetentionDays',
  ]) {
    assert.ok(fields.includes(expected), `expected error for ${expected}`);
  }
  for (const error of errors) {
    assert.equal(error.code, 'VALIDATION_ERROR');
  }
  assert.throws(
    () => assertPrivacySettings({}),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );
});

test('PrivacySettings: optional debugScreenshotDirectory accepts strings when present', () => {
  const settings = makeValidPrivacySettings({
    debugScreenshotDirectory: '/tmp/screens',
  });
  assert.deepEqual(validatePrivacySettings(settings), []);
});

test('PrivacySettings: enabled persistence requires explicit positive budgets', () => {
  const errors = validatePrivacySettings({
    ...DEFAULT_PRIVACY_SETTINGS,
    saveRecentOcrText: true,
    saveRecentTranslations: true,
    saveDebugScreenshots: true,
  });
  const fields = errors.map((error) => error.field);
  assert.ok(fields.includes('recentOcrLimit'));
  assert.ok(fields.includes('recentTranslationLimit'));
  assert.ok(fields.includes('debugRetentionDays'));

  assert.deepEqual(
    validatePrivacySettings({
      ...DEFAULT_PRIVACY_SETTINGS,
      saveRecentOcrText: true,
      recentOcrLimit: 10,
      saveRecentTranslations: true,
      recentTranslationLimit: 10,
      saveDebugScreenshots: true,
      debugRetentionDays: 7,
    }),
    [],
  );
});

test('ProviderKey write: response stays {ok:true} only after provider+apiKey pass', () => {
  for (const provider of ALLOWED_PROVIDERS) {
    assert.deepEqual(
      validateProviderKeyWriteRequest({ apiKey: 'k' }, { provider }),
      [],
    );
    const response = assertProviderKeyWriteRequest(
      { apiKey: 'secret-key-value' },
      { provider },
    );
    assert.deepEqual(response, { ok: true });
    assert.equal(Object.isFrozen(response), true);
    assert.equal(JSON.stringify(response).includes('apiKey'), false);
  }
});

test('ProviderKey write: empty/whitespace/non-string apiKey rejected with VALIDATION_ERROR', () => {
  for (const bad of ['', '   ', undefined, null, 123, {}, []]) {
    const errors = validateProviderKeyWriteRequest(
      { apiKey: bad },
      { provider: 'deepl' },
    );
    assert.ok(errors.some((error) => error.field === 'apiKey'));
    assert.throws(
      () => assertProviderKeyWriteRequest({ apiKey: bad }, { provider: 'deepl' }),
      (error) =>
        error instanceof ContractError && error.code === 'VALIDATION_ERROR',
    );
  }
});

test('ProviderKey write: unknown provider is rejected via PROVIDER_UNKNOWN whether path-bound or in body', () => {
  const fromPath = validateProviderKeyWriteRequest(
    { apiKey: 'k' },
    { provider: 'google' },
  );
  assert.ok(
    fromPath.some(
      (error) => error.field === 'provider' && error.code === 'PROVIDER_UNKNOWN',
    ),
  );

  const fromBody = validateProviderKeyWriteRequest({
    provider: 'google',
    apiKey: 'k',
  });
  assert.ok(
    fromBody.some(
      (error) => error.field === 'provider' && error.code === 'PROVIDER_UNKNOWN',
    ),
  );
});

test('ProviderKey write: path/body provider mismatch is rejected without exposing the key', () => {
  const secret = 'secret-key-value-that-must-not-appear';
  const errors = validateProviderKeyWriteRequest(
    { provider: 'echo', apiKey: secret },
    { provider: 'deepl' },
  );
  assert.ok(
    errors.some(
      (error) => error.field === 'provider' && error.code === 'PROVIDER_PATH_MISMATCH',
    ),
  );
  assert.equal(JSON.stringify(errors).includes(secret), false);

  assert.throws(
    () => assertProviderKeyWriteRequest({ provider: 'echo', apiKey: secret }, { provider: 'deepl' }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'VALIDATION_ERROR' &&
      JSON.stringify(error).includes(secret) === false,
  );
});

test('ProviderKey write: non-object body fails validation', () => {
  assert.throws(
    () => assertProviderKeyWriteRequest(null, { provider: 'deepl' }),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );
});

test('OcrResult: accepts successful and rejected OCR results with controlled reasons', () => {
  assert.deepEqual([...ALLOWED_OCR_REJECTION_REASONS], [
    'EMPTY_TEXT',
    'CONFIDENCE_TOO_LOW',
    'NOISE_TEXT',
    'DUPLICATE_TEXT',
  ]);

  const accepted = {
    text: 'こんにちは',
    normalizedText: 'こんにちは',
    confidence: 0.91,
    durationMs: 12.5,
    accepted: true,
  };
  assert.deepEqual(validateOcrResult(accepted), []);
  assert.strictEqual(assertOcrResult(accepted), accepted);

  for (const rejectionReason of ALLOWED_OCR_REJECTION_REASONS) {
    assert.deepEqual(
      validateOcrResult({
        text: '',
        normalizedText: '',
        confidence: 0,
        durationMs: 0,
        accepted: false,
        rejectionReason,
      }),
      [],
      `expected rejection reason ${rejectionReason} to be accepted`,
    );
  }
});

test('OcrResult: rejects malformed results and keeps diagnostics value-free', () => {
  const secret = 'sk-ABCDEFGHIJKLMNOP1234';
  const rawOcrText = '秘密の原文';
  const errors = validateOcrResult({
    text: 123,
    normalizedText: null,
    confidence: 2,
    durationMs: -1,
    accepted: false,
    rejectionReason: 'UNCONTROLLED_REASON',
    apiKey: secret,
    debugText: rawOcrText,
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.text, 'OCR_RESULT_TEXT_INVALID');
  assert.equal(byField.normalizedText, 'OCR_RESULT_TEXT_INVALID');
  assert.equal(byField.confidence, 'OCR_RESULT_CONFIDENCE_INVALID');
  assert.equal(byField.durationMs, 'OCR_RESULT_DURATION_INVALID');
  assert.equal(byField.rejectionReason, 'OCR_REJECTION_REASON_INVALID');
  assert.equal(byField.apiKey, 'UNKNOWN_OCR_RESULT_FIELD');
  assert.equal(byField.debugText, 'UNKNOWN_OCR_RESULT_FIELD');
  assert.equal(JSON.stringify(errors).includes(secret), false);
  assert.equal(JSON.stringify(errors).includes(rawOcrText), false);

  const acceptedWithReason = validateOcrResult({
    text: rawOcrText,
    normalizedText: rawOcrText,
    confidence: 1,
    durationMs: 1,
    accepted: true,
    rejectionReason: 'EMPTY_TEXT',
  });
  assert.ok(
    acceptedWithReason.some(
      (error) =>
        error.field === 'rejectionReason' &&
        error.code === 'OCR_REJECTION_REASON_INVALID',
    ),
  );
  assert.equal(JSON.stringify(acceptedWithReason).includes(rawOcrText), false);

  const missingAccepted = validateOcrResult({
    text: rawOcrText,
    normalizedText: rawOcrText,
    confidence: 1,
    durationMs: 1,
  });
  assert.ok(
    missingAccepted.some(
      (error) =>
        error.field === 'accepted' &&
        error.code === 'OCR_RESULT_ACCEPTED_INVALID',
    ),
  );
  assert.equal(JSON.stringify(missingAccepted).includes(rawOcrText), false);
});

test('TranslationResult: accepts provider result shape', () => {
  const payload = {
    sourceText: '勇者が来た',
    translatedText: 'The hero has arrived',
    provider: 'deepl',
    durationMs: 123.4,
    cacheHit: false,
  };
  assert.deepEqual(validateTranslationResult(payload), []);
  assert.strictEqual(assertTranslationResult(payload), payload);

  assert.deepEqual(
    validateTranslationResult({
      sourceText: '',
      translatedText: '',
      provider: 'echo',
      durationMs: 0,
      cacheHit: true,
    }),
    [],
  );
});

test('TranslationResult: rejects malformed results and keeps diagnostics value-free', () => {
  const secret = 'sk-ABCDEFGHIJKLMNOP1234';
  const rawText = '秘密の原文';
  const translatedDebug = 'Secret translated debug';
  const errors = validateTranslationResult({
    sourceText: 123,
    translatedText: null,
    provider: 'google',
    durationMs: -1,
    cacheHit: 'yes',
    apiKey: secret,
    rawText,
    translatedDebug,
  });
  const byField = Object.fromEntries(errors.map((error) => [error.field, error.code]));
  assert.equal(byField.sourceText, 'TRANSLATION_RESULT_TEXT_INVALID');
  assert.equal(byField.translatedText, 'TRANSLATION_RESULT_TEXT_INVALID');
  assert.equal(byField.provider, 'PROVIDER_UNKNOWN');
  assert.equal(byField.durationMs, 'TRANSLATION_RESULT_DURATION_INVALID');
  assert.equal(byField.cacheHit, 'TRANSLATION_RESULT_CACHE_HIT_INVALID');
  assert.equal(byField.apiKey, 'UNKNOWN_TRANSLATION_RESULT_FIELD');
  assert.equal(byField.rawText, 'UNKNOWN_TRANSLATION_RESULT_FIELD');
  assert.equal(byField.translatedDebug, 'UNKNOWN_TRANSLATION_RESULT_FIELD');
  assert.equal(JSON.stringify(errors).includes(secret), false);
  assert.equal(JSON.stringify(errors).includes(rawText), false);
  assert.equal(JSON.stringify(errors).includes(translatedDebug), false);
  assert.throws(
    () => assertTranslationResult(null),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );
});

test('ALLOWED_OCR_PRESETS exposes the v1 controlled vocabulary', () => {
  assert.deepEqual([...ALLOWED_OCR_PRESETS], [
    'default_dialogue',
    'pixel_font_dark_bg',
    'pixel_font_light_bg',
    'high_contrast',
    'adv_textbox',
    'menu_text',
  ]);
});

test('OverlayThemeCreateRequest: requires name plus cssJson or baseThemeId', () => {
  assert.deepEqual(
    validateOverlayThemeCreateRequest({
      name: 'Readable Theme',
      cssJson: {
        fontFamily: 'Arial',
        fontSizePx: 32,
        visibleLines: 2,
        builtInStyle: true,
      },
    }),
    [],
  );
  assert.deepEqual(
    assertOverlayThemeCreateRequest({
      name: 'Duplicate Classic',
      baseThemeId: 'classic_subtitle',
    }),
    { name: 'Duplicate Classic', baseThemeId: 'classic_subtitle' },
  );

  const missingSource = validateOverlayThemeCreateRequest({ name: 'No Source' });
  assert.ok(
    missingSource.some((error) => error.message.includes('baseThemeId or cssJson')),
  );

  const unknown = validateOverlayThemeCreateRequest({
    name: 'Bad',
    cssJson: { fontFamily: 'Arial' },
    apiKey: 'should-not-enter-db',
  });
  assert.ok(
    unknown.some(
      (error) => error.field === 'apiKey' && error.code === 'UNKNOWN_THEME_FIELD',
    ),
  );
});

test('Theme cssJson rejects nested, non-finite, null, and forbidden fields', () => {
  const errors = validateThemeCssJson({
    okString: 'Arial',
    okNumber: 42,
    okBoolean: false,
    nested: { color: '#fff' },
    badNumber: Infinity,
    nullValue: null,
    apiKey: 'secret',
    translatedText: 'hello',
  });
  assert.ok(errors.some((error) => error.field === 'cssJson.nested'));
  assert.ok(errors.some((error) => error.field === 'cssJson.badNumber'));
  assert.ok(errors.some((error) => error.field === 'cssJson.nullValue'));
  assert.ok(errors.some((error) => error.code === 'THEME_CSS_FORBIDDEN_FIELD'));
  assert.equal(JSON.stringify(errors).includes('secret'), false);
});

test('OverlayThemeUpdateRequest: partial update accepted and empty/unknown rejected', () => {
  assert.deepEqual(
    assertOverlayThemeUpdateRequest({ name: 'Updated Theme' }),
    { name: 'Updated Theme' },
  );
  assert.deepEqual(
    validateOverlayThemeUpdateRequest({ cssJson: { fontSizePx: 28 } }),
    [],
  );

  const empty = validateOverlayThemeUpdateRequest({});
  assert.ok(empty.some((error) => error.message.includes('at least one field')));

  const unknown = validateOverlayThemeUpdateRequest({ baseThemeId: 'minimal' });
  assert.ok(
    unknown.some(
      (error) => error.field === 'baseThemeId' && error.code === 'UNKNOWN_THEME_FIELD',
    ),
  );
});

test('GlossaryImportRequest: format and content are controlled', () => {
  assert.deepEqual([...ALLOWED_GLOSSARY_IMPORT_FORMATS], ['json', 'csv']);
  for (const format of ALLOWED_GLOSSARY_IMPORT_FORMATS) {
    assert.deepEqual(
      assertGlossaryImportRequest({ format, content: 'sourceTerm,targetTerm\n勇者,hero' }),
      { format, content: 'sourceTerm,targetTerm\n勇者,hero' },
    );
  }

  const invalid = validateGlossaryImportRequest({
    format: 'xlsx',
    content: '',
    apiKey: 'should-not-enter-db',
  });
  assert.ok(
    invalid.some(
      (error) => error.field === 'format' && error.code === 'GLOSSARY_IMPORT_FORMAT_INVALID',
    ),
  );
  assert.ok(invalid.some((error) => error.field === 'content'));
  assert.ok(
    invalid.some(
      (error) =>
        error.field === 'apiKey' &&
        error.code === 'UNKNOWN_GLOSSARY_IMPORT_FIELD',
    ),
  );
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
