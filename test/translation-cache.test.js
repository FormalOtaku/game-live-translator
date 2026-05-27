'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EMPTY_GLOSSARY_REVISION,
  normalizeTargetTerm,
  normalizeGlossaryTerms,
  buildGlossaryRevision,
  applyGlossary,
  buildTranslationCacheKey,
  prepareTranslationInput,
} = require('../src/core/translation-cache');

test('normalizeTargetTerm folds width and whitespace but preserves display text', () => {
  assert.equal(normalizeTargetTerm('　Ｄｒａｇｏｎ\tKing\n'), 'Dragon King');
  assert.equal(normalizeTargetTerm(null), '');
});

test('normalizeGlossaryTerms sorts longest source first and normalizes source terms', () => {
  const terms = normalizeGlossaryTerms([
    { id: 'short', sourceTerm: '魔王', targetTerm: 'Demon King' },
    { id: 'long', sourceTerm: '魔王城', targetTerm: 'Demon Castle' },
    { id: 'half', sourceTerm: 'ﾕｳｼｬ', targetTerm: 'Hero' },
  ]);

  assert.deepEqual(terms.map((term) => term.id), ['half', 'long', 'short']);
  assert.equal(terms[0].sourceTerm, 'ユウシャ');
});

test('normalizeGlossaryTerms uses deterministic code-unit tie breakers', () => {
  const terms = normalizeGlossaryTerms([
    { id: 'lord', sourceTerm: '魔王', targetTerm: 'Demon King' },
    { id: 'hero', sourceTerm: '勇者', targetTerm: 'Hero' },
    { id: 'hero_alt', sourceTerm: '勇者様', targetTerm: 'Honored Hero' },
  ]);

  assert.deepEqual(terms.map((term) => term.id), ['hero_alt', 'hero', 'lord']);
});

test('normalizeGlossaryTerms rejects empty and duplicate normalized sources', () => {
  assert.throws(
    () => normalizeGlossaryTerms([
      { id: 'a', sourceTerm: '勇者', targetTerm: 'Hero' },
      { id: 'b', sourceTerm: '　勇者　', targetTerm: 'Brave One' },
      { id: 'c', sourceTerm: '', targetTerm: '' },
    ]),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors.some((fieldError) => fieldError.code === 'GLOSSARY_SOURCE_DUPLICATE') &&
      error.details.fieldErrors.some((fieldError) => fieldError.code === 'GLOSSARY_SOURCE_EMPTY') &&
      error.details.fieldErrors.some((fieldError) => fieldError.code === 'GLOSSARY_TARGET_EMPTY'),
  );
});

test('applyGlossary replaces longest literal terms in a single non-cascading pass', () => {
  const result = applyGlossary('勇者は魔王城で魔王と会う', [
    { id: 'hero', sourceTerm: '勇者', targetTerm: 'Hero' },
    { id: 'lord', sourceTerm: '魔王', targetTerm: 'Demon King' },
    { id: 'castle', sourceTerm: '魔王城', targetTerm: 'Demon Castle' },
    { id: 'cascade', sourceTerm: 'Hero', targetTerm: 'Champion' },
  ]);

  assert.equal(result.sourceText, '勇者は魔王城で魔王と会う');
  assert.equal(result.text, 'HeroはDemon CastleでDemon Kingと会う');
  assert.deepEqual(result.appliedTerms.map((term) => term.id), ['hero', 'castle', 'lord']);
  assert.match(result.glossaryRevision, /^[a-f0-9]{64}$/);
});

