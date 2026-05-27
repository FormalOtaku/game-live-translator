#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');

const {
  ContractError,
  DEFAULT_PRIVACY_SETTINGS,
  redactSecrets,
} = require('../src/contracts/security');
const {
  PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
  PROFILE_EXPORT_SCHEMA_VERSION,
} = require('../src/contracts/validation');
const { createLocalApiServer } = require('../src/server/local-api-server');
const { createProviderKeyStore } = require('../src/storage/provider-key-store');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SOURCE_SENTINEL = '秘密の原文';
const SECRET_SENTINEL = 'sk-ABCDEFGHIJKLMNOP1234';
const SMOKE_VERSION = 'config-smoke-v1';
const REQUEST_TIMEOUT_MS = 4000;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixedClock() {
  return FIXED_TIME;
}

function httpJsonRequest({ port, path, method = 'GET', body }) {
  return new Promise((resolve, reject) => {
    let requestBody = null;
    const headers = {};
    if (body !== undefined) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        const parsed = responseBody.length > 0 ? JSON.parse(responseBody) : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody, parsed });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`HTTP ${method} ${path} timed out`));
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}

function assertNoSensitivePayload(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(serialized.includes(SOURCE_SENTINEL), false, `${label} leaked source text`);
  assert.equal(serialized.includes(SECRET_SENTINEL), false, `${label} leaked provider key`);
}

function redactSmokeDiagnostic(value) {
  return redactSecrets(String(value)).replaceAll(SOURCE_SENTINEL, '[REDACTED_SOURCE_TEXT]');
}

function record(checks, name) {
  checks.push(name);
}

