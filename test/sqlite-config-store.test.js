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
  RESERVED_PROFILE_IDS,
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

class QueuedDatabase extends RecordingDatabase {
  constructor({ gets = [], alls = [] } = {}) {
    super();
    this.getQueue = [...gets];
    this.allQueue = [...alls];
    this.getCalls = [];
    this.allCalls = [];
  }

  get(sql, params = {}) {
    this.getCalls.push({ sql, params });
    const next = this.getQueue.shift();
    return typeof next === 'function' ? next(sql, params) : (next ?? null);
  }

  all(sql, params = {}) {
    this.allCalls.push({ sql, params });
    const next = this.allQueue.shift();
    return typeof next === 'function' ? next(sql, params) : (next ?? []);
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

function storedProfileRow(overrides = {}) {
  return {
    id: 'profile_001',
    name: 'Stored Profile',
    gameTitle: 'Stored Game',
    captureSourceJson: JSON.stringify({
      kind: 'window',
      id: 'window-1',
      label: 'Game Window',
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    }),
    roiJson: JSON.stringify({ x: 10, y: 20, width: 640, height: 120 }),
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.65,
    captureHz: 2,
    translationProvider: 'deepl',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossaryRevision: buildGlossaryRevision([
      { id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' },
      { id: 'g2', sourceTerm: '魔王', targetTerm: 'demon lord' },
    ]),
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T01:00:00.000Z',
    ...overrides,
  };
}

function storedGlossaryRows(profileId = 'profile_001') {
  return [
    {
      profileId,
      id: 'g1',
      sourceTerm: '勇者',
      targetTerm: 'hero',
      note: null,
      position: 0,
    },
    {
      profileId,
      id: 'g2',
      sourceTerm: '魔王',
      targetTerm: 'demon lord',
      note: 'Boss title',
      position: 1,
    },
  ];
}

function storedThemeRow(overrides = {}) {
  return {
    id: 'custom_theme_001',
    name: 'Custom Theme',
    builtIn: 0,
    cssJson: JSON.stringify({
      fontFamily: 'Arial',
      fontSizePx: 32,
      textColor: '#ffffff',
      visibleLines: 2,
    }),
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T01:00:00.000Z',
    ...overrides,
  };
}

function storedPrivacyRow(overrides = {}) {
  return {
    saveRecentOcrText: 1,
    recentOcrLimit: 12,
    saveRecentTranslations: 1,
    recentTranslationLimit: 8,
    saveDebugScreenshots: 1,
    debugScreenshotDirectory: 'C:\\glt-debug',
    debugRetentionDays: 3,
    ...overrides,
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

test('sqlite config repository: listThemes returns parsed frozen theme rows', () => {
  const database = new QueuedDatabase({
    alls: [[
      storedThemeRow({
        id: 'classic_subtitle',
        name: 'Classic Subtitle',
        builtIn: 1,
      }),
      storedThemeRow(),
    ]],
  });
  const repository = fixedRepository(database).repository;

  const themes = repository.listThemes();

  assert.deepEqual(themes.map((theme) => theme.id), ['classic_subtitle', 'custom_theme_001']);
  assert.equal(themes[0].builtIn, true);
  assert.equal(themes[1].builtIn, false);
  assert.equal(themes[1].cssJson.fontSizePx, 32);
  assert.equal(Object.isFrozen(themes), true);
  assert.equal(Object.isFrozen(themes[0].cssJson), true);
  assert.match(database.allCalls[0].sql, /ORDER BY built_in DESC/);
});

test('sqlite config repository: getTheme reports missing themes', () => {
  const database = new QueuedDatabase({ gets: [null] });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.getTheme('missing_theme'),
    (error) =>
      error instanceof ContractError &&
      error.code === 'THEME_NOT_FOUND' &&
      error.details.themeId === 'missing_theme',
  );
  assert.equal(database.runs.length, 0);
});

test('sqlite config repository: createTheme validates before any read or write', () => {
  const database = new QueuedDatabase({
    gets: [storedThemeRow({ id: 'classic_subtitle', builtIn: 1 })],
  });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.createTheme({
      name: 'Bad Theme',
      cssJson: { fontFamily: 'Arial' },
      apiKey: 'should-not-enter-db',
    }),
    (error) => {
      assertContractError(error);
      assert.ok(
        error.details.fieldErrors.some(
          (fieldError) =>
            fieldError.field === 'apiKey' &&
            fieldError.code === 'UNKNOWN_THEME_FIELD',
        ),
      );
      return true;
    },
  );
  assert.deepEqual(database.getCalls, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: createTheme duplicates a base theme into a custom row', () => {
  const database = new QueuedDatabase({
    gets: [storedThemeRow({
      id: 'classic_subtitle',
      name: 'Classic Subtitle',
      builtIn: 1,
      cssJson: JSON.stringify({ fontFamily: 'Arial', fontSizePx: 42 }),
    })],
  });
  const repository = fixedRepository(database).repository;

  const theme = repository.createTheme({
    name: 'Custom Classic',
    baseThemeId: 'classic_subtitle',
  });

  assert.equal(theme.id, 'theme_001');
  assert.equal(theme.name, 'Custom Classic');
  assert.equal(theme.builtIn, false);
  assert.deepEqual(theme.cssJson, { fontFamily: 'Arial', fontSizePx: 42 });
  assert.equal(Object.isFrozen(theme), true);

  const run = findRun(database, 'overlay_themes');
  assert.equal(run.params.id, 'theme_001');
  assert.equal(run.params.name, 'Custom Classic');
  assert.equal(run.params.builtIn, 0);
  assert.equal(run.params.cssJson, JSON.stringify({ fontFamily: 'Arial', fontSizePx: 42 }));
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'COMMIT;']);
});

test('sqlite config repository: createTheme rolls back when base theme is missing', () => {
  const database = new QueuedDatabase({ gets: [null] });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.createTheme({
      name: 'Missing Base',
      baseThemeId: 'missing_theme',
    }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'THEME_NOT_FOUND' &&
      error.details.themeId === 'missing_theme',
  );
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: createTheme rejects generated built-in ids before writes', () => {
  const database = new RecordingDatabase();
  const repository = createSqliteConfigRepository({
    database,
    clock: () => '2026-05-28T00:00:00.000Z',
    idFactory: () => 'minimal',
  });

  assert.throws(
    () => repository.createTheme({
      name: 'Reserved Theme',
      cssJson: { fontFamily: 'Arial', fontSizePx: 28 },
    }),
    (error) => {
      assertContractError(error);
      assert.equal(error.details.fieldErrors[0].code, 'THEME_ID_RESERVED');
      return true;
    },
  );
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
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

test('sqlite config repository: getProfile reconstructs a frozen profile from rows', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  const profile = repository.getProfile('profile_001');

  assert.equal(profile.id, 'profile_001');
  assert.equal(profile.name, 'Stored Profile');
  assert.deepEqual(profile.captureSource.bounds, { x: 0, y: 0, width: 1280, height: 720 });
  assert.deepEqual(profile.roi, { x: 10, y: 20, width: 640, height: 120 });
  assert.equal(profile.glossary[1].note, 'Boss title');
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.captureSource), true);
  assert.equal(Object.isFrozen(profile.glossary[0]), true);
  assert.equal(database.getCalls[0].params.profileId, 'profile_001');
  assert.equal(database.allCalls[0].params.profileId, 'profile_001');
});

test('sqlite config repository: listProfiles returns profiles with their glossary terms', () => {
  const database = new QueuedDatabase({
    alls: [
      [
        storedProfileRow({ id: 'profile_002', name: 'Second' }),
        storedProfileRow({ id: 'profile_001', name: 'First' }),
      ],
      [
        ...storedGlossaryRows('profile_001'),
        { profileId: 'profile_002', id: 's1', sourceTerm: '村', targetTerm: 'village', note: null, position: 0 },
      ],
    ],
  });
  const repository = fixedRepository(database).repository;

  const profiles = repository.listProfiles();

  assert.deepEqual(profiles.map((profile) => profile.id), ['profile_002', 'profile_001']);
  assert.deepEqual(profiles[0].glossary, [
    { id: 's1', sourceTerm: '村', targetTerm: 'village' },
  ]);
  assert.equal(Object.isFrozen(profiles), true);
  assert.match(database.allCalls[0].sql, /ORDER BY p\.updated_at DESC/);
});

test('sqlite config repository: getProfile reports missing profiles without glossary reads', () => {
  const database = new QueuedDatabase({ gets: [null] });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.getProfile('missing'),
    (error) => error instanceof ContractError && error.code === 'PROFILE_NOT_FOUND',
  );
  assert.equal(database.getCalls.length, 1);
  assert.equal(database.allCalls.length, 0);
  assert.equal(database.runs.length, 0);
});

