'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ContractError } = require('../src/contracts/security');
const {
  buildHomeActionIntent,
  buildHomeStatusViewModel,
} = require('../src/ui/home-status-actions');
const {
  DESKTOP_HOST_LIFECYCLE_SCHEMA_VERSION,
  HOST_LIFECYCLE_STATES,
  HOST_PRIVACY_GUARANTEES,
  SUPPORTED_HOST_COMMANDS,
  createDesktopHostLifecycle,
  normalizeDesktopHostConfig,
  normalizeHostCommandIntent,
  sanitizeHostError,
  trustedAppWsUrl,
  trustedOverlayUrl,
} = require('../src/desktop/host-lifecycle');

const FIXED_TIME = '2026-05-28T12:00:00.000Z';
const COMPLETE_SETUP = Object.freeze({
  activeProfileId: 'profile-1',
  providerKeySaved: true,
  captureSourceSelected: true,
  roiSaved: true,
});

function fixedClock() {
  return FIXED_TIME;
}

function makeAppStatus(overrides = {}) {
  return {
    backend: 'ready',
    activeProfileId: 'profile-1',
    overlayUrl: 'http://127.0.0.1:41000/overlay',
    overlayClients: 1,
    capture: { state: 'idle', code: null, retryable: false, updatedAt: FIXED_TIME },
    ocr: { state: 'ok', code: 'OCR_TEST_OK', retryable: false, updatedAt: FIXED_TIME },
    translation: { state: 'ok', code: 'TRANSLATE_TEST_OK', retryable: false, updatedAt: FIXED_TIME },
    ...overrides,
  };
}

function makeApiFactory(plans, events) {
  let index = 0;
  return (options) => {
    const plan = plans[index] || {};
    const instanceId = index;
    const stopErrors = Array.isArray(plan.stopErrors)
      ? [...plan.stopErrors]
      : plan.stopError
        ? [plan.stopError]
        : [];
    let stopCount = 0;
    index += 1;
    events.push({ event: 'factory', instanceId, options: { ...options } });

    return {
      get port() {
        return plan.getterPort;
      },
      async start() {
        events.push({ event: 'start', instanceId });
        if (plan.startError) throw plan.startError;
        if (plan.startResult !== undefined) return plan.startResult;
        return Object.freeze({
          bindAddress: options.bindAddress,
          port: plan.port,
          overlayUrl: `http://${options.bindAddress}:${plan.port}/overlay`,
        });
      },
      async stop() {
        events.push({ event: 'stop', instanceId });
        const stopError = stopErrors[stopCount];
        stopCount += 1;
        if (stopError) throw stopError;
      },
    };
  };
}

test('desktop host lifecycle constants and config defaults are frozen', () => {
  assert.equal(Object.isFrozen(HOST_LIFECYCLE_STATES), true);
  assert.equal(Object.isFrozen(SUPPORTED_HOST_COMMANDS), true);
  assert.equal(Object.isFrozen(HOST_PRIVACY_GUARANTEES), true);
  assert.deepEqual(SUPPORTED_HOST_COMMANDS, ['restart_backend']);

  const config = normalizeDesktopHostConfig({
    preferredPort: 0,
    maxPortAttempts: 3,
    version: ' test-version ',
    appWsPath: '/ws/custom-app',
  });

  assert.equal(Object.isFrozen(config), true);
  assert.deepEqual(config, {
    bindAddress: '127.0.0.1',
    preferredPort: 0,
    maxPortAttempts: 3,
    version: 'test-version',
    appWsPath: '/ws/custom-app',
  });
});

