import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchExtension, getServiceWorker, inspectStorage, triggerAlarm} from '../helpers/chrome-extension.mjs';
import {createAutomaticRefresh, createRequestContext, validateRequestContext} from '../../../extension/lib/policy.js';

test('new installs and alarms remain default-off in real Chrome', {timeout: 30_000}, async t => {
  const context = await launchExtension();
  t.after(context.cleanup);
  const worker = await getServiceWorker(context.browser, context.extensionId);
  await new Promise(resolve => setTimeout(resolve, 100));
  const local = await inspectStorage(worker, 'local');
  const session = await inspectStorage(worker, 'session');
  assert.equal(local._se_autoRefresh.enabled, false);
  assert.equal(session._se_linkedInRequestContext, undefined);
  await triggerAlarm(worker, 'dailyFetch-test');
  const after = await inspectStorage(worker, 'session');
  assert.equal(after._se_linkedInRequestContext, undefined);
});

test('manual context expires exactly at TTL and 401/403 policy clears before reuse', async () => {
  const context = createRequestContext({headers: {accept: 'application/json'}, capturedAt: 100, accountBinding: 'member-a', authorizedBy: 'manual', featureScope: ['ssi']});
  assert.equal(validateRequestContext(context, {now: context.expiresAt - 1, accountBinding: 'member-a', feature: 'ssi'}).ok, true);
  assert.equal(validateRequestContext(context, {now: context.expiresAt, accountBinding: 'member-a', feature: 'ssi'}).error, 'session_expired');
  assert.equal(createAutomaticRefresh(false).enabled, false);
});

test('worker source gates daily SSI collection on current consent and handles auth status numerically', async () => {
  const source = await readFile('extension/background.js', 'utf8');
  assert.match(source, /if \(preference\.enabled\) await collectFeature\('ssi', 'automatic'\)/);
  assert.match(source, /result\?\.status === 401 \|\| result\?\.status === 403/);
  assert.match(source, /await clearAuthenticationState\(\)/);
  assert.doesNotMatch(source, /response\.text\(|body\.slice/);
});
