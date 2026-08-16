import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_KEYS,
  LINKEDIN_LOCAL_KEYS,
  createStorageAdapters,
  buildExport,
  migrateStorage,
  projectAnalytics,
  projectJobSuggestions,
  projectProfileTips,
  projectSSI,
  purgeForAccountChange,
  trimDailyHistory,
} from '../../extension/lib/storage.js';

function memoryArea(seed = {}) {
  const values = structuredClone(seed);
  return {
    async get(keys) {
      if (keys == null) return structuredClone(values);
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter(key => key in values).map(key => [key, structuredClone(values[key])]));
    },
    async set(items) { Object.assign(values, structuredClone(items)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
    values,
  };
}

test('storage adapters clone values and delete exact keys only', async () => {
  const local = memoryArea({theme: 'dark', ssiHistory: [{date: 'old'}], unrelated: 1});
  const session = memoryArea({_se_linkedInRequestContext: {headers: {accept: 'x'}}});
  const storage = createStorageAdapters({local, session});
  const result = await storage.local.getAll();
  result.ssiHistory[0].date = 'mutated';
  assert.equal(local.values.ssiHistory[0].date, 'old');
  await storage.local.remove(['ssiHistory']);
  assert.deepEqual(local.values, {theme: 'dark', unrelated: 1});
});

test('registry is exact and covers the supported legacy inventory', () => {
  assert.deepEqual(new Set(LINKEDIN_LOCAL_KEYS), new Set(['_se_autoRefresh', '_se_linkedInConnection', 'ssiHistory', 'liAnalytics', 'liAnalyticsHistory', 'dailyActivities', '_se_dailyQuest', '_se_questHistory', '_se_questSeen', 'profileTips', 'jobSuggestions']));
  assert.deepEqual(new Set(LEGACY_KEYS), new Set(['ssiExactHeaders', ...LINKEDIN_LOCAL_KEYS, '_se_session']));
});

test('migration deletes unbound legacy data and preserves unrelated preferences', async () => {
  const local = memoryArea({
    theme: 'light', _se_onboardDone: true, unrelated: {keep: true},
    ssiExactHeaders: {headers: {accept: 'x'}, ts: 1},
    ssiHistory: [{date: '2020-01-01', raw: {private: true}}],
    liAnalytics: {debug: {page: 'secret'}}, profileTips: {slug: 'person', debug: {}},
    jobSuggestions: {debug: {}}, _se_session: {token: 'secret'}, _se_autoRefresh: true,
  });
  const session = memoryArea({_se_linkedInRequestContext: {headers: {accept: 'x'}}});
  const storage = createStorageAdapters({local, session});
  await migrateStorage(storage, 100);
  assert.equal(local.values.theme, 'light');
  assert.equal(local.values._se_onboardDone, true);
  assert.deepEqual(local.values.unrelated, {keep: true});
  assert.equal(local.values.ssiHistory, undefined);
  assert.equal(local.values._se_session, undefined);
  assert.deepEqual(local.values._se_autoRefresh.enabled, false);
  assert.equal(local.values._se_dataSchemaVersion.version, CURRENT_SCHEMA_VERSION);
  await migrateStorage(storage, 200);
  assert.equal(local.values._se_dataSchemaVersion.migratedAt, 100);
});

test('account switch purges all bound data and disables consent', async () => {
  const local = memoryArea(Object.fromEntries(LINKEDIN_LOCAL_KEYS.map(key => [key, {accountBinding: 'old'}])));
  local.values.theme = 'dark';
  const session = memoryArea({_se_linkedInRequestContext: {accountBinding: 'old'}});
  const storage = createStorageAdapters({local, session});
  await purgeForAccountChange(storage, 300);
  assert.equal(local.values.theme, 'dark');
  assert.deepEqual(local.values._se_autoRefresh.enabled, false);
  assert.deepEqual(local.values._se_linkedInConnection, {schemaVersion: 1, status: 'verification_required', accountBinding: null, verifiedAt: null});
  assert.equal(session.values._se_linkedInRequestContext, undefined);
});

test('SSI and analytics projections require binding, enforce ranges, and omit raw input', () => {
  const raw = {
    memberScore: {overall: 51, subScores: [{score: 13}, {score: 12}, {score: 14}, {score: 12}]},
    groupScore: [], raw: {secret: true}, debug: {page: 'private'},
  };
  assert.throws(() => projectSSI(raw, '', 10, '2026-08-11'), /account_unverified/);
  const ssi = projectSSI(raw, 'member-a', 10, '2026-08-11');
  assert.equal(ssi.accountBinding, 'member-a');
  assert.equal(ssi.parsed.overall, 51);
  assert.equal(JSON.stringify(ssi).includes('secret'), false);
  assert.throws(() => projectSSI({memberScore: {overall: 101}}, 'member-a', 10, '2026-08-11'), /invalid_response/);

  const analytics = projectAnalytics({followers: 5, connections: 4, profileViews: 3, searchAppearances: 2, impressions: 1, engagements: 0, snippet: 'private'}, 'member-a', 10);
  assert.equal(analytics.network.followers, 5);
  assert.equal(JSON.stringify(analytics).includes('snippet'), false);
  assert.throws(() => projectAnalytics({followers: -1}, 'member-a', 10), /invalid_response/);
});

test('tips and jobs retain bounded user-visible fields and reject unsafe URLs', () => {
  const tips = projectProfileTips({sections: {headline: {status: 'complete', length: 80}}, tips: [{section: 'headline', text: 'Keep it concise'}], score: {total: 1, complete: 1, weak: 0, missing: 0, percentage: 100}, slug: 'person', debug: {html: '<p>'}}, 'member-a', 10, '2026-08-11');
  assert.equal(tips.sections.headline.status, 'complete');
  assert.equal(Object.hasOwn(tips, 'slug'), false);
  assert.equal(Object.hasOwn(tips, 'debug'), false);

  const jobs = projectJobSuggestions({jobs: [{id: '1', title: 'Engineer', company: 'Example', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/1', logoUrl: 'https://media.licdn.com/logo.png', postedTime: 'Today', remote: true}], debug: {links: []}}, 'member-a', 10, '2026-08-11');
  assert.equal(jobs.jobs.length, 1);
  assert.throws(() => projectJobSuggestions({jobs: [{id: '1', title: 'Bad', company: 'X', location: 'Y', url: 'javascript:alert(1)'}]}, 'member-a', 10, '2026-08-11'), /invalid_response/);
});

test('history is bounded to 365 and export v2 excludes bindings and internal state', () => {
  const history = Array.from({length: 370}, (_, index) => ({date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), collectedAt: index, accountBinding: 'member-a', parsed: {overall: 1}}));
  assert.equal(trimDailyHistory(history).length, 365);
  const exported = buildExport({ssiHistory: history.slice(0, 1), dailyActivities: {schemaVersion: 1, accountBinding: 'member-a', days: {}}, activityCatalog: {safe: true}});
  assert.equal(exported.schemaVersion, 2);
  assert.equal(JSON.stringify(exported).includes('member-a'), false);
  assert.equal(JSON.stringify(exported).includes('raw'), false);
});