test('desktop host config rejects non-localhost and invalid port settings before startup', () => {
  for (const bindAddress of ['0.0.0.0', 'localhost', '192.168.1.10', '::1']) {
    assert.throws(
      () => normalizeDesktopHostConfig({ bindAddress }),
      (error) => error instanceof ContractError && error.code === 'NON_LOCALHOST_BIND_REJECTED',
      `expected ${bindAddress} to be rejected`,
    );
  }

  assert.throws(
    () => normalizeDesktopHostConfig(null),
    (error) => error instanceof ContractError && error.code === 'HOST_CONFIG_INVALID',
  );
  assert.throws(
    () => normalizeDesktopHostConfig({ preferredPort: 65536 }),
    (error) => error instanceof ContractError && error.code === 'HOST_PORT_INVALID',
  );
  assert.throws(
    () => normalizeDesktopHostConfig({ maxPortAttempts: 0 }),
    (error) => error instanceof ContractError && error.code === 'HOST_PORT_ATTEMPTS_INVALID',
  );
  assert.throws(
    () => normalizeDesktopHostConfig({ appWsPath: 'ws/app' }),
    (error) => error instanceof ContractError && error.code === 'HOST_WS_PATH_INVALID',
  );
  for (const appWsPath of ['//ws/app', '/ws/app\\evil', '/ws/app\u0000', '/ws/app?debug=1']) {
    assert.throws(
      () => normalizeDesktopHostConfig({ appWsPath }),
      (error) => error instanceof ContractError && error.code === 'HOST_WS_PATH_INVALID',
      `expected ${JSON.stringify(appWsPath)} to be rejected`,
    );
  }
});

test('desktop host lifecycle starts injected localhost API and returns trusted frozen snapshot', async () => {
  const events = [];
  const lifecycle = createDesktopHostLifecycle({
    config: {
      preferredPort: 41000,
      maxPortAttempts: 2,
      version: 'desktop-test',
    },
    apiFactory: makeApiFactory([{ port: 41000 }], events),
    clock: fixedClock,
    serverOptions: {
      allowedOrigins: ['http://127.0.0.1:41000'],
      bindAddress: '0.0.0.0',
      preferredPort: 49152,
    },
  });

  const idle = lifecycle.snapshot();
  assert.equal(Object.isFrozen(idle), true);
  assert.equal(idle.schemaVersion, DESKTOP_HOST_LIFECYCLE_SCHEMA_VERSION);
  assert.equal(idle.state, 'idle');
  assert.equal(idle.backendState, 'starting');
  assert.equal(idle.overlayUrl, null);
  assert.equal(idle.overlayUrlTrusted, false);

  const ready = await lifecycle.start();

  assert.equal(Object.isFrozen(ready), true);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.backend, 'ready');
  assert.equal(ready.backendState, 'ready');
  assert.equal(ready.bindAddress, '127.0.0.1');
  assert.equal(ready.port, 41000);
  assert.equal(ready.overlayUrl, 'http://127.0.0.1:41000/overlay');
  assert.equal(ready.overlayUrlTrusted, true);
  assert.equal(ready.appWsUrl, 'ws://127.0.0.1:41000/ws/app');
  assert.equal(ready.restartCount, 0);
  assert.equal(ready.generation, 1);
  assert.equal(ready.startedAt, FIXED_TIME);
  assert.equal(ready.lastError, null);
  assert.equal(ready.privacy.localhostOnly, true);
  assert.equal(ready.privacy.providerKeysSerialized, false);
  assert.equal(ready.privacy.rawOcrTextSerialized, false);
  assert.equal(ready.privacy.translatedTextSerialized, false);
  assert.equal(ready.privacy.screenshotsSerialized, false);

  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'factory');
  assert.equal(events[0].options.bindAddress, '127.0.0.1');
  assert.equal(events[0].options.preferredPort, 41000);
  assert.equal(events[0].options.maxPortAttempts, 2);
  assert.equal(events[0].options.version, 'desktop-test');
  assert.deepEqual(events.map((event) => event.event), ['factory', 'start']);

  const serialized = JSON.stringify(ready);
  assert.equal(serialized.includes('sk-'), false);
  assert.equal(serialized.includes('source-dialogue-private'), false);
  assert.equal(serialized.includes('translated-private'), false);
  assert.equal(serialized.includes('private-screenshot'), false);
  assert.equal(serialized.includes('stack'), false);
});

