import test from 'node:test';
import assert from 'node:assert/strict';
import {isResponseEnvelope, validateRequest, validateSender} from '../../../extension/lib/messages.js';
import {getServiceWorker, inspectStorage, launchExtension} from '../helpers/chrome-extension.mjs';

test('forged page, extension, missing, and framed senders fail before dispatch', () => {
  const runtimeId = 'extension-id';
  const invalid = [
    {id: runtimeId, url: 'https://www.linkedin.com', origin: 'https://www.linkedin.com', frameId: 0},
    {id: 'foreign', url: 'chrome-extension://extension-id/popup.html', origin: 'chrome-extension://extension-id', frameId: 0},
    {id: runtimeId, tab: {id: 7}, url: 'chrome-extension://extension-id/popup.html', origin: 'chrome-extension://extension-id', frameId: 1},
    {id: runtimeId},
  ];
  invalid.forEach(sender => assert.equal(validateSender(sender, runtimeId).ok, false));
});

test('a tab-less extension-page sender (side panel/popup) is accepted even when frameId is not reported', () => {
  const runtimeId = 'extension-id';
  const valid = [
    {id: runtimeId, url: 'chrome-extension://extension-id/popup.html', origin: 'chrome-extension://extension-id', frameId: 0},
    {id: runtimeId, url: 'chrome-extension://extension-id/popup.html', origin: 'chrome-extension://extension-id', frameId: undefined},
    {id: runtimeId, url: 'chrome-extension://extension-id/popup.html', origin: 'chrome-extension://extension-id'},
  ];
  valid.forEach(sender => assert.equal(validateSender(sender, runtimeId).ok, true));
});

test('unknown fields, malformed values, and privileged relay actions are rejected', () => {
  for (const request of [
    {action: 'unknown'}, {action: 'fetchNow', extra: true}, {action: 'storeSSI', data: {}},
    {action: 'setAutomaticRefresh', enabled: true, consentVersion: 'old', features: ['ssi']},
    {action: 'clearLinkedInData', confirmed: 'true'}, {action: 'saveActivities', date: 'bad', pillar: 'prof_brand', values: []},
  ]) assert.equal(validateRequest(request).ok, false);
});

test('response schemas reject leaks and unknown fields', () => {
  assert.equal(isResponseEnvelope({ok: true, data: {}}), true);
  assert.equal(isResponseEnvelope({ok: true, data: {}, headers: {cookie: 'secret'}}), false);
  assert.equal(isResponseEnvelope({ok: false, error: {code: 'timeout', message: 'safe', retryable: true}}), true);
  assert.equal(isResponseEnvelope({ok: false, error: {code: 'timeout', message: 'safe', retryable: true, stack: 'secret'}}), false);
});

test('real extension page receives normalized envelopes and clear preserves preferences', {timeout: 30_000}, async t => {
  const context = await launchExtension();
  t.after(context.cleanup);
  const worker = await getServiceWorker(context.browser, context.extensionId);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      theme: 'day', _se_onboardDone: true,
      _se_linkedInConnection: {schemaVersion: 1, status: 'connected', accountBinding: 'member-a', verifiedAt: Date.now()},
      _se_autoRefresh: {schemaVersion: 1, enabled: true, features: ['ssi'], consentedAt: Date.now(), consentVersion: 'privacy-v1'},
      ssiHistory: [{date: '2026-08-11', collectedAt: Date.now(), accountBinding: 'member-a', parsed: {overall: 50}}],
    });
    await chrome.storage.session.set({_se_linkedInRequestContext: {schemaVersion: 1, headers: {accept: 'x'}, capturedAt: Date.now(), expiresAt: Date.now() + 1000, accountBinding: 'member-a', authorizedBy: 'manual', featureScope: ['ssi']}});
  });
  const page = await context.browser.newPage();
  await page.goto(`chrome-extension://${context.extensionId}/popup.html`);
  const envelope = await page.evaluate(() => chrome.runtime.sendMessage({action: 'getPrivacySettings'}));
  assert.equal(envelope.ok, true);
  await page.evaluate(() => { window.confirm = () => true; });
  // Clear LinkedIn Data lives in the Support/About screen, which is closed
  // (display:none) until opened — matching the real user flow.
  await page.click('#brand-btn');
  await page.waitForSelector('#clear-linkedin-data', {visible: true});
  const started = performance.now();
  await page.click('#clear-linkedin-data');
  await page.waitForFunction(() => document.querySelector('#privacy-status')?.textContent === 'LinkedIn data cleared.');
  assert.ok(performance.now() - started < 30_000);
  const local = await inspectStorage(worker, 'local');
  const session = await inspectStorage(worker, 'session');
  assert.equal(local.theme, 'day');
  assert.equal(local._se_onboardDone, true);
  assert.equal(local.ssiHistory, undefined);
  assert.equal(local._se_autoRefresh.enabled, false);
  assert.equal(session._se_linkedInRequestContext, undefined);
});
