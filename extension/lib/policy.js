import {CONSENT_VERSION} from './messages.js';
import {disabledAutomaticRefresh} from './storage.js';

export const CONTEXT_SCHEMA_VERSION = 1;
export const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
// x-li-identity, x-li-page-instance, and x-li-track were observed as sent by
// LinkedIn's own Sales Navigator frontend alongside csrf-token; none are
// session credentials or cookies. x-li-identity is an opaque per-member
// correlation token; the other two are page/client telemetry LinkedIn's own
// requests already include.
export const ALLOWED_HEADERS = Object.freeze([
  'accept', 'csrf-token', 'x-li-lang', 'x-restli-protocol-version',
  'x-li-identity', 'x-li-page-instance', 'x-li-track',
]);
export const FEATURES = Object.freeze(['ssi', 'analytics', 'profileTips', 'jobs']);

const allowedHeaderSet = new Set(ALLOWED_HEADERS);
const isPlainObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const validBinding = value => typeof value === 'string' && value.length >= 1 &&
  value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);

export function captureAllowedHeaders(requestHeaders = []) {
  const headers = {};
  for (const item of requestHeaders) {
    const name = typeof item?.name === 'string' ? item.name.toLowerCase() : '';
    if (allowedHeaderSet.has(name) && typeof item.value === 'string' && item.value.length <= 2048) {
      headers[name] = item.value;
    }
  }
  return headers;
}

function validHeaders(headers) {
  if (!isPlainObject(headers) || Object.keys(headers).length === 0) return false;
  return Object.entries(headers).every(([name, value]) =>
    allowedHeaderSet.has(name) && typeof value === 'string' && value.length > 0 && value.length <= 2048);
}

function validScope(scope) {
  return Array.isArray(scope) && scope.length > 0 && new Set(scope).size === scope.length &&
    scope.every(feature => FEATURES.includes(feature));
}

export function createRequestContext({
  headers,
  capturedAt = Date.now(),
  accountBinding,
  authorizedBy = 'manual',
  featureScope = ['ssi'],
}) {
  if (!validBinding(accountBinding)) throw Object.assign(new Error('account_unverified'), {code: 'account_unverified'});
  if (!validHeaders(headers) || !Number.isFinite(capturedAt) ||
      !['manual', 'automatic'].includes(authorizedBy) || !validScope(featureScope)) {
    throw Object.assign(new Error('invalid_request_context'), {code: 'invalid_request'});
  }
  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    headers: structuredClone(headers),
    capturedAt,
    expiresAt: capturedAt + CONTEXT_TTL_MS,
    accountBinding,
    authorizedBy,
    featureScope: [...featureScope],
  };
}

export function validateRequestContext(context, {now = Date.now(), accountBinding, feature} = {}) {
  if (!isPlainObject(context) || context.schemaVersion !== CONTEXT_SCHEMA_VERSION ||
      !validHeaders(context.headers) || !Number.isFinite(context.capturedAt) ||
      !Number.isFinite(context.expiresAt) || context.expiresAt <= context.capturedAt ||
      context.expiresAt - context.capturedAt > CONTEXT_TTL_MS || context.capturedAt > now + 60_000 ||
      !validBinding(context.accountBinding) || !['manual', 'automatic'].includes(context.authorizedBy) ||
      !validScope(context.featureScope)) {
    return {ok: false, error: 'invalid_request'};
  }
  if (now >= context.expiresAt) return {ok: false, error: 'session_expired'};
  if (!validBinding(accountBinding)) return {ok: false, error: 'account_unverified'};
  if (context.accountBinding !== accountBinding) return {ok: false, error: 'account_changed'};
  if (!FEATURES.includes(feature) || !context.featureScope.includes(feature)) return {ok: false, error: 'not_authorized'};
  return {ok: true, value: structuredClone(context)};
}

export function validateAutomaticRefresh(preference) {
  const valid = isPlainObject(preference) && preference.schemaVersion === 1 &&
    preference.enabled === true && Number.isFinite(preference.consentedAt) &&
    preference.consentedAt > 0 && preference.consentVersion === CONSENT_VERSION &&
    Array.isArray(preference.features) && preference.features.length === 1 && preference.features[0] === 'ssi';
  return valid ? structuredClone(preference) : disabledAutomaticRefresh();
}

export function createAutomaticRefresh(enabled, now = Date.now()) {
  return enabled ? {
    schemaVersion: 1,
    enabled: true,
    features: ['ssi'],
    consentedAt: now,
    consentVersion: CONSENT_VERSION,
  } : disabledAutomaticRefresh();
}

export function evaluateAccountBinding(observed, current) {
  if (!validBinding(observed)) return {ok: false, error: 'account_unverified'};
  if (current == null) return {ok: true, state: 'connect'};
  if (!validBinding(current) || observed !== current) return {ok: false, error: 'account_changed'};
  return {ok: true, state: 'same'};
}

export function isVerifiedConnection(connection) {
  return isPlainObject(connection) && connection.schemaVersion === 1 &&
    connection.status === 'connected' && validBinding(connection.accountBinding) &&
    Number.isFinite(connection.verifiedAt);
}