test('restart_backend Home action restarts current backend through host lifecycle', async () => {
  const events = [];
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000 },
    apiFactory: makeApiFactory([{ port: 41000 }, { port: 41001 }], events),
    clock: fixedClock,
  });

  const initial = await lifecycle.start();
  const viewModel = buildHomeStatusViewModel({
    port: initial.port,
    setup: COMPLETE_SETUP,
    appStatus: makeAppStatus({
      backend: 'error',
      overlayUrl: initial.overlayUrl,
      translation: {
        state: 'error',
        code: 'PORT_UNAVAILABLE',
        retryable: true,
        updatedAt: FIXED_TIME,
      },
    }),
  });
  const intent = buildHomeActionIntent('restart_backend', viewModel);

  assert.deepEqual(intent, {
    type: 'hostCommand',
    actionId: 'restart_backend',
    command: 'restart_backend',
    sensitive: false,
  });

  const restarted = await lifecycle.executeHostCommand(intent);

  assert.equal(restarted.state, 'ready');
  assert.equal(restarted.port, 41001);
  assert.equal(restarted.overlayUrl, 'http://127.0.0.1:41001/overlay');
  assert.equal(restarted.restartCount, 1);
  assert.equal(restarted.generation, 2);
  assert.deepEqual(
    events.map((event) => event.event),
    ['factory', 'start', 'stop', 'factory', 'start'],
  );
});

test('desktop host lifecycle maps startup failures to privacy-safe retryable snapshots', async () => {
  const events = [];
  const failure = new ContractError(
    'PORT_UNAVAILABLE',
    'port failed api_key=sk-ABCDEFGHIJKLMNOP123456 source-dialogue-private',
    {
      bindAddress: '127.0.0.1',
      preferredPort: 41000,
      maxPortAttempts: 1,
      apiKey: 'sk-ABCDEFGHIJKLMNOP123456',
      sourceText: 'source-dialogue-private',
      translatedText: 'translated-private',
      screenshotPath: '/tmp/private-screenshot.png',
      stack: 'Error: private stack\n    at /tmp/private.js:1:1',
    },
  );
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000, maxPortAttempts: 1 },
    apiFactory: makeApiFactory([{ port: 41000, startError: failure }], events),
    clock: fixedClock,
  });

  const failed = await lifecycle.start();

  assert.equal(failed.state, 'error');
  assert.equal(failed.backendState, 'error');
  assert.equal(failed.port, null);
  assert.equal(failed.overlayUrl, null);
  assert.equal(failed.overlayUrlTrusted, false);
  assert.deepEqual(failed.lastError, {
    code: 'PORT_UNAVAILABLE',
    message: 'No localhost port is available for the desktop backend',
    retryable: true,
    details: {
      bindAddress: '127.0.0.1',
      maxPortAttempts: 1,
      preferredPort: 41000,
    },
  });
  assert.deepEqual(events.map((event) => event.event), ['factory', 'start', 'stop']);

  const serialized = JSON.stringify(failed);
  assert.equal(serialized.includes('sk-ABCDEFGHIJKLMNOP123456'), false);
  assert.equal(serialized.includes('source-dialogue-private'), false);
  assert.equal(serialized.includes('translated-private'), false);
  assert.equal(serialized.includes('/tmp/private-screenshot.png'), false);
  assert.equal(serialized.includes('/tmp/private.js'), false);
  assert.equal(serialized.includes('stack'), false);
});

