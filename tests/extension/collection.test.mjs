import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationRegistry, deadlineFor, withDeadline} from '../../extension/lib/collection.js';

function sessionArea(seed = {}) {
  const values = structuredClone(seed);
  return {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, structuredClone(values[key])])); },
    async set(next) { Object.assign(values, structuredClone(next)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    values,
  };
}

test('operation epochs reject stale writes and cancellation closes owned tabs', async () => {
  const session = sessionArea();
  const removed = [];
  const registry = createOperationRegistry({session, tabs: {remove: async id => removed.push(id)}});
  await registry.reconcile();
  const operation = await registry.start('ssi', 'manual');
  await registry.ownTab(operation, 17);
  assert.equal(await registry.canWrite(operation), true);
  await registry.cancelAll();
  assert.equal(await registry.canWrite(operation), false);
  assert.deepEqual(removed, [17]);
});

test('startup reconciliation closes orphaned extension-owned tabs', async () => {
  const session = sessionArea({_se_collectionEpoch: 4, _se_ownedTemporaryTabs: [{tabId: 9, epoch: 3, operationId: 'old'}]});
  const removed = [];
  const registry = createOperationRegistry({session, tabs: {remove: async id => removed.push(id)}});
  await registry.reconcile();
  assert.deepEqual(removed, [9]);
  assert.deepEqual(session.values._se_ownedTemporaryTabs, []);
});

test('nested deadlines never exceed the whole-operation deadline', async () => {
  assert.equal(deadlineFor(1000, 20_000, 16_000), 16_000);
  await assert.rejects(withDeadline(new Promise(() => {}), 5, 'timeout'), error => error.code === 'timeout');
});
