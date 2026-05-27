'use strict';

const {
  ContractError,
  FORBIDDEN_PROFILE_EXPORT_FIELDS,
  apiKeyWriteResponse,
  findForbiddenExportFields,
} = require('./security');

const ALLOWED_CAPTURE_HZ = Object.freeze([0, 1, 2, 3, 4]);
const ALLOWED_TARGET_LANGS = Object.freeze(['en']);
const ALLOWED_PROVIDERS = Object.freeze(['deepl', 'echo']);

// v1 OCR presets are a controlled vocabulary (PRODUCT_SPEC.md FR-002). Profiles
// must reference one of these ids so the OCR pipeline can resolve preset
// parameters deterministically; arbitrary preset strings are rejected.
const ALLOWED_OCR_PRESETS = Object.freeze([
  'default_dialogue',
  'pixel_font_dark_bg',
  'pixel_font_light_bg',
  'high_contrast',
  'adv_textbox',
  'menu_text',
]);

const ALLOWED_CAPTURE_SOURCE_KINDS = Object.freeze(['monitor', 'window']);

// ProfileExport schema constants. Bump PROFILE_EXPORT_SCHEMA_VERSION through
// MIGRATION_PLAN.md before changing the export shape.
const PROFILE_EXPORT_SCHEMA_VERSION = 1;
const PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY =
  'reject_api_keys_ocr_text_translation_text_images_logs';

function fieldError(field, code, message) {
  return { field, code, message };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateCaptureHz(value) {
  const errors = [];
  if (!ALLOWED_CAPTURE_HZ.includes(value)) {
    errors.push(
      fieldError(
        'captureHz',
        'CAPTURE_HZ_INVALID',
        `captureHz must be one of ${ALLOWED_CAPTURE_HZ.join(', ')}`,
      ),
    );
  }
  return errors;
}

function validateRoiRect(rect, basePath = 'roi') {
  const errors = [];
  if (rect == null || typeof rect !== 'object' || Array.isArray(rect)) {
    errors.push(fieldError(basePath, 'ROI_INVALID', 'roi must be an object'));
    return errors;
  }

  for (const key of ['x', 'y', 'width', 'height']) {
    if (!isFiniteNumber(rect[key])) {
      errors.push(
        fieldError(
          `${basePath}.${key}`,
          'ROI_INVALID',
          `${key} must be a finite number`,
        ),
      );
    }
  }

  if (isFiniteNumber(rect.width) && rect.width <= 0) {
    errors.push(fieldError(`${basePath}.width`, 'ROI_INVALID', 'width must be > 0'));
  }
  if (isFiniteNumber(rect.height) && rect.height <= 0) {
    errors.push(fieldError(`${basePath}.height`, 'ROI_INVALID', 'height must be > 0'));
  }

  return errors;
}

function validateOcrConfidenceFloor(value) {
  const errors = [];
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    errors.push(
      fieldError(
        'ocrConfidenceFloor',
        'OCR_CONFIDENCE_FLOOR_INVALID',
        'ocrConfidenceFloor must be a finite number between 0 and 1 inclusive',
      ),
    );
  }
  return errors;
}

function validateTargetLang(value) {
  const errors = [];
  if (!ALLOWED_TARGET_LANGS.includes(value)) {
    errors.push(
      fieldError(
        'targetLang',
        'TARGET_LANG_INVALID',
        `targetLang must be one of ${ALLOWED_TARGET_LANGS.join(', ')}`,
      ),
    );
  }
  return errors;
}

function assertTargetLang(value) {
  if (!ALLOWED_TARGET_LANGS.includes(value)) {
    throw new ContractError(
      'TARGET_LANG_INVALID',
      `targetLang must be one of ${ALLOWED_TARGET_LANGS.join(', ')}`,
      {
        fieldErrors: [
          fieldError(
            'targetLang',
            'TARGET_LANG_INVALID',
            `targetLang must be one of ${ALLOWED_TARGET_LANGS.join(', ')}`,
          ),
        ],
      },
    );
  }
  return value;
}

