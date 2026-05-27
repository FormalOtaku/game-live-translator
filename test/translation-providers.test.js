'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_ERROR_CODES,
  RETRYABLE_PROVIDER_ERROR_CODES,
  isRetryableProviderError,
  createEchoProvider,
  createDeepLProvider,
  createProvider,
} = require('../src/core/translation-providers');

const SECRET_API_KEY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:fx';

function makeFetchStub({ status, body, throwError } = {}) {
  const calls = [];
  const fetchClient = async (url, init) => {
    calls.push({ url, init });
    if (throwError) throw throwError;
    return {
      status,
      async json() {
        if (body instanceof Error) throw body;
        return body;
      },
    };
  };
  return { fetchClient, calls };
}

function constantClock(values) {
  const queue = [...values];
  return () => (queue.length > 1 ? queue.shift() : queue[0]);
}

function serializedError(error) {
  return JSON.stringify({
    message: error.message,
    details: error.details,
    stack: error.stack,
  });
}

test('PROVIDER_ERROR_CODES contract enumerates every mapped failure', () => {
  assert.deepEqual(Object.keys(PROVIDER_ERROR_CODES).sort(), [
    'PROVIDER_AUTH_FAILED',
    'PROVIDER_KEY_MISSING',
    'PROVIDER_NETWORK_ERROR',
    'PROVIDER_QUOTA_EXCEEDED',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_RESPONSE_INVALID',
    'PROVIDER_UNKNOWN',
    'TARGET_LANG_INVALID',
  ]);
  assert.equal(Object.isFrozen(PROVIDER_ERROR_CODES), true);
});

test('isRetryableProviderError matches the documented retry list', () => {
  assert.deepEqual([...RETRYABLE_PROVIDER_ERROR_CODES], [
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_NETWORK_ERROR',
  ]);
  assert.equal(isRetryableProviderError('PROVIDER_RATE_LIMITED'), true);
  assert.equal(isRetryableProviderError('PROVIDER_NETWORK_ERROR'), true);
  for (const code of [
    'PROVIDER_AUTH_FAILED',
    'PROVIDER_KEY_MISSING',
    'PROVIDER_QUOTA_EXCEEDED',
    'PROVIDER_RESPONSE_INVALID',
    'PROVIDER_UNKNOWN',
    'TARGET_LANG_INVALID',
  ]) {
    assert.equal(isRetryableProviderError(code), false, `expected ${code} non-retryable`);
  }
});

test('echo provider returns deterministic, frozen v1 TranslationResult shape', async () => {
  const provider = createEchoProvider({ clock: constantClock([1000, 1007]) });
  const result = await provider.translate({ sourceText: '　勇者は\n魔王と会う　', targetLang: 'en' });
  assert.equal(result.provider, 'echo');
  assert.equal(result.sourceText, '勇者は 魔王と会う');
  assert.equal(result.translatedText, '勇者は 魔王と会う');
  assert.equal(result.cacheHit, false);
  assert.equal(result.durationMs, 7);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result).sort(), [
    'cacheHit',
    'durationMs',
    'provider',
    'sourceText',
    'translatedText',
  ]);
});

test('echo provider default duration is deterministic when no clock is injected', async () => {
  const provider = createEchoProvider();
  const result = await provider.translate({ sourceText: '勇者', targetLang: 'en' });
  assert.equal(result.durationMs, 0);
});

test('echo provider rejects invalid targetLang with TARGET_LANG_INVALID', async () => {
  const provider = createEchoProvider();
  await assert.rejects(
    () => provider.translate({ sourceText: '勇者', targetLang: 'ja' }),
    (error) => error.code === 'TARGET_LANG_INVALID',
  );
});