test('sqlite config repository: updateProfile validates update body before any read or write', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.updateProfile('profile_001', { apiKey: 'should-not-enter-db' }),
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
  assert.deepEqual(database.getCalls, []);
  assert.deepEqual(database.allCalls, []);
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: updateProfile rejects empty patches before any read or write', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.updateProfile('profile_001', {}),
    (error) => {
      assertContractError(error);
      assert.ok(
        error.details.fieldErrors.some(
          (fieldError) => fieldError.message.includes('at least one field'),
        ),
      );
      return true;
    },
  );
  assert.deepEqual(database.getCalls, []);
  assert.deepEqual(database.allCalls, []);
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: updateProfile merges fields and rewrites glossary transactionally', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;
  const glossary = [
    { id: 'g9', sourceTerm: '王女', targetTerm: 'princess', note: 'Royalty' },
  ];

  const profile = repository.updateProfile('profile_001', {
    name: 'Updated Profile',
    ocrConfidenceFloor: 0.8,
    glossary,
  });

  assert.equal(profile.name, 'Updated Profile');
  assert.equal(profile.ocrConfidenceFloor, 0.8);
  assert.deepEqual(profile.glossary, glossary);
  assert.equal(profile.createdAt, '2026-05-27T00:00:00.000Z');
  assert.equal(profile.updatedAt, '2026-05-28T00:00:00.000Z');
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'COMMIT;']);

  const profileRun = database.runs.find((entry) => entry.sql.startsWith('UPDATE profiles'));
  assert.equal(profileRun.params.name, 'Updated Profile');

  const settingsRun = database.runs.find((entry) => entry.sql.startsWith('UPDATE profile_settings'));
  assert.equal(settingsRun.params.ocrConfidenceFloor, 0.8);
  assert.equal(settingsRun.params.glossaryRevision, buildGlossaryRevision(glossary));

  const deleteRun = database.runs.find((entry) => entry.sql.startsWith('DELETE FROM glossary_terms'));
  assert.equal(deleteRun.params.profileId, 'profile_001');

  const glossaryRuns = runsFor(database, 'glossary_terms');
  assert.equal(glossaryRuns.length, 1);
  assert.equal(glossaryRuns[0].params.id, 'g9');
  assert.equal(glossaryRuns[0].params.note, 'Royalty');
});

