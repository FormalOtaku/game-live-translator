'use strict';

const { ContractError, escapeHtml } = require('../contracts/security');

const DEFAULT_DISPLAY_MS = 7000;
const DEFAULT_THEME_ID = 'classic_subtitle';
const CONTROL_AND_FORMAT_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fieldError(field, code, message) {
  return { field, code, message };
}

function throwValidation(fieldErrors) {
  if (fieldErrors.length === 0) return;
  throw new ContractError('VALIDATION_ERROR', 'Subtitle frame validation failed', {
    fieldErrors,
  });
}

function normalizeSubtitleText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKC')
    .replace(CONTROL_AND_FORMAT_CHARS, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeRequiredId(value, field) {
  if (typeof value !== 'string') {
    return { value: '', error: fieldError(field, 'FIELD_REQUIRED', `${field} must be a non-empty string`) };
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) {
    return { value: '', error: fieldError(field, 'FIELD_REQUIRED', `${field} must be a non-empty string`) };
  }
  return { value: normalized };
}

function timestampFromValue(value, field) {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) return { value: value.toISOString() };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value: new Date(value).toISOString() };
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return { value: new Date(value).toISOString() };
  }
  return { value: '', error: fieldError(field, 'TIMESTAMP_INVALID', `${field} must be a valid timestamp`) };
}

function nowIso(clock) {
  if (typeof clock === 'function') {
    const fromClock = timestampFromValue(clock(), 'createdAt');
    if (fromClock.error === undefined) return fromClock.value;
  }
  return new Date().toISOString();
}

function generateId(idFactory, createdAt) {
  if (typeof idFactory === 'function') {
    const id = idFactory();
    if (typeof id === 'string' && id.trim() !== '') return id.trim();
  }
  const timestamp = Date.parse(createdAt);
  const seed = Number.isFinite(timestamp) ? timestamp : Date.now();
  return `subtitle_${seed.toString(36)}`;
}

function normalizeDisplayMs(value) {
  const displayMs = value ?? DEFAULT_DISPLAY_MS;
  if (!isFiniteNumber(displayMs) || displayMs <= 0) {
    return {
      value: DEFAULT_DISPLAY_MS,
      error: fieldError('displayMs', 'DISPLAY_MS_INVALID', 'displayMs must be a positive finite number'),
    };
  }
  return { value: displayMs };
}

function normalizeConfidence(value) {
  if (value === undefined) return { include: false };
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    return {
      include: false,
      error: fieldError('confidence', 'CONFIDENCE_INVALID', 'confidence must be between 0 and 1 inclusive'),
    };
  }
  return { include: true, value };
}

function createSubtitleFrame(input = {}, options = {}) {
  const fieldErrors = [];
  const createdAt = input.createdAt === undefined
    ? { value: nowIso(options.clock) }
    : timestampFromValue(input.createdAt, 'createdAt');
  const id = normalizeRequiredId(input.id ?? generateId(options.idFactory, createdAt.value), 'id');
  const profileId = normalizeRequiredId(input.profileId, 'profileId');
  const provider = normalizeRequiredId(input.provider, 'provider');
  const themeId = normalizeRequiredId(input.themeId ?? DEFAULT_THEME_ID, 'themeId');
  const displayMs = normalizeDisplayMs(input.displayMs);
  const confidence = normalizeConfidence(input.confidence);
  const translatedText = normalizeSubtitleText(input.translatedText);

  for (const result of [id, profileId, provider, themeId, displayMs, confidence, createdAt]) {
    if (result.error !== undefined) fieldErrors.push(result.error);
  }
  if (translatedText.length === 0) {
    fieldErrors.push(fieldError('translatedText', 'TRANSLATED_TEXT_EMPTY', 'translatedText is required'));
  }

  throwValidation(fieldErrors);

  const frame = {
    id: id.value,
    profileId: profileId.value,
    translatedText,
    escapedText: escapeHtml(translatedText),
    provider: provider.value,
    createdAt: createdAt.value,
    displayMs: displayMs.value,
    themeId: themeId.value,
  };

  const includeSourceText = input.includeSourceText === true || options.includeSourceText === true;
  const sourceText = normalizeSubtitleText(input.sourceText);
  if (includeSourceText && sourceText.length > 0) {
    frame.sourceText = sourceText;
  }
  if (confidence.include) {
    frame.confidence = confidence.value;
  }

  return Object.freeze(frame);
}

