#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');

const { ContractError, redactSecrets } = require('../src/contracts/security');
const { createLocalApiServer } = require('../src/server/local-api-server');

const FIXED_TIME = '2026-05-28T10:00:00.000Z';
const SOURCE_SENTINEL = '秘密の原文';
const SECRET_SENTINEL = 'sk-ABCDEFGHIJKLMNOP1234';
const SCREENSHOT_SENTINEL = 'C:\\Users\\streamer\\Pictures\\secret-capture.png';
const SMOKE_VERSION = 'capture-ocr-smoke-v1';
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
  assert.equal(serialized.includes(SCREENSHOT_SENTINEL), false, `${label} leaked screenshot path`);
}

function redactSmokeDiagnostic(value) {
  return redactSecrets(String(value))
    .replaceAll(SOURCE_SENTINEL, '[REDACTED_SOURCE_TEXT]')
    .replaceAll(SCREENSHOT_SENTINEL, '[REDACTED_SCREENSHOT_PATH]');
}

function record(checks, name) {
  checks.push(name);
}

function makeCaptureSource() {
  return {
    kind: 'window',
    id: 'window_smoke_game',
    label: 'Smoke Game Window',
    bounds: { x: 10, y: 20, width: 1280, height: 720 },
  };
}

function makeRoi() {
  return { x: 100, y: 420, width: 920, height: 180 };
}

