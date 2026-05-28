'use strict';

// T-011-005: dependency-free renderer contract for the remaining closeout UI
// surfaces. This module performs no I/O; it emits intent descriptors for the
// Electron host and keeps diagnostics/debug data out of log-safe snapshots.

const {
  fieldError,
  validateDiagnosticBundle,
  validateOverlayThemeCreateRequest,
  validateOverlayThemeUpdateRequest,
  validatePrivacySettings,
  validateProfileUpdateRequest,
  validateThemeCssJson,
} = require('../contracts/validation');
const {
  BUILTIN_THEME_IDS,
  DEFAULT_PRIVACY_SETTINGS,
  ContractError,
  escapeHtml,
  isBuiltInTheme,
  redactDiagnosticString,
  redactSecrets,
} = require('../contracts/security');
const { buildViewModel } = require('./desktop-shell');

const REDACTED = '[REDACTED]';
const DEFAULT_THEME_PREVIEW_TEXT = 'Sample translated subtitle';
const OBS_RECOMMENDED_DIMENSIONS = Object.freeze({ width: 1920, height: 1080 });

const CLOSEOUT_SCREEN_DEFINITIONS = Object.freeze([
  defineScreen({ id: 'overlay-theme', title: 'Overlay Theme Editor', route: 'overlay-theme' }),
  defineScreen({ id: 'obs-setup', title: 'OBS Setup Guide', route: 'obs-setup' }),
  defineScreen({ id: 'privacy', title: 'Privacy Settings', route: 'privacy' }),
  defineScreen({ id: 'logs-diagnostics', title: 'Logs / Diagnostics', route: 'logs-diagnostics' }),
]);

const CLOSEOUT_SCREEN_IDS = Object.freeze(CLOSEOUT_SCREEN_DEFINITIONS.map((screen) => screen.id));

const CLOSEOUT_ACTION_IDS = Object.freeze([
  'refresh_themes',
  'create_theme',
  'duplicate_theme',
  'update_theme',
  'delete_theme',
  'apply_theme_to_profile',
  'reset_theme_draft',
  'copy_overlay_url',
  'copy_obs_settings',
  'open_overlay_browser',
  'refresh_status',
  'connect_status_stream',
  'restart_backend',
  'open_diagnostics',
  'read_privacy_settings',
  'save_privacy_settings',
  'disable_debug_persistence',
  'open_debug_folder',
  'clear_debug_data',
  'fetch_diagnostics_bundle',
  'copy_diagnostics_bundle',
  'retry',
  'wait_and_retry',
  'open_profiles',
]);

const THEME_FIELDS = Object.freeze([
  'id',
  'name',
  'builtIn',
  'cssJson',
  'createdAt',
  'updatedAt',
]);

const THEMES_RESPONSE_FIELDS = Object.freeze(['themes']);
const PRIVACY_FIELDS = Object.freeze([
  'saveRecentOcrText',
  'recentOcrLimit',
  'saveRecentTranslations',
  'recentTranslationLimit',
  'saveDebugScreenshots',
  'debugScreenshotDirectory',
  'debugRetentionDays',
]);

const CLOSEOUT_RECOVERY_ACTIONS_BY_CODE = Object.freeze({
  THEME_NOT_FOUND: Object.freeze(['refresh_themes']),
  CANNOT_UPDATE_BUILT_IN_THEME: Object.freeze(['duplicate_theme']),
  CANNOT_DELETE_BUILT_IN_THEME: Object.freeze(['duplicate_theme']),
  THEME_IN_USE: Object.freeze(['open_profiles']),
  DB_UNAVAILABLE: Object.freeze(['restart_backend', 'open_diagnostics']),
  DB_WRITE_FAILED: Object.freeze(['retry', 'open_diagnostics']),
  DIAGNOSTICS_FAILED: Object.freeze(['open_diagnostics', 'retry']),
  BACKEND_NOT_READY: Object.freeze(['wait_and_retry']),
  PORT_UNAVAILABLE: Object.freeze(['restart_backend']),
  WS_REJECTED: Object.freeze(['restart_backend']),
  VALIDATION_ERROR: Object.freeze(['retry']),
});

const DEFAULT_CLOSEOUT_RECOVERY_ACTIONS = Object.freeze(['open_diagnostics']);

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

function normalizePort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
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

function normalizeScreenId(screenId) {
  if (!isNonEmptyString(screenId)) return 'overlay-theme';
  const trimmed = screenId.trim();
  return CLOSEOUT_SCREEN_IDS.includes(trimmed) ? trimmed : 'overlay-theme';
}

function normalizeActionId(actionId) {
  if (!isNonEmptyString(actionId)) return null;
  const trimmed = actionId.trim();
  return CLOSEOUT_ACTION_IDS.includes(trimmed) ? trimmed : null;
}

function copyCssJson(input) {
  if (!isPlainObject(input)) return Object.freeze({});
  const copied = {};
  for (const key of Object.keys(input)) {
    copied[key] = copyIntentValue(input[key]);
  }
  return deepFreeze(copied);
}

