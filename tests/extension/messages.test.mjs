import test from 'node:test';
import assert from 'node:assert/strict';
import {
  failure,
  success,
  validateRequest,
  validateSender,
} from '../../extension/lib/messages.js';

test('accepts only the extension top-level UI sender', () => {
  const runtimeId = 'abc';
  assert.equal(validateSender({id: runtimeId, url: 'chrome-extension://abc/popup.html', origin: 'chrome-extension://abc', frameId: 0}, runtimeId).ok, true);
  for (const sender of [
    {},
    {id: 'other', url: 'chrome-extension://abc/popup.html', origin: 'chrome-extension://abc', frameId: 0},
    {id: runtimeId, url: 'https://www.linkedin.com/', origin: 'https://www.linkedin.com', frameId: 0},
    {id: runtimeId, tab: {id: 3}, url: 'chrome-extension://abc/popup.html', origin: 'chrome-extension://abc', frameId: 2},
  ]) assert.equal(validateSender(sender, runtimeId).ok, false);
  // Extension-page senders (side panel/popup) have no associated tab and some
  // browsers report frameId as undefined for them rather than 0 — must still pass.
  assert.equal(validateSender({id: runtimeId, url: 'chrome-extension://abc/popup.html', origin: 'chrome-extension://abc'}, runtimeId).ok, true);
});

test('validates exact action schemas and rejects removed relay actions', () => {
  assert.deepEqual(validateRequest({action: 'fetchNow'}), {ok: true, value: {action: 'fetchNow'}});
  assert.equal(validateRequest({action: 'fetchNow', data: {}}).ok, false);
  assert.equal(validateRequest({action: 'storeSSI', data: {}}).ok, false);
  assert.equal(validateRequest({action: 'captureHeaders', headers: {}}).ok, false);
  assert.equal(validateRequest({action: 'setAutomaticRefresh', enabled: true, consentVersion: 'privacy-v1', features: ['ssi']}).ok, true);
  assert.equal(validateRequest({action: 'clearLinkedInData', confirmed: false}).ok, false);
  assert.equal(validateRequest({action: 'updateQuestItem', itemId: 'x'.repeat(130), done: true}).ok, false);
});

test('normalizes success and safe error envelopes', () => {
  assert.deepEqual(success({value: 1}), {ok: true, data: {value: 1}});
  assert.deepEqual(failure('timeout'), {ok: false, error: {code: 'timeout', message: 'LinkedIn did not respond in time. Try again.', retryable: true}});
  assert.equal(JSON.stringify(failure('internal_error', new Error('secret stack'))).includes('secret'), false);
});
