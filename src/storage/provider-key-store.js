'use strict';

const {
  ALLOWED_PROVIDERS,
  assertProviderKeyWriteRequest,
  fieldError,
} = require('../contracts/validation');
const {
  ContractError,
  apiKeyWriteResponse,
} = require('../contracts/security');

const PROVIDER_KEY_SERVICE = 'game-live-translator.provider-keys';

function keychainUnavailable(provider, cause) {
  const details = { provider };
  if (cause && typeof cause === 'object') {
    if (typeof cause.code === 'string') details.causeCode = cause.code;
    if (typeof cause.name === 'string') details.causeName = cause.name;
  }
  return new ContractError(
    'KEYCHAIN_UNAVAILABLE',
    'Provider key secure storage is unavailable',
    details,
  );
}

function normalizeProviderId(provider) {
  const normalized = typeof provider === 'string' ? provider.normalize('NFKC').trim() : '';
  if (!ALLOWED_PROVIDERS.includes(normalized)) {
    throw new ContractError('PROVIDER_UNKNOWN', 'provider is not supported', {
      fieldErrors: [
        fieldError(
          'provider',
          'PROVIDER_UNKNOWN',
          `provider must be one of ${ALLOWED_PROVIDERS.join(', ')}`,
        ),
      ],
    });
  }
  return normalized;
}

function assertSecureStoreAdapter(adapter) {
  if (
    adapter == null ||
    typeof adapter !== 'object' ||
    typeof adapter.writeSecret !== 'function' ||
    typeof adapter.deleteSecret !== 'function'
  ) {
    throw new ContractError(
      'KEYCHAIN_UNAVAILABLE',
      'Provider key secure storage adapter must provide writeSecret and deleteSecret',
    );
  }
  return adapter;
}

function createProviderKeyStore(options = {}) {
  const adapter = assertSecureStoreAdapter(options.adapter);
  const service = typeof options.service === 'string' && options.service.trim().length > 0
    ? options.service.trim()
    : PROVIDER_KEY_SERVICE;

  async function saveProviderKey(provider, payload) {
    const normalizedProvider = normalizeProviderId(provider);
    assertProviderKeyWriteRequest(payload, { provider: normalizedProvider });
    try {
      await adapter.writeSecret({
        service,
        account: normalizedProvider,
        secret: payload.apiKey,
      });
    } catch (error) {
      throw keychainUnavailable(normalizedProvider, error);
    }
    return apiKeyWriteResponse();
  }

  async function deleteProviderKey(provider) {
    const normalizedProvider = normalizeProviderId(provider);
    try {
      await adapter.deleteSecret({
        service,
        account: normalizedProvider,
      });
    } catch (error) {
      throw keychainUnavailable(normalizedProvider, error);
    }
    return apiKeyWriteResponse();
  }

  return Object.freeze({
    saveProviderKey,
    deleteProviderKey,
  });
}

module.exports = {
  PROVIDER_KEY_SERVICE,
  createProviderKeyStore,
};
