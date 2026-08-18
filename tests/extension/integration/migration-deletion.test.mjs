import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_SCHEMA_VERSION,
  LINKEDIN_DATA_KEYS,
  createStorageAdapters,
  deleteLinkedInData,
  migrateStorage,
} from '../../../extension/lib/storage.js';

function area(seed = {}) {
  const values = structuredClone(seed);
  return {async get(keys) { if (keys == null) return structuredClone(values); return Object.fromEntries(keys.filter(key => key in values).map(key => [key, structuredClone(values[key])])); }, async set(next) { Object.assign(values, structuredClone(next)); }, async remove(keys) { keys.forEach(key => delete values[key]); }, values};
}

function seeded() {
  return Object.fromEntries([
    ['ssiExactHeaders', {headers: {accept: 'x'}, ts: 1}], ['ssiHistory', [{raw: {secret: 1}}]],
    ['liAnalytics', {debug: {secret: 1}}], ['liAnalyticsHistory', [{}]], ['dailyActivities', {'2026-01-01': {}}],
    ['_se_dailyQuest', {items: []}], ['_se_questHistory', []], ['_se_questSeen', '2026-01-01'],
    ['profileTips', {debug: {}}], ['jobSuggestions', {debug: {}}], ['_se_session', {token: 'secret'}],
    ['_se_autoRefresh', true], ['_se_linkedInConnection', {accountBinding: 'old'}], ['theme', 'night'], ['_se_onboardDone', true], ['unrelated', 7],
  ]);
}

test('complete legacy inventory migration is idempotent and preserves unrelated keys', async () => {
  const local = area(seeded());
  const session = area({_se_linkedInRequestContext: {headers: {accept: 'x'}}});
  const storage = createStorageAdapters({local, session});
  await migrateStorage(storage, 10);
  await migrateStorage(storage, 20);
  assert.equal(local.values._se_dataSchemaVersion.version, CURRENT_SCHEMA_VERSION);
  assert.equal(local.values._se_dataSchemaVersion.migratedAt, 10);
  assert.equal(local.values.theme, 'night');
  assert.equal(local.values._se_onboardDone, true);
  assert.equal(local.values.unrelated, 7);
  assert.equal(local.values._se_session, undefined);
  assert.equal(session.values._se_linkedInRequestContext, undefined);
});

test('clear and disconnect meet exact deletion matrix and five-second transaction budget', async () => {
  for (const disconnect of [false, true]) {
    for (let run = 0; run < 3; run += 1) {
      const local = area({...Object.fromEntries(LINKEDIN_DATA_KEYS.map(key => [key, {accountBinding: 'member-a'}])), _se_linkedInConnection: {accountBinding: 'member-a'}, _se_autoRefresh: {enabled: true}, theme: 'day', _se_onboardDone: true});
      const session = area({_se_linkedInRequestContext: {accountBinding: 'member-a'}});
      const storage = createStorageAdapters({local, session});
      const started = performance.now();
      await deleteLinkedInData(storage, {disconnect});
      assert.ok(performance.now() - started < 5_000);
      assert.equal(local.values.theme, 'day');
      assert.equal(local.values._se_onboardDone, true);
      assert.equal(local.values._se_autoRefresh.enabled, false);
      assert.equal(session.values._se_linkedInRequestContext, undefined);
      for (const key of LINKEDIN_DATA_KEYS) assert.equal(local.values[key], undefined);
    }
  }
});
