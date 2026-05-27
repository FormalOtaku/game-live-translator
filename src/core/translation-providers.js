'use strict';

const { ContractError } = require('../contracts/security');
const {
  assertProvider,
  assertTargetLang,
} = require('../contracts/validation');
const { normalizeOcrText } = require('./ocr-text');

const PROVIDER_ERROR_CODES = Object.freeze({
  PROVIDER_KEY_MISSING: 'PROVIDER_KEY_MISSING',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_QUOTA_EXCEEDED: 'PROVIDER_QUOTA_EXCEEDED',
  PROVIDER_NETWORK_ERROR: 'PROVIDER_NETWORK_ERROR',
  PROVIDER_RESPONSE_INVALID: 'PROVIDER_RESPONSE_INVALID',
  PROVIDER_UNKNOWN: 'PROVIDER_UNKNOWN',
  TARGET_LANG_INVALID: 'TARGET_LANG_INVALID',
});

const RETRYABLE_PROVIDER_ERROR_CODES = Object.freeze([
  PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED,
  PROVIDER_ERROR_CODES.PROVIDER_NETWORK_ERROR,
]);

const DEEPL_FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate';

function isRetryableProviderError(code) {
  return RETRYABLE_PROVIDER_ERROR_CODES.includes(code);
}

function nowMs(clock) {
  if (typeof clock === 'function') {
    const value = clock();
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return Date.now();
}

function buildTranslationResult({ sourceText, translatedText, provider, durationMs }) {
  const safeDuration = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : 0;
  return Object.freeze({
    sourceText,
    translatedText,
    provider,
    durationMs: safeDuration,
    cacheHit: false,
  });
}

function fieldError(field, code, message) {
  return { field, code, message };
}

function assertSourceTextInput(value) {
  if (typeof value !== 'string') {
    throw new ContractError(
      'VALIDATION_ERROR',
      'sourceText must be a string',
      {
        fieldErrors: [
          fieldError('sourceText', 'SOURCE_TEXT_INVALID', 'sourceText must be a string'),
        ],
      },
    );
  }
}

function createEchoProvider(options = {}) {
  const clock = options.clock;
  return Object.freeze({
    name: 'echo',
    async translate({ sourceText, targetLang } = {}) {
      assertSourceTextInput(sourceText);
      assertTargetLang(targetLang);
      const startedAt = typeof clock === 'function' ? nowMs(clock) : 0;
      const normalized = normalizeOcrText(sourceText);
      const endedAt = typeof clock === 'function' ? nowMs(clock) : 0;
      return buildTranslationResult({
        sourceText: normalized,
        translatedText: normalized,
        provider: 'echo',
        durationMs: Math.max(0, endedAt - startedAt),
      });
    },
  });
}

function assertFunctionOption(value, name) {
  if (typeof value !== 'function') {
    throw new ContractError(
      'VALIDATION_ERROR',
      `${name} must be a function`,
      {
        fieldErrors: [
          fieldError(name, 'FUNCTION_REQUIRED', `${name} must be a function`),
        ],
      },
    );
  }
}

async function resolveDeepLApiKey(apiKeyResolver) {
  let apiKey;
  try {
    apiKey = await apiKeyResolver();
  } catch (_resolverError) {
    throw new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_KEY_MISSING,
      'DeepL API key is not available',
      { provider: 'deepl' },
    );
  }

  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_KEY_MISSING,
      'DeepL API key is not configured',
      { provider: 'deepl' },
    );
  }
  return apiKey;
}

function mapDeepLStatusToError(status) {
  if (status === 401 || status === 403) {
    return new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED,
      'DeepL rejected the API key',
      { provider: 'deepl', status },
    );
  }
  if (status === 429) {
    return new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED,
      'DeepL rate limit reached',
      { provider: 'deepl', status },
    );
  }
  if (status === 456) {
    return new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_QUOTA_EXCEEDED,
      'DeepL quota exceeded',
      { provider: 'deepl', status },
    );
  }
  if (status >= 500 && status < 600) {
    return new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_NETWORK_ERROR,
      'DeepL upstream error',
      { provider: 'deepl', status },
    );
  }
  return new ContractError(
    PROVIDER_ERROR_CODES.PROVIDER_UNKNOWN,
    `DeepL returned unexpected status ${status}`,
    { provider: 'deepl', status },
  );
}

async function readDeepLResponseBody(response) {
  try {
    if (typeof response.json === 'function') return await response.json();
  } catch (_jsonError) {
    throw new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      'DeepL response body was not valid JSON',
      { provider: 'deepl' },
    );
  }
  throw new ContractError(
    PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
    'DeepL response body could not be read',
    { provider: 'deepl' },
  );
}

function extractDeepLTranslatedText(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      'DeepL response body was not an object',
      { provider: 'deepl' },
    );
  }
  const { translations } = body;
  if (!Array.isArray(translations) || translations.length === 0) {
    throw new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      'DeepL response missing translations array',
      { provider: 'deepl' },
    );
  }
  const first = translations[0];
  if (first == null || typeof first.text !== 'string') {
    throw new ContractError(
      PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      'DeepL response missing translations[0].text',
      { provider: 'deepl' },
    );
  }
  return first.text;
}

function createDeepLProvider(options = {}) {
  const {
    fetchClient,
    apiKeyResolver,
    endpoint = DEEPL_FREE_ENDPOINT,
    clock,
  } = options;

  assertFunctionOption(fetchClient, 'fetchClient');
  assertFunctionOption(apiKeyResolver, 'apiKeyResolver');

  return Object.freeze({
    name: 'deepl',
    async translate({ sourceText, targetLang } = {}) {
      assertSourceTextInput(sourceText);
      assertTargetLang(targetLang);
      const startedAt = nowMs(clock);
      const normalized = normalizeOcrText(sourceText);

      const apiKey = await resolveDeepLApiKey(apiKeyResolver);

      let response;
      try {
        response = await fetchClient(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            text: normalized,
            target_lang: 'EN',
            source_lang: 'JA',
          }).toString(),
        });
      } catch (_networkError) {
        throw new ContractError(
          PROVIDER_ERROR_CODES.PROVIDER_NETWORK_ERROR,
          'DeepL network request failed',
          { provider: 'deepl' },
        );
      }

      if (response == null || typeof response !== 'object' || typeof response.status !== 'number') {
        throw new ContractError(
          PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_INVALID,
          'DeepL response was missing a numeric status',
          { provider: 'deepl' },
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw mapDeepLStatusToError(response.status);
      }

      const body = await readDeepLResponseBody(response);
      const translatedText = extractDeepLTranslatedText(body);

      const endedAt = nowMs(clock);
      return buildTranslationResult({
        sourceText: normalized,
        translatedText,
        provider: 'deepl',
        durationMs: Math.max(0, endedAt - startedAt),
      });
    },
  });
}

const PROVIDER_FACTORIES = Object.freeze({
  echo: createEchoProvider,
  deepl: createDeepLProvider,
});

function createProvider(name, options = {}) {
  assertProvider(name);
  return PROVIDER_FACTORIES[name](options);
}

module.exports = {
  PROVIDER_ERROR_CODES,
  RETRYABLE_PROVIDER_ERROR_CODES,
  DEEPL_FREE_ENDPOINT,
  isRetryableProviderError,
  buildTranslationResult,
  createEchoProvider,
  createDeepLProvider,
  createProvider,
};
