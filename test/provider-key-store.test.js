'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ContractError } = require('../src/contracts/security');
const {
  PROVIDER_KEY_SERVICE,
  createProviderKeyStore,
} = require('../src/storage/provider-key-store');

function recordingAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      async writeSecret(payload) {
        calls.push(['writeSecret', payload]);
        if (overrides.writeSecret) return overrides.writeSecret(payload);
        return undefined;
      },
      async deleteSecret(payload) {
        calls.push(['deleteSecret', payload]);
        if (overrides.deleteSecret) return overrides.deleteSecret(payload);
        return undefined;
      },
    },
  };
}

test('provider key store writes and deletes through the secure-store adapter only', async () => {
  const { calls, adapter } = recordingAdapter();
  const store = createProviderKeyStore({ adapter });

  const saved = await store.saveProviderKey(' deepl ', {
    provider: 'deepl',
    apiKey: 'secret-token-value',
  });
  const deleted = await store.deleteProviderKey('deepl');

  assert.deepEqual(saved, { ok: true });
  assert.deepEqual(deleted, { ok: true });
  assert.equal(Object.isFrozen(saved), true);
  assert.equal(Object.hasOwn(store, 'readProviderKey'), false);
  assert.equal(Object.hasOwn(store, 'listProviderKeys'), false);
  assert.deepEqual(calls, [
    ['writeSecret', {
      service: PROVIDER_KEY_SERVICE,
      account: 'deepl',
      secret: 'secret-token-value',
    }],
    ['deleteSecret', {
      service: PROVIDER_KEY_SERVICE,
      account: 'deepl',
    }],
  ]);
});

test('provider key store validates provider and write body before adapter calls', async () => {
  const { calls, adapter } = recordingAdapter();
  const store = createProviderKeyStore({ adapter });

  await assert.rejects(
    () => store.saveProviderKey('unknown', { apiKey: 'secret-token-value' }),
    (error) =>
      error instanceof ContractError &&
      error.code === 'PROVIDER_UNKNOWN' &&
      error.details.fieldErrors[0].field === 'provider',
  );

  await assert.rejects(
    () => store.saveProviderKey('deepl', {
      provider: 'echo',
      apiKey: 'secret-token-value',
    }),
    (error) => {
      assert.equal(error instanceof ContractError, true);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.details.fieldErrors[0].code, 'PROVIDER_PATH_MISMATCH');
      assert.equal(JSON.stringify(error).includes('secret-token-value'), false);
      return true;
    },
  );

  await assert.rejects(
    () => store.saveProviderKey('deepl', { apiKey: '   ' }),
    (error) => error instanceof ContractError && error.code === 'VALIDATION_ERROR',
  );

  await assert.rejects(
    () => store.deleteProviderKey('unknown'),
    (error) => error instanceof ContractError && error.code === 'PROVIDER_UNKNOWN',
  );

  assert.deepEqual(calls, []);
});

test('provider key store maps adapter failures without leaking secrets', async () => {
  const secret = 'sk-ABCDEFGHIJKLMNOP1234';
  const { calls, adapter } = recordingAdapter({
    writeSecret() {
      const error = new Error(`failed to save ${secret}`);
      error.code = 'EKEYCHAIN';
      throw error;
    },
  });
  const store = createProviderKeyStore({ adapter });

  await assert.rejects(
    () => store.saveProviderKey('deepl', { apiKey: secret }),
    (error) => {
      assert.equal(error instanceof ContractError, true);
      assert.equal(error.code, 'KEYCHAIN_UNAVAILABLE');
      assert.equal(error.message.includes(secret), false);
      assert.equal(JSON.stringify(error.details).includes(secret), false);
      assert.deepEqual(error.details, {
        provider: 'deepl',
        causeCode: 'EKEYCHAIN',
        causeName: 'Error',
      });
      return true;
    },
  );

  assert.equal(calls.length, 1);
});

test('provider key store maps delete adapter failures without secret access', async () => {
  const { calls, adapter } = recordingAdapter({
    deleteSecret() {
      const error = new Error('native keychain locked');
      error.code = 'ELOCKED';
      throw error;
    },
  });
  const store = createProviderKeyStore({ adapter });

  await assert.rejects(
    () => store.deleteProviderKey('deepl'),
    (error) => {
      assert.equal(error instanceof ContractError, true);
      assert.equal(error.code, 'KEYCHAIN_UNAVAILABLE');
      assert.deepEqual(error.details, {
        provider: 'deepl',
        causeCode: 'ELOCKED',
        causeName: 'Error',
      });
      return true;
    },
  );

  assert.deepEqual(calls, [
    ['deleteSecret', {
      service: PROVIDER_KEY_SERVICE,
      account: 'deepl',
    }],
  ]);
});

test('provider key store requires write/delete adapter primitives', () => {
  assert.throws(
    () => createProviderKeyStore({ adapter: null }),
    (error) => error instanceof ContractError && error.code === 'KEYCHAIN_UNAVAILABLE',
  );
  assert.throws(
    () => createProviderKeyStore({ adapter: { writeSecret() {} } }),
    (error) => error instanceof ContractError && error.code === 'KEYCHAIN_UNAVAILABLE',
  );
});
