'use strict';

const crypto = require('node:crypto');

const {
  BUILTIN_THEME_IDS,
  ContractError,
  DEFAULT_PRIVACY_SETTINGS,
} = require('../contracts/security');
const {
  ALLOWED_CAPTURE_HZ,
  ALLOWED_OCR_PRESETS,
  ALLOWED_PROVIDERS,
  ALLOWED_TARGET_LANGS,
  assertProfileExport,
  assertPrivacySettings,
  assertProfileCreateRequest,
  assertProfileUpdateRequest,
  fieldError,
  PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
  PROFILE_EXPORT_SCHEMA_VERSION,
} = require('../contracts/validation');
const {
  EMPTY_GLOSSARY_REVISION,
  buildGlossaryRevision,
} = require('../core/translation-cache');

const SQLITE_SCHEMA_VERSION = 1;
const ACTIVE_PROFILE_META_KEY = 'active_profile_id';
const RESERVED_PROFILE_IDS = Object.freeze(['active', 'import']);

const PROFILE_SELECT_SQL = `SELECT
  p.id AS id,
  p.name AS name,
  p.game_title AS gameTitle,
  p.created_at AS createdAt,
  p.updated_at AS updatedAt,
  ps.capture_source_json AS captureSourceJson,
  ps.roi_json AS roiJson,
  ps.ocr_preset AS ocrPreset,
  ps.ocr_confidence_floor AS ocrConfidenceFloor,
  ps.capture_hz AS captureHz,
  ps.translation_provider AS translationProvider,
  ps.target_lang AS targetLang,
  ps.overlay_theme_id AS overlayThemeId,
  ps.glossary_revision AS glossaryRevision
FROM profiles p
JOIN profile_settings ps ON ps.profile_id = p.id`;

const GLOSSARY_SELECT_SQL = `SELECT
  profile_id AS profileId,
  id AS id,
  source_term AS sourceTerm,
  target_term AS targetTerm,
  note AS note,
  position AS position
FROM glossary_terms`;

function sqlStringList(values) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
}

const SQLITE_SCHEMA_STATEMENTS = Object.freeze([
  'PRAGMA foreign_keys = ON;',
  `CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY CHECK (length(trim(key)) > 0),
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS overlay_themes (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  built_in INTEGER NOT NULL CHECK (built_in IN (0, 1)),
  css_json TEXT NOT NULL CHECK (json_valid(css_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  game_title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS profile_settings (
  profile_id TEXT PRIMARY KEY
    REFERENCES profiles(id) ON DELETE CASCADE,
  capture_source_json TEXT CHECK (capture_source_json IS NULL OR json_valid(capture_source_json)),
  roi_json TEXT CHECK (roi_json IS NULL OR json_valid(roi_json)),
  ocr_preset TEXT NOT NULL CHECK (ocr_preset IN (${sqlStringList(ALLOWED_OCR_PRESETS)})),
  ocr_confidence_floor REAL NOT NULL CHECK (ocr_confidence_floor >= 0 AND ocr_confidence_floor <= 1),
  capture_hz INTEGER NOT NULL CHECK (capture_hz IN (${ALLOWED_CAPTURE_HZ.join(', ')})),
  translation_provider TEXT NOT NULL CHECK (translation_provider IN (${sqlStringList(ALLOWED_PROVIDERS)})),
  target_lang TEXT NOT NULL CHECK (target_lang IN (${sqlStringList(ALLOWED_TARGET_LANGS)})),
  overlay_theme_id TEXT NOT NULL
    REFERENCES overlay_themes(id),
  glossary_revision TEXT NOT NULL CHECK (length(glossary_revision) = 64),
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS glossary_terms (
  profile_id TEXT NOT NULL
    REFERENCES profiles(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(trim(id)) > 0),
  source_term TEXT NOT NULL CHECK (length(trim(source_term)) > 0),
  target_term TEXT NOT NULL CHECK (length(trim(target_term)) > 0),
  note TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, id)
);`,
  `CREATE TABLE IF NOT EXISTS privacy_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  save_recent_ocr_text INTEGER NOT NULL CHECK (save_recent_ocr_text IN (0, 1)),
  recent_ocr_limit INTEGER NOT NULL CHECK (recent_ocr_limit >= 0),
  save_recent_translations INTEGER NOT NULL CHECK (save_recent_translations IN (0, 1)),
  recent_translation_limit INTEGER NOT NULL CHECK (recent_translation_limit >= 0),
  save_debug_screenshots INTEGER NOT NULL CHECK (save_debug_screenshots IN (0, 1)),
  debug_screenshot_directory TEXT,
  debug_retention_days INTEGER NOT NULL CHECK (debug_retention_days >= 0),
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS translation_cache (
  cache_key TEXT PRIMARY KEY CHECK (length(trim(cache_key)) > 0),
  provider TEXT NOT NULL CHECK (provider IN (${sqlStringList(ALLOWED_PROVIDERS)})),
  target_lang TEXT NOT NULL CHECK (target_lang IN (${sqlStringList(ALLOWED_TARGET_LANGS)})),
  source_text_hash TEXT NOT NULL CHECK (length(source_text_hash) = 64),
  glossary_revision TEXT NOT NULL CHECK (length(glossary_revision) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0)
);`,
  'CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at);',
  'CREATE INDEX IF NOT EXISTS idx_glossary_terms_profile_position ON glossary_terms(profile_id, position);',
  'CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup ON translation_cache(provider, target_lang, source_text_hash, glossary_revision);',
]);

