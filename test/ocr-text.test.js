'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  OCR_REJECTION_REASONS,
  normalizeOcrText,
  hashNormalizedText,
  evaluateOcrCandidate,
  DuplicateSuppressor,
  processOcrCandidate,
} = require('../src/core/ocr-text');

test('normalizeOcrText folds width, strips control characters, and collapses whitespace', () => {
  const normalized = normalizeOcrText('　Ｈｅｌｌｏ\tｶﾀｶﾅ\n\u0007世界　');
  assert.equal(normalized, 'Hello カタカナ 世界');
  assert.equal(normalizeOcrText(normalized), normalized);
  assert.equal(normalizeOcrText(null), '');
});

test('hashNormalizedText is stable sha256 hex over normalized text', () => {
  const left = hashNormalizedText(normalizeOcrText('勇者　こんにちは'));
  const right = hashNormalizedText(normalizeOcrText('勇者 こんにちは'));
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test('evaluateOcrCandidate rejects empty text before confidence and noise checks', () => {
  const result = evaluateOcrCandidate({
    text: '  \n\t',
    confidence: 0,
    durationMs: 12,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, OCR_REJECTION_REASONS.EMPTY_TEXT);
  assert.equal(result.normalizedText, '');
});

test('evaluateOcrCandidate rejects low or invalid confidence', () => {
  const low = evaluateOcrCandidate({
    text: '勇者',
    confidence: 0.59,
    durationMs: 8,
  }, { confidenceFloor: 0.6 });
  assert.equal(low.accepted, false);
  assert.equal(low.rejectionReason, OCR_REJECTION_REASONS.CONFIDENCE_TOO_LOW);

  const invalid = evaluateOcrCandidate({
    text: '勇者',
    confidence: Number.NaN,
  });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.confidence, 0);
  assert.equal(invalid.rejectionReason, OCR_REJECTION_REASONS.CONFIDENCE_TOO_LOW);
});

test('evaluateOcrCandidate rejects punctuation-only noise', () => {
  const result = evaluateOcrCandidate({
    text: '・・・！？――',
    confidence: 0.95,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, OCR_REJECTION_REASONS.NOISE_TEXT);
});

test('evaluateOcrCandidate accepts meaningful Japanese text', () => {
  const result = evaluateOcrCandidate({
    text: '　勇者　こんにちは！ ',
    confidence: 0.91,
    durationMs: 44,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.normalizedText, '勇者 こんにちは!');
  assert.equal(result.confidence, 0.91);
  assert.equal(result.durationMs, 44);
  assert.equal('hash' in result, false);
  assert.equal('rejectionReason' in result, false);
});

test('evaluateOcrCandidate uses confidenceFloor only from trusted options', () => {
  const result = evaluateOcrCandidate({
    text: '勇者',
    confidence: 0.1,
    confidenceFloor: 0,
  }, { confidenceFloor: 0.6 });
  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, OCR_REJECTION_REASONS.CONFIDENCE_TOO_LOW);
});

test('processOcrCandidate suppresses duplicate normalized text within ttl', () => {
  const suppressor = new DuplicateSuppressor({ ttlMs: 1000 });
  const first = processOcrCandidate({
    text: '勇者　こんにちは',
    confidence: 0.8,
  }, { duplicateSuppressor: suppressor, nowMs: 100 });
  const second = processOcrCandidate({
    text: '勇者 こんにちは',
    confidence: 0.8,
  }, { duplicateSuppressor: suppressor, nowMs: 500 });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.rejectionReason, OCR_REJECTION_REASONS.DUPLICATE_TEXT);
  assert.equal(suppressor.snapshot(500).size, 1);
});

test('duplicate suppression ttl expiry allows the same normalized text again', () => {
  const suppressor = new DuplicateSuppressor({ ttlMs: 1000 });
  assert.equal(processOcrCandidate({
    text: '魔王が現れた',
    confidence: 0.9,
  }, { duplicateSuppressor: suppressor, nowMs: 100 }).accepted, true);
  assert.equal(processOcrCandidate({
    text: '魔王が現れた',
    confidence: 0.9,
  }, { duplicateSuppressor: suppressor, nowMs: 1099 }).rejectionReason, OCR_REJECTION_REASONS.DUPLICATE_TEXT);
  assert.equal(processOcrCandidate({
    text: '魔王が現れた',
    confidence: 0.9,
  }, { duplicateSuppressor: suppressor, nowMs: 1100 }).accepted, true);
});

test('DuplicateSuppressor snapshot and entries never expose raw OCR text', () => {
  const rawText = '秘密の村へようこそ';
  const suppressor = new DuplicateSuppressor({ ttlMs: 5000 });
  const result = processOcrCandidate({
    text: rawText,
    confidence: 0.95,
  }, { duplicateSuppressor: suppressor, nowMs: 200 });

  assert.equal(result.accepted, true);
  const serializedSnapshot = JSON.stringify(suppressor.snapshot(200));
  const serializedEntries = JSON.stringify(suppressor.entries(200));
  assert.equal(serializedSnapshot.includes(rawText), false);
  assert.equal(serializedSnapshot.includes(normalizeOcrText(rawText)), false);
  assert.equal(serializedEntries.includes(rawText), false);
  assert.deepEqual(Object.keys(suppressor.entries(200)[0]).sort(), ['firstSeenAt', 'hash']);
});

test('DuplicateSuppressor evicts oldest hashes when maxEntries is exceeded', () => {
  const suppressor = new DuplicateSuppressor({ ttlMs: 5000, maxEntries: 2 });
  const first = hashNormalizedText('first');
  const second = hashNormalizedText('second');
  const third = hashNormalizedText('third');

  assert.equal(suppressor.recordHash(first, 100), true);
  assert.equal(suppressor.recordHash(second, 200), true);
  assert.equal(suppressor.recordHash(third, 300), true);

  assert.equal(suppressor.hasHash(first, 300), false);
  assert.equal(suppressor.hasHash(second, 300), true);
  assert.equal(suppressor.hasHash(third, 300), true);
  assert.deepEqual(suppressor.entries(300).map((entry) => entry.hash), [second, third]);
});

test('processOcrCandidate rejects invalid duplicateSuppressor objects', () => {
  assert.throws(
    () => processOcrCandidate({
      text: '勇者',
      confidence: 0.9,
    }, { duplicateSuppressor: {} }),
    (error) => error.code === 'VALIDATION_ERROR',
  );
});