function normalizeTheme(input) {
  if (!isPlainObject(input)) return null;
  return deepFreeze({
    id: typeof input.id === 'string' ? input.id : '',
    name: typeof input.name === 'string' ? input.name : '',
    builtIn: input.builtIn === true,
    cssJson: copyCssJson(input.cssJson),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : '',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
  });
}

function validateOverlayTheme(theme, basePath = 'themes[0]') {
  if (!isPlainObject(theme)) {
    return [fieldError(basePath, 'VALIDATION_ERROR', `${basePath} must be an object`)];
  }
  const errors = [];
  for (const field of Object.keys(theme)) {
    if (!THEME_FIELDS.includes(field)) {
      errors.push(
        fieldError(
          `${basePath}.${field}`,
          'UNKNOWN_THEME_FIELD',
          `${basePath}.${field} is not an overlay theme field`,
        ),
      );
    }
  }
  for (const field of ['id', 'name', 'createdAt', 'updatedAt']) {
    if (!isNonEmptyString(theme[field])) {
      errors.push(
        fieldError(`${basePath}.${field}`, 'VALIDATION_ERROR', `${field} must be non-empty`),
      );
    }
  }
  if (typeof theme.builtIn !== 'boolean') {
    errors.push(
      fieldError(`${basePath}.builtIn`, 'VALIDATION_ERROR', 'builtIn must be a boolean'),
    );
  }
  errors.push(...validateThemeCssJson(theme.cssJson, `${basePath}.cssJson`));
  return errors;
}

function validateThemesResponse(payload) {
  if (!isPlainObject(payload)) {
    return [fieldError('', 'VALIDATION_ERROR', 'Themes response must be an object')];
  }
  const errors = [];
  for (const field of Object.keys(payload)) {
    if (!THEMES_RESPONSE_FIELDS.includes(field)) {
      errors.push(
        fieldError(field, 'UNKNOWN_THEMES_FIELD', `${field} is not a themes response field`),
      );
    }
  }
  if (!Array.isArray(payload.themes)) {
    errors.push(fieldError('themes', 'VALIDATION_ERROR', 'themes must be an array'));
    return errors;
  }
  for (let i = 0; i < payload.themes.length; i += 1) {
    errors.push(...validateOverlayTheme(payload.themes[i], `themes[${i}]`));
  }
  return errors;
}

function normalizeThemesResponse(payload) {
  const themes = Array.isArray(payload?.themes)
    ? payload.themes.map(normalizeTheme).filter(Boolean)
    : [];
  return deepFreeze(themes);
}

function normalizeThemeDraft(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return deepFreeze({
    name: typeof source.name === 'string' ? source.name : '',
    baseThemeId: trimOrNull(source.baseThemeId),
    cssJson: copyCssJson(source.cssJson),
    previewText: typeof source.previewText === 'string'
      ? source.previewText
      : DEFAULT_THEME_PREVIEW_TEXT,
  });
}

function copyPrivacySettings(input = DEFAULT_PRIVACY_SETTINGS) {
  const source = isPlainObject(input) ? input : {};
  const copied = {};
  for (const field of PRIVACY_FIELDS) {
    if (field === 'debugScreenshotDirectory') {
      if (source[field] !== undefined) copied[field] = source[field];
      continue;
    }
    copied[field] = hasOwn(source, field) ? source[field] : DEFAULT_PRIVACY_SETTINGS[field];
  }
  return deepFreeze(copied);
}

function normalizeDiagnosticBundle(input) {
  if (!isPlainObject(input)) return null;
  return deepFreeze({
    generatedAt: input.generatedAt,
    appVersion: input.appVersion,
    backendVersion: input.backendVersion,
    os: input.os,
    activeProfileId: input.activeProfileId === null ? null : input.activeProfileId,
    redactedLogs: Array.isArray(input.redactedLogs)
      ? input.redactedLogs.map((line) => redactDiagnosticString(line))
      : [],
    redactionSummary: isPlainObject(input.redactionSummary)
      ? copyIntentValue(input.redactionSummary)
      : {},
  });
}

function normalizeErrors(input = {}) {
  if (!isPlainObject(input)) return deepFreeze(Object.create(null));
  const errors = Object.create(null);
  for (const screenId of CLOSEOUT_SCREEN_IDS) {
    if (!hasOwn(input, screenId)) continue;
    errors[screenId] = sanitizeCloseoutError(input[screenId]);
  }
  return Object.freeze(errors);
}

function freezeState(input) {
  const themes = normalizeThemesResponse({ themes: input.themes });
  const selectedThemeId = trimOrNull(input.selectedThemeId) ||
    (themes[0] ? themes[0].id : null);
  const privacySettings = copyPrivacySettings(input.privacySettings);
  return deepFreeze({
    activeScreenId: normalizeScreenId(input.activeScreenId),
    themes,
    selectedThemeId,
    themeDraft: normalizeThemeDraft(input.themeDraft),
    privacySettings,
    privacyDraft: copyPrivacySettings(input.privacyDraft || privacySettings),
    diagnosticBundle: normalizeDiagnosticBundle(input.diagnosticBundle),
    errors: normalizeErrors(input.errors),
    pendingAction: normalizeActionId(input.pendingAction),
  });
}