test('echo provider rejects non-string sourceText', async () => {
  const provider = createEchoProvider();
  await assert.rejects(
    () => provider.translate({ sourceText: 123, targetLang: 'en' }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'SOURCE_TEXT_INVALID',
  );
});

test('createDeepLProvider requires injected fetchClient and apiKeyResolver', () => {
  assert.throws(
    () => createDeepLProvider({ apiKeyResolver: async () => SECRET_API_KEY }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].field === 'fetchClient',
  );
  assert.throws(
    () => createDeepLProvider({ fetchClient: async () => ({ status: 200, json: async () => ({}) }) }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].field === 'apiKeyResolver',
  );
});

test('deepl provider maps a 200 success into a frozen v1 TranslationResult', async () => {
  const { fetchClient, calls } = makeFetchStub({
    status: 200,
    body: { translations: [{ detected_source_language: 'JA', text: 'The hero meets the demon king' }] },
  });
  const provider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
    clock: constantClock([2000, 2042]),
  });

  const result = await provider.translate({ sourceText: '勇者は魔王と会う', targetLang: 'en' });
  assert.equal(result.provider, 'deepl');
  assert.equal(result.sourceText, '勇者は魔王と会う');
  assert.equal(result.translatedText, 'The hero meets the demon king');
  assert.equal(result.cacheHit, false);
  assert.equal(result.durationMs, 42);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(Object.hasOwn(provider, 'endpoint'), false);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers.Authorization, /^DeepL-Auth-Key /);
  assert.equal(calls[0].url.includes(SECRET_API_KEY), false);
  assert.equal(calls[0].init.body.includes(SECRET_API_KEY), false);
  assert.ok(calls[0].init.body.includes('target_lang=EN'));
  assert.ok(calls[0].init.body.includes('source_lang=JA'));
});

test('deepl provider honors endpoint override without exposing it on the adapter', async () => {
  const endpoint = 'https://deepl.example.test/v2/translate';
  const { fetchClient, calls } = makeFetchStub({
    status: 200,
    body: { translations: [{ text: 'A translated line' }] },
  });
  const provider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
    endpoint,
  });

  await provider.translate({ sourceText: '勇者', targetLang: 'en' });
  assert.equal(calls[0].url, endpoint);
  assert.equal(Object.hasOwn(provider, 'endpoint'), false);
});

test('deepl provider maps missing API key to PROVIDER_KEY_MISSING and never logs the key', async () => {
  const { fetchClient, calls } = makeFetchStub({ status: 200, body: { translations: [{ text: 'x' }] } });
  const emptyKeyProvider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => '',
  });
  const whitespaceKeyProvider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => '   ',
  });
  const throwingProvider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => { throw new Error(`leaked ${SECRET_API_KEY}`); },
  });

  for (const provider of [emptyKeyProvider, whitespaceKeyProvider, throwingProvider]) {
    try {
      await provider.translate({ sourceText: '勇者', targetLang: 'en' });
      assert.fail('expected PROVIDER_KEY_MISSING');
    } catch (error) {
      assert.equal(error.code, 'PROVIDER_KEY_MISSING');
      assert.equal(serializedError(error).includes(SECRET_API_KEY), false);
    }
  }
  assert.equal(calls.length, 0);
});

test('deepl provider maps 401 and 403 to PROVIDER_AUTH_FAILED', async () => {
  for (const status of [401, 403]) {
    const { fetchClient } = makeFetchStub({ status });
    const provider = createDeepLProvider({
      fetchClient,
      apiKeyResolver: async () => SECRET_API_KEY,
    });
    await assert.rejects(
      () => provider.translate({ sourceText: '勇者', targetLang: 'en' }),
      (error) => error.code === 'PROVIDER_AUTH_FAILED' && error.details.status === status,
    );
  }
});

test('deepl provider maps 429 to PROVIDER_RATE_LIMITED', async () => {
  const { fetchClient } = makeFetchStub({ status: 429 });
  const provider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  await assert.rejects(
    () => provider.translate({ sourceText: '勇者', targetLang: 'en' }),
    (error) => error.code === 'PROVIDER_RATE_LIMITED' && isRetryableProviderError(error.code),
  );
});

test('deepl provider maps 456 to PROVIDER_QUOTA_EXCEEDED', async () => {
  const { fetchClient } = makeFetchStub({ status: 456 });
  const provider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  await assert.rejects(
    () => provider.translate({ sourceText: '勇者', targetLang: 'en' }),
    (error) => error.code === 'PROVIDER_QUOTA_EXCEEDED',
  );
});