function assertProvider(value) {
  if (!ALLOWED_PROVIDERS.includes(value)) {
    throw new ContractError(
      'PROVIDER_UNKNOWN',
      `translationProvider must be one of ${ALLOWED_PROVIDERS.join(', ')}`,
      {
        fieldErrors: [
          fieldError(
            'translationProvider',
            'PROVIDER_UNKNOWN',
            `translationProvider must be one of ${ALLOWED_PROVIDERS.join(', ')}`,
          ),
        ],
      },
    );
  }
  return value;
}

function validateProvider(value) {
  const errors = [];
  if (!ALLOWED_PROVIDERS.includes(value)) {
    errors.push(
      fieldError(
        'translationProvider',
        'PROVIDER_UNKNOWN',
        `translationProvider must be one of ${ALLOWED_PROVIDERS.join(', ')}`,
      ),
    );
  }
  return errors;
}

function validateProfileCore(profile) {
  if (profile == null || typeof profile !== 'object' || Array.isArray(profile)) {
    return [fieldError('', 'VALIDATION_ERROR', 'profile must be an object')];
  }

  const errors = [];
  errors.push(...validateCaptureHz(profile.captureHz));
  errors.push(...validateOcrConfidenceFloor(profile.ocrConfidenceFloor));
  errors.push(...validateTargetLang(profile.targetLang));
  errors.push(...validateProvider(profile.translationProvider));
  if (profile.roi !== undefined) {
    errors.push(...validateRoiRect(profile.roi));
  }
  return errors;
}