function createCloseoutScreensState(input = {}) {
  return freezeState({
    activeScreenId: input.activeScreenId,
    themes: input.themes,
    selectedThemeId: input.selectedThemeId,
    themeDraft: input.themeDraft,
    privacySettings: input.privacySettings,
    privacyDraft: input.privacyDraft,
    diagnosticBundle: input.diagnosticBundle,
    errors: input.errors,
    pendingAction: input.pendingAction,
  });
}

function updateThemeDraft(state, patch) {
  const current = createCloseoutScreensState(state);
  const nextDraft = { ...current.themeDraft };
  if (isPlainObject(patch)) {
    for (const field of ['name', 'baseThemeId', 'cssJson', 'previewText']) {
      if (hasOwn(patch, field)) nextDraft[field] = patch[field];
    }
  }
  return freezeState({ ...current, themeDraft: nextDraft });
}

function updatePrivacyDraft(state, patch) {
  const current = createCloseoutScreensState(state);
  const nextDraft = { ...current.privacyDraft };
  if (isPlainObject(patch)) {
    for (const field of PRIVACY_FIELDS) {
      if (hasOwn(patch, field)) nextDraft[field] = patch[field];
    }
  }
  return freezeState({ ...current, privacyDraft: nextDraft });
}

function navigateCloseoutScreen(state, screenId) {
  const current = createCloseoutScreensState(state);
  return freezeState({ ...current, activeScreenId: normalizeScreenId(screenId) });
}

function setCloseoutPendingAction(state, actionId) {
  const current = createCloseoutScreensState(state);
  return freezeState({ ...current, pendingAction: normalizeActionId(actionId) });
}

function setCloseoutScreenError(state, screenId, error) {
  const current = createCloseoutScreensState(state);
  const normalizedScreenId = normalizeScreenId(screenId);
  return freezeState({
    ...current,
    errors: {
      ...current.errors,
      [normalizedScreenId]: sanitizeCloseoutError(error),
    },
  });
}

function clearCloseoutScreenError(state, screenId) {
  const current = createCloseoutScreensState(state);
  const normalizedScreenId = normalizeScreenId(screenId);
  if (!hasOwn(current.errors, normalizedScreenId)) return current;
  const errors = { ...current.errors };
  delete errors[normalizedScreenId];
  return freezeState({ ...current, errors });
}

function throwContractValidation(errors) {
  if (errors.length === 0) return;
  throw new ContractError('VALIDATION_ERROR', 'Validation failed', {
    fieldErrors: sanitizeFieldErrors(errors),
  });
}

function sanitizeFieldErrors(errors) {
  if (!Array.isArray(errors)) return deepFreeze([]);
  return deepFreeze(
    errors.map((error) => ({
      field: typeof error.field === 'string' ? error.field : '',
      code: typeof error.code === 'string' ? error.code : 'VALIDATION_ERROR',
      message: typeof error.message === 'string'
        ? redactCloseoutText(error.message)
        : 'Validation failed',
    })),
  );
}

function requireNonEmpty(value, field) {
  const normalized = trimOrNull(value);
  if (!normalized) {
    throw new ContractError('VALIDATION_ERROR', `${field} must be a non-empty string`, {
      fieldErrors: [
        {
          field,
          code: 'VALIDATION_ERROR',
          message: `${field} must be a non-empty string`,
        },
      ],
    });
  }
  return normalized;
}

function selectedTheme(state, themeId = null) {
  const current = createCloseoutScreensState(state);
  const id = trimOrNull(themeId) || current.selectedThemeId;
  return current.themes.find((theme) => theme.id === id) || null;
}

function assertThemeEditable(theme) {
  if (!theme) throw new ContractError('THEME_NOT_FOUND', 'Theme was not found');
  if (theme.builtIn === true || isBuiltInTheme(theme.id)) {
    throw new ContractError(
      'CANNOT_UPDATE_BUILT_IN_THEME',
      'Built-in themes are read-only; duplicate first',
      { themeId: theme.id },
    );
  }
  return theme;
}

function buildThemesListIntent() {
  return freezeIntent({
    type: 'http',
    actionId: 'refresh_themes',
    method: 'GET',
    path: '/api/themes',
  });
}

function buildThemeCreateIntent(input = {}) {
  const body = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.baseThemeId !== undefined) body.baseThemeId = input.baseThemeId;
  if (input.cssJson !== undefined) body.cssJson = copyIntentValue(input.cssJson);
  throwContractValidation(validateOverlayThemeCreateRequest(body));
  return freezeIntent({
    type: 'http',
    actionId: 'create_theme',
    method: 'POST',
    path: '/api/themes',
    body,
  });
}

function buildThemeDuplicateIntent(input = {}) {
  return freezeIntent({
    ...buildThemeCreateIntent({
      name: input.name,
      baseThemeId: input.baseThemeId,
    }),
    actionId: 'duplicate_theme',
  });
}

