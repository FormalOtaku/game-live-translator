'use strict';

// T-011-002: dependency-free first-run setup flow contract for the future
// Electron/React renderer. The module is pure JS: it performs no I/O, stores no
// provider key, and keeps raw manual translation text outside serializable
// wizard state and log-safe request descriptors.

const {
  ALLOWED_PROVIDERS,
  ALLOWED_TARGET_LANGS,
  validateCaptureSource,
  validateOcrTestRequest,
  validateProfileCreateRequest,
  validateProviderKeyWriteRequest,
  validateRoiRect,
  validateTranslateTestRequest,
} = require('../contracts/validation');
const { BUILTIN_THEME_IDS, ContractError, redactSecrets } = require('../contracts/security');

const REDACTED = '[REDACTED]';
const DEFAULT_OCR_PRESET = 'default_dialogue';
const DEFAULT_OCR_CONFIDENCE_FLOOR = 0.6;
const DEFAULT_CAPTURE_HZ = 2;
const DEFAULT_TARGET_LANG = 'en';
const DEFAULT_OVERLAY_THEME_ID = BUILTIN_THEME_IDS[0];

const FIRST_RUN_STEP_DEFINITIONS = Object.freeze([
  defineStep({
    id: 'boundary',
    title: 'Product Boundary',
    description:
      'No game modification, no script distribution, and no game file parsing.',
    action: 'accept_boundary',
  }),
  defineStep({
    id: 'privacy',
    title: 'Privacy',
    description: 'Cloud providers receive recognized text only when enabled.',
    action: 'accept_privacy',
  }),
  defineStep({
    id: 'profile-basics',
    title: 'Profile Basics',
    description: 'Name the game profile and confirm v1 defaults.',
    action: 'continue',
  }),
  defineStep({
    id: 'provider',
    title: 'Translation Provider',
    description: 'Choose DeepL or the local echo provider.',
    action: 'choose_provider',
  }),
  defineStep({
    id: 'provider-key',
    title: 'Provider Key',
    description: 'Save a write-only provider key when the provider requires one.',
    action: 'save_provider_key',
  }),
  defineStep({
    id: 'obs-overlay',
    title: 'OBS Overlay URL',
    description: 'Copy the trusted localhost Browser Source URL.',
    action: 'copy_overlay_url',
  }),
  defineStep({
    id: 'capture-source',
    title: 'Capture Source',
    description: 'Choose a monitor or window capture source.',
    action: 'select_capture_source',
  }),
  defineStep({
    id: 'roi',
    title: 'OCR Region',
    description: 'Draw the subtitle region of interest.',
    action: 'save_roi',
  }),
  defineStep({
    id: 'persist-profile',
    title: 'Create Test Profile',
    description: 'Persist the profile so profile-bound OCR and translation tests can run.',
    action: 'create_profile',
    visible: false,
  }),
  defineStep({
    id: 'ocr-test',
    title: 'Test OCR',
    description: 'Run a one-shot OCR test without persisting recognized text.',
    action: 'run_ocr_test',
  }),
  defineStep({
    id: 'translation-test',
    title: 'Test Translation',
    description: 'Run a provider test without storing the supplied test text.',
    action: 'run_translation_test',
  }),
  defineStep({
    id: 'finish',
    title: 'Save And Finish',
    description: 'Activate the profile and enter Home / Status.',
    action: 'activate_profile',
  }),
]);

const FIRST_RUN_STEP_IDS = Object.freeze(FIRST_RUN_STEP_DEFINITIONS.map((step) => step.id));

const PROVIDERS_REQUIRING_KEY = Object.freeze(['deepl']);

