'use strict';

const { ContractError } = require('./security');

const ALLOWED_CAPTURE_HZ = Object.freeze([0, 1, 2, 3, 4]);
const ALLOWED_TARGET_LANGS = Object.freeze(['en']);
const ALLOWED_PROVIDERS = Object.freeze(['deepl', 'echo']);

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

module.exports = {
  ALLOWED_CAPTURE_HZ,
  ALLOWED_TARGET_LANGS,
  ALLOWED_PROVIDERS,
  fieldError,
  validateCaptureHz,
  validateRoiRect,
  validateOcrConfidenceFloor,
  validateTargetLang,
  assertTargetLang,
  validateProvider,
  assertProvider,
  validateProfileCore,
  throwIfErrors,
};