test('sqlite config repository: updateProfile rejects duplicate glossary ids before writes', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.updateProfile('profile_001', {
      glossary: [
        { id: 'dup', sourceTerm: '勇者', targetTerm: 'hero' },
        { id: 'dup', sourceTerm: '村', targetTerm: 'village' },
      ],
    }),
    (error) => {
      assertContractError(error);
      assert.ok(error.details.fieldErrors.some((fieldError) => fieldError.code === 'GLOSSARY_ID_DUPLICATE'));
      return true;
    },
  );
  assert.deepEqual(database.execs, []);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: deleteProfile blocks deleting the active profile', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow(), { value: 'profile_001' }],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.deleteProfile('profile_001'),
    (error) =>
      error instanceof ContractError &&
      error.code === 'CANNOT_DELETE_ACTIVE_PROFILE' &&
      error.details.profileId === 'profile_001',
  );
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: deleteProfile deletes inactive profiles', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow(), { value: 'profile_other' }],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  const result = repository.deleteProfile('profile_001');

  assert.deepEqual(result, { ok: true });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(database.runs.length, 1);
  assert.match(database.runs[0].sql, /DELETE FROM profiles/);
  assert.equal(database.runs[0].params.profileId, 'profile_001');
});

test('sqlite config repository: setActiveProfile verifies existence and stores app metadata', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  const result = repository.setActiveProfile('profile_001');

  assert.deepEqual(result, { ok: true });
  assert.equal(database.runs.length, 1);
  assert.match(database.runs[0].sql, /INSERT INTO app_meta/);
  assert.equal(database.runs[0].params.key, 'active_profile_id');
  assert.equal(database.runs[0].params.value, 'profile_001');
  assert.equal(database.runs[0].params.updatedAt, '2026-05-28T00:00:00.000Z');
});