function throwIfErrors(errors) {
  if (errors.length === 0) return;
  throw new ContractError('VALIDATION_ERROR', 'Validation failed', {
    fieldErrors: errors,
  });
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function validateNonEmptyString(value, field, code = 'VALIDATION_ERROR') {
  if (!isNonEmptyString(value)) {
    return [fieldError(field, code, `${field} must be a non-empty string`)];
  }
  return [];
}

function validateOptionalString(value, field) {
  if (value === undefined) return [];
  if (typeof value !== 'string') {
    return [fieldError(field, 'VALIDATION_ERROR', `${field} must be a string`)];
  }
  return [];
}

function validateOcrPreset(value, field = 'ocrPreset') {
  if (!ALLOWED_OCR_PRESETS.includes(value)) {
    return [
      fieldError(
        field,
        'OCR_PRESET_INVALID',
        `${field} must be one of ${ALLOWED_OCR_PRESETS.join(', ')}`,
      ),
    ];
  }
  return [];
}

function validateOverlayThemeId(value, field = 'overlayThemeId') {
  return validateNonEmptyString(value, field);
}

function validateCaptureSource(captureSource, basePath = 'captureSource') {
  if (!isPlainObject(captureSource)) {
    return [fieldError(basePath, 'VALIDATION_ERROR', `${basePath} must be an object`)];
  }
  const errors = [];
  if (!ALLOWED_CAPTURE_SOURCE_KINDS.includes(captureSource.kind)) {
    errors.push(
      fieldError(
        `${basePath}.kind`,
        'CAPTURE_SOURCE_KIND_INVALID',
        `${basePath}.kind must be one of ${ALLOWED_CAPTURE_SOURCE_KINDS.join(', ')}`,
      ),
    );
  }
  errors.push(...validateNonEmptyString(captureSource.id, `${basePath}.id`));
  errors.push(...validateNonEmptyString(captureSource.label, `${basePath}.label`));
  if (captureSource.bounds !== undefined) {
    errors.push(...validateRoiRect(captureSource.bounds, `${basePath}.bounds`));
  }
  return errors;
}

function validateGlossaryTerm(term, basePath) {
  if (!isPlainObject(term)) {
    return [fieldError(basePath, 'VALIDATION_ERROR', `${basePath} must be an object`)];
  }
  const errors = [];
  errors.push(...validateNonEmptyString(term.id, `${basePath}.id`));
  errors.push(...validateNonEmptyString(term.sourceTerm, `${basePath}.sourceTerm`));
  errors.push(...validateNonEmptyString(term.targetTerm, `${basePath}.targetTerm`));
  errors.push(...validateOptionalString(term.note, `${basePath}.note`));
  return errors;
}

function validateGlossary(glossary, basePath = 'glossary') {
  if (!Array.isArray(glossary)) {
    return [fieldError(basePath, 'VALIDATION_ERROR', `${basePath} must be an array`)];
  }
  const errors = [];
  for (let i = 0; i < glossary.length; i += 1) {
    errors.push(...validateGlossaryTerm(glossary[i], `${basePath}[${i}]`));
  }
  return errors;
}

// Shared per-field validators for ProfileCreateRequest fields. The map is
// consulted by both create (all required) and update (any subset) flows so the
// two surfaces stay aligned without duplicating per-field code.
const PROFILE_FIELD_VALIDATORS = Object.freeze({
  name: (value) => validateNonEmptyString(value, 'name'),
  gameTitle: (value) => validateOptionalString(value, 'gameTitle'),
  captureSource: (value) => validateCaptureSource(value, 'captureSource'),
  roi: (value) => validateRoiRect(value, 'roi'),
  ocrPreset: (value) => validateOcrPreset(value, 'ocrPreset'),
  ocrConfidenceFloor: (value) => validateOcrConfidenceFloor(value),
  captureHz: (value) => validateCaptureHz(value),
  translationProvider: (value) => validateProvider(value),
  targetLang: (value) => validateTargetLang(value),
  overlayThemeId: (value) => validateOverlayThemeId(value, 'overlayThemeId'),
  glossary: (value) => validateGlossary(value, 'glossary'),
});

const PROFILE_CREATE_REQUIRED_FIELDS = Object.freeze([
  'name',
  'ocrPreset',
  'ocrConfidenceFloor',
  'captureHz',
  'translationProvider',
  'targetLang',
  'overlayThemeId',
  'glossary',
]);

const PROFILE_CREATE_OPTIONAL_FIELDS = Object.freeze([
  'gameTitle',
  'captureSource',
  'roi',
]);

function validateProfileCreateRequest(payload) {
  if (!isPlainObject(payload)) {
    return [
      fieldError('', 'VALIDATION_ERROR', 'ProfileCreateRequest must be an object'),
    ];
  }
  const errors = [];
  const writableFields = new Set([
    ...PROFILE_CREATE_REQUIRED_FIELDS,
    ...PROFILE_CREATE_OPTIONAL_FIELDS,
  ]);
  for (const field of Object.keys(payload)) {
    if (!writableFields.has(field)) {
      errors.push(
        fieldError(
          field,
          'UNKNOWN_PROFILE_FIELD',
          `${field} is not a writable profile field`,
        ),
      );
    }
  }
  for (const field of PROFILE_CREATE_REQUIRED_FIELDS) {
    if (!(field in payload)) {
      errors.push(
        fieldError(field, 'VALIDATION_ERROR', `${field} is required`),
      );
      continue;
    }
    errors.push(...PROFILE_FIELD_VALIDATORS[field](payload[field]));
  }
  for (const field of PROFILE_CREATE_OPTIONAL_FIELDS) {
    if (payload[field] === undefined) continue;
    errors.push(...PROFILE_FIELD_VALIDATORS[field](payload[field]));
  }
  return errors;
}

function validateProfileUpdateRequest(payload) {
  if (!isPlainObject(payload)) {
    return [
      fieldError('', 'VALIDATION_ERROR', 'ProfileUpdateRequest must be an object'),
    ];
  }
  const errors = [];
  let provided = 0;
  for (const field of Object.keys(payload)) {
    const validator = PROFILE_FIELD_VALIDATORS[field];
    if (!validator) {
      errors.push(
        fieldError(
          field,
          'UNKNOWN_PROFILE_FIELD',
          `${field} is not a writable profile field`,
        ),
      );
      continue;
    }
    provided += 1;
    errors.push(...validator(payload[field]));
  }
  if (provided === 0 && errors.length === 0) {
    errors.push(
      fieldError(
        '',
        'VALIDATION_ERROR',
        'ProfileUpdateRequest must update at least one field',
      ),
    );
  }
  return errors;
}

function assertProfileCreateRequest(payload) {
  throwIfErrors(validateProfileCreateRequest(payload));
  return payload;
}

function assertProfileUpdateRequest(payload) {
  throwIfErrors(validateProfileUpdateRequest(payload));
  return payload;
}

function validatePrivacySettings(payload) {
  if (!isPlainObject(payload)) {
    return [
      fieldError('', 'VALIDATION_ERROR', 'PrivacySettings must be an object'),
    ];
  }
  const errors = [];
  for (const field of [
    'saveRecentOcrText',
    'saveRecentTranslations',
    'saveDebugScreenshots',
  ]) {
    if (typeof payload[field] !== 'boolean') {
      errors.push(
        fieldError(field, 'VALIDATION_ERROR', `${field} must be a boolean`),
      );
    }
  }
  for (const field of [
    'recentOcrLimit',
    'recentTranslationLimit',
    'debugRetentionDays',
  ]) {
    if (!isNonNegativeInteger(payload[field])) {
      errors.push(
        fieldError(
          field,
          'VALIDATION_ERROR',
          `${field} must be a non-negative integer`,
        ),
      );
    }
  }
  if (payload.debugScreenshotDirectory !== undefined) {
    if (typeof payload.debugScreenshotDirectory !== 'string') {
      errors.push(
        fieldError(
          'debugScreenshotDirectory',
          'VALIDATION_ERROR',
          'debugScreenshotDirectory must be a string',
        ),
      );
    } else if (payload.debugScreenshotDirectory.length === 0) {
      errors.push(
        fieldError(
          'debugScreenshotDirectory',
          'VALIDATION_ERROR',
          'debugScreenshotDirectory must be a non-empty string when present',
        ),
      );
    }
  }

  if (
    payload.saveRecentOcrText === true &&
    isNonNegativeInteger(payload.recentOcrLimit) &&
    payload.recentOcrLimit === 0
  ) {
    errors.push(
      fieldError(
        'recentOcrLimit',
        'VALIDATION_ERROR',
        'recentOcrLimit must be greater than 0 when saveRecentOcrText is enabled',
      ),
    );
  }
  if (
    payload.saveRecentTranslations === true &&
    isNonNegativeInteger(payload.recentTranslationLimit) &&
    payload.recentTranslationLimit === 0
  ) {
    errors.push(
      fieldError(
        'recentTranslationLimit',
        'VALIDATION_ERROR',
        'recentTranslationLimit must be greater than 0 when saveRecentTranslations is enabled',
      ),
    );
  }
  if (
    payload.saveDebugScreenshots === true &&
    isNonNegativeInteger(payload.debugRetentionDays) &&
    payload.debugRetentionDays === 0
  ) {
    errors.push(
      fieldError(
        'debugRetentionDays',
        'VALIDATION_ERROR',
        'debugRetentionDays must be greater than 0 when saveDebugScreenshots is enabled',
      ),
    );
  }
  return errors;
}

function assertPrivacySettings(payload) {
  throwIfErrors(validatePrivacySettings(payload));
  return payload;
}

// Provider key write requests are intentionally write-only: callers send the
// {provider, apiKey} pair, the API persists it through OS secure storage, and
// the response is always `{ ok: true }`. The validator only inspects the
// REQUEST envelope and does not echo or return the apiKey.
function validateProviderKeyWriteRequest(payload, options = {}) {
  const provider = options.provider;
  const errors = [];

  if (provider === undefined) {
    if (!isPlainObject(payload)) {
      return [
        fieldError(
          '',
          'VALIDATION_ERROR',
          'ProviderKey write request must be an object',
        ),
      ];
    }
    if (!ALLOWED_PROVIDERS.includes(payload.provider)) {
      errors.push(
        fieldError(
          'provider',
          'PROVIDER_UNKNOWN',
          `provider must be one of ${ALLOWED_PROVIDERS.join(', ')}`,
        ),
      );
    }
  } else if (!ALLOWED_PROVIDERS.includes(provider)) {
    errors.push(
      fieldError(
        'provider',
        'PROVIDER_UNKNOWN',
        `provider must be one of ${ALLOWED_PROVIDERS.join(', ')}`,
      ),
    );
  } else if (
    isPlainObject(payload) &&
    payload.provider !== undefined &&
    payload.provider !== provider
  ) {
    errors.push(
      fieldError(
        'provider',
        'PROVIDER_PATH_MISMATCH',
        'provider in request body must match the provider path parameter',
      ),
    );
  }

  if (!isPlainObject(payload)) {
    errors.push(
      fieldError(
        '',
        'VALIDATION_ERROR',
        'ProviderKey write request must be an object',
      ),
    );
    return errors;
  }

  if (!isNonEmptyString(payload.apiKey)) {
    errors.push(
      fieldError(
        'apiKey',
        'VALIDATION_ERROR',
        'apiKey must be a non-empty non-whitespace string',
      ),
    );
  }
  return errors;
}

function assertProviderKeyWriteRequest(payload, options) {
  throwIfErrors(validateProviderKeyWriteRequest(payload, options));
  return apiKeyWriteResponse();
}

// ProfileExport validation combines two invariants:
//   1. Shape: schemaVersion=1, profile is a complete Profile, exportedAt is
//      a non-empty string, and forbiddenFieldsPolicy is the controlled token.
//   2. Privacy: no forbidden field name (API keys, OCR text, translated text,
//      screenshots, logs) appears anywhere in the payload, including nested
//      objects and arrays. Shape errors and forbidden-field errors are
//      collected together so callers see one VALIDATION_ERROR with the full
//      fieldErrors list instead of two-stage feedback.
function validateProfileExport(payload) {
  if (!isPlainObject(payload)) {
    return [
      fieldError('', 'VALIDATION_ERROR', 'ProfileExport must be an object'),
    ];
  }

  const errors = [];

  if (payload.schemaVersion !== PROFILE_EXPORT_SCHEMA_VERSION) {
    errors.push(
      fieldError(
        'schemaVersion',
        'IMPORT_SCHEMA_INVALID',
        `schemaVersion must be ${PROFILE_EXPORT_SCHEMA_VERSION}`,
      ),
    );
  }

  if (payload.forbiddenFieldsPolicy !== PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY) {
    errors.push(
      fieldError(
        'forbiddenFieldsPolicy',
        'IMPORT_SCHEMA_INVALID',
        `forbiddenFieldsPolicy must be "${PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY}"`,
      ),
    );
  }

  errors.push(...validateNonEmptyString(payload.exportedAt, 'exportedAt', 'IMPORT_SCHEMA_INVALID'));

  if (!isPlainObject(payload.profile)) {
    errors.push(
      fieldError(
        'profile',
        'IMPORT_SCHEMA_INVALID',
        'profile must be an object',
      ),
    );
  } else {
    const profile = payload.profile;
    errors.push(...validateNonEmptyString(profile.id, 'profile.id', 'IMPORT_SCHEMA_INVALID'));
    errors.push(...validateNonEmptyString(profile.createdAt, 'profile.createdAt', 'IMPORT_SCHEMA_INVALID'));
    errors.push(...validateNonEmptyString(profile.updatedAt, 'profile.updatedAt', 'IMPORT_SCHEMA_INVALID'));
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...profileCreateFields
    } = profile;
    for (const error of validateProfileCreateRequest(profileCreateFields)) {
      if (FORBIDDEN_PROFILE_EXPORT_FIELDS.includes(error.field)) {
        continue;
      }
      errors.push({ ...error, field: error.field ? `profile.${error.field}` : 'profile' });
    }
  }

  const forbidden = findForbiddenExportFields(payload);
  for (const path of forbidden) {
    errors.push(
      fieldError(
        path,
        'IMPORT_CONTAINS_FORBIDDEN_FIELD',
        `${path} is a forbidden field in ProfileExport`,
      ),
    );
  }

  return errors;
}

function assertProfileExport(payload) {
  throwIfErrors(validateProfileExport(payload));
  return payload;
}

module.exports = {
  ALLOWED_CAPTURE_HZ,
  ALLOWED_TARGET_LANGS,
  ALLOWED_PROVIDERS,
  ALLOWED_OCR_PRESETS,
  ALLOWED_CAPTURE_SOURCE_KINDS,
  PROFILE_EXPORT_SCHEMA_VERSION,
  PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
  FORBIDDEN_PROFILE_EXPORT_FIELDS,
  fieldError,
  validateCaptureHz,
  validateRoiRect,
  validateOcrConfidenceFloor,
  validateTargetLang,
  assertTargetLang,
  validateProvider,
  assertProvider,
  validateProfileCore,
  validateOcrPreset,
  validateOverlayThemeId,
  validateCaptureSource,
  validateGlossaryTerm,
  validateGlossary,
  validateProfileCreateRequest,
  assertProfileCreateRequest,
  validateProfileUpdateRequest,
  assertProfileUpdateRequest,
  validatePrivacySettings,
  assertPrivacySettings,
  validateProviderKeyWriteRequest,
  assertProviderKeyWriteRequest,
  validateProfileExport,
  assertProfileExport,
  throwIfErrors,
};