const FIRST_RUN_RECOVERY_ACTIONS_BY_CODE = Object.freeze({
  PROVIDER_KEY_MISSING: Object.freeze(['edit_api_key']),
  PROVIDER_AUTH_FAILED: Object.freeze(['edit_api_key', 'retry']),
  PROVIDER_RATE_LIMITED: Object.freeze(['wait_and_retry']),
  PROVIDER_QUOTA_EXCEEDED: Object.freeze(['switch_provider']),
  PROVIDER_NETWORK_ERROR: Object.freeze(['check_network']),
  PROVIDER_RESPONSE_INVALID: Object.freeze(['open_diagnostics']),
  PROVIDER_UNKNOWN: Object.freeze(['switch_provider']),
  TARGET_LANG_INVALID: Object.freeze(['open_translation_settings']),
  KEYCHAIN_UNAVAILABLE: Object.freeze(['open_diagnostics', 'retry']),

  CAPTURE_ENUM_FAILED: Object.freeze(['refresh_sources', 'open_diagnostics']),
  CAPTURE_SOURCE_MISSING: Object.freeze(['select_capture_source']),
  CAPTURE_SOURCE_TEMPORARILY_UNAVAILABLE: Object.freeze(['refresh_sources', 'retry']),
  ROI_MISSING: Object.freeze(['redraw_roi']),
  OCR_ENGINE_ERROR: Object.freeze(['open_diagnostics', 'retry']),
  OCR_TEXT_NOT_ACCEPTED: Object.freeze(['redraw_roi', 'retry']),

  PROFILE_NOT_FOUND: Object.freeze(['create_profile']),
  DB_UNAVAILABLE: Object.freeze(['restart_backend', 'open_diagnostics']),
  DB_WRITE_FAILED: Object.freeze(['retry', 'open_diagnostics']),
  VALIDATION_ERROR: Object.freeze(['edit_current_step']),
});

const DEFAULT_FIRST_RUN_RECOVERY_ACTIONS = Object.freeze(['open_diagnostics']);

const DRAFT_FIELDS = Object.freeze([
  'name',
  'gameTitle',
  'captureSource',
  'roi',
  'ocrPreset',
  'ocrConfidenceFloor',
  'captureHz',
  'translationProvider',
  'targetLang',
  'overlayThemeId',
  'glossary',
]);

const PROGRESS_FIELDS = Object.freeze([
  'boundaryAccepted',
  'privacyAccepted',
  'overlayUrlCopied',
  'providerKeySaved',
  'profileId',
  'ocrTestPassed',
  'translationTestPassed',
  'activeProfileId',
]);