test('sqlite config repository: getActiveProfileId returns null when unset', () => {
  const database = new QueuedDatabase({ gets: [null] });
  const repository = fixedRepository(database).repository;

  assert.equal(repository.getActiveProfileId(), null);
  assert.equal(database.getCalls[0].params.key, 'active_profile_id');
});

test('sqlite config repository: exportProfile returns schema v1 without forbidden fields', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  const exported = repository.exportProfile('profile_001');

  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.forbiddenFieldsPolicy, 'reject_api_keys_ocr_text_translation_text_images_logs');
  assert.equal(exported.exportedAt, '2026-05-28T00:00:00.000Z');
  assert.equal(exported.profile.id, 'profile_001');
  assert.equal(Object.isFrozen(exported), true);
  assert.equal(Object.isFrozen(exported.profile), true);

  const serialized = JSON.stringify(exported);
  for (const forbidden of [
    'apiKey',
    'providerApiKey',
    'providerKeys',
    'ocrText',
    'recentOcrText',
    'translatedText',
    'screenshots',
    'logs',
  ]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false);
  }
});

test('sqlite config repository: reserved profile ids are rejected before writes', () => {
  for (const reservedId of RESERVED_PROFILE_IDS) {
    const database = new RecordingDatabase();
    const repository = createSqliteConfigRepository({
      database,
      clock: () => '2026-05-28T00:00:00.000Z',
      idFactory: () => reservedId,
    });
    assert.throws(
      () => repository.createProfile(makeProfileCreateRequest()),
      (error) =>
        error instanceof ContractError &&
        error.code === 'VALIDATION_ERROR' &&
        error.details.fieldErrors[0].code === 'PROFILE_ID_RESERVED',
      `expected ${reservedId} to be rejected`,
    );
    assert.deepEqual(database.execs, []);
    assert.deepEqual(database.runs, []);
  }
});

test('sqlite config repository: updateTheme rejects built-in themes without writes', () => {
  const database = new QueuedDatabase({
    gets: [storedThemeRow({ id: 'minimal', builtIn: 1 })],
  });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.updateTheme('minimal', { name: 'Cannot Update' }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'CANNOT_UPDATE_BUILT_IN_THEME' &&
      error.details.themeId === 'minimal',
  );
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: updateTheme and deleteTheme roll back missing themes', () => {
  const updateDatabase = new QueuedDatabase({ gets: [null] });
  const updateRepository = fixedRepository(updateDatabase).repository;

  assert.throws(
    () => updateRepository.updateTheme('missing_theme', { name: 'Missing' }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'THEME_NOT_FOUND' &&
      error.details.themeId === 'missing_theme',
  );
  assert.deepEqual(updateDatabase.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
  assert.deepEqual(updateDatabase.runs, []);

  const deleteDatabase = new QueuedDatabase({ gets: [null] });
  const deleteRepository = fixedRepository(deleteDatabase).repository;

  assert.throws(
    () => deleteRepository.deleteTheme('missing_theme'),
    (error) =>
      error instanceof ContractError &&
      error.code === 'THEME_NOT_FOUND' &&
      error.details.themeId === 'missing_theme',
  );
  assert.deepEqual(deleteDatabase.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
  assert.deepEqual(deleteDatabase.runs, []);
});

test('sqlite config repository: updateTheme writes custom theme changes transactionally', () => {
  const database = new QueuedDatabase({
    gets: [storedThemeRow()],
  });
  const repository = fixedRepository(database).repository;

  const theme = repository.updateTheme('custom_theme_001', {
    name: 'Readable Custom',
    cssJson: { fontFamily: 'Inter', fontSizePx: 30, visibleLines: 3 },
  });

  assert.equal(theme.name, 'Readable Custom');
  assert.deepEqual(theme.cssJson, { fontFamily: 'Inter', fontSizePx: 30, visibleLines: 3 });
  assert.equal(theme.updatedAt, '2026-05-28T00:00:00.000Z');
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'COMMIT;']);
  assert.equal(database.runs.length, 1);
  assert.match(database.runs[0].sql, /UPDATE overlay_themes/);
  assert.equal(database.runs[0].params.themeId, 'custom_theme_001');
  assert.equal(database.runs[0].params.cssJson, JSON.stringify(theme.cssJson));
});

test('sqlite config repository: deleteTheme rejects built-in and in-use themes', () => {
  const builtInDatabase = new QueuedDatabase({
    gets: [storedThemeRow({ id: 'stream_box', builtIn: 1 })],
  });
  const builtInRepository = fixedRepository(builtInDatabase).repository;

  assert.throws(
    () => builtInRepository.deleteTheme('stream_box'),
    (error) => error instanceof ContractError && error.code === 'CANNOT_DELETE_BUILT_IN_THEME',
  );
  assert.deepEqual(builtInDatabase.runs, []);

  const inUseDatabase = new QueuedDatabase({
    gets: [storedThemeRow(), { profileId: 'profile_001' }],
  });
  const inUseRepository = fixedRepository(inUseDatabase).repository;
  assert.throws(
    () => inUseRepository.deleteTheme('custom_theme_001'),
    (error) =>
      error instanceof ContractError &&
      error.code === 'THEME_IN_USE' &&
      error.details.profileId === 'profile_001',
  );
  assert.deepEqual(inUseDatabase.runs, []);
});

test('sqlite config repository: deleteTheme deletes unused custom themes', () => {
  const database = new QueuedDatabase({
    gets: [storedThemeRow(), null],
  });
  const repository = fixedRepository(database).repository;

  const result = repository.deleteTheme('custom_theme_001');

  assert.deepEqual(result, { ok: true });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'COMMIT;']);
  assert.equal(database.runs.length, 1);
  assert.match(database.runs[0].sql, /DELETE FROM overlay_themes/);
  assert.equal(database.runs[0].params.themeId, 'custom_theme_001');
});

