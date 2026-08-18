import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOperationRegistry, withOwnedTemporaryTab} from '../../../extension/lib/collection.js';
import {
  getServiceWorker, inspectStorage, interceptLinkedIn, launchExtension, snapshotTabs,
} from '../helpers/chrome-extension.mjs';
import {FIXTURE_ACCOUNT, createFixtureRouter} from '../fixtures/server.mjs';

function event() {
  const listeners = new Set();
  return {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].forEach(fn => fn(...args))};
}

function sessionArea() {
  const values = {};
  return {async get(keys) { return Object.fromEntries(keys.filter(key => key in values).map(key => [key, structuredClone(values[key])])); }, async set(next) { Object.assign(values, structuredClone(next)); }, async remove(keys) { keys.forEach(key => delete values[key]); }, values};
}

test('rendered collection creates exactly one inactive owned tab and closes it in finally', async () => {
  const session = sessionArea();
  const calls = [];
  const tabs = {
    onUpdated: event(), onRemoved: event(),
    async create(options) { calls.push(['create', options]); return {id: 41, active: false}; },
    async get() { return {id: 41, status: 'complete'}; },
    async remove(id) { calls.push(['remove', id]); },
  };
  const registry = createOperationRegistry({session, tabs});
  await registry.reconcile();
  const operation = await registry.start('jobs', 'manual');
  const result = await withOwnedTemporaryTab({registry, tabs, operation, url: 'https://www.linkedin.com/jobs/collections/recommended/', collect: async tabId => ({tabId})});
  assert.deepEqual(result, {tabId: 41});
  assert.deepEqual(calls, [['create', {url: 'https://www.linkedin.com/jobs/collections/recommended/', active: false}], ['remove', 41]]);
  assert.deepEqual(session.values._se_ownedTemporaryTabs, []);
});

test('manual closure reports context_closed and never adopts a user tab', async () => {
  const session = sessionArea();
  const tabs = {
    onUpdated: event(), onRemoved: event(),
    async create() { return {id: 42, active: false}; },
    async get() { setTimeout(() => tabs.onRemoved.emit(42), 0); return {id: 42, status: 'loading'}; }, async remove() {},
  };
  const registry = createOperationRegistry({session, tabs});
  await registry.reconcile();
  const operation = await registry.start('jobs', 'manual');
  await assert.rejects(withOwnedTemporaryTab({registry, tabs, operation, url: 'https://www.linkedin.com/jobs/', collect: async () => ({})}), error => error.code === 'context_closed');
});

test('closure during parsing cancels the owned collection context', async () => {
  const session = sessionArea();
  const tabs = {
    onUpdated: event(), onRemoved: event(),
    async create() { return {id: 43, active: false}; },
    async get() { return {id: 43, status: 'complete'}; }, async remove() {},
  };
  const registry = createOperationRegistry({session, tabs});
  await registry.reconcile();
  const operation = await registry.start('jobs', 'manual');
  await assert.rejects(withOwnedTemporaryTab({
    registry, tabs, operation, url: 'https://www.linkedin.com/jobs/',
    collect: async () => { setTimeout(() => tabs.onRemoved.emit(43), 0); return new Promise(() => {}); },
  }), error => error.code === 'context_closed');
});

test('collector source never updates, scrolls, focuses, or restores arbitrary tabs', async () => {
  const source = `${await readFile('extension/background.js', 'utf8')}\n${await readFile('extension/lib/collection.js', 'utf8')}`;
  assert.doesNotMatch(source, /chrome\.tabs\.update|\.focus\(|tabs\[0\]/);
  const existingPath = source.split('if (feature !== \'jobs\') {')[1].split('if (!result)')[0];
  assert.doesNotMatch(existingPath, /renderedFallback: true|scrapeProfileTips|scrapeJobs|scrollTo/);
  assert.match(source, /active: false/);
  assert.match(source, /withOwnedTemporaryTab/);
  assert.match(source, /REQUEST_TIMEOUT_MS/);
});

test('real SSI collection against an open LinkedIn tab preserves unrelated and LinkedIn tab state and retains no raw payload', {timeout: 30_000}, async t => {
  const context = await launchExtension();
  t.after(context.cleanup);

  const unrelated = await context.browser.newPage();
  await unrelated.goto('data:text/html,<input name="note"><div style="height:2000px"></div>');
  await unrelated.evaluate(() => { document.querySelector('input').value = 'do-not-touch'; window.scrollTo(0, 500); });

  const linkedin = await context.browser.newPage();
  const router = createFixtureRouter();
  await interceptLinkedIn(linkedin, request => router.route(request));
  await linkedin.goto('https://www.linkedin.com/sales/ssi', {waitUntil: 'load'});
  await linkedin.evaluate(() => { document.querySelector('input[name="preserved"]').value = 'still-here'; window.scrollTo(0, 400); });

  const before = await snapshotTabs(context.browser);

  const panel = await context.browser.newPage();
  await panel.goto(`chrome-extension://${context.extensionId}/popup.html`);
  const envelope = await panel.evaluate(() => chrome.runtime.sendMessage({action: 'fetchNow'}));
  assert.equal(envelope?.ok, true, JSON.stringify(envelope));

  const after = await snapshotTabs(context.browser);
  const findTab = (snapshots, url) => snapshots.find(tab => tab.url === url);
  // Opening the extension's own side panel shifts OS/browser window focus, so
  // `active` (document.hasFocus()) is compared separately from the content
  // state that must never change: URL, scroll position, and typed form values.
  const contentState = tab => ({url: tab.url, scrollX: tab.scrollX, scrollY: tab.scrollY, forms: tab.forms});
  assert.deepEqual(contentState(findTab(after, unrelated.url())), contentState(findTab(before, unrelated.url())));
  assert.deepEqual(contentState(findTab(after, 'https://www.linkedin.com/sales/ssi')), contentState(findTab(before, 'https://www.linkedin.com/sales/ssi')));

  const worker = await getServiceWorker(context.browser, context.extensionId);
  const local = await inspectStorage(worker, 'local');
  assert.equal(local.ssiHistory?.[0]?.accountBinding, FIXTURE_ACCOUNT);
  assert.doesNotMatch(JSON.stringify(local), /rawSecret|must never persist/);
});

test('withOwnedTemporaryTab invokes onCreated before waiting for the tab to load', async () => {
  // Regression test: header capture must be registered while the tab is still
  // loading, because the site's own organic API calls (carrying the
  // csrf-token our own requests need) fire during load, not after. Capture
  // registered only once collect() runs (i.e. after the load wait) misses
  // that window entirely — this was a real bug where every LinkedIn request
  // failed with a false "session expired" because no csrf-token was ever
  // captured in time to reuse.
  const session = sessionArea();
  const calls = [];
  const tabs = {
    onUpdated: event(), onRemoved: event(),
    async create() { calls.push('create'); return {id: 99, active: false}; },
    async get() { calls.push('get'); return {id: 99, status: 'complete'}; },
    async remove() { calls.push('remove'); },
  };
  const registry = createOperationRegistry({session, tabs});
  await registry.reconcile();
  const operation = await registry.start('ssi', 'manual');
  let onCreatedTabId = null;
  const result = await withOwnedTemporaryTab({
    registry, tabs, operation, url: 'https://www.linkedin.com/sales/ssi',
    onCreated: tabId => { onCreatedTabId = tabId; calls.push('onCreated'); },
    collect: async tabId => ({tabId}),
  });
  assert.equal(onCreatedTabId, 99);
  assert.deepEqual(result, {tabId: 99});
  assert.deepEqual(calls, ['create', 'onCreated', 'get', 'remove']);
});