function sanitizeSubtitleForOverlay(frame, options = {}) {
  if (frame == null || typeof frame !== 'object' || Array.isArray(frame)) {
    throwValidation([fieldError('frame', 'SUBTITLE_FRAME_INVALID', 'frame must be an object')]);
  }

  const sanitized = createSubtitleFrame({
    id: frame.id,
    profileId: frame.profileId,
    translatedText: frame.translatedText,
    provider: frame.provider,
    confidence: frame.confidence,
    createdAt: frame.createdAt,
    displayMs: frame.displayMs,
    themeId: frame.themeId,
    sourceText: frame.sourceText,
    includeSourceText: options.includeSourceText === true,
  });

  const overlayFrame = {
    id: sanitized.id,
    profileId: sanitized.profileId,
    translatedText: sanitized.translatedText,
    escapedText: sanitized.escapedText,
    provider: sanitized.provider,
    createdAt: sanitized.createdAt,
    displayMs: sanitized.displayMs,
    themeId: sanitized.themeId,
  };
  if (sanitized.confidence !== undefined) overlayFrame.confidence = sanitized.confidence;
  if (sanitized.sourceText !== undefined) overlayFrame.sourceText = sanitized.sourceText;
  return Object.freeze(overlayFrame);
}

function frameExpiresAt(frame) {
  return Date.parse(frame.createdAt) + frame.displayMs;
}

function isFrameExpired(frame, nowMs) {
  if (frame == null) return true;
  const expiresAt = frameExpiresAt(frame);
  return !Number.isFinite(expiresAt) || nowMs >= expiresAt;
}

class OverlayState {
  constructor(options = {}) {
    this._clock = options.clock;
    this._latestFrame = null;
    this._overlayClients = 0;
    this._connectionsOpened = 0;
    this._connectionsClosed = 0;
    this._updatedAt = nowIso(this._clock);
  }

  _nowMs() {
    const timestamp = nowIso(this._clock);
    return Date.parse(timestamp);
  }

  _touch() {
    this._updatedAt = nowIso(this._clock);
  }

  publishFrame(frame) {
    this._latestFrame = sanitizeSubtitleForOverlay(frame);
    this._touch();
    return this.snapshot();
  }

  latestFrame() {
    if (this._latestFrame === null) return null;
    if (isFrameExpired(this._latestFrame, this._nowMs())) {
      this._latestFrame = null;
      this._touch();
      return null;
    }
    return this._latestFrame;
  }

  clearFrame() {
    this._latestFrame = null;
    this._touch();
    return this.snapshot();
  }

  connectClient() {
    this._overlayClients += 1;
    this._connectionsOpened += 1;
    this._touch();
    return this.snapshot();
  }

  disconnectClient() {
    if (this._overlayClients > 0) {
      this._overlayClients -= 1;
      this._connectionsClosed += 1;
    }
    this._touch();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      overlayClients: this._overlayClients,
      lastSubtitle: this.latestFrame(),
      updatedAt: this._updatedAt,
      connectionsOpened: this._connectionsOpened,
      connectionsClosed: this._connectionsClosed,
    });
  }
}

module.exports = {
  DEFAULT_DISPLAY_MS,
  DEFAULT_THEME_ID,
  normalizeSubtitleText,
  createSubtitleFrame,
  sanitizeSubtitleForOverlay,
  isFrameExpired,
  OverlayState,
};