function defineStep(input) {
  return Object.freeze({
    id: input.id,
    title: input.title,
    description: input.description,
    action: input.action,
    visible: input.visible !== false,
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

function copyRoi(value) {
  if (!isPlainObject(value)) return null;
  return Object.freeze({
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
  return Object.freeze(copied);
}

function copyGlossary(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.map((term) => {
      if (!isPlainObject(term)) return Object.freeze({});
      const copied = {
        id: term.id,
        sourceTerm: term.sourceTerm,
        targetTerm: term.targetTerm,
      };
      if (term.note !== undefined) copied.note = term.note;
      return Object.freeze(copied);
    }),
  );
}

function normalizeDraft(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return Object.freeze({
    name: hasOwn(source, 'name') && typeof source.name === 'string' ? source.name : '',
    gameTitle: hasOwn(source, 'gameTitle') && typeof source.gameTitle === 'string'
      ? source.gameTitle
      : '',
    captureSource: hasOwn(source, 'captureSource')
      ? copyCaptureSource(source.captureSource)
      : null,
    roi: hasOwn(source, 'roi') ? copyRoi(source.roi) : null,
    ocrPreset: hasOwn(source, 'ocrPreset') && typeof source.ocrPreset === 'string'
      ? source.ocrPreset
      : DEFAULT_OCR_PRESET,
    ocrConfidenceFloor: hasOwn(source, 'ocrConfidenceFloor')
      ? source.ocrConfidenceFloor
      : DEFAULT_OCR_CONFIDENCE_FLOOR,
    captureHz: hasOwn(source, 'captureHz') ? source.captureHz : DEFAULT_CAPTURE_HZ,
    translationProvider: hasOwn(source, 'translationProvider') &&
      typeof source.translationProvider === 'string'
      ? source.translationProvider
      : '',
    targetLang: hasOwn(source, 'targetLang') && typeof source.targetLang === 'string'
      ? source.targetLang
      : DEFAULT_TARGET_LANG,
    overlayThemeId: hasOwn(source, 'overlayThemeId') && typeof source.overlayThemeId === 'string'
      ? source.overlayThemeId
      : DEFAULT_OVERLAY_THEME_ID,
    glossary: hasOwn(source, 'glossary') ? copyGlossary(source.glossary) : Object.freeze([]),
  });
}

function normalizeProgress(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return Object.freeze({
    boundaryAccepted: hasOwn(source, 'boundaryAccepted') && source.boundaryAccepted === true,
    privacyAccepted: hasOwn(source, 'privacyAccepted') && source.privacyAccepted === true,
    overlayUrlCopied: hasOwn(source, 'overlayUrlCopied') && source.overlayUrlCopied === true,
    providerKeySaved: hasOwn(source, 'providerKeySaved') && source.providerKeySaved === true,
    profileId: hasOwn(source, 'profileId') ? trimOrNull(source.profileId) : null,
    ocrTestPassed: hasOwn(source, 'ocrTestPassed') && source.ocrTestPassed === true,
    translationTestPassed: hasOwn(source, 'translationTestPassed') &&
      source.translationTestPassed === true,
    activeProfileId: hasOwn(source, 'activeProfileId')
      ? trimOrNull(source.activeProfileId)
      : null,
  });
}

function normalizeErrors(input = {}) {
  if (!isPlainObject(input)) return Object.freeze(Object.create(null));
  const errors = Object.create(null);
  for (const stepId of FIRST_RUN_STEP_IDS) {
    if (!hasOwn(input, stepId)) continue;
    errors[stepId] = sanitizeFirstRunError(input[stepId]);
  }
  return Object.freeze(errors);
}

function freezeState(input) {
  const currentStepId = FIRST_RUN_STEP_IDS.includes(input.currentStepId)
    ? input.currentStepId
    : 'boundary';
  return Object.freeze({
    currentStepId,
    draft: normalizeDraft(input.draft),
    progress: normalizeProgress(input.progress),
    errors: normalizeErrors(input.errors),
  });
}

function createFirstRunState(input = {}) {
  return freezeState({
    currentStepId: input.currentStepId,
    draft: input.draft,
    progress: input.progress,
    errors: input.errors,
  });
}

function updateFirstRunDraft(state, patch) {
  const current = createFirstRunState(state);
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

function updateFirstRunProgress(state, patch) {
  const current = createFirstRunState(state);
  const nextProgress = { ...current.progress };
  if (isPlainObject(patch)) {
    for (const field of PROGRESS_FIELDS) {
      if (!hasOwn(patch, field)) continue;
      nextProgress[field] = patch[field];
    }
  }
  return freezeState({
    ...current,
    progress: nextProgress,
  });
}

function setFirstRunError(state, stepId, error) {
  const current = createFirstRunState(state);
  if (!FIRST_RUN_STEP_IDS.includes(stepId)) return current;
  return freezeState({
    ...current,
    errors: {
      ...current.errors,
      [stepId]: sanitizeFirstRunError(error),
    },
  });
}

function clearFirstRunError(state, stepId) {
  const current = createFirstRunState(state);
  if (!FIRST_RUN_STEP_IDS.includes(stepId) || !hasOwn(current.errors, stepId)) {
    return current;
  }
  const errors = { ...current.errors };
  delete errors[stepId];
  return freezeState({
    ...current,
    errors,
  });
}

function isProviderKeyRequired(provider) {
  return PROVIDERS_REQUIRING_KEY.includes(provider);
}

function isValidProvider(provider) {
  return ALLOWED_PROVIDERS.includes(provider);
}

function isEchoProviderReady(provider) {
  return provider === 'echo';
}

function isProviderReady(state) {
  const current = createFirstRunState(state);
  const provider = current.draft.translationProvider;
  if (!isValidProvider(provider)) return false;
  if (isEchoProviderReady(provider)) return true;
  return current.progress.providerKeySaved === true;
}

function validateDraftProfileForCreate(draft) {
  const payload = buildProfileCreatePayload(draft);
  return validateProfileCreateRequest(payload);
}

function isCaptureSourceSaved(draft) {
  return validateCaptureSource(draft.captureSource).length === 0;
}

function isRoiSaved(draft) {
  return validateRoiRect(draft.roi).length === 0;
}

function isStepComplete(state, stepId) {
  const current = createFirstRunState(state);
  const { draft, progress } = current;
  switch (stepId) {
    case 'boundary':
      return progress.boundaryAccepted;
    case 'privacy':
      return progress.privacyAccepted;
    case 'profile-basics':
      return (
        isNonEmptyString(draft.name) &&
        validateProfileCreateRequest(buildProfileCreatePayload(draft, {
          includeCaptureFields: false,
          translationProvider: draft.translationProvider || 'echo',
        })).filter((error) => error.field !== 'translationProvider').length === 0
      );
    case 'provider':
      return isValidProvider(draft.translationProvider);
    case 'provider-key':
      return isProviderReady(current);
    case 'obs-overlay':
      return progress.overlayUrlCopied;
    case 'capture-source':
      return isCaptureSourceSaved(draft);
    case 'roi':
      return isRoiSaved(draft);
    case 'persist-profile':
      return isNonEmptyString(progress.profileId);
    case 'ocr-test':
      return progress.ocrTestPassed;
    case 'translation-test':
      return progress.translationTestPassed;
    case 'finish':
      return isFirstRunComplete(current);
    default:
      return false;
  }
}

function stepIndex(stepId) {
  return FIRST_RUN_STEP_IDS.indexOf(stepId);
}

function isStepAvailable(state, stepId) {
  const targetIndex = stepIndex(stepId);
  if (targetIndex < 0) return false;
  for (let index = 0; index < targetIndex; index += 1) {
    if (!isStepComplete(state, FIRST_RUN_STEP_IDS[index])) return false;
  }
  return true;
}

function firstIncompleteStepId(state) {
  const current = isPlainObject(state)
    ? {
        draft: normalizeDraft(state.draft),
        progress: normalizeProgress(state.progress),
        errors: normalizeErrors(state.errors),
      }
    : createFirstRunState();
  for (const stepId of FIRST_RUN_STEP_IDS) {
    if (!isStepComplete(current, stepId)) return stepId;
  }
  return 'finish';
}

function nextFirstRunStepId(state) {
  const current = createFirstRunState(state);
  const currentIndex = stepIndex(current.currentStepId);
  if (currentIndex < 0) return firstIncompleteStepId(current);
  if (!isStepComplete(current, current.currentStepId)) return current.currentStepId;
  const next = FIRST_RUN_STEP_IDS[currentIndex + 1];
  return next || 'finish';
}

function navigateFirstRun(state, stepId) {
  const current = createFirstRunState(state);
  if (!FIRST_RUN_STEP_IDS.includes(stepId)) return current;
  if (!isStepAvailable(current, stepId) && !isStepComplete(current, stepId)) {
    return freezeState({
      ...current,
      currentStepId: firstIncompleteStepId(current),
    });
  }
  return freezeState({
    ...current,
    currentStepId: stepId,
  });
}

function buildProfileCreatePayload(draft, options = {}) {
  const includeCaptureFields = options.includeCaptureFields !== false;
  const payload = {
    name: draft.name,
    ocrPreset: draft.ocrPreset,
    ocrConfidenceFloor: draft.ocrConfidenceFloor,
    captureHz: draft.captureHz,
    translationProvider: options.translationProvider || draft.translationProvider,
    targetLang: draft.targetLang,
    overlayThemeId: draft.overlayThemeId,
    glossary: draft.glossary.map((term) => ({ ...term })),
  };
  if (isNonEmptyString(draft.gameTitle)) payload.gameTitle = draft.gameTitle;
  if (includeCaptureFields && draft.captureSource) {
    payload.captureSource = copyIntentValue(draft.captureSource);
  }
  if (includeCaptureFields && draft.roi) {
    payload.roi = copyIntentValue(draft.roi);
  }
  return payload;
}

function throwContractValidation(errors) {
  if (errors.length === 0) return;
  throw new ContractError('VALIDATION_ERROR', 'Validation failed', {
    fieldErrors: sanitizeFieldErrors(errors),
  });
}

function assertProviderReady(state) {
  const current = createFirstRunState(state);
  if (!isValidProvider(current.draft.translationProvider)) {
    throw new ContractError('PROVIDER_UNKNOWN', 'Translation provider is not supported');
  }
  if (!isProviderReady(current)) {
    throw new ContractError('PROVIDER_KEY_MISSING', 'Provider key is not saved', {
      provider: current.draft.translationProvider,
    });
  }
}

function buildProfileCreateIntent(state) {
  const current = createFirstRunState(state);
  assertProviderReady(current);
  if (!current.draft.captureSource) {
    throw new ContractError(
      'CAPTURE_SOURCE_MISSING',
      'Capture source is not selected',
    );
  }
  throwContractValidation(validateCaptureSource(current.draft.captureSource));
  if (!current.draft.roi) {
    throw new ContractError('ROI_MISSING', 'OCR region is not saved');
  }
  throwContractValidation(validateRoiRect(current.draft.roi));
  const payload = buildProfileCreatePayload(current.draft);
  throwContractValidation(validateProfileCreateRequest(payload));
  return freezeIntent({
    method: 'POST',
    path: '/api/profiles',
    body: payload,
  });
}

function buildProviderKeySaveIntent(input = {}) {
  const provider = isNonEmptyString(input.provider) ? input.provider.trim() : '';
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
      return Object.freeze({ apiKey: input.apiKey });
    },
    logSafeBody: { apiKey: REDACTED },
    sensitive: true,
  });
}

function buildCaptureSourcesIntent() {
  return freezeIntent({
    method: 'GET',
    path: '/api/capture/sources',
  });
}

function buildOcrTestIntent(input = {}) {
  const payload = { profileId: input.profileId };
  if (input.roi !== undefined) payload.roi = copyRoi(input.roi);
  throwContractValidation(validateOcrTestRequest(payload));
  return freezeIntent({
    method: 'POST',
    path: '/api/ocr/test',
    body: payload,
  });
}

function buildTranslationTestIntent(input = {}) {
  const payload = { profileId: input.profileId, text: input.text };
  throwContractValidation(validateTranslateTestRequest(payload));
  return freezeIntent({
    method: 'POST',
    path: '/api/translate/test',
    makeBody() {
      return Object.freeze({ profileId: input.profileId, text: input.text });
    },
    logSafeBody: { profileId: input.profileId, text: REDACTED },
    sensitive: true,
  });
}

function buildActiveProfileIntent(input = {}) {
  const profileId = trimOrNull(input.profileId);
  if (!profileId) {
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
  return freezeIntent({
    method: 'PUT',
    path: '/api/profiles/active',
    body: { profileId },
  });
}

function applyProfileCreated(state, profile) {
  const profileId = trimOrNull(isPlainObject(profile) ? profile.id : null);
  if (!profileId) {
    throw new ContractError('VALIDATION_ERROR', 'Profile response did not include id');
  }
  return updateFirstRunProgress(state, { profileId });
}

function applyProviderKeySaved(state, response) {
  if (!isPlainObject(response) || response.ok !== true) {
    throw new ContractError('VALIDATION_ERROR', 'Provider key response must be { ok: true }');
  }
  return updateFirstRunProgress(state, { providerKeySaved: true });
}

function applyOcrTestResult(state, result) {
  if (!isPlainObject(result) || result.accepted !== true) {
    throw new ContractError('OCR_TEXT_NOT_ACCEPTED', 'OCR test did not recognize usable text');
  }
  return updateFirstRunProgress(state, { ocrTestPassed: true });
}

function applyTranslationTestResult(state, result) {
  if (!isPlainObject(result) || !isNonEmptyString(result.translatedText)) {
    throw new ContractError(
      'PROVIDER_RESPONSE_INVALID',
      'Translation test response was invalid',
    );
  }
  return updateFirstRunProgress(state, { translationTestPassed: true });
}

function applyActiveProfileSaved(state, response) {
  const current = createFirstRunState(state);
  if (!isPlainObject(response) || response.ok !== true) {
    throw new ContractError('VALIDATION_ERROR', 'Active profile response must be { ok: true }');
  }
  if (!current.progress.profileId) {
    throw new ContractError('VALIDATION_ERROR', 'profileId must be set before activation');
  }
  return updateFirstRunProgress(current, {
    activeProfileId: current.progress.profileId,
  });
}

function deriveDesktopSetup(state) {
  const current = createFirstRunState(state);
  return Object.freeze({
    activeProfileId: current.progress.activeProfileId,
    // The desktop-shell setup gate uses this legacy field name for provider
    // readiness. Keyless local providers such as echo satisfy it without a key.
    providerKeySaved: isProviderReady(current),
    captureSourceSelected: isCaptureSourceSaved(current.draft),
    roiSaved: isRoiSaved(current.draft),
  });
}

function isFirstRunComplete(state) {
  const current = createFirstRunState(state);
  const setup = deriveDesktopSetup(current);
  return (
    isNonEmptyString(setup.activeProfileId) &&
    setup.providerKeySaved === true &&
    setup.captureSourceSelected === true &&
    setup.roiSaved === true &&
    current.progress.boundaryAccepted === true &&
    current.progress.privacyAccepted === true &&
    current.progress.overlayUrlCopied === true &&
    current.progress.ocrTestPassed === true &&
    current.progress.translationTestPassed === true
  );
}

function buildFirstRunViewModel(state) {
  const current = createFirstRunState(state);
  const setup = deriveDesktopSetup(current);
  const visibleSteps = FIRST_RUN_STEP_DEFINITIONS.filter((step) => step.visible);
  return Object.freeze({
    currentStepId: current.currentStepId,
    nextStepId: nextFirstRunStepId(current),
    complete: isFirstRunComplete(current),
    setup,
    providerKeyRequired: isProviderKeyRequired(current.draft.translationProvider),
    providerReady: isProviderReady(current),
    profileId: current.progress.profileId,
    activeProfileId: current.progress.activeProfileId,
    profilePreview: Object.freeze({
      name: current.draft.name,
      gameTitle: current.draft.gameTitle || null,
      translationProvider: current.draft.translationProvider || null,
      targetLang: current.draft.targetLang,
      ocrPreset: current.draft.ocrPreset,
      ocrConfidenceFloor: current.draft.ocrConfidenceFloor,
      captureHz: current.draft.captureHz,
      overlayThemeId: current.draft.overlayThemeId,
      captureSourceSelected: setup.captureSourceSelected,
      roiSaved: setup.roiSaved,
      glossaryCount: current.draft.glossary.length,
    }),
    steps: Object.freeze(
      visibleSteps.map((step) => Object.freeze({
        id: step.id,
        title: step.title,
        description: step.description,
        action: step.action,
        current: current.currentStepId === step.id,
        available: isStepAvailable(current, step.id),
        complete: isStepComplete(current, step.id),
        error: current.errors[step.id] || null,
      })),
    ),
    errors: current.errors,
  });
}

function sanitizeFieldErrors(errors) {
  if (!Array.isArray(errors)) return Object.freeze([]);
  return Object.freeze(
    errors.map((error) => Object.freeze({
      field: typeof error.field === 'string' ? error.field : '',
      code: typeof error.code === 'string' ? error.code : 'VALIDATION_ERROR',
      message: typeof error.message === 'string'
        ? redactFirstRunText(error.message)
        : 'Validation failed',
    })),
  );
}

function redactFirstRunText(text) {
  return redactSecrets(String(text))
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9._-]{8,}:(?:fx)?[A-Za-z0-9._-]{4,}\b/g, REDACTED);
}

function sanitizeFirstRunError(error) {
  if (error === null || error === undefined) return null;

  if (
    isPlainObject(error) &&
    isNonEmptyString(error.code) &&
    Array.isArray(error.recoveryActions)
  ) {
    return Object.freeze({
      code: error.code.trim(),
      message: typeof error.message === 'string'
        ? redactFirstRunText(error.message)
        : 'Action failed',
      retryable: error.retryable === true,
      fieldErrors: sanitizeFieldErrors(error.fieldErrors),
      recoveryActions: deriveFirstRunRecoveryActions({
        state: 'error',
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
  return Object.freeze({
    code,
    message: apiError
      ? redactFirstRunText(String(apiError.message || 'Action failed'))
      : 'Action failed',
    retryable,
    fieldErrors: sanitizeFieldErrors(fieldErrors),
    recoveryActions: deriveFirstRunRecoveryActions({
      state: 'error',
      code,
      retryable,
    }),
  });
}

function deriveFirstRunRecoveryActions(status) {
  if (!isPlainObject(status)) return Object.freeze([]);
  const code = trimOrNull(status.code);
  const actions = code && hasOwn(FIRST_RUN_RECOVERY_ACTIONS_BY_CODE, code)
    ? [...FIRST_RUN_RECOVERY_ACTIONS_BY_CODE[code]]
    : [...DEFAULT_FIRST_RUN_RECOVERY_ACTIONS];
  if (status.retryable === true && !actions.includes('retry')) {
    actions.unshift('retry');
  }
  return Object.freeze(actions);
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
  if (input.body !== undefined) intent.body = Object.freeze(copyIntentValue(input.body));
  if (input.logSafeBody !== undefined) {
    intent.logSafeBody = Object.freeze(copyIntentValue(input.logSafeBody));
  }
  if (typeof input.makeBody === 'function') intent.makeBody = input.makeBody;
  return Object.freeze(intent);
}

function safeIntentForLog(intent) {
  if (!isPlainObject(intent)) return null;
  const safe = {
    method: intent.method,
    path: intent.path,
    sensitive: intent.sensitive === true,
  };
  if (intent.logSafeBody !== undefined) {
    safe.body = copyIntentValue(intent.logSafeBody);
  } else if (intent.body !== undefined) {
    safe.body = copyIntentValue(intent.body);
  }
  return Object.freeze(safe);
}

module.exports = {
  REDACTED,
  DEFAULT_OCR_PRESET,
  DEFAULT_OCR_CONFIDENCE_FLOOR,
  DEFAULT_CAPTURE_HZ,
  DEFAULT_TARGET_LANG,
  DEFAULT_OVERLAY_THEME_ID,
  FIRST_RUN_STEP_DEFINITIONS,
  FIRST_RUN_STEP_IDS,
  PROVIDERS_REQUIRING_KEY,
  FIRST_RUN_RECOVERY_ACTIONS_BY_CODE,
  DEFAULT_FIRST_RUN_RECOVERY_ACTIONS,
  createFirstRunState,
  updateFirstRunDraft,
  updateFirstRunProgress,
  setFirstRunError,
  clearFirstRunError,
  isProviderKeyRequired,
  isProviderReady,
  isStepComplete,
  isStepAvailable,
  firstIncompleteStepId,
  nextFirstRunStepId,
  navigateFirstRun,
  validateDraftProfileForCreate,
  buildProfileCreateIntent,
  buildProviderKeySaveIntent,
  buildCaptureSourcesIntent,
  buildOcrTestIntent,
  buildTranslationTestIntent,
  buildActiveProfileIntent,
  applyProfileCreated,
  applyProviderKeySaved,
  applyOcrTestResult,
  applyTranslationTestResult,
  applyActiveProfileSaved,
  deriveDesktopSetup,
  isFirstRunComplete,
  buildFirstRunViewModel,
  sanitizeFirstRunError,
  deriveFirstRunRecoveryActions,
  safeIntentForLog,
};
