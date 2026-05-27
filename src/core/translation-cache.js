'use strict';

const crypto = require('node:crypto');

const { ContractError } = require('../contracts/security');
const {
  ALLOWED_PROVIDERS,
  ALLOWED_TARGET_LANGS,
} = require('../contracts/validation');
const {
  hashNormalizedText,
  normalizeOcrText,
} = require('./ocr-text');

const CACHE_KEY_VERSION = 'v1';
const EMPTY_GLOSSARY_REVISION = '0'.repeat(64);
const HASH_HEX = /^[a-f0-9]{64}$/u;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hashJson(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function normalizeTargetTerm(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function fieldError(field, code, message) {
  return { field, code, message };
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function throwValidation(fieldErrors) {
  if (fieldErrors.length === 0) return;
  throw new ContractError('VALIDATION_ERROR', 'Glossary validation failed', {
    fieldErrors,
  });
}

function normalizeGlossaryTerms(terms = []) {
  if (!Array.isArray(terms)) {
    throwValidation([
      fieldError('glossary', 'GLOSSARY_INVALID', 'glossary must be an array'),
    ]);
  }

  const fieldErrors = [];
  const normalized = [];
  const seenSources = new Map();

  terms.forEach((term, index) => {
    if (!isObject(term)) {
      fieldErrors.push(fieldError(`glossary[${index}]`, 'GLOSSARY_TERM_INVALID', 'term must be an object'));
      return;
    }

    const sourceTerm = normalizeOcrText(term.sourceTerm);
    const targetTerm = normalizeTargetTerm(term.targetTerm);
    const id = typeof term.id === 'string' && term.id.trim() !== ''
      ? term.id.trim()
      : `term_${index + 1}`;

    if (sourceTerm.length === 0) {
      fieldErrors.push(fieldError(`glossary[${index}].sourceTerm`, 'GLOSSARY_SOURCE_EMPTY', 'sourceTerm is required'));
    }
    if (targetTerm.length === 0) {
      fieldErrors.push(fieldError(`glossary[${index}].targetTerm`, 'GLOSSARY_TARGET_EMPTY', 'targetTerm is required'));
    }

    if (sourceTerm.length > 0) {
      const firstIndex = seenSources.get(sourceTerm);
      if (firstIndex !== undefined) {
        fieldErrors.push(fieldError(
          `glossary[${index}].sourceTerm`,
          'GLOSSARY_SOURCE_DUPLICATE',
          `sourceTerm duplicates glossary[${firstIndex}].sourceTerm after normalization`,
        ));
      } else {
        seenSources.set(sourceTerm, index);
      }
    }

    normalized.push(Object.freeze({
      id,
      sourceTerm,
      targetTerm,
      sourceLength: sourceTerm.length,
    }));
  });

  throwValidation(fieldErrors);

  return Object.freeze([...normalized].sort((a, b) => {
    if (b.sourceLength !== a.sourceLength) return b.sourceLength - a.sourceLength;
    const sourceCompare = compareCodeUnits(a.sourceTerm, b.sourceTerm);
    if (sourceCompare !== 0) return sourceCompare;
    return compareCodeUnits(a.id, b.id);
  }));
}

function buildGlossaryRevisionFromNormalizedTerms(normalized) {
  if (normalized.length === 0) return EMPTY_GLOSSARY_REVISION;

  const canonicalPairs = normalized
    .map(({ sourceTerm, targetTerm }) => ({ sourceTerm, targetTerm }))
    .sort((a, b) => {
      const sourceCompare = compareCodeUnits(a.sourceTerm, b.sourceTerm);
      if (sourceCompare !== 0) return sourceCompare;
      return compareCodeUnits(a.targetTerm, b.targetTerm);
    });

  return hashJson(canonicalPairs);
}

function buildGlossaryRevision(terms = []) {
  return buildGlossaryRevisionFromNormalizedTerms(normalizeGlossaryTerms(terms));
}

function applyGlossary(sourceText, terms = []) {
  const normalizedText = normalizeOcrText(sourceText);
  const glossaryTerms = normalizeGlossaryTerms(terms);
  const glossaryRevision = buildGlossaryRevisionFromNormalizedTerms(glossaryTerms);

  if (normalizedText.length === 0 || glossaryTerms.length === 0) {
    return Object.freeze({
      sourceText: normalizedText,
      text: normalizedText,
      glossaryRevision,
      appliedTerms: Object.freeze([]),
    });
  }

  let cursor = 0;
  let output = '';
  const appliedTerms = [];

  while (cursor < normalizedText.length) {
    const match = glossaryTerms.find((term) => normalizedText.startsWith(term.sourceTerm, cursor));
    if (match) {
      output += match.targetTerm;
      appliedTerms.push(Object.freeze({
        id: match.id,
        sourceTerm: match.sourceTerm,
        targetTerm: match.targetTerm,
        index: cursor,
      }));
      cursor += match.sourceTerm.length;
    } else {
      output += normalizedText[cursor];
      cursor += 1;
    }
  }

  return Object.freeze({
    sourceText: normalizedText,
    text: output,
    glossaryRevision,
    appliedTerms: Object.freeze(appliedTerms),
  });
}

function assertControlledValue(field, value, allowed, code) {
  if (!allowed.includes(value)) {
    throw new ContractError('VALIDATION_ERROR', `${field} must be one of ${allowed.join(', ')}`, {
      fieldErrors: [
        fieldError(field, code, `${field} must be one of ${allowed.join(', ')}`),
      ],
    });
  }
}

function assertSha256Hex(field, value) {
  if (typeof value !== 'string' || !HASH_HEX.test(value)) {
    throw new ContractError('VALIDATION_ERROR', `${field} must be a sha256 hex digest`, {
      fieldErrors: [
        fieldError(field, 'HASH_INVALID', `${field} must be a sha256 hex digest`),
      ],
    });
  }
}

function buildTranslationCacheKey({
  provider,
  targetLang,
  normalizedSourceText,
  glossaryRevision = EMPTY_GLOSSARY_REVISION,
}) {
  assertControlledValue('provider', provider, ALLOWED_PROVIDERS, 'PROVIDER_UNKNOWN');
  assertControlledValue('targetLang', targetLang, ALLOWED_TARGET_LANGS, 'TARGET_LANG_INVALID');
  assertSha256Hex('glossaryRevision', glossaryRevision);

  const sourceText = normalizeOcrText(normalizedSourceText);
  const sourceTextHash = hashNormalizedText(sourceText);

  return `${CACHE_KEY_VERSION}:${provider}:${targetLang}:${glossaryRevision}:${sourceTextHash}`;
}

function prepareTranslationInput({
  text,
  glossary = [],
  provider,
  targetLang = 'en',
}) {
  const glossaryResult = applyGlossary(text, glossary);
  const cacheKey = buildTranslationCacheKey({
    provider,
    targetLang,
    normalizedSourceText: glossaryResult.sourceText,
    glossaryRevision: glossaryResult.glossaryRevision,
  });

  return Object.freeze({
    sourceText: glossaryResult.sourceText,
    provider,
    targetLang,
    glossaryAppliedText: glossaryResult.text,
    glossaryRevision: glossaryResult.glossaryRevision,
    appliedTerms: glossaryResult.appliedTerms,
    cacheKey,
  });
}

module.exports = {
  CACHE_KEY_VERSION,
  EMPTY_GLOSSARY_REVISION,
  normalizeTargetTerm,
  normalizeGlossaryTerms,
  buildGlossaryRevision,
  applyGlossary,
  buildTranslationCacheKey,
  prepareTranslationInput,
};