function buildThemeUpdateIntent(state, input = {}) {
  const theme = assertThemeEditable(selectedTheme(state, input.themeId));
  const current = createCloseoutScreensState(state);
  const body = {};
  const draft = current.themeDraft;
  if (input.name !== undefined || draft.name) body.name = input.name ?? draft.name;
  if (input.cssJson !== undefined || Object.keys(draft.cssJson).length > 0) {
    body.cssJson = copyIntentValue(input.cssJson ?? draft.cssJson);
  }
  throwContractValidation(validateOverlayThemeUpdateRequest(body));
  return freezeIntent({
    type: 'http',
    actionId: 'update_theme',
    method: 'PUT',
    path: `/api/themes/${encodeURIComponent(theme.id)}`,
    body,
  });
}

function buildThemeDeleteIntent(state, input = {}) {
  const theme = selectedTheme(state, input.themeId);
  if (!theme) throw new ContractError('THEME_NOT_FOUND', 'Theme was not found');
  if (theme.builtIn === true || isBuiltInTheme(theme.id)) {
    throw new ContractError(
      'CANNOT_DELETE_BUILT_IN_THEME',
      'Built-in themes cannot be deleted',
      { themeId: theme.id },
    );
  }
  return freezeIntent({
    type: 'http',
    actionId: 'delete_theme',
    method: 'DELETE',
    path: `/api/themes/${encodeURIComponent(theme.id)}`,
  });
}

function buildProfileThemeUpdateIntent(input = {}) {
  const profileId = requireNonEmpty(input.profileId, 'profileId');
  const overlayThemeId = requireNonEmpty(input.overlayThemeId, 'overlayThemeId');
  const body = { overlayThemeId };
  throwContractValidation(validateProfileUpdateRequest(body));
  return freezeIntent({
    type: 'http',
    actionId: 'apply_theme_to_profile',
    method: 'PUT',
    path: `/api/profiles/${encodeURIComponent(profileId)}`,
    body,
  });
}

function buildPrivacySettingsReadIntent() {
  return freezeIntent({
    type: 'http',
    actionId: 'read_privacy_settings',
    method: 'GET',
    path: '/api/settings/privacy',
  });
}

function buildPrivacySettingsUpdateIntent(state, input = {}) {
  const current = createCloseoutScreensState(state);
  const body = copyPrivacySettings(input.settings || current.privacyDraft);
  throwContractValidation(validatePrivacySettings(body));
  return freezeIntent({
    type: 'http',
    actionId: 'save_privacy_settings',
    method: 'PUT',
    path: '/api/settings/privacy',
    body,
  });
}

function buildDiagnosticsBundleIntent() {
  return freezeIntent({
    type: 'http',
    actionId: 'fetch_diagnostics_bundle',
    method: 'GET',
    path: '/api/diagnostics/bundle',
  });
}

function buildDiagnosticBundleCopyIntent(state) {
  const current = createCloseoutScreensState(state);
  if (!current.diagnosticBundle) {
    throw new ContractError('DIAGNOSTICS_FAILED', 'Diagnostic bundle is not loaded');
  }
  return freezeIntent({
    type: 'clipboard.writeText',
    actionId: 'copy_diagnostics_bundle',
    text: JSON.stringify(current.diagnosticBundle, null, 2),
    logSafeBody: diagnosticsLogSummary(current.diagnosticBundle),
    sensitive: true,
  });
}

function buildPrivacyHostActionIntent(actionId, state) {
  const normalized = normalizeActionId(actionId);
  if (normalized !== 'open_debug_folder' && normalized !== 'clear_debug_data') {
    throw new ContractError('CLOSEOUT_ACTION_UNAVAILABLE', 'Privacy action is unavailable', {
      actionId: normalized,
    });
  }
  const current = createCloseoutScreensState(state);
  if (normalized === 'open_debug_folder' && !trimOrNull(current.privacyDraft.debugScreenshotDirectory)) {
    throw new ContractError('CLOSEOUT_ACTION_UNAVAILABLE', 'Debug folder is not configured', {
      actionId: normalized,
      reason: 'debug_folder_missing',
    });
  }
  return freezeIntent({
    type: 'hostCommand',
    actionId: normalized,
    command: normalized,
    sensitive: false,
  });
}

function applyThemesResult(state, response) {
  const current = createCloseoutScreensState(state);
  throwContractValidation(validateThemesResponse(response));
  const themes = normalizeThemesResponse(response);
  return freezeState({
    ...current,
    themes,
    selectedThemeId: themes.some((theme) => theme.id === current.selectedThemeId)
      ? current.selectedThemeId
      : themes[0]?.id,
  });
}