test('sqlite config repository: exportGlossary returns terms only', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  const exported = repository.exportGlossary('profile_001');

  assert.deepEqual(exported, {
    terms: [
      { id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' },
      { id: 'g2', sourceTerm: '魔王', targetTerm: 'demon lord', note: 'Boss title' },
    ],
    format: 'json',
  });
  assert.equal(Object.isFrozen(exported), true);
  assert.equal(Object.isFrozen(exported.terms[0]), true);
  assert.equal(JSON.stringify(exported).includes('apiKey'), false);
  assert.equal(JSON.stringify(exported).includes('translatedText'), false);
});

test('sqlite config repository: importGlossary accepts JSON terms and updates profile glossary', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;
  const terms = [
    { id: 'j1', sourceTerm: '王女', targetTerm: 'princess', note: 'Royalty' },
  ];

  const result = repository.importGlossary('profile_001', {
    format: 'json',
    content: JSON.stringify({ terms }),
  });

  assert.deepEqual(result, { terms, rejected: [] });
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'COMMIT;']);
  const settingsRun = database.runs.find((entry) => entry.sql.startsWith('UPDATE profile_settings'));
  assert.equal(settingsRun.params.glossaryRevision, buildGlossaryRevision(terms));
  const glossaryRuns = runsFor(database, 'glossary_terms');
  assert.equal(glossaryRuns.length, 1);
  assert.equal(glossaryRuns[0].params.id, 'j1');
});

test('sqlite config repository: importGlossary accepts headered CSV', () => {
  const database = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const repository = fixedRepository(database).repository;

  const result = repository.importGlossary('profile_001', {
    format: 'csv',
    content: [
      '\uFEFFid,sourceTerm,targetTerm,note',
      'c1,"王,女",princess,"quoted, note"',
    ].join('\n'),
  });

  assert.deepEqual(result.terms, [
    { id: 'c1', sourceTerm: '王,女', targetTerm: 'princess', note: 'quoted, note' },
  ]);
  assert.deepEqual(result.rejected, []);
});