const BUILT_IN_THEME_SEED_ROWS = Object.freeze([
  Object.freeze({
    id: 'classic_subtitle',
    name: 'Classic Subtitle',
    builtIn: true,
    cssJson: Object.freeze({
      fontFamily: 'Arial',
      fontSizePx: 42,
      fontWeight: 700,
      textColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidthPx: 4,
      shadowColor: 'rgba(0,0,0,0.55)',
      shadowBlurPx: 8,
      backgroundColor: 'transparent',
      maxWidthPct: 88,
      position: 'bottom_center',
      visibleLines: 2,
    }),
  }),
  Object.freeze({
    id: 'stream_box',
    name: 'Stream Box',
    builtIn: true,
    cssJson: Object.freeze({
      fontFamily: 'Inter',
      fontSizePx: 34,
      fontWeight: 700,
      textColor: '#f8fafc',
      strokeColor: '#0f172a',
      strokeWidthPx: 2,
      shadowColor: 'rgba(15,23,42,0.5)',
      shadowBlurPx: 10,
      backgroundColor: 'rgba(15,23,42,0.72)',
      maxWidthPct: 76,
      position: 'bottom_center',
      visibleLines: 3,
    }),
  }),
  Object.freeze({
    id: 'minimal',
    name: 'Minimal',
    builtIn: true,
    cssJson: Object.freeze({
      fontFamily: 'Arial',
      fontSizePx: 32,
      fontWeight: 600,
      textColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidthPx: 0,
      shadowColor: 'rgba(0,0,0,0.7)',
      shadowBlurPx: 6,
      backgroundColor: 'transparent',
      maxWidthPct: 72,
      position: 'bottom_center',
      visibleLines: 1,
    }),
  }),
]);

function getSqliteSchemaSql() {
  return `${SQLITE_SCHEMA_STATEMENTS.join('\n\n')}\n`;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function getBuiltInThemeSeedRows() {
  return Object.freeze(BUILT_IN_THEME_SEED_ROWS.map((row) => deepFreeze(cloneJson(row))));
}

function assertDatabaseAdapter(database) {
  if (
    database == null ||
    typeof database.exec !== 'function' ||
    typeof database.run !== 'function'
  ) {
    throw new ContractError(
      'DB_UNAVAILABLE',
      'SQLite adapter must provide exec(sql) and run(sql, params)',
    );
  }
}

function assertReadDatabaseAdapter(database) {
  if (
    database == null ||
    typeof database.get !== 'function' ||
    typeof database.all !== 'function'
  ) {
    throw new ContractError(
      'DB_UNAVAILABLE',
      'SQLite adapter must provide get(sql, params) and all(sql, params) for profile reads',
    );
  }
}

function timestampFromClock(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ContractError('VALIDATION_ERROR', 'clock returned an invalid timestamp');
    }
    return value.toISOString();
  }
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ContractError('VALIDATION_ERROR', 'clock returned an invalid timestamp');
    }
    return parsed.toISOString();
  }
  throw new ContractError('VALIDATION_ERROR', 'clock must return Date, number, or ISO string');
}

function defaultIdFactory(kind) {
  return `${kind}_${crypto.randomUUID()}`;
}