test('desktop host lifecycle treats invalid started ports as sanitized errors and cleans up adapter', async () => {
  const events = [];
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000 },
    apiFactory: makeApiFactory([{ startResult: { port: 0 } }], events),
    clock: fixedClock,
  });

  const failed = await lifecycle.start();

  assert.equal(failed.state, 'error');
  assert.equal(failed.lastError.code, 'HOST_BACKEND_PORT_INVALID');
  assert.equal(failed.lastError.message, 'Desktop backend did not report a usable localhost port');
  assert.deepEqual(failed.lastError.details, { field: 'port' });
  assert.deepEqual(events.map((event) => event.event), ['factory', 'start', 'stop']);
});

test('desktop host lifecycle stop success clears localhost backend and reports degraded stopped state', async () => {
  const events = [];
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000 },
    apiFactory: makeApiFactory([{ port: 41000 }], events),
    clock: fixedClock,
  });

  await lifecycle.start();
  const stopped = await lifecycle.stop();
  const stoppedAgain = await lifecycle.stop();

  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.backendState, 'degraded');
  assert.equal(stopped.port, null);
  assert.equal(stopped.overlayUrl, null);
  assert.equal(stopped.overlayUrlTrusted, false);
  assert.equal(stopped.appWsUrl, null);
  assert.equal(stopped.lastError, null);
  assert.equal(stopped.stoppedAt, FIXED_TIME);
  assert.equal(stoppedAgain.state, 'stopped');
  assert.deepEqual(events.map((event) => event.event), ['factory', 'start', 'stop']);
});

test('start retries cleanup of prior stop failure before creating a new adapter', async () => {
  const events = [];
  const stopError = new ContractError(
    'HOST_BACKEND_STOP_FAILED',
    'stop failed api_key=sk-ABCDEFGHIJKLMNOP123456 source-dialogue-private',
    {
      stack: 'Error: private stack\n    at /tmp/private.js:1:1',
      apiKey: 'sk-ABCDEFGHIJKLMNOP123456',
      sourceText: 'source-dialogue-private',
    },
  );
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000 },
    apiFactory: makeApiFactory([
      { port: 41000, stopErrors: [stopError, null] },
      { port: 41001 },
    ], events),
    clock: fixedClock,
  });

  await lifecycle.start();
  const failedStop = await lifecycle.stop();
  const recovered = await lifecycle.start();

  assert.equal(failedStop.state, 'error');
  assert.equal(failedStop.port, 41000);
  assert.equal(failedStop.lastError.code, 'HOST_BACKEND_STOP_FAILED');
  assert.equal(JSON.stringify(failedStop).includes('source-dialogue-private'), false);
  assert.equal(recovered.state, 'ready');
  assert.equal(recovered.port, 41001);
  assert.deepEqual(
    events.map((event) => event.event),
    ['factory', 'start', 'stop', 'stop', 'factory', 'start'],
  );
});

test('failed restart does not inflate restartCount or orphan the live adapter', async () => {
  const events = [];
  const stopError = new ContractError('HOST_BACKEND_STOP_FAILED', 'stop failed');
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000 },
    apiFactory: makeApiFactory([{ port: 41000, stopError }], events),
    clock: fixedClock,
  });

  await lifecycle.start();
  const failedRestart = await lifecycle.restart();

  assert.equal(failedRestart.state, 'error');
  assert.equal(failedRestart.restartCount, 0);
  assert.equal(failedRestart.generation, 1);
  assert.equal(failedRestart.port, 41000);
  assert.deepEqual(events.map((event) => event.event), ['factory', 'start', 'stop']);
});

test('startup failure after a prior stop clears stale stoppedAt timestamp', async () => {
  const events = [];
  const failure = new ContractError('PORT_UNAVAILABLE', 'port failed');
  const lifecycle = createDesktopHostLifecycle({
    config: { preferredPort: 41000 },
    apiFactory: makeApiFactory([
      { port: 41000 },
      { startError: failure },
    ], events),
    clock: fixedClock,
  });

  await lifecycle.start();
  const stopped = await lifecycle.stop();
  const failedStart = await lifecycle.start();

  assert.equal(stopped.stoppedAt, FIXED_TIME);
  assert.equal(failedStart.state, 'error');
  assert.equal(failedStart.stoppedAt, null);
});