function applyThemeMutationResult(state, theme) {
  const current = createCloseoutScreensState(state);
  throwContractValidation(validateOverlayTheme(theme, 'theme'));
  const normalized = normalizeTheme(theme);
  const existingIndex = current.themes.findIndex((entry) => entry.id === normalized.id);
  const nextThemes = [...current.themes];
  if (existingIndex >= 0) {
    nextThemes[existingIndex] = normalized;
  } else {
    nextThemes.push(normalized);
  }
  return freezeState({
    ...current,
    themes: nextThemes,
    selectedThemeId: normalized.id,
  });
}

function applyThemeDeleted(state, input = {}) {
  const current = createCloseoutScreensState(state);
  if (!isPlainObject(input) || input.ok !== true) {
    throw new ContractError('VALIDATION_ERROR', 'Theme delete response must be { ok: true }');
  }
  const deletedId = trimOrNull(input.themeId) || current.selectedThemeId;
  if (isBuiltInTheme(deletedId)) return current;
  const themes = current.themes.filter((theme) => theme.id !== deletedId);
  return freezeState({
    ...current,
    themes,
    selectedThemeId: themes[0]?.id,
  });
}

function applyPrivacySettingsResult(state, settings) {
  const current = createCloseoutScreensState(state);
  throwContractValidation(validatePrivacySettings(settings));
  return freezeState({
    ...current,
    privacySettings: settings,
    privacyDraft: settings,
  });
}

function applyDiagnosticsBundleResult(state, bundle) {
  const current = createCloseoutScreensState(state);
  throwContractValidation(validateDiagnosticBundle(bundle));
  const normalized = normalizeDiagnosticBundle(bundle);
  throwContractValidation(validateDiagnosticBundle(normalized));
  return freezeState({
    ...current,
    diagnosticBundle: normalized,
  });
}

function buildThemePreview(theme, previewText) {
  const text = typeof previewText === 'string' ? previewText : DEFAULT_THEME_PREVIEW_TEXT;
  return deepFreeze({
    text,
    escapedText: escapeHtml(text),
    containsSensitiveText: text !== DEFAULT_THEME_PREVIEW_TEXT,
    cssJson: theme ? theme.cssJson : Object.freeze({}),
  });
}

function actionDescriptor(id, enabled, unavailableReason = null) {
  const actionId = normalizeActionId(id);
  if (!actionId) return null;
  return deepFreeze({
    id: actionId,
    enabled: enabled === true,
    unavailableReason: enabled === true ? null : unavailableReason || 'unavailable',
  });
}

function validationPasses(validator, payload) {
  return validator(payload).length === 0;
}

function buildThemeEditorView(state) {
  const current = createCloseoutScreensState(state);
  const theme = selectedTheme(current);
  const editable = Boolean(theme && theme.builtIn !== true && !isBuiltInTheme(theme.id));
  const createBody = {
    name: current.themeDraft.name,
    cssJson: current.themeDraft.cssJson,
  };
  const canCreate = validationPasses(validateOverlayThemeCreateRequest, createBody);
  const updateBody = {};
  if (current.themeDraft.name) updateBody.name = current.themeDraft.name;
  if (Object.keys(current.themeDraft.cssJson).length > 0) {
    updateBody.cssJson = current.themeDraft.cssJson;
  }
  const canUpdate = editable &&
    validationPasses(validateOverlayThemeUpdateRequest, updateBody);
  return deepFreeze({
    id: 'overlay-theme',
    route: 'overlay-theme',
    themes: current.themes,
    builtInThemes: current.themes.filter((entry) => entry.builtIn === true),
    customThemes: current.themes.filter((entry) => entry.builtIn !== true),
    selectedTheme: theme,
    editable,
    empty: current.themes.filter((entry) => entry.builtIn !== true).length === 0,
    draft: current.themeDraft,
    preview: buildThemePreview(theme, current.themeDraft.previewText),
    error: current.errors['overlay-theme'] || null,
    actions: [
      actionDescriptor('refresh_themes', true),
      actionDescriptor('create_theme', canCreate, 'validation_error'),
      actionDescriptor('duplicate_theme', Boolean(theme), 'theme_missing'),
      actionDescriptor('update_theme', canUpdate, editable ? 'validation_error' : 'built_in_theme'),
      actionDescriptor('delete_theme', editable, editable ? null : 'built_in_theme'),
      actionDescriptor('apply_theme_to_profile', Boolean(theme), 'theme_missing'),
    ].filter(Boolean),
  });
}

function derivePrivacyWarnings(settings) {
  const warnings = [];
  if (settings.saveRecentOcrText === true) warnings.push('ocr_text_persistence');
  if (settings.saveRecentTranslations === true) warnings.push('translation_persistence');
  if (settings.saveDebugScreenshots === true) warnings.push('debug_screenshot_persistence');
  return deepFreeze(warnings);
}