function createId(idFactory, kind) {
  const id = idFactory(kind);
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new ContractError('VALIDATION_ERROR', `${kind} id must be a non-empty string`);
  }
  return assertProfileId(id, `${kind}Id`);
}

function boolToInteger(value) {
  return value === true ? 1 : 0;
}

function jsonOrNull(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJsonOrUndefined(value, field) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return cloneJson(value);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new ContractError('DB_READ_FAILED', `${field} contained invalid JSON`, {
      field,
      causeCode: error && error.code,
    });
  }
}

function normalizeProfileForReturn(profile) {
  const output = {
    id: profile.id,
    name: profile.name,
    ocrPreset: profile.ocrPreset,
    ocrConfidenceFloor: profile.ocrConfidenceFloor,
    captureHz: profile.captureHz,
    translationProvider: profile.translationProvider,
    targetLang: profile.targetLang,
    overlayThemeId: profile.overlayThemeId,
    glossary: profile.glossary.map((term) => {
      const normalized = {
        id: term.id,
        sourceTerm: term.sourceTerm,
        targetTerm: term.targetTerm,
      };
      if (term.note !== undefined) normalized.note = term.note;
      return normalized;
    }),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
  if (profile.gameTitle !== undefined) output.gameTitle = profile.gameTitle;
  if (profile.captureSource !== undefined) output.captureSource = cloneJson(profile.captureSource);
  if (profile.roi !== undefined) output.roi = cloneJson(profile.roi);
  return deepFreeze(output);
}

function normalizePrivacySettingsForReturn(settings) {
  const output = {
    saveRecentOcrText: settings.saveRecentOcrText,
    recentOcrLimit: settings.recentOcrLimit,
    saveRecentTranslations: settings.saveRecentTranslations,
    recentTranslationLimit: settings.recentTranslationLimit,
    saveDebugScreenshots: settings.saveDebugScreenshots,
    debugRetentionDays: settings.debugRetentionDays,
  };
  if (settings.debugScreenshotDirectory !== undefined) {
    output.debugScreenshotDirectory = settings.debugScreenshotDirectory;
  }
  return deepFreeze(output);
}

function run(database, sql, params) {
  return database.run(sql, params);
}

function get(database, sql, params) {
  assertReadDatabaseAdapter(database);
  return database.get(sql, params) ?? null;
}

function all(database, sql, params) {
  assertReadDatabaseAdapter(database);
  const rows = database.all(sql, params);
  if (!Array.isArray(rows)) {
    throw new ContractError('DB_READ_FAILED', 'SQLite adapter all(sql, params) must return an array');
  }
  return rows;
}

function rowValue(row, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

function assertProfileId(profileId, field = 'profileId') {
  if (typeof profileId !== 'string' || profileId.trim().length === 0) {
    throw new ContractError('VALIDATION_ERROR', `${field} must be a non-empty string`, {
      fieldErrors: [
        fieldError(field, 'VALIDATION_ERROR', `${field} must be a non-empty string`),
      ],
    });
  }
  const normalized = profileId.normalize('NFKC').trim();
  if (RESERVED_PROFILE_IDS.includes(normalized)) {
    throw new ContractError('VALIDATION_ERROR', `${field} is reserved`, {
      fieldErrors: [
        fieldError(
          field,
          'PROFILE_ID_RESERVED',
          `${field} cannot be one of ${RESERVED_PROFILE_IDS.join(', ')}`,
        ),
      ],
    });
  }
  return normalized;
}

function profileNotFound(profileId) {
  return new ContractError('PROFILE_NOT_FOUND', `Profile not found: ${profileId}`, {
    profileId,
  });
}

function glossaryTermsFromRows(rows) {
  return rows.map((row) => {
    const term = {
      id: rowValue(row, 'id'),
      sourceTerm: rowValue(row, 'sourceTerm', 'source_term'),
      targetTerm: rowValue(row, 'targetTerm', 'target_term'),
    };
    const note = rowValue(row, 'note');
    if (note !== null && note !== undefined) term.note = note;
    return term;
  });
}

function profileFromRow(row, glossaryRows) {
  const profile = {
    id: rowValue(row, 'id', 'profile_id'),
    name: rowValue(row, 'name'),
    ocrPreset: rowValue(row, 'ocrPreset', 'ocr_preset'),
    ocrConfidenceFloor: Number(rowValue(row, 'ocrConfidenceFloor', 'ocr_confidence_floor')),
    captureHz: Number(rowValue(row, 'captureHz', 'capture_hz')),
    translationProvider: rowValue(row, 'translationProvider', 'translation_provider'),
    targetLang: rowValue(row, 'targetLang', 'target_lang'),
    overlayThemeId: rowValue(row, 'overlayThemeId', 'overlay_theme_id'),
    glossary: glossaryTermsFromRows(glossaryRows),
    createdAt: rowValue(row, 'createdAt', 'created_at'),
    updatedAt: rowValue(row, 'updatedAt', 'updated_at'),
  };
  const gameTitle = rowValue(row, 'gameTitle', 'game_title');
  const captureSource = parseJsonOrUndefined(
    rowValue(row, 'captureSourceJson', 'capture_source_json'),
    'captureSource',
  );
  const roi = parseJsonOrUndefined(rowValue(row, 'roiJson', 'roi_json'), 'roi');
  if (gameTitle !== null && gameTitle !== undefined) profile.gameTitle = gameTitle;
  if (captureSource !== undefined) profile.captureSource = captureSource;
  if (roi !== undefined) profile.roi = roi;
  return normalizeProfileForReturn(profile);
}

function profileCreateFieldsFromProfile(profile) {
  const fields = {
    name: profile.name,
    ocrPreset: profile.ocrPreset,
    ocrConfidenceFloor: profile.ocrConfidenceFloor,
    captureHz: profile.captureHz,
    translationProvider: profile.translationProvider,
    targetLang: profile.targetLang,
    overlayThemeId: profile.overlayThemeId,
    glossary: profile.glossary,
  };
  for (const field of ['gameTitle', 'captureSource', 'roi']) {
    if (profile[field] !== undefined) fields[field] = cloneJson(profile[field]);
  }
  return fields;
}

function mergeProfileUpdate(currentProfile, patch) {
  const merged = profileCreateFieldsFromProfile(currentProfile);
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[field];
    } else {
      merged[field] = cloneJson(value);
    }
  }
  assertProfileCreateRequest(merged);
  return merged;
}