function makeProfile(overrides = {}) {
  return {
    id: 'profile_main',
    name: 'Smoke Main',
    gameTitle: 'Smoke Game',
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.72,
    captureHz: 2,
    translationProvider: 'deepl',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossary: [
      { id: 'term_hero', sourceTerm: '勇者', targetTerm: 'hero' },
    ],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function makeTheme(overrides = {}) {
  return {
    id: 'custom_smoke_theme',
    name: 'Smoke Theme',
    builtIn: false,
    cssJson: {
      fontFamily: 'Arial',
      fontSizePx: 34,
      textColor: '#ffffff',
      visibleLines: 2,
    },
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function createSmokeProfileRepository() {
  const profiles = new Map([
    ['profile_main', makeProfile()],
  ]);
  const themes = new Map([
    ['classic_subtitle', makeTheme({
      id: 'classic_subtitle',
      name: 'Classic Subtitle',
      builtIn: true,
    })],
    ['custom_smoke_theme', makeTheme()],
  ]);
  const hiddenDiagnostics = {
    sourceText: SOURCE_SENTINEL,
    providerKey: SECRET_SENTINEL,
  };
  let activeProfileId = 'profile_main';
  let privacySettings = { ...DEFAULT_PRIVACY_SETTINGS };

  function getProfileOrThrow(profileId) {
    const profile = profiles.get(profileId);
    if (!profile) {
      throw new ContractError('PROFILE_NOT_FOUND', `missing ${profileId} token=${SECRET_SENTINEL}`);
    }
    return profile;
  }

  function getThemeOrThrow(themeId) {
    const theme = themes.get(themeId);
    if (!theme) {
      throw new ContractError('THEME_NOT_FOUND', `missing theme apiKey=${SECRET_SENTINEL}`);
    }
    return theme;
  }

  function safeProfile(profile) {
    const output = cloneJson(profile);
    assert.equal(Object.hasOwn(output, 'apiKey'), false);
    assert.equal(JSON.stringify(output).includes(hiddenDiagnostics.sourceText), false);
    return output;
  }

  return Object.freeze({
    listProfiles() {
      return Array.from(profiles.values()).map(safeProfile);
    },
    createProfile(payload) {
      const profile = makeProfile({
        ...payload,
        id: 'profile_created',
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
      });
      profiles.set(profile.id, profile);
      return safeProfile(profile);
    },
    getProfile(profileId) {
      return safeProfile(getProfileOrThrow(profileId));
    },
    updateProfile(profileId, payload) {
      const profile = getProfileOrThrow(profileId);
      const updated = {
        ...profile,
        ...payload,
        id: profile.id,
        updatedAt: FIXED_TIME,
      };
      profiles.set(profileId, updated);
      return safeProfile(updated);
    },
    deleteProfile(profileId) {
      if (profileId === activeProfileId) {
        throw new ContractError(
          'CANNOT_DELETE_ACTIVE_PROFILE',
          `active profile cannot be deleted apiKey=${SECRET_SENTINEL}`,
          { profileId, providerKey: SECRET_SENTINEL },
        );
      }
      getProfileOrThrow(profileId);
      profiles.delete(profileId);
      return { ok: true };
    },
    setActiveProfile(profileId) {
      getProfileOrThrow(profileId);
      activeProfileId = profileId;
      return { ok: true };
    },
    exportProfile(profileId) {
      return {
        schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
        profile: safeProfile(getProfileOrThrow(profileId)),
        exportedAt: FIXED_TIME,
        forbiddenFieldsPolicy: PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY,
      };
    },
    listThemes() {
      return Array.from(themes.values()).map(cloneJson);
    },
    createTheme(payload) {
      const theme = makeTheme({
        id: 'theme_created',
        name: payload.name,
        builtIn: false,
        cssJson: payload.cssJson ?? themes.get(payload.baseThemeId ?? 'classic_subtitle').cssJson,
      });
      themes.set(theme.id, theme);
      return cloneJson(theme);
    },
    getTheme(themeId) {
      return cloneJson(getThemeOrThrow(themeId));
    },
    updateTheme(themeId, payload) {
      const theme = getThemeOrThrow(themeId);
      if (theme.builtIn) {
        throw new ContractError(
          'CANNOT_UPDATE_BUILT_IN_THEME',
          `built-in theme update blocked secret=${SECRET_SENTINEL}`,
          { themeId, token: SECRET_SENTINEL },
        );
      }
      const updated = { ...theme, ...payload, id: theme.id, builtIn: false, updatedAt: FIXED_TIME };
      themes.set(themeId, updated);
      return cloneJson(updated);
    },
    deleteTheme(themeId) {
      const theme = getThemeOrThrow(themeId);
      if (theme.builtIn) {
        throw new ContractError('CANNOT_DELETE_BUILT_IN_THEME', 'built-in theme delete blocked', {
          themeId,
        });
      }
      themes.delete(themeId);
      return { ok: true };
    },
    exportGlossary(profileId) {
      return {
        terms: safeProfile(getProfileOrThrow(profileId)).glossary,
        format: 'json',
      };
    },
    importGlossary(profileId, payload) {
      const profile = getProfileOrThrow(profileId);
      const terms = payload.format === 'json'
        ? JSON.parse(payload.content)
        : [{ id: 'csv_knight', sourceTerm: '騎士', targetTerm: 'knight' }];
      const updated = { ...profile, glossary: terms, updatedAt: FIXED_TIME };
      profiles.set(profileId, updated);
      return { terms: cloneJson(terms), rejected: [] };
    },
    getPrivacySettings() {
      return cloneJson(privacySettings);
    },
    savePrivacySettings(settings) {
      privacySettings = cloneJson(settings);
      return cloneJson(privacySettings);
    },
  });
}

function createRecordingProviderKeyStore() {
  const writes = [];
  const deletes = [];
  const store = createProviderKeyStore({
    adapter: {
      async writeSecret(entry) {
        writes.push(entry);
      },
      async deleteSecret(entry) {
        deletes.push(entry);
      },
    },
  });
  assert.equal(Object.hasOwn(store, 'readProviderKey'), false);
  assert.equal(Object.hasOwn(store, 'listProviderKeys'), false);
  return { store, writes, deletes };
}

async function expectJson(port, path, options, statusCode) {
  const response = await httpJsonRequest({ port, path, ...options });
  assert.equal(response.statusCode, statusCode, response.body);
  assertNoSensitivePayload(response.parsed, `${options && options.method ? options.method : 'GET'} ${path}`);
  return response;
}

async function runSmoke() {
  const checks = [];
  const repository = createSmokeProfileRepository();
  const keyStore = createRecordingProviderKeyStore();
  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    profileRepository: repository,
    providerKeyStore: keyStore.store,
    activeProfileId: 'profile_main',
    clock: fixedClock,
  });

  let started;
  try {
    started = await api.start();
    assert.equal(started.bindAddress, '127.0.0.1');
    record(checks, 'server binds 127.0.0.1 on an ephemeral port');

    const health = await expectJson(started.port, '/health', {}, 200);
    assert.equal(health.parsed.version, SMOKE_VERSION);
    assert.equal(health.parsed.bindAddress, '127.0.0.1');
    record(checks, 'GET /health reports selected localhost port');

    const profiles = await expectJson(started.port, '/api/profiles', {}, 200);
    assert.equal(profiles.parsed.profiles[0].id, 'profile_main');
    const created = await expectJson(started.port, '/api/profiles', {
      method: 'POST',
      body: {
        name: 'Created Smoke',
        ocrPreset: 'menu_text',
        ocrConfidenceFloor: 0.6,
        captureHz: 1,
        translationProvider: 'deepl',
        targetLang: 'en',
        overlayThemeId: 'classic_subtitle',
        glossary: [{ id: 'term_castle', sourceTerm: '城', targetTerm: 'castle' }],
      },
    }, 201);
    assert.equal(created.parsed.id, 'profile_created');
    const updated = await expectJson(started.port, '/api/profiles/profile_created', {
      method: 'PUT',
      body: { name: 'Updated Smoke' },
    }, 200);
    assert.equal(updated.parsed.name, 'Updated Smoke');
    const active = await expectJson(started.port, '/api/profiles/active', {
      method: 'PUT',
      body: { profileId: 'profile_created' },
    }, 200);
    assert.deepEqual(active.parsed, { ok: true });
    const exported = await expectJson(started.port, '/api/profiles/profile_created/export', {}, 200);
    assert.equal(exported.parsed.schemaVersion, PROFILE_EXPORT_SCHEMA_VERSION);
    assert.equal(exported.parsed.forbiddenFieldsPolicy, PROFILE_EXPORT_FORBIDDEN_FIELDS_POLICY);
    const activeDelete = await expectJson(started.port, '/api/profiles/profile_created', {
      method: 'DELETE',
    }, 409);
    assert.equal(activeDelete.parsed.error.code, 'CANNOT_DELETE_ACTIVE_PROFILE');
    record(checks, 'profile CRUD active selection and safe export routes pass');

    const themes = await expectJson(started.port, '/api/themes', {}, 200);
    assert.ok(themes.parsed.themes.some((theme) => theme.id === 'classic_subtitle'));
    const themeCreated = await expectJson(started.port, '/api/themes', {
      method: 'POST',
      body: { name: 'Created Theme', baseThemeId: 'classic_subtitle' },
    }, 201);
    assert.equal(themeCreated.parsed.id, 'theme_created');
    const themeRead = await expectJson(started.port, '/api/themes/theme_created', {}, 200);
    assert.equal(themeRead.parsed.name, 'Created Theme');
    const themeUpdated = await expectJson(started.port, '/api/themes/theme_created', {
      method: 'PUT',
      body: { name: 'Readable Theme' },
    }, 200);
    assert.equal(themeUpdated.parsed.name, 'Readable Theme');
    const builtInUpdate = await expectJson(started.port, '/api/themes/classic_subtitle', {
      method: 'PUT',
      body: { name: 'Nope' },
    }, 409);
    assert.equal(builtInUpdate.parsed.error.code, 'CANNOT_UPDATE_BUILT_IN_THEME');
    const themeDelete = await expectJson(started.port, '/api/themes/theme_created', {
      method: 'DELETE',
    }, 200);
    assert.deepEqual(themeDelete.parsed, { ok: true });
    record(checks, 'theme CRUD and built-in conflict routes pass');

    const glossary = await expectJson(
      started.port,
      '/api/profiles/profile_created/glossary/export',
      {},
      200,
    );
    assert.equal(glossary.parsed.format, 'json');
    const glossaryImport = await expectJson(started.port, '/api/profiles/profile_created/glossary/import', {
      method: 'POST',
      body: {
        format: 'json',
        content: JSON.stringify([{ id: 'term_sword', sourceTerm: '剣', targetTerm: 'sword' }]),
      },
    }, 200);
    assert.deepEqual(glossaryImport.parsed.rejected, []);
    record(checks, 'glossary export/import routes pass');

    const privacy = await expectJson(started.port, '/api/settings/privacy', {}, 200);
    assert.deepEqual(privacy.parsed, DEFAULT_PRIVACY_SETTINGS);
    const privacyUpdated = await expectJson(started.port, '/api/settings/privacy', {
      method: 'PUT',
      body: {
        ...DEFAULT_PRIVACY_SETTINGS,
        saveRecentTranslations: true,
        recentTranslationLimit: 5,
      },
    }, 200);
    assert.equal(privacyUpdated.parsed.saveRecentTranslations, true);
    const privacyWrongMethod = await expectJson(started.port, '/api/settings/privacy', {
      method: 'POST',
    }, 405);
    assert.equal(privacyWrongMethod.headers.allow, 'GET, PUT');
    record(checks, 'privacy settings read/update and method guard pass');

    const keyWrite = await expectJson(started.port, '/api/keys/deepl', {
      method: 'PUT',
      body: { provider: 'deepl', apiKey: SECRET_SENTINEL },
    }, 200);
    assert.deepEqual(keyWrite.parsed, { ok: true });
    assert.equal(keyStore.writes.length, 1);
    assert.equal(keyStore.writes[0].account, 'deepl');
    assert.equal(keyStore.writes[0].secret, SECRET_SENTINEL);
    const keyReadback = await expectJson(started.port, '/api/keys/deepl', {}, 405);
    assert.equal(keyReadback.headers.allow, 'PUT, DELETE');
    const unknownProvider = await expectJson(started.port, '/api/keys/steam', {
      method: 'PUT',
      body: { apiKey: SECRET_SENTINEL },
    }, 400);
    assert.equal(unknownProvider.parsed.error.code, 'PROVIDER_UNKNOWN');
    assert.equal(keyStore.writes.length, 1);
    const keyDelete = await expectJson(started.port, '/api/keys/deepl', {
      method: 'DELETE',
    }, 200);
    assert.deepEqual(keyDelete.parsed, { ok: true });
    assert.equal(keyStore.deletes.length, 1);
    assert.equal(keyStore.deletes[0].account, 'deepl');
    record(checks, 'provider key write/delete-only routes pass without readback');

    return Object.freeze({
      ok: true,
      command: 'npm run smoke:config',
      bindAddress: started.bindAddress,
      port: started.port,
      checks,
    });
  } finally {
    await api.stop();
  }
}

if (require.main === module) {
  runSmoke()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      const message = error && typeof error.message === 'string'
        ? redactSmokeDiagnostic(error.message)
        : 'Config API smoke failed';
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:config',
        error: {
          name: error && error.name ? error.name : 'Error',
          message,
        },
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  runSmoke,
};