test('deepl provider maps 5xx and thrown fetch errors to PROVIDER_NETWORK_ERROR', async () => {
  const stub5xx = makeFetchStub({ status: 503 });
  const provider5xx = createDeepLProvider({
    fetchClient: stub5xx.fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  await assert.rejects(
    () => provider5xx.translate({ sourceText: '勇者', targetLang: 'en' }),
    (error) => error.code === 'PROVIDER_NETWORK_ERROR' && error.details.status === 503,
  );

  const stubThrow = makeFetchStub({ throwError: new Error(`socket reset with ${SECRET_API_KEY}`) });
  const providerThrow = createDeepLProvider({
    fetchClient: stubThrow.fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  try {
    await providerThrow.translate({ sourceText: '勇者', targetLang: 'en' });
    assert.fail('expected PROVIDER_NETWORK_ERROR');
  } catch (error) {
    assert.equal(error.code, 'PROVIDER_NETWORK_ERROR');
    assert.equal(serializedError(error).includes(SECRET_API_KEY), false);
  }
});

test('deepl provider maps unexpected non-200 statuses to PROVIDER_UNKNOWN', async () => {
  for (const status of [0, 199, 418]) {
    const { fetchClient } = makeFetchStub({ status });
    const provider = createDeepLProvider({
      fetchClient,
      apiKeyResolver: async () => SECRET_API_KEY,
    });
    await assert.rejects(
      () => provider.translate({ sourceText: '勇者', targetLang: 'en' }),
      (error) => error.code === 'PROVIDER_UNKNOWN' && error.details.status === status,
      `expected PROVIDER_UNKNOWN for ${status}`,
    );
  }
});

test('deepl provider maps malformed response objects and bodies to PROVIDER_RESPONSE_INVALID', async () => {
  const responseCases = [
    null,
    {},
    { status: '200' },
    { status: 200, body: { translations: [{ text: 'x' }] } },
  ];
  for (const response of responseCases) {
    const fetchClient = async () => response;
    const provider = createDeepLProvider({
      fetchClient,
      apiKeyResolver: async () => SECRET_API_KEY,
    });
    await assert.rejects(
      () => provider.translate({ sourceText: '勇者', targetLang: 'en' }),
      (error) => error.code === 'PROVIDER_RESPONSE_INVALID',
      `expected PROVIDER_RESPONSE_INVALID for response=${JSON.stringify(response)}`,
    );
  }

  const bodyCases = [
    {},
    { translations: [] },
    { translations: [{ detected_source_language: 'JA' }] },
    null,
    [],
  ];
  for (const body of bodyCases) {
    const { fetchClient } = makeFetchStub({ status: 200, body });
    const provider = createDeepLProvider({
      fetchClient,
      apiKeyResolver: async () => SECRET_API_KEY,
    });
    await assert.rejects(
      () => provider.translate({ sourceText: '勇者', targetLang: 'en' }),
      (error) => error.code === 'PROVIDER_RESPONSE_INVALID',
      `expected PROVIDER_RESPONSE_INVALID for body=${JSON.stringify(body)}`,
    );
  }

  const jsonThrows = makeFetchStub({ status: 200, body: new Error(`boom ${SECRET_API_KEY}`) });
  const providerJson = createDeepLProvider({
    fetchClient: jsonThrows.fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  try {
    await providerJson.translate({ sourceText: '勇者', targetLang: 'en' });
    assert.fail('expected PROVIDER_RESPONSE_INVALID');
  } catch (error) {
    assert.equal(error.code, 'PROVIDER_RESPONSE_INVALID');
    assert.equal(serializedError(error).includes(SECRET_API_KEY), false);
  }
});

test('deepl provider rejects invalid targetLang with TARGET_LANG_INVALID and never calls fetch', async () => {
  const { fetchClient, calls } = makeFetchStub({ status: 200, body: { translations: [{ text: 'x' }] } });
  const provider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  await assert.rejects(
    () => provider.translate({ sourceText: '勇者', targetLang: 'ja' }),
    (error) => error.code === 'TARGET_LANG_INVALID',
  );
  assert.equal(calls.length, 0);
});

test('deepl provider does not include the API key in fetch URL or error payloads', async () => {
  const { fetchClient, calls } = makeFetchStub({ status: 401 });
  const provider = createDeepLProvider({
    fetchClient,
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  try {
    await provider.translate({ sourceText: '勇者', targetLang: 'en' });
    assert.fail('expected throw');
  } catch (error) {
    const serialized = JSON.stringify({
      message: error.message,
      details: error.details,
      url: calls[0].url,
    });
    assert.equal(serialized.includes(SECRET_API_KEY), false);
  }
});

test('createProvider returns matching factory and rejects unknown providers', () => {
  const echo = createProvider('echo', {
    fetchClient: async () => {
      throw new Error('echo must ignore fetchClient');
    },
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  assert.equal(echo.name, 'echo');
  const deepl = createProvider('deepl', {
    fetchClient: async () => ({ status: 200, json: async () => ({}) }),
    apiKeyResolver: async () => SECRET_API_KEY,
  });
  assert.equal(deepl.name, 'deepl');
  assert.throws(
    () => createProvider('google'),
    (error) =>
      error.code === 'PROVIDER_UNKNOWN' &&
      error.details.fieldErrors[0].field === 'translationProvider',
  );
});