function buildPrivacySettingsView(state) {
  const current = createCloseoutScreensState(state);
  const validationErrors = validatePrivacySettings(current.privacyDraft);
  const warnings = derivePrivacyWarnings(current.privacyDraft);
  return deepFreeze({
    id: 'privacy',
    route: 'privacy',
    settings: current.privacySettings,
    draft: current.privacyDraft,
    warnings,
    requiresExplicitOptIn: warnings.length > 0,
    valid: validationErrors.length === 0,
    fieldErrors: sanitizeFieldErrors(validationErrors),
    error: current.errors.privacy || null,
    actions: [
      actionDescriptor('read_privacy_settings', true),
      actionDescriptor('save_privacy_settings', validationErrors.length === 0, 'validation_error'),
      actionDescriptor('disable_debug_persistence', warnings.length > 0, 'debug_persistence_disabled'),
      actionDescriptor(
        'open_debug_folder',
        trimOrNull(current.privacyDraft.debugScreenshotDirectory) !== null,
        'debug_folder_missing',
      ),
      actionDescriptor('clear_debug_data', true),
    ].filter(Boolean),
  });
}

function diagnosticsLogSummary(bundle) {
  if (!bundle) return null;
  return deepFreeze({
    generatedAt: bundle.generatedAt,
    appVersion: bundle.appVersion,
    backendVersion: bundle.backendVersion,
    activeProfileId: bundle.activeProfileId,
    redactedLogCount: Array.isArray(bundle.redactedLogs) ? bundle.redactedLogs.length : 0,
    redactionSummary: bundle.redactionSummary,
  });
}

function buildDiagnosticsView(state) {
  const current = createCloseoutScreensState(state);
  const bundle = current.diagnosticBundle;
  return deepFreeze({
    id: 'logs-diagnostics',
    route: 'logs-diagnostics',
    bundle,
    summary: diagnosticsLogSummary(bundle),
    previewLines: bundle ? bundle.redactedLogs.slice(0, 20) : Object.freeze([]),
    empty: !bundle || bundle.redactedLogs.length === 0,
    error: current.errors['logs-diagnostics'] || null,
    actions: [
      actionDescriptor('fetch_diagnostics_bundle', true),
      actionDescriptor('copy_diagnostics_bundle', Boolean(bundle), 'bundle_missing'),
      actionDescriptor('open_diagnostics', true),
    ].filter(Boolean),
  });
}

function buildObsSetupViewModel(input = {}) {
  const port = normalizePort(input.port);
  const shellView = buildViewModel({
    route: 'obs-setup',
    appStatus: input.appStatus,
    setup: input.setup,
    port,
  });
  const status = shellView.status;
  const trusted = status?.overlayUrlTrusted === true && isNonEmptyString(status.overlayUrl);
  const clients = Number.isInteger(status?.overlayClients) && status.overlayClients >= 0
    ? status.overlayClients
    : 0;
  const state = !status
    ? 'loading'
    : trusted
      ? clients > 0 ? 'connected' : 'disconnected'
      : 'unavailable';
  return deepFreeze({
    id: 'obs-setup',
    route: shellView.route,
    port,
    state,
    overlayUrl: trusted ? status.overlayUrl : null,
    overlayUrlTrusted: trusted,
    overlayClients: clients,
    recommendedDimensions: OBS_RECOMMENDED_DIMENSIONS,
    steps: [
      { id: 'add_browser_source', complete: trusted && clients > 0 },
      { id: 'set_url', complete: trusted },
      { id: 'set_dimensions', complete: false },
      { id: 'confirm_connection', complete: trusted && clients > 0 },
    ],
    actions: [
      actionDescriptor('refresh_status', port !== null, 'port_missing'),
      actionDescriptor('connect_status_stream', port !== null, 'port_missing'),
      actionDescriptor('copy_overlay_url', trusted, 'overlay_url_untrusted'),
      actionDescriptor('copy_obs_settings', trusted, 'overlay_url_untrusted'),
      actionDescriptor('open_overlay_browser', trusted, 'overlay_url_untrusted'),
      actionDescriptor('restart_backend', true),
      actionDescriptor('open_diagnostics', true),
    ].filter(Boolean),
  });
}

function buildObsSetupActionIntent(actionId, viewModel) {
  const normalized = normalizeActionId(actionId);
  const action = viewModel?.actions?.find((entry) => entry.id === normalized);
  if (!action || action.enabled !== true) {
    throw new ContractError('CLOSEOUT_ACTION_UNAVAILABLE', 'OBS setup action unavailable', {
      actionId: normalized,
      reason: action?.unavailableReason || 'unavailable',
    });
  }
  if (normalized === 'refresh_status') {
    return freezeIntent({
      type: 'http',
      actionId: normalized,
      method: 'GET',
      path: '/api/status',
    });
  }
  if (normalized === 'connect_status_stream') {
    const port = normalizePort(viewModel.port);
    if (port === null) {
      throw new ContractError('CLOSEOUT_ACTION_UNAVAILABLE', 'Port is missing', {
        actionId: normalized,
        reason: 'port_missing',
      });
    }
    return freezeIntent({
      type: 'websocket',
      actionId: normalized,
      url: `ws://127.0.0.1:${port}/ws/app`,
      path: '/ws/app',
      port,
    });
  }
  if (normalized === 'copy_overlay_url') {
    return freezeIntent({
      type: 'clipboard.writeText',
      actionId: normalized,
      text: viewModel.overlayUrl,
    });
  }
  if (normalized === 'copy_obs_settings') {
    return freezeIntent({
      type: 'clipboard.writeText',
      actionId: normalized,
      text: JSON.stringify({
        url: viewModel.overlayUrl,
        width: viewModel.recommendedDimensions.width,
        height: viewModel.recommendedDimensions.height,
      }, null, 2),
    });
  }
  if (normalized === 'open_overlay_browser') {
    return freezeIntent({
      type: 'hostCommand',
      actionId: normalized,
      command: 'open_url',
      url: viewModel.overlayUrl,
    });
  }
  if (normalized === 'restart_backend') {
    return freezeIntent({
      type: 'hostCommand',
      actionId: normalized,
      command: 'restart_backend',
    });
  }
  if (normalized === 'open_diagnostics') {
    return freezeIntent({
      type: 'navigate',
      actionId: normalized,
      route: 'logs-diagnostics',
    });
  }
  throw new ContractError('CLOSEOUT_ACTION_UNAVAILABLE', 'OBS setup action unavailable', {
    actionId: normalized,
  });
}

