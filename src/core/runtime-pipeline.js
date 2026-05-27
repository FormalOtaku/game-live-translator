'use strict';

const { ContractError } = require('../contracts/security');
const {
  assertProvider: assertProviderId,
  assertTargetLang,
  fieldError,
} = require('../contracts/validation');
const {
  DEFAULT_CONFIDENCE_FLOOR,
  DuplicateSuppressor,
  OCR_REJECTION_REASONS,
  evaluateOcrCandidate,
  hashNormalizedText,
} = require('./ocr-text');
const { prepareTranslationInput } = require('./translation-cache');
const {
  DEFAULT_DISPLAY_MS,
  DEFAULT_THEME_ID,
  OverlayState,
  createSubtitleFrame,
} = require('./subtitle-state');

const PIPELINE_STAGES = Object.freeze({
  OCR: 'ocr',
  TRANSLATION: 'translation',
  OVERLAY: 'overlay',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validationError(fieldErrors) {
  return new ContractError('VALIDATION_ERROR', 'Runtime pipeline validation failed', {
    fieldErrors,
  });
}

function normalizeRequiredString(value, field) {
  if (typeof value !== 'string') {
    throw validationError([
      fieldError(field, 'FIELD_REQUIRED', `${field} must be a non-empty string`),
    ]);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) {
    throw validationError([
      fieldError(field, 'FIELD_REQUIRED', `${field} must be a non-empty string`),
    ]);
  }
  return normalized;
}

function normalizeProfile(profile) {
  if (!isObject(profile)) {
    throw validationError([
      fieldError('profile', 'PROFILE_INVALID', 'profile must be an object'),
    ]);
  }

  const profileId = normalizeRequiredString(profile.id ?? profile.profileId, 'profile.id');
  const provider = assertProviderId(profile.translationProvider ?? profile.provider);
  const targetLang = assertTargetLang(profile.targetLang ?? 'en');
  const ocrConfidenceFloor = profile.ocrConfidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  if (!isFiniteNumber(ocrConfidenceFloor) || ocrConfidenceFloor < 0 || ocrConfidenceFloor > 1) {
    throw validationError([
      fieldError(
        'profile.ocrConfidenceFloor',
        'OCR_CONFIDENCE_FLOOR_INVALID',
        'ocrConfidenceFloor must be between 0 and 1 inclusive',
      ),
    ]);
  }

  const displayMs = profile.subtitleDisplayMs ?? profile.displayMs ?? DEFAULT_DISPLAY_MS;
  if (!isFiniteNumber(displayMs) || displayMs <= 0) {
    throw validationError([
      fieldError('profile.subtitleDisplayMs', 'DISPLAY_MS_INVALID', 'subtitleDisplayMs must be > 0'),
    ]);
  }

  return Object.freeze({
    profileId,
    provider,
    targetLang,
    ocrConfidenceFloor,
    themeId: profile.themeId ?? DEFAULT_THEME_ID,
    displayMs,
    glossary: profile.glossary ?? [],
  });
}

function assertProviderAdapter(provider, expectedName) {
  if (!isObject(provider) || typeof provider.translate !== 'function') {
    throw validationError([
      fieldError('provider', 'PROVIDER_ADAPTER_INVALID', 'provider must expose translate(input)'),
    ]);
  }
  if (typeof provider.name !== 'string' || provider.name.trim().length === 0) {
    throw validationError([
      fieldError('provider.name', 'PROVIDER_NAME_REQUIRED', 'provider.name must be a non-empty string'),
    ]);
  }
  if (provider.name !== expectedName) {
    throw validationError([
      fieldError(
        'provider.name',
        'PROVIDER_MISMATCH',
        `provider.name must match profile translationProvider ${expectedName}`,
      ),
    ]);
  }
}

function buildDuplicateRejection(evaluation) {
  return Object.freeze({
    text: evaluation.text,
    normalizedText: evaluation.normalizedText,
    confidence: evaluation.confidence,
    durationMs: evaluation.durationMs,
    accepted: false,
    rejectionReason: OCR_REJECTION_REASONS.DUPLICATE_TEXT,
  });
}

function processOcrForRuntime(ocrCandidate, options) {
  const evaluation = evaluateOcrCandidate(ocrCandidate, {
    confidenceFloor: options.confidenceFloor,
  });
  if (!evaluation.accepted) {
    return Object.freeze({ ocr: evaluation, duplicateHash: null, duplicateRecordedAt: null });
  }

  const duplicateSuppressor = options.duplicateSuppressor;
  if (duplicateSuppressor === undefined) {
    return Object.freeze({ ocr: evaluation, duplicateHash: null, duplicateRecordedAt: null });
  }

  const duplicateRecordedAt = options.nowMs ?? Date.now();
  const duplicateHash = hashNormalizedText(evaluation.normalizedText);
  if (duplicateSuppressor.hasHash(duplicateHash, duplicateRecordedAt)) {
    return Object.freeze({
      ocr: buildDuplicateRejection(evaluation),
      duplicateHash: null,
      duplicateRecordedAt: null,
    });
  }

  return Object.freeze({ ocr: evaluation, duplicateHash, duplicateRecordedAt });
}

function assertDuplicateSuppressor(duplicateSuppressor) {
  if (duplicateSuppressor === undefined) return;
  if (!(duplicateSuppressor instanceof DuplicateSuppressor)) {
    throw validationError([
      fieldError(
        'duplicateSuppressor',
        'DUPLICATE_SUPPRESSOR_INVALID',
        'duplicateSuppressor must be a DuplicateSuppressor instance',
      ),
    ]);
  }
}

function assertOverlayState(overlayState) {
  if (overlayState === undefined) return;
  if (!(overlayState instanceof OverlayState)) {
    throw validationError([
      fieldError('overlayState', 'OVERLAY_STATE_INVALID', 'overlayState must be an OverlayState instance'),
    ]);
  }
}

function assertTranslationResult(translation, expectedProvider) {
  if (!isObject(translation) || typeof translation.translatedText !== 'string') {
    throw validationError([
      fieldError('translation', 'TRANSLATION_RESULT_INVALID', 'translation result must include translatedText'),
    ]);
  }
  if (translation.provider !== expectedProvider) {
    throw validationError([
      fieldError(
        'translation.provider',
        'TRANSLATION_PROVIDER_MISMATCH',
        `translation.provider must match profile translationProvider ${expectedProvider}`,
      ),
    ]);
  }
}

function overlaySnapshotOrNull(overlayState) {
  if (overlayState === undefined) return null;
  return overlayState.snapshot();
}

function freezeRejectedResult({ ocr, overlayState }) {
  return Object.freeze({
    accepted: false,
    stage: PIPELINE_STAGES.OCR,
    rejectionReason: ocr.rejectionReason,
    ocr,
    translationInput: null,
    cacheKey: null,
    translation: null,
    subtitleFrame: null,
    overlaySnapshot: overlaySnapshotOrNull(overlayState),
  });
}

async function runOcrToOverlayPipeline(input = {}) {
  const {
    profile,
    ocrCandidate = {},
    provider,
    duplicateSuppressor,
    overlayState,
    nowMs,
    clock,
    idFactory,
    includeSourceText = false,
  } = input;

  const normalizedProfile = normalizeProfile(profile);
  assertProviderAdapter(provider, normalizedProfile.provider);
  assertDuplicateSuppressor(duplicateSuppressor);
  assertOverlayState(overlayState);

  const ocrResult = processOcrForRuntime(ocrCandidate, {
    confidenceFloor: normalizedProfile.ocrConfidenceFloor,
    duplicateSuppressor,
    nowMs,
  });
  const { ocr } = ocrResult;

  if (!ocr.accepted) {
    return freezeRejectedResult({ ocr, overlayState });
  }

  const translationInput = prepareTranslationInput({
    text: ocr.normalizedText,
    glossary: normalizedProfile.glossary,
    provider: normalizedProfile.provider,
    targetLang: normalizedProfile.targetLang,
  });

  const translation = await provider.translate({
    sourceText: translationInput.glossaryAppliedText,
    targetLang: normalizedProfile.targetLang,
  });
  assertTranslationResult(translation, normalizedProfile.provider);

  const subtitleFrame = createSubtitleFrame({
    profileId: normalizedProfile.profileId,
    sourceText: translationInput.sourceText,
    translatedText: translation.translatedText,
    provider: translation.provider,
    confidence: ocr.confidence,
    displayMs: normalizedProfile.displayMs,
    themeId: normalizedProfile.themeId,
    includeSourceText,
  }, { clock, idFactory, includeSourceText });

  const overlaySnapshot = overlayState === undefined
    ? null
    : overlayState.publishFrame(subtitleFrame);
  if (duplicateSuppressor !== undefined && ocrResult.duplicateHash !== null) {
    duplicateSuppressor.recordHash(ocrResult.duplicateHash, ocrResult.duplicateRecordedAt);
  }

  return Object.freeze({
    accepted: true,
    stage: overlayState === undefined ? PIPELINE_STAGES.TRANSLATION : PIPELINE_STAGES.OVERLAY,
    rejectionReason: null,
    ocr,
    translationInput,
    cacheKey: translationInput.cacheKey,
    translation,
    subtitleFrame,
    overlaySnapshot,
  });
}

module.exports = {
  PIPELINE_STAGES,
  runOcrToOverlayPipeline,
};
