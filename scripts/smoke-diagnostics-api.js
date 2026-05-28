#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');

const { redactDiagnosticString } = require('../src/contracts/security');
const { assertDiagnosticBundle } = require('../src/contracts/validation');
const { createLocalApiServer } = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SOURCE_SENTINEL = '秘密の診断OCR原文';
const TRANSLATED_SENTINEL = 'secret diagnostic translated output';
const SECRET_SENTINEL = 'sk-DIAGNOSTICSMOKEKEY1234';
const SCREENSHOT_SENTINEL = 'C:\\Users\\streamer\\Pictures\\diagnostic-secret.png';
const IMAGE_SENTINEL = 'C:\\Users\\streamer\\Pictures\\diagnostic-frame.png';
const STACK_FILE_SENTINEL = 'provider.js';
const PROVIDER_RESPONSE_SENTINEL = 'upstream diagnostics response secret';
const SMOKE_VERSION = 'diagnostics-smoke-v1';
const REQUEST_TIMEOUT_MS = 4000;

function fixedClock() {
  return FIXED_TIME;
}

function record(checks, name) {
  checks.push(name);
}

function httpJsonRequest({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    let requestBody = null;
    const requestHeaders = { ...headers };
    if (body !== undefined) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: requestHeaders,
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
  const forbidden = [
    SOURCE_SENTINEL,
    TRANSLATED_SENTINEL,
    SECRET_SENTINEL,
    SCREENSHOT_SENTINEL,
    IMAGE_SENTINEL,
    STACK_FILE_SENTINEL,
    PROVIDER_RESPONSE_SENTINEL,
  ];
  for (const sentinel of forbidden) {
    assert.equal(serialized.includes(sentinel), false, `${label} leaked ${sentinel}`);
  }
}

function redactSmokeDiagnostic(value) {
  return redactDiagnosticString(value)
    .replaceAll(SOURCE_SENTINEL, '[REDACTED_SOURCE_TEXT]')
    .replaceAll(TRANSLATED_SENTINEL, '[REDACTED_TRANSLATED_TEXT]')
    .replaceAll(SCREENSHOT_SENTINEL, '[REDACTED_SCREENSHOT_PATH]')
    .replaceAll(IMAGE_SENTINEL, '[REDACTED_IMAGE_PATH]')
    .replaceAll(STACK_FILE_SENTINEL, '[REDACTED_STACK_FILE]')
    .replaceAll(PROVIDER_RESPONSE_SENTINEL, '[REDACTED_PROVIDER_RESPONSE]');
}

function createSmokeDiagnosticsProvider() {
  return {
    mode: 'ok',
    calls: 0,
    async collectDiagnostics() {
      this.calls += 1;
      if (this.mode === 'throw') {
        throw new Error(
          `diagnostics failed key=${SECRET_SENTINEL} source=${SOURCE_SENTINEL} translated=${TRANSLATED_SENTINEL} screenshot=${SCREENSHOT_SENTINEL}`,
        );
      }
      if (this.mode === 'invalid') {
        return { logLines: `sourceText="${SOURCE_SENTINEL}" apiKey=${SECRET_SENTINEL}` };
      }
      return {
        appVersion: 'diagnostics-app-provider',
        backendVersion: 'diagnostics-backend-provider',
        os: 'Windows 11 Pro',
        activeProfileId: ' profile_diag_provider ',
        logLines: [
          `apiKey=${SECRET_SENTINEL} sourceText="${SOURCE_SENTINEL}" translatedText="${TRANSLATED_SENTINEL}" screenshotPath="${SCREENSHOT_SENTINEL}"`,
          {
            component: 'diagnostics-smoke',
            message: `provider returned token ${SECRET_SENTINEL}`,
            sourceText: SOURCE_SENTINEL,
            translatedText: TRANSLATED_SENTINEL,
            screenshotPath: SCREENSHOT_SENTINEL,
            nested: {
              imagePath: IMAGE_SENTINEL,
              providerResponseBody: PROVIDER_RESPONSE_SENTINEL,
              errorStack: `Error: failed ${SOURCE_SENTINEL}\n    at collect (${STACK_FILE_SENTINEL}:12:3)`,
            },
          },
          null,
          42,
        ],
      };
    },
  };
}

async function expectJson(port, path, options, statusCode) {
  const response = await httpJsonRequest({ port, path, ...options });
  assert.equal(response.statusCode, statusCode, response.body);
  assertNoSensitivePayload(
    response.parsed,
    `${options && options.method ? options.method : 'GET'} ${path}`,
  );
  return response;
}

function assertCanonicalDiagnosticBundle(bundle) {
  assert.strictEqual(assertDiagnosticBundle(bundle), bundle);
  assert.deepEqual(Object.keys(bundle).sort(), [
    'activeProfileId',
    'appVersion',
    'backendVersion',
    'generatedAt',
    'os',
    'redactedLogs',
    'redactionSummary',
  ]);
}

async function runNoProviderSmoke(checks) {
  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    appVersion: 'diagnostics-app-default',
    backendVersion: 'diagnostics-backend-default',
    osName: 'Windows 11',
    activeProfileId: 'profile_diag_default',
    clock: fixedClock,
  });

  let started;
  try {
    started = await api.start();
    assert.equal(started.bindAddress, '127.0.0.1');
    record(checks, 'server binds 127.0.0.1 on an ephemeral port');

    const health = await expectJson(started.port, '/health', {}, 200);
    assert.deepEqual(health.parsed, {
      ok: true,
      version: SMOKE_VERSION,
      port: started.port,
      bindAddress: '127.0.0.1',
    });
    record(checks, 'GET /health reports selected localhost port');

    const bundle = await expectJson(started.port, '/api/diagnostics/bundle', {}, 200);
    assertCanonicalDiagnosticBundle(bundle.parsed);
    assert.deepEqual(bundle.parsed, {
      generatedAt: FIXED_TIME,
      appVersion: 'diagnostics-app-default',
      backendVersion: 'diagnostics-backend-default',
      os: 'Windows 11',
      activeProfileId: 'profile_diag_default',
      redactedLogs: [],
      redactionSummary: {
        apiKeysRemoved: true,
        ocrTextIncluded: false,
        translatedTextIncluded: false,
        imagesIncluded: false,
      },
    });
    record(checks, 'diagnostics bundle returns a valid minimal bundle without a provider');
  } finally {
    await api.stop();
  }
}