function buildCloseoutScreensViewModel(state, input = {}) {
  const current = createCloseoutScreensState(state);
  const screenViews = {
    'overlay-theme': buildThemeEditorView(current),
    'obs-setup': buildObsSetupViewModel(input),
    privacy: buildPrivacySettingsView(current),
    'logs-diagnostics': buildDiagnosticsView(current),
  };
  return deepFreeze({
    activeScreenId: current.activeScreenId,
    screens: CLOSEOUT_SCREEN_DEFINITIONS.map((screen) => ({
      ...screen,
      current: screen.id === current.activeScreenId,
      error: current.errors[screen.id] || null,
    })),
    theme: screenViews['overlay-theme'],
    obs: screenViews['obs-setup'],
    privacy: screenViews.privacy,
    diagnostics: screenViews['logs-diagnostics'],
    errors: current.errors,
    pendingAction: current.pendingAction,
  });
}

function redactCloseoutText(text) {
  return redactDiagnosticString(redactSecrets(String(text)))
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, REDACTED);
}

function sanitizeCloseoutError(error) {
  if (error === null || error === undefined) return null;
  if (
    isPlainObject(error) &&
    isNonEmptyString(error.code) &&
    Array.isArray(error.recoveryActions)
  ) {
    return deepFreeze({
      code: error.code.trim(),
      message: typeof error.message === 'string'
        ? redactCloseoutText(error.message)
        : 'Action failed',
      retryable: error.retryable === true,
      fieldErrors: sanitizeFieldErrors(error.fieldErrors),
      recoveryActions: deriveCloseoutRecoveryActions({
        code: error.code,
        retryable: error.retryable === true,
      }),
    });
  }
  const apiError = isPlainObject(error) && isPlainObject(error.error) ? error.error : null;
  const code = trimOrNull(apiError?.code) ||
    trimOrNull(error.code) ||
    'UNKNOWN_ERROR';
  const retryable = apiError ? apiError.retryable === true : error.retryable === true;
  const fieldErrors = apiError?.details?.fieldErrors || error.details?.fieldErrors;
  return deepFreeze({
    code,
    message: apiError
      ? redactCloseoutText(String(apiError.message || 'Action failed'))
      : 'Action failed',
    retryable,
    fieldErrors: sanitizeFieldErrors(fieldErrors),
    recoveryActions: deriveCloseoutRecoveryActions({ code, retryable }),
  });
}

function deriveCloseoutRecoveryActions(status) {
  if (!isPlainObject(status)) return deepFreeze([]);
  const code = trimOrNull(status.code);
  const actions = code && hasOwn(CLOSEOUT_RECOVERY_ACTIONS_BY_CODE, code)
    ? [...CLOSEOUT_RECOVERY_ACTIONS_BY_CODE[code]]
    : [...DEFAULT_CLOSEOUT_RECOVERY_ACTIONS];
  if (status.retryable === true && !actions.includes('retry')) actions.unshift('retry');
  return deepFreeze(actions);
}

function redactedCssJsonForLog(cssJson) {
  if (!isPlainObject(cssJson)) return Object.freeze({});
  const copied = {};
  for (const [key, value] of Object.entries(cssJson)) {
    const normalized = String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (
      normalized.includes('apikey') ||
      normalized.includes('token') ||
      normalized.includes('secret') ||
      normalized.includes('screenshot') ||
      normalized.includes('sourcetext') ||
      normalized.includes('translatedtext') ||
      normalized.includes('providerresponse')
    ) {
      copied[key] = REDACTED;
    } else if (typeof value === 'string') {
      copied[key] = redactCloseoutText(value);
    } else {
      copied[key] = value;
    }
  }
  return deepFreeze(copied);
}

function redactThemeForLog(theme) {
  if (!isPlainObject(theme)) return null;
  return deepFreeze({
    id: theme.id,
    name: redactCloseoutText(theme.name),
    builtIn: theme.builtIn === true,
    cssJson: redactedCssJsonForLog(theme.cssJson),
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  });
}

