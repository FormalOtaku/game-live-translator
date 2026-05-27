'use strict';

const crypto = require('node:crypto');

const { ContractError } = require('../contracts/security');

const DEFAULT_CONFIDENCE_FLOOR = 0.6;
const DEFAULT_DUPLICATE_TTL_MS = 4000;
const DEFAULT_DUPLICATE_MAX_ENTRIES = 256;

const OCR_REJECTION_REASONS = Object.freeze({
  EMPTY_TEXT: 'EMPTY_TEXT',
  CONFIDENCE_TOO_LOW: 'CONFIDENCE_TOO_LOW',
  NOISE_TEXT: 'NOISE_TEXT',
  DUPLICATE_TEXT: 'DUPLICATE_TEXT',
});

const CONTROL_AND_ZERO_WIDTH = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;
const MEANINGFUL_TEXT = /[\p{L}\p{N}]/u;
const HASH_HEX = /^[a-f0-9]{64}$/u;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeOcrText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKC')
    .replace(CONTROL_AND_ZERO_WIDTH, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hashNormalizedText(normalizedText) {
  return crypto
    .createHash('sha256')
    .update(String(normalizedText), 'utf8')
    .digest('hex');
}

function normalizeConfidence(value) {
  if (!isFiniteNumber(value) || value < 0 || value > 1) return 0;
  return value;
}

function normalizeConfidenceFloor(value) {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    return DEFAULT_CONFIDENCE_FLOOR;
  }
  return value;
}

function normalizeDurationMs(value) {
  if (!isFiniteNumber(value) || value < 0) return 0;
  return value;
}

function buildResult({ text, normalizedText, confidence, durationMs, accepted, rejectionReason }) {
  const result = {
    text,
    normalizedText,
    confidence,
    durationMs,
    accepted,
  };
  if (rejectionReason !== undefined) result.rejectionReason = rejectionReason;
  return Object.freeze(result);
}

function evaluateOcrCandidate(candidate = {}, options = {}) {
  const rawText = typeof candidate.text === 'string' ? candidate.text : '';
  const normalizedText = normalizeOcrText(rawText);
  const confidence = normalizeConfidence(candidate.confidence);
  const confidenceFloor = normalizeConfidenceFloor(options.confidenceFloor);
  const durationMs = normalizeDurationMs(candidate.durationMs);

  if (normalizedText.length === 0) {
    return buildResult({
      text: rawText,
      normalizedText,
      confidence,
      durationMs,
      accepted: false,
      rejectionReason: OCR_REJECTION_REASONS.EMPTY_TEXT,
    });
  }

  if (confidence < confidenceFloor) {
    return buildResult({
      text: rawText,
      normalizedText,
      confidence,
      durationMs,
      accepted: false,
      rejectionReason: OCR_REJECTION_REASONS.CONFIDENCE_TOO_LOW,
    });
  }

  if (!MEANINGFUL_TEXT.test(normalizedText)) {
    return buildResult({
      text: rawText,
      normalizedText,
      confidence,
      durationMs,
      accepted: false,
      rejectionReason: OCR_REJECTION_REASONS.NOISE_TEXT,
    });
  }

  return buildResult({
    text: rawText,
    normalizedText,
    confidence,
    durationMs,
    accepted: true,
  });
}

function assertHash(hash) {
  if (typeof hash !== 'string' || !HASH_HEX.test(hash)) {
    throw new ContractError('VALIDATION_ERROR', 'DuplicateSuppressor requires a sha256 hex hash');
  }
}

class DuplicateSuppressor {
  constructor(options = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_DUPLICATE_TTL_MS;
    const maxEntries = options.maxEntries ?? DEFAULT_DUPLICATE_MAX_ENTRIES;
    if (!isFiniteNumber(ttlMs) || ttlMs <= 0) {
      throw new ContractError('VALIDATION_ERROR', 'ttlMs must be a positive finite number');
    }
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new ContractError('VALIDATION_ERROR', 'maxEntries must be a positive integer');
    }
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this._entries = new Map();
  }

  _prune(nowMs) {
    const now = normalizeDurationMs(nowMs);
    for (const [hash, firstSeenAt] of this._entries) {
      if (now - firstSeenAt >= this.ttlMs) {
        this._entries.delete(hash);
      }
    }
  }

  hasHash(hash, nowMs = Date.now()) {
    assertHash(hash);
    this._prune(nowMs);
    return this._entries.has(hash);
  }

  recordHash(hash, nowMs = Date.now()) {
    assertHash(hash);
    const firstSeenAt = normalizeDurationMs(nowMs);
    this._prune(firstSeenAt);
    if (this._entries.has(hash)) return false;
    this._entries.set(hash, firstSeenAt);
    while (this._entries.size > this.maxEntries) {
      const oldestHash = this._entries.keys().next().value;
      this._entries.delete(oldestHash);
    }
    return true;
  }

  entries(nowMs = Date.now()) {
    this._prune(nowMs);
    return [...this._entries.entries()].map(([hash, firstSeenAt]) => Object.freeze({
      hash,
      firstSeenAt,
    }));
  }

  snapshot(nowMs = Date.now()) {
    return Object.freeze({
      ttlMs: this.ttlMs,
      maxEntries: this.maxEntries,
      size: this.entries(nowMs).length,
      entries: Object.freeze(this.entries(nowMs)),
    });
  }

  clear() {
    this._entries.clear();
  }
}

function processOcrCandidate(candidate = {}, options = {}) {
  const evaluation = evaluateOcrCandidate(candidate, options);
  if (!evaluation.accepted) return evaluation;

  const duplicateSuppressor = options.duplicateSuppressor;
  if (duplicateSuppressor === undefined) {
    return evaluation;
  }
  if (!(duplicateSuppressor instanceof DuplicateSuppressor)) {
    throw new ContractError(
      'VALIDATION_ERROR',
      'duplicateSuppressor must be a DuplicateSuppressor instance',
    );
  }

  const nowMs = options.nowMs ?? Date.now();
  const hash = hashNormalizedText(evaluation.normalizedText);
  if (duplicateSuppressor.hasHash(hash, nowMs)) {
    return buildResult({
      text: evaluation.text,
      normalizedText: evaluation.normalizedText,
      confidence: evaluation.confidence,
      durationMs: evaluation.durationMs,
      accepted: false,
      rejectionReason: OCR_REJECTION_REASONS.DUPLICATE_TEXT,
    });
  }

  duplicateSuppressor.recordHash(hash, nowMs);
  return evaluation;
}

module.exports = {
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_DUPLICATE_TTL_MS,
  DEFAULT_DUPLICATE_MAX_ENTRIES,
  OCR_REJECTION_REASONS,
  normalizeOcrText,
  hashNormalizedText,
  evaluateOcrCandidate,
  DuplicateSuppressor,
  processOcrCandidate,
};