test('sqlite config repository: importGlossary rejects invalid content before writes', () => {
  const invalidJsonDatabase = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const invalidJsonRepository = fixedRepository(invalidJsonDatabase).repository;

  assert.throws(
    () => invalidJsonRepository.importGlossary('profile_001', {
      format: 'json',
      content: '{bad json',
    }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'GLOSSARY_IMPORT_INVALID' &&
      Array.isArray(error.details.rejected),
  );
  assert.deepEqual(invalidJsonDatabase.execs, []);
  assert.deepEqual(invalidJsonDatabase.runs, []);

  const duplicateDatabase = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const duplicateRepository = fixedRepository(duplicateDatabase).repository;

  assert.throws(
    () => duplicateRepository.importGlossary('profile_001', {
      format: 'json',
      content: JSON.stringify([
        { id: 'dup', sourceTerm: '勇者', targetTerm: 'hero' },
        { id: 'dup', sourceTerm: '村', targetTerm: 'village' },
      ]),
    }),
    (error) => {
      assert.equal(error instanceof ContractError, true);
      assert.equal(error.code, 'GLOSSARY_IMPORT_INVALID');
      assert.ok(error.details.fieldErrors.some((fieldError) => fieldError.code === 'GLOSSARY_ID_DUPLICATE'));
      assert.ok(error.details.rejected.some((rejected) => rejected.code === 'GLOSSARY_ID_DUPLICATE'));
      return true;
    },
  );
  assert.deepEqual(duplicateDatabase.execs, []);
  assert.deepEqual(duplicateDatabase.runs, []);

  const duplicateSourceDatabase = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const duplicateSourceRepository = fixedRepository(duplicateSourceDatabase).repository;

  assert.throws(
    () => duplicateSourceRepository.importGlossary('profile_001', {
      format: 'json',
      content: JSON.stringify([
        { id: 'one', sourceTerm: '勇者', targetTerm: 'hero' },
        { id: 'two', sourceTerm: '  勇者 ', targetTerm: 'brave' },
      ]),
    }),
    (error) => {
      assert.equal(error instanceof ContractError, true);
      assert.equal(error.code, 'GLOSSARY_IMPORT_INVALID');
      assert.ok(error.details.fieldErrors.some((fieldError) => fieldError.code === 'GLOSSARY_SOURCE_DUPLICATE'));
      return true;
    },
  );
  assert.deepEqual(duplicateSourceDatabase.execs, []);
  assert.deepEqual(duplicateSourceDatabase.runs, []);

  const shortCsvDatabase = new QueuedDatabase({
    gets: [storedProfileRow()],
    alls: [storedGlossaryRows()],
  });
  const shortCsvRepository = fixedRepository(shortCsvDatabase).repository;

  assert.throws(
    () => shortCsvRepository.importGlossary('profile_001', {
      format: 'csv',
      content: 'id,sourceTerm,targetTerm,note\nc1,勇者,hero',
    }),
    (error) => {
      assert.equal(error instanceof ContractError, true);
      assert.equal(error.code, 'GLOSSARY_IMPORT_INVALID');
      assert.ok(error.details.rejected.some((rejected) => rejected.code === 'CSV_ROW_TOO_FEW_FIELDS'));
      return true;
    },
  );
  assert.deepEqual(shortCsvDatabase.execs, []);
  assert.deepEqual(shortCsvDatabase.runs, []);
});

test('sqlite config repository: importGlossary rolls back when profile is missing', () => {
  const database = new QueuedDatabase({ gets: [null] });
  const repository = fixedRepository(database).repository;

  assert.throws(
    () => repository.importGlossary('missing_profile', {
      format: 'json',
      content: JSON.stringify([
        { id: 'g1', sourceTerm: '勇者', targetTerm: 'hero' },
      ]),
    }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'PROFILE_NOT_FOUND' &&
      error.details.profileId === 'missing_profile',
  );
  assert.deepEqual(database.execs, ['BEGIN IMMEDIATE TRANSACTION;', 'ROLLBACK;']);
  assert.deepEqual(database.runs, []);
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

test('sqlite config repository: getPrivacySettings returns the stored singleton row', () => {
  const database = new QueuedDatabase({ gets: [storedPrivacyRow()] });
  const repository = fixedRepository(database).repository;

  const settings = repository.getPrivacySettings();

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
  assert.equal(database.getCalls.length, 1);
  assert.match(database.getCalls[0].sql, /FROM privacy_settings/);
  assert.match(database.getCalls[0].sql, /WHERE id = 1/);
  assert.deepEqual(database.runs, []);
});

test('sqlite config repository: getPrivacySettings falls back to privacy defaults when absent', () => {
  const database = new QueuedDatabase({ gets: [null] });
  const repository = fixedRepository(database).repository;

  const settings = repository.getPrivacySettings();

  assert.deepEqual(settings, DEFAULT_PRIVACY_SETTINGS);
  assert.equal(Object.isFrozen(settings), true);
  assert.equal(database.getCalls.length, 1);
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