test('buildGlossaryRevision is order and id independent but target sensitive', () => {
  const left = buildGlossaryRevision([
    { id: 'a1', sourceTerm: '勇者', targetTerm: 'Hero', note: 'ignored' },
    { id: 'b1', sourceTerm: '魔王', targetTerm: 'Demon King' },
  ]);
  const right = buildGlossaryRevision([
    { id: 'b2', sourceTerm: '魔王', targetTerm: 'Demon King' },
    { id: 'a2', sourceTerm: '勇者', targetTerm: 'Hero' },
  ]);
  const changed = buildGlossaryRevision([
    { id: 'a1', sourceTerm: '勇者', targetTerm: 'Champion' },
    { id: 'b1', sourceTerm: '魔王', targetTerm: 'Demon King' },
  ]);

  assert.equal(left, right);
  assert.notEqual(left, changed);
  assert.equal(buildGlossaryRevision([]), EMPTY_GLOSSARY_REVISION);
});

test('buildTranslationCacheKey includes controlled dimensions but never raw text', () => {
  const rawText = '勇者は魔王と会う';
  const glossaryRevision = buildGlossaryRevision([
    { id: 'hero', sourceTerm: '勇者', targetTerm: 'Hero' },
  ]);
  const key = buildTranslationCacheKey({
    provider: 'deepl',
    targetLang: 'en',
    normalizedSourceText: rawText,
    glossaryRevision,
  });

  assert.match(key, /^v1:deepl:en:[a-f0-9]{64}:[a-f0-9]{64}$/);
  assert.equal(key.includes(rawText), false);
  assert.equal(key.includes('Hero'), false);
});

test('buildTranslationCacheKey changes when provider or source text changes', () => {
  const glossaryRevision = buildGlossaryRevision([
    { id: 'hero', sourceTerm: '勇者', targetTerm: 'Hero' },
  ]);
  const base = buildTranslationCacheKey({
    provider: 'deepl',
    targetLang: 'en',
    normalizedSourceText: '勇者',
    glossaryRevision,
  });
  const differentProvider = buildTranslationCacheKey({
    provider: 'echo',
    targetLang: 'en',
    normalizedSourceText: '勇者',
    glossaryRevision,
  });
  const differentSource = buildTranslationCacheKey({
    provider: 'deepl',
    targetLang: 'en',
    normalizedSourceText: '魔王',
    glossaryRevision,
  });

  assert.notEqual(base, differentProvider);
  assert.notEqual(base, differentSource);
});

test('buildTranslationCacheKey rejects unknown provider, target language, and bad revisions', () => {
  assert.throws(
    () => buildTranslationCacheKey({
      provider: 'google',
      targetLang: 'en',
      normalizedSourceText: '勇者',
      glossaryRevision: EMPTY_GLOSSARY_REVISION,
    }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'PROVIDER_UNKNOWN',
  );
  assert.throws(
    () => buildTranslationCacheKey({
      provider: 'deepl',
      targetLang: 'ja',
      normalizedSourceText: '勇者',
      glossaryRevision: EMPTY_GLOSSARY_REVISION,
    }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details.fieldErrors[0].code === 'TARGET_LANG_INVALID',
  );
  assert.throws(
    () => buildTranslationCacheKey({
      provider: 'deepl',
      targetLang: 'en',
      normalizedSourceText: '勇者',
      glossaryRevision: 'not-a-hash',
    }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
});

test('prepareTranslationInput combines glossary application and cache key generation', () => {
  const prepared = prepareTranslationInput({
    text: '　勇者　と　魔王　',
    provider: 'echo',
    targetLang: 'en',
    glossary: [
      { id: 'hero', sourceTerm: '勇者', targetTerm: 'Hero' },
      { id: 'lord', sourceTerm: '魔王', targetTerm: 'Demon King' },
    ],
  });

  assert.equal(prepared.sourceText, '勇者 と 魔王');
  assert.equal(prepared.glossaryAppliedText, 'Hero と Demon King');
  assert.deepEqual(prepared.appliedTerms.map((term) => term.id), ['hero', 'lord']);
  assert.match(prepared.cacheKey, /^v1:echo:en:[a-f0-9]{64}:[a-f0-9]{64}$/);
  assert.equal(prepared.cacheKey.includes('勇者'), false);
  assert.equal(prepared.cacheKey.includes('Demon King'), false);
});
