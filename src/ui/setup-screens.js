'use strict';

// T-011-004: dependency-free Capture/OCR/Translation setup renderer contract.
// This module performs no I/O and keeps provider keys plus manual translation
// text behind fetch-time intent makeBody functions. Preview result objects carry
// containsSensitiveText=true so downstream renderer code treats them as visible
// UI-only data and routes diagnostics through safeSetupScreensStateForLog.

const {
  ALLOWED_CAPTURE_HZ,
  ALLOWED_OCR_PRESETS,
  ALLOWED_PROVIDERS,
  ALLOWED_TARGET_LANGS,
  validateCaptureSourcesResponse,
  validateOcrResult,
  validateOcrTestRequest,
  validateProfileUpdateRequest,
  validateProviderKeyWriteRequest,
  validateTranslationResult,
  validateTranslateTestRequest,
} = require('../contracts/validation');
const { ContractError, redactSecrets } = require('../contracts/security');

const REDACTED = '[REDACTED]';
const DEFAULT_OCR_PRESET = 'default_dialogue';
const DEFAULT_OCR_CONFIDENCE_FLOOR = 0.6;
const DEFAULT_CAPTURE_HZ = 2;
const DEFAULT_TARGET_LANG = 'en';

const SETUP_SCREEN_DEFINITIONS = Object.freeze([
  defineScreen({
    id: 'capture-setup',
    title: 'Capture Setup',
    route: 'capture-setup',
  }),
  defineScreen({
    id: 'ocr-preview',
    title: 'OCR Preview',
    route: 'ocr-preview',
  }),
  defineScreen({
    id: 'translation-settings',
    title: 'Translation Settings',
    route: 'translation-settings',
  }),
]);

const SETUP_SCREEN_IDS = Object.freeze(SETUP_SCREEN_DEFINITIONS.map((screen) => screen.id));

const SETUP_ACTION_IDS = Object.freeze([
  'refresh_sources',
  'select_capture_source',
  'redraw_roi',
  'save_capture_settings',
  'save_ocr_settings',
  'run_ocr_preview',
  'edit_ocr_settings',
  'save_translation_settings',
  'save_provider_key',
  'run_translation_preview',
  'edit_api_key',
  'switch_provider',
  'retry',
  'check_network',
  'wait_and_retry',
  'open_diagnostics',
  'open_profiles',
]);

const PROVIDERS_REQUIRING_KEY = Object.freeze(['deepl']);

const DRAFT_FIELDS = Object.freeze([
  'captureSource',
  'roi',
  'captureHz',
  'ocrPreset',
  'ocrConfidenceFloor',
  'translationProvider',
  'targetLang',
]);

const PROFILE_UPDATE_FIELDS = Object.freeze([
  'captureSource',
  'roi',
  'captureHz',
  'ocrPreset',
  'ocrConfidenceFloor',
  'translationProvider',
  'targetLang',
]);

const CAPTURE_PROFILE_FIELDS = Object.freeze([
  'captureSource',
  'roi',
  'captureHz',
]);

const OCR_PROFILE_FIELDS = Object.freeze([
  'ocrPreset',
  'ocrConfidenceFloor',
]);

const TRANSLATION_PROFILE_FIELDS = Object.freeze([
  'translationProvider',
  'targetLang',
]);

const SETUP_RECOVERY_ACTIONS_BY_CODE = Object.freeze({
  CAPTURE_ENUM_FAILED: Object.freeze(['refresh_sources', 'open_diagnostics']),
  CAPTURE_SOURCE_MISSING: Object.freeze(['select_capture_source', 'refresh_sources']),
  CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE: Object.freeze(['refresh_sources']),
  CAPTURE_FAILED: Object.freeze(['open_diagnostics']),
  ROI_MISSING: Object.freeze(['redraw_roi']),

  OCR_ENGINE_ERROR: Object.freeze(['open_diagnostics']),
  OCR_TEXT_NOT_ACCEPTED: Object.freeze(['redraw_roi', 'retry']),

  PROVIDER_KEY_MISSING: Object.freeze(['edit_api_key']),
  PROVIDER_AUTH_FAILED: Object.freeze(['edit_api_key', 'retry']),
  PROVIDER_RATE_LIMITED: Object.freeze(['wait_and_retry']),
  PROVIDER_QUOTA_EXCEEDED: Object.freeze(['switch_provider']),
  PROVIDER_NETWORK_ERROR: Object.freeze(['check_network']),
  PROVIDER_RESPONSE_INVALID: Object.freeze(['open_diagnostics']),
  PROVIDER_UNKNOWN: Object.freeze(['switch_provider']),
  TARGET_LANG_INVALID: Object.freeze(['switch_provider']),
  KEYCHAIN_UNAVAILABLE: Object.freeze(['open_diagnostics']),

  PROFILE_NOT_FOUND: Object.freeze(['open_profiles']),
  DB_UNAVAILABLE: Object.freeze(['open_diagnostics']),
  VALIDATION_ERROR: Object.freeze(['retry']),
});