function redactPrivacyForLog(settings) {
  if (!isPlainObject(settings)) return null;
  const copied = copyIntentValue(settings);
  if (copied.debugScreenshotDirectory !== undefined) {
    copied.debugScreenshotDirectory = REDACTED;
  }
  return deepFreeze(copied);
}

function redactDiagnosticBundleForLog(bundle) {
  if (!bundle) return null;
  return diagnosticsLogSummary(bundle);
}

function freezeIntent(input) {
  const intent = {
    type: input.type || 'http',
    actionId: input.actionId || null,
    sensitive: input.sensitive === true,
  };
  for (const field of ['method', 'path', 'url', 'route', 'command', 'port']) {
    if (input[field] !== undefined) intent[field] = input[field];
  }
  if (input.body !== undefined) intent.body = copyIntentValue(input.body);
  if (input.text !== undefined) intent.text = input.text;
  if (input.logSafeBody !== undefined) intent.logSafeBody = copyIntentValue(input.logSafeBody);
  return deepFreeze(intent);
}

function safeCloseoutIntentForLog(intent) {
  if (!isPlainObject(intent)) return null;
  const safe = {
    type: intent.type,
    actionId: intent.actionId || null,
    sensitive: intent.sensitive === true,
  };
  for (const field of ['method', 'path', 'url', 'route', 'command', 'port']) {
    if (intent[field] !== undefined) safe[field] = intent[field];
  }
  if (intent.logSafeBody !== undefined) {
    safe.body = copyIntentValue(intent.logSafeBody);
  } else if (intent.body !== undefined) {
    safe.body = redactIntentBodyForLog(intent.body);
  }
  if (intent.text !== undefined) {
    safe.text = intent.sensitive === true ? REDACTED : redactCloseoutText(intent.text);
  }
  return deepFreeze(safe);
}

function redactIntentBodyForLog(body) {
  if (Array.isArray(body)) return body.map(redactIntentBodyForLog);
  if (!isPlainObject(body)) return typeof body === 'string' ? redactCloseoutText(body) : body;
  if (hasOwn(body, 'debugScreenshotDirectory')) return redactPrivacyForLog(body);
  const copied = {};
  for (const [key, value] of Object.entries(body)) {
    copied[key] = key === 'cssJson'
      ? redactedCssJsonForLog(value)
      : redactIntentBodyForLog(value);
  }
  return copied;
}

function safeCloseoutStateForLog(state) {
  const current = createCloseoutScreensState(state);
  return deepFreeze({
    activeScreenId: current.activeScreenId,
    themes: current.themes.map(redactThemeForLog),
    selectedThemeId: current.selectedThemeId,
    themeDraft: {
      name: redactCloseoutText(current.themeDraft.name),
      baseThemeId: current.themeDraft.baseThemeId,
      cssJson: redactedCssJsonForLog(current.themeDraft.cssJson),
      previewText: REDACTED,
    },
    privacySettings: redactPrivacyForLog(current.privacySettings),
    privacyDraft: redactPrivacyForLog(current.privacyDraft),
    diagnosticBundle: redactDiagnosticBundleForLog(current.diagnosticBundle),
    errors: current.errors,
    pendingAction: current.pendingAction,
  });
}

module.exports = {
  REDACTED,
  DEFAULT_THEME_PREVIEW_TEXT,
  OBS_RECOMMENDED_DIMENSIONS,
  CLOSEOUT_SCREEN_DEFINITIONS,
  CLOSEOUT_SCREEN_IDS,
  CLOSEOUT_ACTION_IDS,
  CLOSEOUT_RECOVERY_ACTIONS_BY_CODE,
  DEFAULT_CLOSEOUT_RECOVERY_ACTIONS,
  createCloseoutScreensState,
  updateThemeDraft,
  updatePrivacyDraft,
  navigateCloseoutScreen,
  setCloseoutPendingAction,
  setCloseoutScreenError,
  clearCloseoutScreenError,
  buildThemesListIntent,
  buildThemeCreateIntent,
  buildThemeDuplicateIntent,
  buildThemeUpdateIntent,
  buildThemeDeleteIntent,
  buildProfileThemeUpdateIntent,
  buildPrivacySettingsReadIntent,
  buildPrivacySettingsUpdateIntent,
  buildDiagnosticsBundleIntent,
  buildDiagnosticBundleCopyIntent,
  buildPrivacyHostActionIntent,
  applyThemesResult,
  applyThemeMutationResult,
  applyThemeDeleted,
  applyPrivacySettingsResult,
  applyDiagnosticsBundleResult,
  buildThemeEditorView,
  buildPrivacySettingsView,
  buildDiagnosticsView,
  buildObsSetupViewModel,
  buildObsSetupActionIntent,
  buildCloseoutScreensViewModel,
  sanitizeCloseoutError,
  deriveCloseoutRecoveryActions,
  safeCloseoutIntentForLog,
  safeCloseoutStateForLog,
};
