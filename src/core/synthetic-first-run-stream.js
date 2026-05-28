'use strict';

const crypto = require('node:crypto');

const {
  ContractError,
  redactDiagnosticString,
} = require('../contracts/security');
const { OverlayState } = require('./subtitle-state');
const { runOcrToOverlayPipeline } = require('./runtime-pipeline');

const SCHEMA_VERSION = 'synthetic-first-run-stream.v1';
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000;
const SYNTHETIC_OCR_CANDIDATE = Object.freeze({
  text: '勇者と魔王',
  confidence: 0.95,
  durationMs: 5,
});

const FAILURE_REASONS = Object.freeze({
  OCR_REJECTED: 'OCR_REJECTED',
  PIPELINE_ERROR: 'PIPELINE_ERROR',
  TIMEOUT: 'TIMEOUT',
});

const PRIVACY_GUARANTEES = Object.freeze({
  sourceTextIncluded: false,
  translatedTextIncluded: false,
  imagesIncluded: false,
  apiKeysIncluded: false,
  persistenceUsed: false,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validationError(message) {
  return new ContractError('VALIDATION_ERROR', message);
}

function resolveNowMs(clock) {
  if (typeof clock === 'function') {
    const value = clock();
    if (value instanceof Date) {
      const time = value.getTime();
      if (Number.isFinite(time)) return time;
    }
    if (isFiniteNumber(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return Date.now();
}

function toIsoTimestamp(ms) {
  if (!isFiniteNumber(ms)) return new Date(0).toISOString();
  return new Date(ms).toISOString();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function profileFingerprint(profile) {
  if (!isObject(profile)) {
    return Object.freeze({
      profileId: null,
      provider: null,
      targetLang: null,
      themeId: null,
    });
  }
  const profileId = typeof profile.id === 'string'
    ? profile.id
    : (typeof profile.profileId === 'string' ? profile.profileId : null);
  const provider = typeof profile.translationProvider === 'string'
    ? profile.translationProvider
    : (typeof profile.provider === 'string' ? profile.provider : null);
  const targetLang = typeof profile.targetLang === 'string' ? profile.targetLang : null;
  const themeId = typeof profile.themeId === 'string' ? profile.themeId : null;
  return Object.freeze({ profileId, provider, targetLang, themeId });
}

function buildFailureSummary(reason, error) {
  const summary = Object.create(null);
  summary.reason = reason;
  if (error == null) {
    summary.code = reason;
    summary.message = '';
    return Object.freeze(summary);
  }
  summary.code = typeof error.code === 'string' ? error.code : reason;
  const rawMessage = typeof error.message === 'string' ? error.message : '';
  summary.message = redactDiagnosticString(rawMessage);
  const fieldErrors = error.details && Array.isArray(error.details.fieldErrors)
    ? error.details.fieldErrors
    : null;
  if (fieldErrors !== null) {
    summary.fieldErrors = Object.freeze(
      fieldErrors.map((entry) => Object.freeze({
        field: typeof entry?.field === 'string' ? entry.field : '',
        code: typeof entry?.code === 'string' ? entry.code : 'UNKNOWN',
      })),
    );
  }
  return Object.freeze(summary);
}

function buildSubtitleEvidence(frame) {
  return Object.freeze({
    id: frame.id,
    provider: frame.provider,
    themeId: frame.themeId,
    displayMs: frame.displayMs,
    createdAt: frame.createdAt,
    translatedTextSha256: sha256Hex(frame.translatedText),
    escapedTextSha256: sha256Hex(frame.escapedText),
  });
}

function freezeSummary(parts) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    startedAt: parts.startedAt,
    completedAt: parts.completedAt,
    durationMs: parts.durationMs,
    maxDurationMs: parts.maxDurationMs,
    withinBudget: parts.withinBudget,
    profileId: parts.fingerprint.profileId,
    provider: parts.fingerprint.provider,
    targetLang: parts.fingerprint.targetLang,
    themeId: parts.fingerprint.themeId,
    stage: parts.stage,
    overlayPublished: parts.overlayPublished,
    subtitle: parts.subtitle,
    failure: parts.failure,
    privacy: PRIVACY_GUARANTEES,
  });
}

async function runSyntheticFirstRunStream(input = {}) {
  const {
    profile,
    provider,
    clock,
    idFactory,
    overlayState: providedOverlayState,
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
  } = input;

  if (!isFiniteNumber(maxDurationMs) || maxDurationMs <= 0) {
    throw validationError('maxDurationMs must be a positive finite number');
  }

  const fingerprint = profileFingerprint(profile);
  const startedAtMs = resolveNowMs(clock);
  const overlayState = providedOverlayState === undefined
    ? new OverlayState({ clock })
    : providedOverlayState;

  let pipelineResult = null;
  let pipelineError = null;
  try {
    pipelineResult = await runOcrToOverlayPipeline({
      profile,
      ocrCandidate: SYNTHETIC_OCR_CANDIDATE,
      provider,
      overlayState,
      nowMs: startedAtMs,
      clock,
      idFactory,
      includeSourceText: false,
    });
  } catch (error) {
    pipelineError = error;
  }

  const completedAtMs = resolveNowMs(clock);
  const elapsedMs = Math.max(0, completedAtMs - startedAtMs);
  const withinBudget = elapsedMs <= maxDurationMs;

  const baseParts = {
    startedAt: toIsoTimestamp(startedAtMs),
    completedAt: toIsoTimestamp(completedAtMs),
    durationMs: elapsedMs,
    maxDurationMs,
    withinBudget,
    fingerprint,
  };

  if (pipelineError !== null) {
    return freezeSummary({
      ...baseParts,
      stage: 'error',
      overlayPublished: false,
      subtitle: null,
      failure: buildFailureSummary(FAILURE_REASONS.PIPELINE_ERROR, pipelineError),
    });
  }

  if (!pipelineResult.accepted) {
    return freezeSummary({
      ...baseParts,
      stage: pipelineResult.stage,
      overlayPublished: false,
      subtitle: null,
      failure: buildFailureSummary(FAILURE_REASONS.OCR_REJECTED, {
        code: pipelineResult.rejectionReason || 'OCR_REJECTED',
        message: 'Synthetic OCR candidate was rejected before translation',
      }),
    });
  }

  const overlayLatest = overlayState.latestFrame();
  const overlayPublished = overlayLatest !== null
    && overlayLatest.id === pipelineResult.subtitleFrame.id;

  if (!withinBudget) {
    return freezeSummary({
      ...baseParts,
      stage: pipelineResult.stage,
      overlayPublished,
      subtitle: overlayPublished ? buildSubtitleEvidence(pipelineResult.subtitleFrame) : null,
      failure: buildFailureSummary(FAILURE_REASONS.TIMEOUT, {
        code: FAILURE_REASONS.TIMEOUT,
        message: `Synthetic pipeline exceeded budget of ${maxDurationMs}ms`,
      }),
    });
  }

  return freezeSummary({
    ...baseParts,
    stage: pipelineResult.stage,
    overlayPublished,
    subtitle: overlayPublished ? buildSubtitleEvidence(pipelineResult.subtitleFrame) : null,
    failure: null,
  });
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_MAX_DURATION_MS,
  SYNTHETIC_OCR_CANDIDATE,
  FAILURE_REASONS,
  PRIVACY_GUARANTEES,
  runSyntheticFirstRunStream,
};
