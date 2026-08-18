import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_TTL_MS,
  captureAllowedHeaders,
  createRequestContext,
  evaluateAccountBinding,
  validateAutomaticRefresh,
  validateRequestContext,
} from '../../extension/lib/policy.js';

test('captures only approved non-cookie request headers', () => {
  assert.deepEqual(captureAllowedHeaders([
    {name: 'Accept', value: 'application/json'},
    {name: 'CSRF-Token', value: 'ajax:1'},
    {name: 'Cookie', value: 'JSESSIONID=secret'},
    {name: 'Authorization', value: 'secret'},
    {name: 'X-LI-Lang', value: 'en_US'},
    {name: 'X-Restli-Protocol-Version', value: '2.0.0'},
    {name: 'X-Other', value: 'no'},
  ]), {accept: 'application/json', 'csrf-token': 'ajax:1', 'x-li-lang': 'en_US', 'x-restli-protocol-version': '2.0.0'});
});

test('requires verified binding and enforces the 24 hour TTL boundary', () => {
  const now = 1_000_000;
  assert.throws(() => createRequestContext({headers: {accept: 'x'}, capturedAt: now, accountBinding: ''}), /account_unverified/);
  const context = createRequestContext({headers: {accept: 'x'}, capturedAt: now, accountBinding: 'member-a', authorizedBy: 'manual', featureScope: ['ssi']});
  assert.equal(context.expiresAt, now + CONTEXT_TTL_MS);
  assert.equal(validateRequestContext(context, {now: context.expiresAt - 1, accountBinding: 'member-a', feature: 'ssi'}).ok, true);
  assert.equal(validateRequestContext(context, {now: context.expiresAt, accountBinding: 'member-a', feature: 'ssi'}).error, 'session_expired');
  assert.equal(validateRequestContext({...context, headers: {...context.headers, cookie: 'secret'}}, {now, accountBinding: 'member-a', feature: 'ssi'}).ok, false);
  assert.equal(validateRequestContext({...context, capturedAt: Number.NaN}, {now, accountBinding: 'member-a', feature: 'ssi'}).ok, false);
});

test('accepts only current SSI-only automatic refresh consent', () => {
  assert.equal(validateAutomaticRefresh(undefined).enabled, false);
  assert.equal(validateAutomaticRefresh(true).enabled, false);
  assert.equal(validateAutomaticRefresh({schemaVersion: 1, enabled: true, features: ['ssi'], consentedAt: 10, consentVersion: 'privacy-v1'}).enabled, true);
  assert.equal(validateAutomaticRefresh({schemaVersion: 1, enabled: true, features: ['ssi'], consentedAt: 10, consentVersion: 'old'}).enabled, false);
  assert.equal(validateAutomaticRefresh({schemaVersion: 1, enabled: true, features: ['analytics'], consentedAt: 10, consentVersion: 'privacy-v1'}).enabled, false);
});

test('fails closed when account identity is unavailable or changes', () => {
  assert.deepEqual(evaluateAccountBinding(null, null), {ok: false, error: 'account_unverified'});
  assert.deepEqual(evaluateAccountBinding('member-a', null), {ok: true, state: 'connect'});
  assert.deepEqual(evaluateAccountBinding('member-a', 'member-a'), {ok: true, state: 'same'});
  assert.deepEqual(evaluateAccountBinding('member-b', 'member-a'), {ok: false, error: 'account_changed'});
});