async function runProviderSmoke(checks) {
  const diagnosticsProvider = createSmokeDiagnosticsProvider();
  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    appVersion: 'diagnostics-app-fallback',
    backendVersion: 'diagnostics-backend-fallback',
    osName: 'Windows fallback',
    activeProfileId: 'profile_diag_fallback',
    diagnosticsProvider,
    clock: fixedClock,
  });

  let started;
  try {
    started = await api.start();
    assert.equal(started.bindAddress, '127.0.0.1');
    const allowedOrigin = `http://127.0.0.1:${started.port}`;

    const preflight = await httpJsonRequest({
      port: started.port,
      path: '/api/diagnostics/bundle',
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(preflight.headers['access-control-allow-methods'], 'GET, POST, PUT, DELETE, OPTIONS');
    assert.deepEqual(diagnosticsProvider.calls, 0);

    const wrongMethod = await expectJson(started.port, '/api/diagnostics/bundle', {
      method: 'POST',
      body: {
        apiKey: SECRET_SENTINEL,
        sourceText: SOURCE_SENTINEL,
      },
    }, 405);
    assert.equal(wrongMethod.headers.allow, 'GET');
    assert.equal(wrongMethod.parsed.error.code, 'METHOD_NOT_ALLOWED');
    assert.deepEqual(diagnosticsProvider.calls, 0);
    record(checks, 'diagnostics bundle method and CORS guards avoid provider collection');

    const bundle = await expectJson(started.port, '/api/diagnostics/bundle', {}, 200);
    assertCanonicalDiagnosticBundle(bundle.parsed);
    assert.equal(bundle.parsed.generatedAt, FIXED_TIME);
    assert.equal(bundle.parsed.appVersion, 'diagnostics-app-provider');
    assert.equal(bundle.parsed.backendVersion, 'diagnostics-backend-provider');
    assert.equal(bundle.parsed.os, 'Windows 11 Pro');
    assert.equal(bundle.parsed.activeProfileId, 'profile_diag_provider');
    assert.equal(bundle.parsed.redactedLogs.length, 4);
    assert.equal(bundle.parsed.redactedLogs.every((line) => typeof line === 'string'), true);
    assert.equal(bundle.parsed.redactedLogs[2], '');
    assert.equal(bundle.parsed.redactedLogs[3], '42');
    assert.equal(JSON.stringify(bundle.parsed).includes('[REDACTED]'), true);
    assert.deepEqual(diagnosticsProvider.calls, 1);
    record(checks, 'diagnostics bundle provider logs are redacted and validated');

    diagnosticsProvider.mode = 'throw';
    const thrown = await expectJson(started.port, '/api/diagnostics/bundle', {}, 500);
    assert.equal(thrown.parsed.error.code, 'DIAGNOSTICS_FAILED');
    assert.equal(thrown.parsed.error.message, 'Diagnostics bundle generation failed');
    assert.deepEqual(diagnosticsProvider.calls, 2);

    diagnosticsProvider.mode = 'invalid';
    const invalid = await expectJson(started.port, '/api/diagnostics/bundle', {}, 500);
    assert.equal(invalid.parsed.error.code, 'DIAGNOSTICS_FAILED');
    assert.equal(invalid.parsed.error.message, 'Diagnostics bundle generation failed');
    assert.deepEqual(diagnosticsProvider.calls, 3);
    record(checks, 'diagnostics provider failures and invalid shapes map to redacted DIAGNOSTICS_FAILED');

    return started.port;
  } finally {
    await api.stop();
  }
}

async function runSmoke() {
  const checks = [];
  await runNoProviderSmoke(checks);
  const port = await runProviderSmoke(checks);

  return Object.freeze({
    ok: true,
    command: 'npm run smoke:diagnostics',
    bindAddress: '127.0.0.1',
    port,
    checks,
  });
}

if (require.main === module) {
  runSmoke()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      const message = error && typeof error.message === 'string'
        ? redactSmokeDiagnostic(error.message)
        : 'Diagnostics API smoke failed';
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:diagnostics',
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
