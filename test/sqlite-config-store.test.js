'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILTIN_THEME_IDS,
  ContractError,
  DEFAULT_PRIVACY_SETTINGS,
} = require('../src/contracts/security');
const { buildGlossaryRevision } = require('../src/core/translation-cache');
const {
  SQLITE_SCHEMA_VERSION,
  SQLITE_SCHEMA_STATEMENTS,
  EMPTY_GLOSSARY_REVISION,
  createSqliteConfigRepository,
  getBuiltInThemeSeedRows,
  getSqliteSchemaSql,
} = require('../src/storage/sqlite-config-store');

class RecordingDatabase {
  constructor() {
    this.execs = [];
    this.runs = [];
  }

  exec(sql) {
    this.execs.push(sql);
  }

  run(sql, params = {}) {
    this.runs.push({ sql, params });
    return { changes: 1 };
  }
}

function fixedRepository(database = new RecordingDatabase()) {
  return {
    database,
    repository: createSqliteConfigRepository({
      database,
      clock: () => '2026-05-28T00:00:00.000Z',
      idFactory: (kind) => `${kind}_001`,
    }),
  };
}

function makeProfileCreateRequest(overrides = {}) {
  return {
    name: 'Test Profile',
    gameTitle: 'Test Game',
    captureSource: {
      kind: 'window',
      id: 'window-1',
      label: 'Game Window',
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    },
    roi: { x: 10, y: 20, width: 640, height: 120 },
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.65,
    captureHz: 2,
    translationProvider: 'deepl',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossary: [
      { id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' },
      { id: 'g2', sourceTerm: '魔王', targetTerm: 'demon lord', note: 'Boss title' },
    ],
    ...overrides,
  };
}

function runsFor(database, tableName) {
  return database.runs.filter((entry) => entry.sql.includes(`INTO ${tableName}`));
}

function findRun(database, tableName) {
  return runsFor(database, tableName)[0];
}

function assertContractError(error, code = 'VALIDATION_ERROR') {
  assert.equal(error instanceof ContractError, true);
  assert.equal(error.code, code);
  assert.equal(Array.isArray(error.details.fieldErrors), true);
  return true;
}

test('sqlite config schema: version 1 declares required tables and privacy-safe columns', () => {
  assert.equal(SQLITE_SCHEMA_VERSION, 1);
  assert.ok(SQLITE_SCHEMA_STATEMENTS.length >= 10);

  const schema = getSqliteSchemaSql().toLowerCase();
  for (const table of [
    'app_meta',
    'profiles',
    'profile_settings',
    'glossary_terms',
    'overlay_themes',
    'privacy_settings',
    'translation_cache',
  ]) {
    assert.match(schema, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(schema, /source_text_hash text not null/);
  assert.match(schema, /key text primary key/);

  const privacyFlagNamesRemoved = schema
    .replaceAll('source_text_hash', '')
    .replaceAll('save_recent_ocr_text', '')
    .replaceAll('save_debug_screenshots', '')
    .replaceAll('debug_screenshot_directory', '');

  for (const forbidden of [
    'api_key',
    'apikey',
    'provider_key',
    'secret',
    'translated_text',
    'ocr_text_history',
    'recent_ocr_text',
    'image_blob',
    'screenshot_blob',
    'log_payload',
    'stack_trace',
  ]) {
    assert.equal(
      privacyFlagNamesRemoved.includes(forbidden),
      false,
      `schema must not contain ${forbidden}`,
    );
  }
  assert.equal(/\bsource_text\b/u.test(privacyFlagNamesRemoved), false);
  assert.equal(/\bocr_text\b/u.test(privacyFlagNamesRemoved), false);
});

test('sqlite config schema: built-in theme seeds match controlled theme ids', () => {
  const rows = getBuiltInThemeSeedRows();
  assert.equal(Object.isFrozen(rows), true);
  assert.deepEqual(rows.map((row) => row.id), BUILTIN_THEME_IDS);
  for (const row of rows) {
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.isFrozen(row.cssJson), true);
    assert.equal(row.builtIn, true);
    assert.equal(typeof row.cssJson.fontSizePx, 'number');
  }
});

test('sqlite config repository: initialize applies schema version, privacy defaults, and built-in themes', () => {
  const { database, repository } = fixedRepository();

  const result = repository.initialize();

  assert.equal(database.execs.length, 3);
  assert.match(database.execs[0], /CREATE TABLE IF NOT EXISTS profiles/);
  assert.match(database.execs[0], /CREATE TABLE IF NOT EXISTS privacy_settings/);
  assert.equal(database.execs[1], 'BEGIN IMMEDIATE TRANSACTION;');
  assert.equal(database.execs[2], 'COMMIT;');
  assert.deepEqual(result.builtInThemeIds, BUILTIN_THEME_IDS);
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.privacySettingsSeeded, DEFAULT_PRIVACY_SETTINGS);

  const schemaRun = findRun(database, 'app_meta');
  assert.equal(schemaRun.params.key, 'schema_version');
  assert.equal(schemaRun.params.value, '1');

  const privacyRun = findRun(database, 'privacy_settings');
  assert.equal(privacyRun.params.saveRecentOcrText, 0);
  assert.equal(privacyRun.params.recentOcrLimit, 0);
  assert.equal(privacyRun.params.saveRecentTranslations, 0);
  assert.equal(privacyRun.params.recentTranslationLimit, 0);
  assert.equal(privacyRun.params.saveDebugScreenshots, 0);
  assert.equal(privacyRun.params.debugRetentionDays, 0);
  assert.equal(privacyRun.params.debugScreenshotDirectory, null);

  const themeRuns = runsFor(database, 'overlay_themes');
  assert.deepEqual(themeRuns.map((entry) => entry.params.id), BUILTIN_THEME_IDS);
  assert.equal(JSON.stringify(database.runs).includes('apiKey'), false);
});

test('sqlite config repository: initialize refuses schema_version mismatches when adapter exposes changes', () => {
  class SchemaMismatchDatabase extends RecordingDatabase {
    run(sql, params) {
      super.run(sql, params);
      if (params.key === 'schema_version') return { changes: 0 };
      return { changes: 1 };
    }
  }
  const database = new SchemaMismatchDatabase();
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.initialize(),
    (error) =>
      error instanceof ContractError &&
      error.code === 'DB_SCHEMA_INCOMPATIBLE' &&
      error.details.expectedSchemaVersion === 1,
  );
  assert.deepEqual(database.execs.slice(1), ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
  assert.equal(database.runs.length, 1);
});

test('sqlite config repository: createProfile validates before any write', () => {
  const { database, repository } = fixedRepository();
  const payload = makeProfileCreateRequest({ apiKey: 'should-not-enter-db' });

  assert.throws(
    () => repository.createProfile(payload),
    (error) => {
      assertContractError(error);
      assert.ok(
        error.details.fieldErrors.some(
          (fieldError) =>
            fieldError.field === 'apiKey' &&
            fieldError.code === 'UNKNOWN_PROFILE_FIELD',
        ),
      );
      return true;
    },
  );
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: duplicate glossary term ids fail before writes', () => {
  const { database, repository } = fixedRepository();
  const payload = makeProfileCreateRequest({
    glossary: [
      { id: 'g1', sourceTerm: '魔王', targetTerm: 'demon lord' },
      { id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' },
    ],
  });

  assert.throws(
    () => repository.createProfile(payload),
    (error) => {
      assertContractError(error);
      assert.ok(
        error.details.fieldErrors.some(
          (fieldError) => fieldError.code === 'GLOSSARY_ID_DUPLICATE',
        ),
      );
      return true;
    },
  );
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: glossary normalization errors also happen before writes', () => {
  const { database, repository } = fixedRepository();
  const payload = makeProfileCreateRequest({
    glossary: [
      { id: 'g1', sourceTerm: '魔王', targetTerm: 'demon lord' },
      { id: 'g2', sourceTerm: '魔王', targetTerm: 'final boss' },
    ],
  });

  assert.throws(
    () => repository.createProfile(payload),
    (error) => {
      assertContractError(error);
      assert.ok(
        error.details.fieldErrors.some(
          (fieldError) => fieldError.code === 'GLOSSARY_SOURCE_DUPLICATE',
        ),
      );
      return true;
    },
  );
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: createProfile supports required-only profiles with empty glossary', () => {
  const { database, repository } = fixedRepository();
  const payload = {
    name: 'Required Only',
    ocrPreset: 'menu_text',
    ocrConfidenceFloor: 0.5,
    captureHz: 0,
    translationProvider: 'echo',
    targetLang: 'en',
    overlayThemeId: 'minimal',
    glossary: [],
  };

  const profile = repository.createProfile(payload);

  assert.equal('gameTitle' in profile, false);
  assert.equal('captureSource' in profile, false);
  assert.equal('roi' in profile, false);
  assert.deepEqual(profile.glossary, []);
  assert.equal(Object.isFrozen(profile.glossary), true);

  const settingsRun = findRun(database, 'profile_settings');
  assert.equal(settingsRun.params.captureSourceJson, null);
  assert.equal(settingsRun.params.roiJson, null);
  assert.equal(settingsRun.params.glossaryRevision, EMPTY_GLOSSARY_REVISION);
  assert.equal(runsFor(database, 'glossary_terms').length, 0);
});

test('sqlite config repository: createProfile writes profile, settings, and glossary rows', () => {
  const { database, repository } = fixedRepository();
  const payload = makeProfileCreateRequest();

  const profile = repository.createProfile(payload);

  assert.equal(profile.id, 'profile_001');
  assert.equal(profile.createdAt, '2026-05-28T00:00:00.000Z');
  assert.equal(profile.updatedAt, '2026-05-28T00:00:00.000Z');
  assert.equal(profile.name, payload.name);
  assert.deepEqual(profile.captureSource, payload.captureSource);
  assert.deepEqual(profile.roi, payload.roi);
  assert.deepEqual(profile.glossary, payload.glossary);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.captureSource), true);
  assert.equal(Object.isFrozen(profile.glossary[0]), true);

  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'COMMIT;']);

  const profileRun = findRun(database, 'profiles');
  assert.equal(profileRun.params.id, 'profile_001');
  assert.equal(profileRun.params.name, payload.name);
  assert.equal(profileRun.params.gameTitle, payload.gameTitle);

  const settingsRun = findRun(database, 'profile_settings');
  assert.equal(settingsRun.params.profileId, 'profile_001');
  assert.equal(settingsRun.params.captureSourceJson, JSON.stringify(payload.captureSource));
  assert.equal(settingsRun.params.roiJson, JSON.stringify(payload.roi));
  assert.equal(settingsRun.params.ocrPreset, payload.ocrPreset);
  assert.equal(settingsRun.params.ocrConfidenceFloor, payload.ocrConfidenceFloor);
  assert.equal(settingsRun.params.captureHz, payload.captureHz);
  assert.equal(settingsRun.params.translationProvider, payload.translationProvider);
  assert.equal(settingsRun.params.targetLang, 'en');
  assert.equal(settingsRun.params.overlayThemeId, payload.overlayThemeId);
  assert.equal(settingsRun.params.glossaryRevision, buildGlossaryRevision(payload.glossary));

  const glossaryRuns = runsFor(database, 'glossary_terms');
  assert.equal(glossaryRuns.length, 2);
  assert.deepEqual(
    glossaryRuns.map((entry) => ({
      id: entry.params.id,
      position: entry.params.position,
      note: entry.params.note,
    })),
    [
      { id: 'g1', position: 0, note: null },
      { id: 'g2', position: 1, note: 'Boss title' },
    ],
  );

  const serializedWrites = JSON.stringify(database.runs);
  for (const forbidden of [
    'apiKey',
    'providerApiKey',
    'providerKeys',
    'ocrText',
    'translatedText',
    'images',
    'screenshots',
    'logs',
  ]) {
    assert.equal(serializedWrites.includes(forbidden), false);
  }
});