test('host command normalization rejects sensitive, unsupported, and inherited commands', async () => {
  const lifecycle = createDesktopHostLifecycle({
    apiFactory: makeApiFactory([{ port: 41000 }], []),
    clock: fixedClock,
  });

  assert.deepEqual(normalizeHostCommandIntent({
    type: 'hostCommand',
    actionId: 'restart_backend',
    command: 'restart_backend',
    sensitive: false,
  }), {
    type: 'hostCommand',
    actionId: 'restart_backend',
    command: 'restart_backend',
  });

  assert.throws(
    () => normalizeHostCommandIntent({
      type: 'hostCommand',
      actionId: 'restart_backend',
      command: 'restart_backend',
      sensitive: true,
    }),
    (error) => error instanceof ContractError && error.code === 'HOST_COMMAND_SENSITIVE_REJECTED',
  );
  for (const sensitive of ['true', 1, {}]) {
    assert.throws(
      () => normalizeHostCommandIntent({
        type: 'hostCommand',
        command: 'restart_backend',
        sensitive,
      }),
      (error) => error instanceof ContractError && error.code === 'HOST_COMMAND_SENSITIVE_REJECTED',
      `expected sensitive=${JSON.stringify(sensitive)} to be rejected`,
    );
  }
  assert.throws(
    () => normalizeHostCommandIntent({
      type: 'hostCommand',
      command: 'restart_backend sk-ABCDEFGHIJKLMNOP123456',
    }),
    (error) => error instanceof ContractError && error.code === 'HOST_COMMAND_UNSUPPORTED',
  );
  assert.throws(
    () => normalizeHostCommandIntent(Object.create({
      type: 'hostCommand',
      command: 'restart_backend',
    })),
    (error) => error instanceof ContractError && error.code === 'HOST_COMMAND_INVALID',
  );
  await assert.rejects(
    () => lifecycle.executeHostCommand({
      type: 'hostCommand',
      command: 'restart_backend',
      sensitive: true,
    }),
    (error) => error instanceof ContractError && error.code === 'HOST_COMMAND_SENSITIVE_REJECTED',
  );
});

test('trusted URL helpers accept only 127.0.0.1 with usable ports', () => {
  assert.equal(trustedOverlayUrl('127.0.0.1', 41000), 'http://127.0.0.1:41000/overlay');
  assert.equal(trustedOverlayUrl('localhost', 41000), null);
  assert.equal(trustedOverlayUrl('127.0.0.1', 0), null);
  assert.equal(trustedAppWsUrl('127.0.0.1', 41000, '/ws/app'), 'ws://127.0.0.1:41000/ws/app');
  assert.equal(trustedAppWsUrl('0.0.0.0', 41000, '/ws/app'), null);
});

test('sanitizeHostError drops unsafe details and raw message text', () => {
  const sanitized = sanitizeHostError(new ContractError(
    'HOST_COMMAND_UNSUPPORTED',
    'unsupported source-dialogue-private api_key=sk-ABCDEFGHIJKLMNOP123456',
    {
      field: 'command',
      command: 'source-dialogue-private',
      apiKey: 'sk-ABCDEFGHIJKLMNOP123456',
      sourceText: 'source-dialogue-private',
      screenshotPath: '/tmp/private-screenshot.png',
      stack: 'Error: private stack\n    at /tmp/private.js:1:1',
    },
  ));

  assert.deepEqual(sanitized, {
    code: 'HOST_COMMAND_UNSUPPORTED',
    message: 'Host command is not supported',
    retryable: false,
    details: { field: 'command' },
  });
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes('source-dialogue-private'), false);
  assert.equal(serialized.includes('sk-ABCDEFGHIJKLMNOP123456'), false);
  assert.equal(serialized.includes('/tmp/private-screenshot.png'), false);
  assert.equal(serialized.includes('/tmp/private.js'), false);
});