const DEFAULT_SETUP_RECOVERY_ACTIONS = Object.freeze(['open_diagnostics']);

function defineScreen(input) {
  return Object.freeze({
    id: input.id,
    title: input.title,
    route: input.route,
    capabilities: Object.freeze({
      loading: true,
      empty: true,
      error: true,
      success: true,
      recovery: true,
    }),
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function trimOrNull(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

function copyRoi(value) {
  if (!isPlainObject(value)) return null;
  return deepFreeze({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  });
}

function copyCaptureSource(value) {
  if (!isPlainObject(value)) return null;
  const copied = {
    kind: value.kind,
    id: value.id,
    label: value.label,
  };
  if (value.bounds !== undefined) {
    copied.bounds = copyRoi(value.bounds);
  }
  return deepFreeze(copied);
}

function normalizeCaptureSources(input) {
  const rawSources = Array.isArray(input)
    ? input
    : isPlainObject(input) && Array.isArray(input.sources)
      ? input.sources
      : [];
  return deepFreeze(rawSources.map(copyCaptureSource));
}

function normalizeDraft(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return deepFreeze({
    captureSource: hasOwn(source, 'captureSource')
      ? copyCaptureSource(source.captureSource)
      : null,
    roi: hasOwn(source, 'roi') ? copyRoi(source.roi) : null,
    captureHz: hasOwn(source, 'captureHz') ? source.captureHz : DEFAULT_CAPTURE_HZ,
    ocrPreset: hasOwn(source, 'ocrPreset') && typeof source.ocrPreset === 'string'
      ? source.ocrPreset
      : DEFAULT_OCR_PRESET,
    ocrConfidenceFloor: hasOwn(source, 'ocrConfidenceFloor')
      ? source.ocrConfidenceFloor
      : DEFAULT_OCR_CONFIDENCE_FLOOR,
    translationProvider: hasOwn(source, 'translationProvider') &&
      typeof source.translationProvider === 'string'
      ? source.translationProvider
      : '',
    targetLang: hasOwn(source, 'targetLang') && typeof source.targetLang === 'string'
      ? source.targetLang
      : DEFAULT_TARGET_LANG,
  });
}

function normalizeOcrPreview(input) {
  if (!isPlainObject(input)) return null;
  return deepFreeze({
    text: typeof input.text === 'string' ? input.text : '',
    normalizedText: typeof input.normalizedText === 'string' ? input.normalizedText : '',
    confidence: input.confidence,
    durationMs: input.durationMs,
    accepted: input.accepted === true,
    rejectionReason: typeof input.rejectionReason === 'string' ? input.rejectionReason : null,
    containsSensitiveText: true,
  });
}

function normalizeTranslationPreview(input) {
  if (!isPlainObject(input)) return null;
  return deepFreeze({
    translatedText: typeof input.translatedText === 'string' ? input.translatedText : '',
    provider: typeof input.provider === 'string' ? input.provider : null,
    durationMs: input.durationMs,
    cacheHit: input.cacheHit === true,
    containsSensitiveText: true,
  });
}

function normalizeErrors(input = {}) {
  if (!isPlainObject(input)) return deepFreeze(Object.create(null));
  const errors = Object.create(null);
  for (const screenId of SETUP_SCREEN_IDS) {
    if (!hasOwn(input, screenId)) continue;
    errors[screenId] = sanitizeSetupScreenError(input[screenId]);
  }
  return Object.freeze(errors);
}

function normalizeScreenId(screenId) {
  if (!isNonEmptyString(screenId)) return 'capture-setup';
  const trimmed = screenId.trim();
  return SETUP_SCREEN_IDS.includes(trimmed) ? trimmed : 'capture-setup';
}

function normalizeActionId(actionId) {
  if (!isNonEmptyString(actionId)) return null;
  const trimmed = actionId.trim();
  return SETUP_ACTION_IDS.includes(trimmed) ? trimmed : null;
}

function freezeState(input) {
  return deepFreeze({
    activeScreenId: normalizeScreenId(input.activeScreenId),
    profileId: trimOrNull(input.profileId),
    draft: normalizeDraft(input.draft),
    providerKeySaved: input.providerKeySaved === true,
    captureSources: normalizeCaptureSources(input.captureSources),
    ocrPreview: normalizeOcrPreview(input.ocrPreview),
    translationPreview: normalizeTranslationPreview(input.translationPreview),
    errors: normalizeErrors(input.errors),
    pendingAction: normalizeActionId(input.pendingAction),
  });
}

function createSetupScreensState(input = {}) {
  return freezeState({
    activeScreenId: input.activeScreenId,
    profileId: input.profileId,
    draft: input.draft,
    providerKeySaved: input.providerKeySaved,
    captureSources: input.captureSources,
    ocrPreview: input.ocrPreview,
    translationPreview: input.translationPreview,
    errors: input.errors,
    pendingAction: input.pendingAction,
  });
}

function updateSetupDraft(state, patch) {
  const current = createSetupScreensState(state);
  const nextDraft = { ...current.draft };
  if (isPlainObject(patch)) {
    for (const field of DRAFT_FIELDS) {
      if (!hasOwn(patch, field)) continue;
      nextDraft[field] = patch[field];
    }
  }
  return freezeState({
    ...current,
    draft: nextDraft,
  });
}

function navigateSetupScreen(state, screenId) {
  const current = createSetupScreensState(state);
  return freezeState({
    ...current,
    activeScreenId: normalizeScreenId(screenId),
  });
}

function setSetupPendingAction(state, actionId) {
  const current = createSetupScreensState(state);
  return freezeState({
    ...current,
    pendingAction: normalizeActionId(actionId),
  });
}

function setSetupScreenError(state, screenId, error) {
  const current = createSetupScreensState(state);
  const normalizedScreenId = normalizeScreenId(screenId);
  return freezeState({
    ...current,
    errors: {
      ...current.errors,
      [normalizedScreenId]: sanitizeSetupScreenError(error),
    },
  });
}

function clearSetupScreenError(state, screenId) {
  const current = createSetupScreensState(state);
  const normalizedScreenId = normalizeScreenId(screenId);
  if (!hasOwn(current.errors, normalizedScreenId)) return current;
  const errors = { ...current.errors };
  delete errors[normalizedScreenId];
  return freezeState({
    ...current,
    errors,
  });
}

function isValidProvider(provider) {
  return ALLOWED_PROVIDERS.includes(provider);
}

function isProviderKeyRequired(provider) {
  return PROVIDERS_REQUIRING_KEY.includes(provider);
}

function isValidTargetLang(targetLang) {
  return ALLOWED_TARGET_LANGS.includes(targetLang);
}

function isValidCaptureHz(captureHz) {
  return ALLOWED_CAPTURE_HZ.includes(captureHz);
}

function isValidOcrPreset(ocrPreset) {
  return ALLOWED_OCR_PRESETS.includes(ocrPreset);
}

function sanitizeFieldErrors(errors) {
  if (!Array.isArray(errors)) return deepFreeze([]);
  return deepFreeze(
    errors.map((error) => ({
      field: typeof error.field === 'string' ? error.field : '',
      code: typeof error.code === 'string' ? error.code : 'VALIDATION_ERROR',
      message: typeof error.message === 'string'
        ? redactSetupText(error.message)
        : 'Validation failed',
    })),
  );
}

function throwContractValidation(errors) {
  if (errors.length === 0) return;
  throw new ContractError('VALIDATION_ERROR', 'Validation failed', {
    fieldErrors: sanitizeFieldErrors(errors),
  });
}

function requireProfileId(profileId) {
  const normalized = trimOrNull(profileId);
  if (!normalized) {
    throw new ContractError('VALIDATION_ERROR', 'profileId must be a non-empty string', {
      fieldErrors: [
        {
          field: 'profileId',
          code: 'VALIDATION_ERROR',
          message: 'profileId must be a non-empty string',
        },
      ],
    });
  }
  return normalized;
}

function normalizeUpdateFields(fields) {
  const candidates = Array.isArray(fields) ? fields : PROFILE_UPDATE_FIELDS;
  const selected = [];
  for (const field of candidates) {
    if (!PROFILE_UPDATE_FIELDS.includes(field) || selected.includes(field)) continue;
    selected.push(field);
  }
  return selected;
}

function buildProfileUpdatePayload(draft, fields) {
  const payload = {};
  for (const field of normalizeUpdateFields(fields)) {
    const value = draft[field];
    if ((field === 'captureSource' || field === 'roi') && value === null) continue;
    payload[field] = copyIntentValue(value);
  }
  return payload;
}

function buildProfileSettingsUpdateIntent(state, options = {}) {
  const current = createSetupScreensState(state);
  const profileId = requireProfileId(current.profileId);
  const payload = buildProfileUpdatePayload(current.draft, options.fields);
  throwContractValidation(validateProfileUpdateRequest(payload));
  return freezeIntent({
    method: 'PUT',
    path: `/api/profiles/${encodeURIComponent(profileId)}`,
    body: payload,
  });
}

function buildCaptureSettingsUpdateIntent(state) {
  const current = createSetupScreensState(state);
  if (current.draft.captureSource === null) {
    throw new ContractError('CAPTURE_SOURCE_MISSING', 'Capture source is not selected');
  }
  if (current.draft.roi === null) {
    throw new ContractError('ROI_MISSING', 'OCR region is not saved');
  }
  return buildProfileSettingsUpdateIntent(current, { fields: CAPTURE_PROFILE_FIELDS });
}

function buildOcrSettingsUpdateIntent(state) {
  return buildProfileSettingsUpdateIntent(state, { fields: OCR_PROFILE_FIELDS });
}

function buildTranslationSettingsUpdateIntent(state) {
  return buildProfileSettingsUpdateIntent(state, { fields: TRANSLATION_PROFILE_FIELDS });
}

function buildCaptureSourcesIntent() {
  return freezeIntent({
    method: 'GET',
    path: '/api/capture/sources',
  });
}

function buildOcrPreviewIntent(state, input = {}) {
  const current = createSetupScreensState(state);
  const payload = { profileId: requireProfileId(current.profileId) };
  if (input.roi !== undefined) {
    payload.roi = copyRoi(input.roi);
  } else if (current.draft.roi !== null) {
    payload.roi = copyIntentValue(current.draft.roi);
  }
  throwContractValidation(validateOcrTestRequest(payload));
  return freezeIntent({
    method: 'POST',
    path: '/api/ocr/test',
    body: payload,
  });
}

function buildProviderKeySaveIntent(input = {}) {
  const provider = trimOrNull(input.provider) || '';
  if (!isValidProvider(provider)) {
    throw new ContractError('PROVIDER_UNKNOWN', 'Translation provider is not supported');
  }
  if (!isProviderKeyRequired(provider)) {
    throw new ContractError(
      'PROVIDER_KEY_NOT_REQUIRED',
      'Selected provider does not require a key',
    );
  }
  const payload = { apiKey: input.apiKey };
  throwContractValidation(validateProviderKeyWriteRequest(payload, { provider }));
  return freezeIntent({
    method: 'PUT',
    path: `/api/keys/${encodeURIComponent(provider)}`,
    makeBody() {
      return deepFreeze({ apiKey: input.apiKey });
    },
    logSafeBody: { apiKey: REDACTED },
    sensitive: true,
  });
}

function buildTranslationPreviewIntent(state, input = {}) {
  const current = createSetupScreensState(state);
  const profileId = requireProfileId(current.profileId);
  const payload = { profileId, text: input.text };
  throwContractValidation(validateTranslateTestRequest(payload));
  return freezeIntent({
    method: 'POST',
    path: '/api/translate/test',
    makeBody() {
      return deepFreeze({ profileId, text: input.text });
    },
    logSafeBody: { profileId, text: REDACTED },
    sensitive: true,
  });
}

function applyCaptureSourcesResult(state, response) {
  const current = createSetupScreensState(state);
  if (!isPlainObject(response) || !Array.isArray(response.sources)) {
    throwContractValidation(validateCaptureSourcesResponse(response));
  }
  const sanitized = {
    sources: normalizeCaptureSources(response),
  };
  throwContractValidation(validateCaptureSourcesResponse(sanitized));
  return freezeState({
    ...current,
    captureSources: sanitized.sources,
  });
}

function applyProviderKeySaved(state, response) {
  const current = createSetupScreensState(state);
  if (!isPlainObject(response) || response.ok !== true) {
    throw new ContractError('VALIDATION_ERROR', 'Provider key response must be { ok: true }');
  }
  return freezeState({
    ...current,
    providerKeySaved: true,
  });
}

function applyOcrPreviewResult(state, result) {
  const current = createSetupScreensState(state);
  throwContractValidation(validateOcrResult(result));
  return freezeState({
    ...current,
    ocrPreview: {
      text: result.text,
      normalizedText: result.normalizedText,
      confidence: result.confidence,
      durationMs: result.durationMs,
      accepted: result.accepted,
      rejectionReason: result.accepted === true ? null : result.rejectionReason,
      containsSensitiveText: true,
    },
  });
}

function applyTranslationPreviewResult(state, result) {
  const current = createSetupScreensState(state);
  throwContractValidation(validateTranslationResult(result));
  return freezeState({
    ...current,
    translationPreview: {
      translatedText: result.translatedText,
      provider: result.provider,
      durationMs: result.durationMs,
      cacheHit: result.cacheHit,
      containsSensitiveText: true,
    },
  });
}

function actionDescriptor(id, enabled, unavailableReason = null) {
  const actionId = normalizeActionId(id);
  if (!actionId) return null;
  return deepFreeze({
    id: actionId,
    enabled: enabled === true,
    unavailableReason: enabled === true ? null : unavailableReason || 'unavailable',
    pending: false,
  });
}

function validationPasses(validator, payload) {
  return validator(payload).length === 0;
}

function buildCaptureScreenView(current) {
  const capturePayload = buildProfileUpdatePayload(current.draft, CAPTURE_PROFILE_FIELDS);
  const captureReady = current.draft.captureSource !== null && current.draft.roi !== null;
  return deepFreeze({
    id: 'capture-setup',
    route: 'capture-setup',
    sourceCount: current.captureSources.length,
    empty: current.captureSources.length === 0,
    selectedSource: current.draft.captureSource,
    roi: current.draft.roi,
    captureHz: current.draft.captureHz,
    captureHzOptions: ALLOWED_CAPTURE_HZ,
    sources: current.captureSources,
    error: current.errors['capture-setup'] || null,
    actions: [
      actionDescriptor('refresh_sources', true),
      actionDescriptor(
        'save_capture_settings',
        captureReady &&
          Boolean(current.profileId) &&
          validationPasses(validateProfileUpdateRequest, capturePayload),
        current.profileId
          ? captureReady ? 'validation_error' : 'capture_source_or_roi_missing'
          : 'profile_missing',
      ),
      actionDescriptor('run_ocr_preview', Boolean(current.profileId), 'profile_missing'),
    ].filter(Boolean),
  });
}

function buildOcrScreenView(current) {
  const ocrPayload = buildProfileUpdatePayload(current.draft, OCR_PROFILE_FIELDS);
  return deepFreeze({
    id: 'ocr-preview',
    route: 'ocr-preview',
    ocrPreset: current.draft.ocrPreset,
    ocrPresetOptions: ALLOWED_OCR_PRESETS,
    ocrConfidenceFloor: current.draft.ocrConfidenceFloor,
    preview: current.ocrPreview,
    empty: current.ocrPreview === null,
    error: current.errors['ocr-preview'] || null,
    actions: [
      actionDescriptor(
        'save_ocr_settings',
        Boolean(current.profileId) &&
          validationPasses(validateProfileUpdateRequest, ocrPayload),
        current.profileId ? 'validation_error' : 'profile_missing',
      ),
      actionDescriptor('run_ocr_preview', Boolean(current.profileId), 'profile_missing'),
    ].filter(Boolean),
  });
}

function buildTranslationScreenView(current) {
  const translationPayload = buildProfileUpdatePayload(current.draft, TRANSLATION_PROFILE_FIELDS);
  const provider = current.draft.translationProvider;
  const providerKnown = isValidProvider(provider);
  const providerKeyRequired = isProviderKeyRequired(provider);
  return deepFreeze({
    id: 'translation-settings',
    route: 'translation-settings',
    provider,
    providerOptions: ALLOWED_PROVIDERS,
    providerKeyRequired,
    providerKeySaved: providerKeyRequired ? current.providerKeySaved : true,
    targetLang: current.draft.targetLang,
    targetLangOptions: ALLOWED_TARGET_LANGS,
    preview: current.translationPreview,
    empty: !providerKnown,
    error: current.errors['translation-settings'] || null,
    actions: [
      actionDescriptor(
        'save_translation_settings',
        Boolean(current.profileId) &&
          validationPasses(validateProfileUpdateRequest, translationPayload),
        current.profileId ? 'validation_error' : 'profile_missing',
      ),
      actionDescriptor(
        'save_provider_key',
        providerKeyRequired,
        providerKnown ? 'provider_key_not_required' : 'provider_missing',
      ),
      actionDescriptor(
        'run_translation_preview',
        Boolean(current.profileId) && providerKnown,
        current.profileId ? 'provider_missing' : 'profile_missing',
      ),
    ].filter(Boolean),
  });
}

function buildSetupScreensViewModel(state) {
  const current = createSetupScreensState(state);
  const screenViews = {
    'capture-setup': buildCaptureScreenView(current),
    'ocr-preview': buildOcrScreenView(current),
    'translation-settings': buildTranslationScreenView(current),
  };
  return deepFreeze({
    activeScreenId: current.activeScreenId,
    profileId: current.profileId,
    draft: current.draft,
    capture: screenViews['capture-setup'],
    ocr: screenViews['ocr-preview'],
    translation: screenViews['translation-settings'],
    screens: SETUP_SCREEN_DEFINITIONS.map((screen) => ({
      ...screen,
      current: screen.id === current.activeScreenId,
      error: current.errors[screen.id] || null,
    })),
    errors: current.errors,
    pendingAction: current.pendingAction,
  });
}

function redactSetupText(text) {
  return redactSecrets(String(text))
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9._-]{8,}:(?:fx)?[A-Za-z0-9._-]{4,}\b/g, REDACTED);
}

function sanitizeSetupScreenError(error) {
  if (error === null || error === undefined) return null;

  if (
    isPlainObject(error) &&
    isNonEmptyString(error.code) &&
    Array.isArray(error.recoveryActions)
  ) {
    // Idempotency path: callers may re-sanitize our own output after storing it.
    return deepFreeze({
      code: error.code.trim(),
      message: typeof error.message === 'string'
        ? redactSetupText(error.message)
        : 'Action failed',
      retryable: error.retryable === true,
      fieldErrors: sanitizeFieldErrors(error.fieldErrors),
      recoveryActions: deriveSetupRecoveryActions({
        code: error.code,
        retryable: error.retryable === true,
      }),
    });
  }

  const apiError = isPlainObject(error) && isPlainObject(error.error)
    ? error.error
    : null;
  const code = trimOrNull(apiError?.code) ||
    trimOrNull(error.code) ||
    'UNKNOWN_ERROR';
  const retryable = apiError
    ? apiError.retryable === true
    : error.retryable === true;
  const fieldErrors = apiError?.details?.fieldErrors || error.details?.fieldErrors;
  return deepFreeze({
    code,
    message: apiError
      ? redactSetupText(String(apiError.message || 'Action failed'))
      : 'Action failed',
    retryable,
    fieldErrors: sanitizeFieldErrors(fieldErrors),
    recoveryActions: deriveSetupRecoveryActions({ code, retryable }),
  });
}

function deriveSetupRecoveryActions(status) {
  if (!isPlainObject(status)) return deepFreeze([]);
  const code = trimOrNull(status.code);
  const actions = code && hasOwn(SETUP_RECOVERY_ACTIONS_BY_CODE, code)
    ? [...SETUP_RECOVERY_ACTIONS_BY_CODE[code]]
    : [...DEFAULT_SETUP_RECOVERY_ACTIONS];
  if (status.retryable === true && !actions.includes('retry')) {
    actions.unshift('retry');
  }
  return deepFreeze(actions);
}

function copyIntentValue(value) {
  if (Array.isArray(value)) return value.map(copyIntentValue);
  if (!isPlainObject(value)) return value;
  const copied = {};
  for (const key of Object.keys(value)) {
    copied[key] = copyIntentValue(value[key]);
  }
  return copied;
}

function freezeIntent(input) {
  const intent = {
    method: input.method,
    path: input.path,
    sensitive: input.sensitive === true,
  };
  if (input.body !== undefined) intent.body = copyIntentValue(input.body);
  if (input.logSafeBody !== undefined) intent.logSafeBody = copyIntentValue(input.logSafeBody);
  if (typeof input.makeBody === 'function') intent.makeBody = input.makeBody;
  return deepFreeze(intent);
}

function safeSetupIntentForLog(intent) {
  if (!isPlainObject(intent)) return null;
  const safe = {
    method: intent.method,
    path: intent.path,
    sensitive: intent.sensitive === true,
  };
  if (intent.logSafeBody !== undefined) {
    safe.body = redactLogSensitiveFields(copyIntentValue(intent.logSafeBody));
  } else if (intent.body !== undefined) {
    safe.body = redactLogSensitiveFields(copyIntentValue(intent.body));
  }
  return deepFreeze(safe);
}

function isCaptureSourceLike(value) {
  return isPlainObject(value) &&
    (value.kind === 'monitor' || value.kind === 'window') &&
    typeof value.label === 'string';
}

function redactLogSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(redactLogSensitiveFields);
  if (!isPlainObject(value)) return value;
  if (isCaptureSourceLike(value)) {
    const redacted = {
      kind: value.kind,
      id: value.id,
      label: REDACTED,
    };
    if (value.bounds !== undefined) {
      redacted.bounds = redactLogSensitiveFields(value.bounds);
    }
    return redacted;
  }
  const copied = {};
  for (const key of Object.keys(value)) {
    copied[key] = redactLogSensitiveFields(value[key]);
  }
  return copied;
}

function redactOcrPreviewForLog(preview) {
  if (!isPlainObject(preview)) return null;
  return deepFreeze({
    text: REDACTED,
    normalizedText: REDACTED,
    confidence: preview.confidence,
    durationMs: preview.durationMs,
    accepted: preview.accepted === true,
    rejectionReason: preview.rejectionReason || null,
    containsSensitiveText: true,
  });
}

function redactTranslationPreviewForLog(preview) {
  if (!isPlainObject(preview)) return null;
  return deepFreeze({
    translatedText: REDACTED,
    provider: preview.provider || null,
    durationMs: preview.durationMs,
    cacheHit: preview.cacheHit === true,
    containsSensitiveText: true,
  });
}

function safeSetupScreensStateForLog(state) {
  const current = createSetupScreensState(state);
  return deepFreeze({
    activeScreenId: current.activeScreenId,
    profileId: current.profileId,
    draft: redactLogSensitiveFields(current.draft),
    providerKeySaved: current.providerKeySaved,
    captureSources: redactLogSensitiveFields(current.captureSources),
    ocrPreview: redactOcrPreviewForLog(current.ocrPreview),
    translationPreview: redactTranslationPreviewForLog(current.translationPreview),
    errors: current.errors,
    pendingAction: current.pendingAction,
  });
}

module.exports = {
  REDACTED,
  DEFAULT_OCR_PRESET,
  DEFAULT_OCR_CONFIDENCE_FLOOR,
  DEFAULT_CAPTURE_HZ,
  DEFAULT_TARGET_LANG,
  SETUP_SCREEN_DEFINITIONS,
  SETUP_SCREEN_IDS,
  SETUP_ACTION_IDS,
  PROVIDERS_REQUIRING_KEY,
  SETUP_RECOVERY_ACTIONS_BY_CODE,
  DEFAULT_SETUP_RECOVERY_ACTIONS,
  createSetupScreensState,
  updateSetupDraft,
  navigateSetupScreen,
  setSetupPendingAction,
  setSetupScreenError,
  clearSetupScreenError,
  isProviderKeyRequired,
  isValidProvider,
  isValidTargetLang,
  isValidCaptureHz,
  isValidOcrPreset,
  buildProfileSettingsUpdateIntent,
  buildCaptureSettingsUpdateIntent,
  buildOcrSettingsUpdateIntent,
  buildTranslationSettingsUpdateIntent,
  buildCaptureSourcesIntent,
  buildOcrPreviewIntent,
  buildProviderKeySaveIntent,
  buildTranslationPreviewIntent,
  applyCaptureSourcesResult,
  applyProviderKeySaved,
  applyOcrPreviewResult,
  applyTranslationPreviewResult,
  buildSetupScreensViewModel,
  sanitizeSetupScreenError,
  deriveSetupRecoveryActions,
  safeSetupIntentForLog,
  safeSetupScreensStateForLog,
};