function assertSchemaVersionSeeded(result) {
  if (result && typeof result.changes === 'number' && result.changes === 0) {
    throw new ContractError(
      'DB_SCHEMA_INCOMPATIBLE',
      `SQLite schema_version must be ${SQLITE_SCHEMA_VERSION}`,
      { expectedSchemaVersion: SQLITE_SCHEMA_VERSION },
    );
  }
}

function assertUniqueGlossaryTermIds(glossary) {
  const firstIndexById = new Map();
  const errors = [];
  glossary.forEach((term, index) => {
    const firstIndex = firstIndexById.get(term.id);
    if (firstIndex !== undefined) {
      errors.push(
        fieldError(
          `glossary[${index}].id`,
          'GLOSSARY_ID_DUPLICATE',
          `id duplicates glossary[${firstIndex}].id`,
        ),
      );
      return;
    }
    firstIndexById.set(term.id, index);
  });
  if (errors.length > 0) {
    throw new ContractError('VALIDATION_ERROR', 'Glossary validation failed', {
      fieldErrors: errors,
    });
  }
}

function withTransaction(database, callback) {
  database.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = callback();
    database.exec('COMMIT;');
    return result;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function createSqliteConfigRepository({
  database,
  clock = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  assertDatabaseAdapter(database);
  if (typeof idFactory !== 'function') {
    throw new ContractError('VALIDATION_ERROR', 'idFactory must be a function');
  }

  function initialize() {
    const updatedAt = timestampFromClock(clock);
    database.exec(getSqliteSchemaSql());
    const seedResult = withTransaction(database, () => {
      const schemaVersionResult = run(
        database,
        `INSERT INTO app_meta (key, value, updated_at)
VALUES (:key, :value, :updatedAt)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at
WHERE app_meta.value = excluded.value;`,
        {
          key: 'schema_version',
          value: String(SQLITE_SCHEMA_VERSION),
          updatedAt,
        },
      );
      assertSchemaVersionSeeded(schemaVersionResult);

      const defaults = DEFAULT_PRIVACY_SETTINGS;
      run(
        database,
        `INSERT INTO privacy_settings (
  id,
  save_recent_ocr_text,
  recent_ocr_limit,
  save_recent_translations,
  recent_translation_limit,
  save_debug_screenshots,
  debug_screenshot_directory,
  debug_retention_days,
  updated_at
) VALUES (
  1,
  :saveRecentOcrText,
  :recentOcrLimit,
  :saveRecentTranslations,
  :recentTranslationLimit,
  :saveDebugScreenshots,
  :debugScreenshotDirectory,
  :debugRetentionDays,
  :updatedAt
)
ON CONFLICT(id) DO NOTHING;`,
        {
          saveRecentOcrText: boolToInteger(defaults.saveRecentOcrText),
          recentOcrLimit: defaults.recentOcrLimit,
          saveRecentTranslations: boolToInteger(defaults.saveRecentTranslations),
          recentTranslationLimit: defaults.recentTranslationLimit,
          saveDebugScreenshots: boolToInteger(defaults.saveDebugScreenshots),
          debugScreenshotDirectory: defaults.debugScreenshotDirectory ?? null,
          debugRetentionDays: defaults.debugRetentionDays,
          updatedAt,
        },
      );

      for (const theme of BUILT_IN_THEME_SEED_ROWS) {
        run(
          database,
          `INSERT INTO overlay_themes (
  id,
  name,
  built_in,
  css_json,
  created_at,
  updated_at
) VALUES (
  :id,
  :name,
  :builtIn,
  :cssJson,
  :createdAt,
  :updatedAt
)
ON CONFLICT(id) DO NOTHING;`,
          {
            id: theme.id,
            name: theme.name,
            builtIn: boolToInteger(theme.builtIn),
            cssJson: JSON.stringify(theme.cssJson),
            createdAt: updatedAt,
            updatedAt,
          },
        );
      }

      return deepFreeze({
        schemaVersion: SQLITE_SCHEMA_VERSION,
        privacySettingsSeeded: normalizePrivacySettingsForReturn(DEFAULT_PRIVACY_SETTINGS),
        builtInThemeIds: [...BUILTIN_THEME_IDS],
      });
    });

    return seedResult;
  }

  function createProfile(request) {
    assertProfileCreateRequest(request);
    assertUniqueGlossaryTermIds(request.glossary);
    const glossaryRevision = buildGlossaryRevision(request.glossary);
    const now = timestampFromClock(clock);
    const profile = normalizeProfileForReturn({
      ...request,
      id: createId(idFactory, 'profile'),
      createdAt: now,
      updatedAt: now,
    });

    withTransaction(database, () => {
      run(
        database,
        `INSERT INTO profiles (
  id,
  name,
  game_title,
  created_at,
  updated_at
) VALUES (
  :id,
  :name,
  :gameTitle,
  :createdAt,
  :updatedAt
);`,
        {
          id: profile.id,
          name: profile.name,
          gameTitle: profile.gameTitle ?? null,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
      );
      run(
        database,
        `INSERT INTO profile_settings (
  profile_id,
  capture_source_json,
  roi_json,
  ocr_preset,
  ocr_confidence_floor,
  capture_hz,
  translation_provider,
  target_lang,
  overlay_theme_id,
  glossary_revision,
  updated_at
) VALUES (
  :profileId,
  :captureSourceJson,
  :roiJson,
  :ocrPreset,
  :ocrConfidenceFloor,
  :captureHz,
  :translationProvider,
  :targetLang,
  :overlayThemeId,
  :glossaryRevision,
  :updatedAt
);`,
        {
          profileId: profile.id,
          captureSourceJson: jsonOrNull(profile.captureSource),
          roiJson: jsonOrNull(profile.roi),
          ocrPreset: profile.ocrPreset,
          ocrConfidenceFloor: profile.ocrConfidenceFloor,
          captureHz: profile.captureHz,
          translationProvider: profile.translationProvider,
          targetLang: profile.targetLang,
          overlayThemeId: profile.overlayThemeId,
          glossaryRevision,
          updatedAt: profile.updatedAt,
        },
      );

      profile.glossary.forEach((term, index) => {
        run(
          database,
          `INSERT INTO glossary_terms (
  profile_id,
  id,
  source_term,
  target_term,
  note,
  position,
  created_at,
  updated_at
) VALUES (
  :profileId,
  :id,
  :sourceTerm,
  :targetTerm,
  :note,
  :position,
  :createdAt,
  :updatedAt
);`,
          {
            profileId: profile.id,
            id: term.id,
            sourceTerm: term.sourceTerm,
            targetTerm: term.targetTerm,
            note: term.note ?? null,
            position: index,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          },
        );
      });
    });

    return profile;
  }

  function listProfiles() {
    const profileRows = all(
      database,
      `${PROFILE_SELECT_SQL}
ORDER BY p.updated_at DESC, p.name ASC;`,
      {},
    );
    const glossaryRows = all(
      database,
      `${GLOSSARY_SELECT_SQL}
ORDER BY profile_id ASC, position ASC, id ASC;`,
      {},
    );
    const termsByProfileId = new Map();
    for (const row of glossaryRows) {
      const profileId = rowValue(row, 'profileId', 'profile_id');
      if (!termsByProfileId.has(profileId)) termsByProfileId.set(profileId, []);
      termsByProfileId.get(profileId).push(row);
    }
    return deepFreeze(profileRows.map((row) => {
      const profileId = rowValue(row, 'id', 'profile_id');
      return profileFromRow(row, termsByProfileId.get(profileId) ?? []);
    }));
  }

  function getProfile(profileId) {
    const normalizedProfileId = assertProfileId(profileId);
    const profileRow = get(
      database,
      `${PROFILE_SELECT_SQL}
WHERE p.id = :profileId
LIMIT 1;`,
      { profileId: normalizedProfileId },
    );
    if (profileRow === null) throw profileNotFound(normalizedProfileId);
    const glossaryRows = all(
      database,
      `${GLOSSARY_SELECT_SQL}
WHERE profile_id = :profileId
ORDER BY position ASC, id ASC;`,
      { profileId: normalizedProfileId },
    );
    return profileFromRow(profileRow, glossaryRows);
  }

  function updateProfile(profileId, patch) {
    const normalizedProfileId = assertProfileId(profileId);
    assertProfileUpdateRequest(patch);
    if (Array.isArray(patch.glossary)) {
      assertUniqueGlossaryTermIds(patch.glossary);
      buildGlossaryRevision(patch.glossary);
    }

    let profile;
    withTransaction(database, () => {
      const currentProfile = getProfile(normalizedProfileId);
      const merged = mergeProfileUpdate(currentProfile, patch);
      assertUniqueGlossaryTermIds(merged.glossary);
      const glossaryRevision = buildGlossaryRevision(merged.glossary);
      const now = timestampFromClock(clock);
      profile = normalizeProfileForReturn({
        ...merged,
        id: normalizedProfileId,
        createdAt: currentProfile.createdAt,
        updatedAt: now,
      });

      run(
        database,
        `UPDATE profiles
SET
  name = :name,
  game_title = :gameTitle,
  updated_at = :updatedAt
WHERE id = :profileId;`,
        {
          profileId: normalizedProfileId,
          name: profile.name,
          gameTitle: profile.gameTitle ?? null,
          updatedAt: profile.updatedAt,
        },
      );
      run(
        database,
        `UPDATE profile_settings
SET
  capture_source_json = :captureSourceJson,
  roi_json = :roiJson,
  ocr_preset = :ocrPreset,
  ocr_confidence_floor = :ocrConfidenceFloor,
  capture_hz = :captureHz,
  translation_provider = :translationProvider,
  target_lang = :targetLang,
  overlay_theme_id = :overlayThemeId,
  glossary_revision = :glossaryRevision,
  updated_at = :updatedAt
WHERE profile_id = :profileId;`,
        {
          profileId: normalizedProfileId,
          captureSourceJson: jsonOrNull(profile.captureSource),
          roiJson: jsonOrNull(profile.roi),
          ocrPreset: profile.ocrPreset,
          ocrConfidenceFloor: profile.ocrConfidenceFloor,
          captureHz: profile.captureHz,
          translationProvider: profile.translationProvider,
          targetLang: profile.targetLang,
          overlayThemeId: profile.overlayThemeId,
          glossaryRevision,
          updatedAt: profile.updatedAt,
        },
      );
      run(
        database,
        'DELETE FROM glossary_terms WHERE profile_id = :profileId;',
        { profileId: normalizedProfileId },
      );
      profile.glossary.forEach((term, index) => {
        run(
          database,
          `INSERT INTO glossary_terms (
  profile_id,
  id,
  source_term,
  target_term,
  note,
  position,
  created_at,
  updated_at
) VALUES (
  :profileId,
  :id,
  :sourceTerm,
  :targetTerm,
  :note,
  :position,
  :createdAt,
  :updatedAt
);`,
          {
            profileId: normalizedProfileId,
            id: term.id,
            sourceTerm: term.sourceTerm,
            targetTerm: term.targetTerm,
            note: term.note ?? null,
            position: index,
            createdAt: profile.updatedAt,
            updatedAt: profile.updatedAt,
          },
        );
      });
    });

    return profile;
  }

  function getActiveProfileId() {
    const row = get(
      database,
      'SELECT value FROM app_meta WHERE key = :key LIMIT 1;',
      { key: ACTIVE_PROFILE_META_KEY },
    );
    const value = row === null ? null : rowValue(row, 'value');
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  function setActiveProfile(profileId) {
    const normalizedProfileId = assertProfileId(profileId);
    withTransaction(database, () => {
      getProfile(normalizedProfileId);
      const updatedAt = timestampFromClock(clock);
      run(
        database,
        `INSERT INTO app_meta (key, value, updated_at)
VALUES (:key, :value, :updatedAt)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;`,
        {
          key: ACTIVE_PROFILE_META_KEY,
          value: normalizedProfileId,
          updatedAt,
        },
      );
    });
    return deepFreeze({ ok: true });
  }

  function deleteProfile(profileId) {
    const normalizedProfileId = assertProfileId(profileId);
    withTransaction(database, () => {
      getProfile(normalizedProfileId);
      if (getActiveProfileId() === normalizedProfileId) {
        throw new ContractError(
          'CANNOT_DELETE_ACTIVE_PROFILE',
          'The active profile cannot be deleted until another profile is activated',
          { profileId: normalizedProfileId },
        );
      }
      run(
        database,
        'DELETE FROM profiles WHERE id = :profileId;',
        { profileId: normalizedProfileId },
      );
    });
    return deepFreeze({ ok: true });
  }

  function exportProfile(profileId) {
    const profile = getProfile(profileId);
    const payload = {
      schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
      profile,
      exportedAt: timestampFromClock(clock),
      forbiddenFieldsPolicy: PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
    };
    assertProfileExport(payload);
    return deepFreeze(payload);
  }

  function savePrivacySettings(settings) {
    assertPrivacySettings(settings);
    const normalized = normalizePrivacySettingsForReturn(settings);
    const updatedAt = timestampFromClock(clock);
    run(
      database,
      `INSERT INTO privacy_settings (
  id,
  save_recent_ocr_text,
  recent_ocr_limit,
  save_recent_translations,
  recent_translation_limit,
  save_debug_screenshots,
  debug_screenshot_directory,
  debug_retention_days,
  updated_at
) VALUES (
  1,
  :saveRecentOcrText,
  :recentOcrLimit,
  :saveRecentTranslations,
  :recentTranslationLimit,
  :saveDebugScreenshots,
  :debugScreenshotDirectory,
  :debugRetentionDays,
  :updatedAt
)
ON CONFLICT(id) DO UPDATE SET
  save_recent_ocr_text = excluded.save_recent_ocr_text,
  recent_ocr_limit = excluded.recent_ocr_limit,
  save_recent_translations = excluded.save_recent_translations,
  recent_translation_limit = excluded.recent_translation_limit,
  save_debug_screenshots = excluded.save_debug_screenshots,
  debug_screenshot_directory = excluded.debug_screenshot_directory,
  debug_retention_days = excluded.debug_retention_days,
  updated_at = excluded.updated_at;`,
      {
        saveRecentOcrText: boolToInteger(normalized.saveRecentOcrText),
        recentOcrLimit: normalized.recentOcrLimit,
        saveRecentTranslations: boolToInteger(normalized.saveRecentTranslations),
        recentTranslationLimit: normalized.recentTranslationLimit,
        saveDebugScreenshots: boolToInteger(normalized.saveDebugScreenshots),
        debugScreenshotDirectory: normalized.debugScreenshotDirectory ?? null,
        debugRetentionDays: normalized.debugRetentionDays,
        updatedAt,
      },
    );
    return normalized;
  }

  return Object.freeze({
    initialize,
    createProfile,
    listProfiles,
    getProfile,
    updateProfile,
    deleteProfile,
    getActiveProfileId,
    setActiveProfile,
    exportProfile,
    savePrivacySettings,
  });
}

module.exports = {
  SQLITE_SCHEMA_VERSION,
  ACTIVE_PROFILE_META_KEY,
  RESERVED_PROFILE_IDS,
  SQLITE_SCHEMA_STATEMENTS,
  EMPTY_GLOSSARY_REVISION,
  getSqliteSchemaSql,
  getBuiltInThemeSeedRows,
  createSqliteConfigRepository,
};