test('sqlite config repository: createProfile rolls back if a write fails', () => {
  class FailingDatabase extends RecordingDatabase {
    run(sql, params) {
      if (this.runs.length === 1) {
        throw new Error('simulated write failure');
      }
      return super.run(sql, params);
    }
  }
  const database = new FailingDatabase();
  const repository = fixedRepository(database).repository;

  assert.throws(() => repository.createProfile(makeProfileCreateRequest()), /simulated/);
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
});

test('sqlite config repository: invalid Date clocks surface ContractError', () => {
  const database = new RecordingDatabase();
  const repository = createSqliteConfigRepository({
    database,
    clock: () => new Date(NaN),
    idFactory: (kind) => `${kind}_bad_clock`,
  });

  assert.throws(
    () => repository.createProfile(makeProfileCreateRequest()),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: savePrivacySettings validates before writing', () => {
  const { database, repository } = fixedRepository();

  assert.throws(
    () =>
      repository.savePrivacySettings({
        ...DEFAULT_PRIVACY_SETTINGS,
        saveRecentOcrText: true,
      }),
    (error) => {
      assertContractError(error);
      assert.ok(
        error.details.fieldErrors.some(
          (fieldError) => fieldError.field === 'recentOcrLimit',
        ),
      );
      return true;
    },
  );
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: savePrivacySettings persists booleans as integers', () => {
  const { database, repository } = fixedRepository();

  const settings = repository.savePrivacySettings({
    ...DEFAULT_PRIVACY_SETTINGS,
    saveRecentOcrText: true,
    recentOcrLimit: 12,
    saveRecentTranslations: true,
    recentTranslationLimit: 8,
    saveDebugScreenshots: true,
    debugScreenshotDirectory: 'C:\\glt-debug',
    debugRetentionDays: 3,
  });

  assert.equal(Object.isFrozen(settings), true);
  assert.deepEqual(settings, {
    saveRecentOcrText: true,
    recentOcrLimit: 12,
    saveRecentTranslations: true,
    recentTranslationLimit: 8,
    saveDebugScreenshots: true,
    debugScreenshotDirectory: 'C:\\glt-debug',
    debugRetentionDays: 3,
  });

  const run = findRun(database, 'privacy_settings');
  assert.equal(run.params.saveRecentOcrText, 1);
  assert.equal(run.params.recentOcrLimit, 12);
  assert.equal(run.params.saveRecentTranslations, 1);
  assert.equal(run.params.recentTranslationLimit, 8);
  assert.equal(run.params.saveDebugScreenshots, 1);
  assert.equal(run.params.debugScreenshotDirectory, 'C:\\glt-debug');
  assert.equal(run.params.debugRetentionDays, 3);
  assert.match(run.sql, /ON CONFLICT\(id\) DO UPDATE/);
});

test('sqlite config repository: provider key persistence is intentionally absent', () => {
  const { repository } = fixedRepository();
  assert.equal(Object.prototype.hasOwnProperty.call(repository, 'saveProviderKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(repository, 'readProviderKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(repository, 'listProviderKeys'), false);
});

test('sqlite config repository: adapter shape is required', () => {
  assert.throws(
    () => createSqliteConfigRepository({ database: { run() {} } }),
    (error) => error instanceof ContractError && error.code === 'DB_UNAVAILABLE',
  );
  assert.throws(
    () => createSqliteConfigRepository({ database: { exec() {} } }),
    (error) => error instanceof ContractError && error.code === 'DB_UNAVAILABLE',
  );
});