function makeProfile(overrides = {}) {
  return {
    id: 'profile_main',
    name: 'Capture OCR Smoke',
    gameTitle: 'Smoke Game',
    captureSource: makeCaptureSource(),
    roi: makeRoi(),
    ocrPreset: 'default_dialogue',
    ocrConfidenceFloor: 0.7,
    captureHz: 2,
    translationProvider: 'deepl',
    targetLang: 'en',
    overlayThemeId: 'classic_subtitle',
    glossary: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function createSmokeProfileRepository() {
  const profiles = new Map([
    ['profile_main', makeProfile()],
    ['profile_no_roi', makeProfile({
      id: 'profile_no_roi',
      name: 'No ROI Smoke',
      roi: undefined,
    })],
  ]);

  return Object.freeze({
    getProfile(profileId) {
      const profile = profiles.get(profileId);
      if (!profile) {
        throw new ContractError(
          'PROFILE_NOT_FOUND',
          `missing profile ${profileId} secret=${SECRET_SENTINEL} source=${SOURCE_SENTINEL}`,
          { screenshotPath: SCREENSHOT_SENTINEL },
        );
      }
      return cloneJson(profile);
    },
  });
}

function createSmokeCaptureSourceProvider() {
  return {
    failNext: false,
    calls: 0,
    enumerateCaptureSources() {
      this.calls += 1;
      if (this.failNext) {
        this.failNext = false;
        throw new Error(
          `desktop enumeration failed key=${SECRET_SENTINEL} source=${SOURCE_SENTINEL} screenshot=${SCREENSHOT_SENTINEL}`,
        );
      }
      return {
        sources: [
          makeCaptureSource(),
          {
            kind: 'monitor',
            id: 'monitor_1',
            label: 'Primary Monitor',
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          },
        ],
      };
    },
  };
}

function createSmokeCaptureController() {
  return {
    starts: [],
    stops: [],
    async startCapture({ profile, captureSource }) {
      this.starts.push({ profileId: profile.id, captureSource: cloneJson(captureSource) });
      return {
        ok: true,
        ignoredDebug: `${SECRET_SENTINEL} ${SOURCE_SENTINEL} ${SCREENSHOT_SENTINEL}`,
      };
    },
    async stopCapture({ profileId }) {
      this.stops.push({ profileId });
      return {
        ok: true,
        ignoredDebug: `${SECRET_SENTINEL} ${SOURCE_SENTINEL} ${SCREENSHOT_SENTINEL}`,
      };
    },
  };
}

function createSmokeOcrTestProvider() {
  return {
    failNext: false,
    calls: [],
    async runOcrTest({ profile, roi }) {
      this.calls.push({ profileId: profile.id, roi: cloneJson(roi) });
      if (this.failNext) {
        this.failNext = false;
        throw new Error(
          `ocr failed key=${SECRET_SENTINEL} source=${SOURCE_SENTINEL} screenshot=${SCREENSHOT_SENTINEL}`,
        );
      }
      return Object.freeze({
        text: '勇者が来た',
        normalizedText: '勇者が来た',
        confidence: 0.93,
        durationMs: 18,
        accepted: true,
      });
    },
  };
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
  const captureSourceProvider = createSmokeCaptureSourceProvider();
  const captureController = createSmokeCaptureController();
  const ocrTestProvider = createSmokeOcrTestProvider();
  const api = createLocalApiServer({
    preferredPort: 0,
    version: SMOKE_VERSION,
    profileRepository: repository,
    captureSourceProvider,
    captureController,
    ocrTestProvider,
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
    assert.equal(health.parsed.port, started.port);
    record(checks, 'GET /health reports selected localhost port');

    const sources = await expectJson(started.port, '/api/capture/sources', {}, 200);
    assert.deepEqual(sources.parsed.sources[0], makeCaptureSource());
    assert.deepEqual(Object.keys(sources.parsed.sources[0]).sort(), ['bounds', 'id', 'kind', 'label']);
    captureSourceProvider.failNext = true;
    const sourceFailure = await expectJson(started.port, '/api/capture/sources', {}, 500);
    assert.equal(sourceFailure.parsed.error.code, 'CAPTURE_ENUM_FAILED');
    assert.equal(sourceFailure.parsed.error.retryable, false);
    record(checks, 'capture source enumeration success and no-leak failure routes pass');

    const ocrSuccess = await expectJson(started.port, '/api/ocr/test', {
      method: 'POST',
      body: { profileId: 'profile_main' },
    }, 200);
    assert.deepEqual(ocrSuccess.parsed, {
      text: '勇者が来た',
      normalizedText: '勇者が来た',
      confidence: 0.93,
      durationMs: 18,
      accepted: true,
    });
    assert.deepEqual(ocrTestProvider.calls[0], { profileId: 'profile_main', roi: makeRoi() });

    const missingRoi = await expectJson(started.port, '/api/ocr/test', {
      method: 'POST',
      body: { profileId: 'profile_no_roi' },
    }, 400);
    assert.equal(missingRoi.parsed.error.code, 'ROI_MISSING');
    assert.equal(ocrTestProvider.calls.length, 1);

    ocrTestProvider.failNext = true;
    const ocrFailure = await expectJson(started.port, '/api/ocr/test', {
      method: 'POST',
      body: { profileId: 'profile_main' },
    }, 500);
    assert.equal(ocrFailure.parsed.error.code, 'OCR_ENGINE_ERROR');
    assert.equal(ocrTestProvider.calls.length, 2);
    record(checks, 'manual OCR success ROI fallback missing-ROI and no-leak engine failure pass');

    const start = await expectJson(started.port, '/api/capture/start', {
      method: 'POST',
      body: { profileId: 'profile_main' },
    }, 200);
    assert.deepEqual(start.parsed, { ok: true });
    assert.deepEqual(captureController.starts, [{
      profileId: 'profile_main',
      captureSource: makeCaptureSource(),
    }]);
    const runningStatus = await expectJson(started.port, '/api/status', {}, 200);
    assert.equal(runningStatus.parsed.activeProfileId, 'profile_main');
    assert.equal(runningStatus.parsed.capture.state, 'running');
    assert.equal(runningStatus.parsed.capture.code, 'CAPTURE_RUNNING');

    const duplicateStart = await expectJson(started.port, '/api/capture/start', {
      method: 'POST',
      body: { profileId: 'profile_main' },
    }, 409);
    assert.equal(duplicateStart.parsed.error.code, 'CAPTURE_ALREADY_RUNNING');
    assert.equal(captureController.starts.length, 1);
    record(checks, 'capture start updates status and duplicate start is blocked');

    const stop = await expectJson(started.port, '/api/capture/stop', {
      method: 'POST',
    }, 200);
    assert.deepEqual(stop.parsed, { ok: true });
    assert.deepEqual(captureController.stops, [{ profileId: 'profile_main' }]);
    const stoppedStatus = await expectJson(started.port, '/api/status', {}, 200);
    assert.equal(stoppedStatus.parsed.activeProfileId, 'profile_main');
    assert.equal(stoppedStatus.parsed.capture.state, 'idle');
    assert.equal(stoppedStatus.parsed.capture.code, 'CAPTURE_STOPPED');

    const idleStop = await expectJson(started.port, '/api/capture/stop', {
      method: 'POST',
    }, 409);
    assert.equal(idleStop.parsed.error.code, 'CAPTURE_NOT_RUNNING');
    assert.equal(captureController.stops.length, 1);
    record(checks, 'capture stop updates status and idle stop is blocked');

    return Object.freeze({
      ok: true,
      command: 'npm run smoke:capture-ocr',
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
        : 'Capture/OCR API smoke failed';
      process.stderr.write(`${JSON.stringify({
        ok: false,
        command: 'npm run smoke:capture-ocr',
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
