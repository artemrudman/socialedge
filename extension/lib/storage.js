export const CURRENT_SCHEMA_VERSION = 1;
export const REQUEST_CONTEXT_KEY = '_se_linkedInRequestContext';
export const SCHEMA_KEY = '_se_dataSchemaVersion';
export const AUTO_REFRESH_KEY = '_se_autoRefresh';
export const CONNECTION_KEY = '_se_linkedInConnection';

export const LINKEDIN_DATA_KEYS = Object.freeze([
  'ssiHistory', 'liAnalytics', 'liAnalyticsHistory', 'dailyActivities',
  '_se_dailyQuest', '_se_questHistory', '_se_questSeen', 'profileTips', 'jobSuggestions',
]);
export const LINKEDIN_LOCAL_KEYS = Object.freeze([
  AUTO_REFRESH_KEY, CONNECTION_KEY, ...LINKEDIN_DATA_KEYS,
]);
export const LEGACY_KEYS = Object.freeze(['ssiExactHeaders', ...LINKEDIN_LOCAL_KEYS, '_se_session']);

export const disabledAutomaticRefresh = () => ({
  schemaVersion: 1,
  enabled: false,
  features: [],
  consentedAt: null,
  consentVersion: null,
});

export const verificationRequiredConnection = () => ({
  schemaVersion: 1,
  status: 'verification_required',
  accountBinding: null,
  verifiedAt: null,
});

const clone = value => value === undefined ? undefined : structuredClone(value);

function wrapArea(area) {
  return {
    async get(keys) { return clone(await area.get(keys)); },
    async getAll() { return clone(await area.get(null)); },
    async set(values) { await area.set(clone(values)); },
    async remove(keys) { await area.remove([...new Set(Array.isArray(keys) ? keys : [keys])]); },
  };
}

export function createStorageAdapters(storage = globalThis.chrome?.storage) {
  if (!storage?.local || !storage?.session) throw new TypeError('local and session storage are required');
  return {local: wrapArea(storage.local), session: wrapArea(storage.session)};
}

export async function readOne(area, key) {
  const result = await area.get([key]);
  return result[key];
}

export async function migrateStorage(storage, now = Date.now()) {
  const marker = await readOne(storage.local, SCHEMA_KEY);
  if (marker?.version === CURRENT_SCHEMA_VERSION && Number.isFinite(marker.migratedAt)) return false;

  await storage.local.remove(LEGACY_KEYS);
  await storage.session.remove([REQUEST_CONTEXT_KEY]);
  await storage.local.set({
    [AUTO_REFRESH_KEY]: disabledAutomaticRefresh(),
    [SCHEMA_KEY]: {version: CURRENT_SCHEMA_VERSION, migratedAt: now},
  });
  return true;
}

export async function purgeForAccountChange(storage) {
  await storage.session.remove([REQUEST_CONTEXT_KEY]);
  await storage.local.remove(LINKEDIN_DATA_KEYS);
  await storage.local.set({
    [AUTO_REFRESH_KEY]: disabledAutomaticRefresh(),
    [CONNECTION_KEY]: verificationRequiredConnection(),
  });
}

export async function deleteLinkedInData(storage, {disconnect = false} = {}) {
  await storage.session.remove([REQUEST_CONTEXT_KEY]);
  await storage.local.remove([...LINKEDIN_DATA_KEYS, CONNECTION_KEY]);
  await storage.local.set({[AUTO_REFRESH_KEY]: disabledAutomaticRefresh()});
  if (!disconnect) await storage.local.remove([CONNECTION_KEY]);
  return ['credentials', 'ssi', 'analytics', 'activities', 'tips', 'jobs', 'identifiers'];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BINDING_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PILLARS = ['prof_brand', 'find_right_people', 'insight_engagement', 'relationship'];
const PROFILE_SECTIONS = new Set(['photo', 'headline', 'about', 'experience', 'education', 'skills', 'featured']);

function invalidResponse() {
  throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'});
}

function requireBinding(binding) {
  if (typeof binding !== 'string' || !BINDING_PATTERN.test(binding)) {
    throw Object.assign(new Error('account_unverified'), {code: 'account_unverified'});
  }
  return binding;
}

function requireTimestamp(value) {
  if (!Number.isFinite(value) || value < 0) invalidResponse();
  return Math.trunc(value);
}

function nullableNumber(value, minimum, maximum, {integer = false} = {}) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) invalidResponse();
  return value;
}

function boundedText(value, maximum, {required = false} = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') invalidResponse();
  const text = value.trim();
  if ((required && !text) || text.length > maximum) invalidResponse();
  return text;
}

function scorePillars(source = {}) {
  const subs = Array.isArray(source.subScores) ? source.subScores : [];
  return Object.fromEntries(PILLARS.map((pillar, index) => [pillar,
    nullableNumber(source[pillar] ?? subs[index]?.score, 0, 25)]));
}

function groupProjection(group = {}) {
  return {
    ssi: nullableNumber(group.ssi ?? group.score?.overall, 0, 100),
    top: nullableNumber(group.top ?? group.rank, 0, Number.MAX_SAFE_INTEGER, {integer: true}),
    people_amount: nullableNumber(group.people_amount ?? group.groupSize, 0, Number.MAX_SAFE_INTEGER, {integer: true}),
    name: boundedText(group.name ?? group.industry, 160),
    ...scorePillars(group.score ?? group),
  };
}

export function projectSSI(source, accountBinding, collectedAt = Date.now(), date) {
  requireBinding(accountBinding);
  if (!source || typeof source !== 'object' || !DATE_PATTERN.test(date)) invalidResponse();
  const member = source.memberScore ?? source.parsed ?? source;
  const groups = Array.isArray(source.groupScore) ? source.groupScore : [];
  const industry = source.industry ?? groups.find(group => group?.groupType === 'INDUSTRY') ?? {};
  const network = source.network ?? groups.find(group => group?.groupType === 'NETWORK') ?? {};
  return {
    date,
    collectedAt: requireTimestamp(collectedAt),
    accountBinding,
    parsed: {
      overall: nullableNumber(member.overall, 0, 100),
      ...scorePillars(member),
      industry: groupProjection(industry),
      network: groupProjection(network),
    },
  };
}

function countMetric(value) {
  return nullableNumber(value, 0, Number.MAX_SAFE_INTEGER, {integer: true});
}

export function projectAnalytics(source, accountBinding, collectedAt = Date.now()) {
  requireBinding(accountBinding);
  if (!source || typeof source !== 'object') invalidResponse();
  const timestamp = requireTimestamp(collectedAt);
  const flat = {
    followers: source.followers ?? source.network?.followers,
    connections: source.connections ?? source.network?.connections,
    profileViews: source.profileViews ?? source.dashboard?.profileViews,
    searchAppearances: source.searchAppearances ?? source.dashboard?.searchAppearances,
    impressions: source.impressions ?? source.content?.impressions,
    engagements: source.engagements ?? source.content?.engagements,
  };
  return {
    schemaVersion: 1,
    accountBinding,
    network: {collectedAt: timestamp, followers: countMetric(flat.followers), connections: countMetric(flat.connections)},
    dashboard: {collectedAt: timestamp, profileViews: countMetric(flat.profileViews), searchAppearances: countMetric(flat.searchAppearances)},
    content: {collectedAt: timestamp, impressions: countMetric(flat.impressions), engagements: countMetric(flat.engagements)},
  };
}

export function analyticsHistoryEntry(analytics, date) {
  if (!DATE_PATTERN.test(date) || !analytics?.accountBinding) invalidResponse();
  return {
    date,
    collectedAt: analytics.network.collectedAt,
    accountBinding: analytics.accountBinding,
    followers: analytics.network.followers,
    connections: analytics.network.connections,
    profileViews: analytics.dashboard.profileViews,
    searchAppearances: analytics.dashboard.searchAppearances,
    impressions: analytics.content.impressions,
    engagements: analytics.content.engagements,
  };
}

export function projectProfileTips(source, accountBinding, collectedAt = Date.now(), date) {
  requireBinding(accountBinding);
  if (!source || typeof source !== 'object' || !DATE_PATTERN.test(date)) invalidResponse();
  const sections = {};
  for (const [name, value] of Object.entries(source.sections ?? {})) {
    if (!PROFILE_SECTIONS.has(name) || !value || !['missing', 'weak', 'complete'].includes(value.status)) invalidResponse();
    sections[name] = {status: value.status};
    for (const field of ['count', 'length']) {
      if (value[field] != null) sections[name][field] = nullableNumber(value[field], 0, 100_000, {integer: true});
    }
  }
  const tips = (Array.isArray(source.tips) ? source.tips : []).slice(0, 10).map((tip, index) => {
    if (!tip || typeof tip !== 'object') invalidResponse();
    return {id: boundedText(tip.id ?? `tip-${index}`, 80, {required: true}), section: boundedText(tip.section, 40), text: boundedText(tip.text ?? tip.tip ?? tip.label, 500, {required: true})};
  });
  const scoreSource = source.score ?? {};
  const complete = nullableNumber(scoreSource.complete ?? Object.values(sections).filter(item => item.status === 'complete').length, 0, 100, {integer: true});
  const weak = nullableNumber(scoreSource.weak ?? Object.values(sections).filter(item => item.status === 'weak').length, 0, 100, {integer: true});
  const missing = nullableNumber(scoreSource.missing ?? Object.values(sections).filter(item => item.status === 'missing').length, 0, 100, {integer: true});
  const total = nullableNumber(scoreSource.total ?? complete + weak + missing, 0, 100, {integer: true});
  const percentage = nullableNumber(scoreSource.percentage ?? (total ? Math.round(complete / total * 100) : 0), 0, 100, {integer: true});
  if (complete + weak + missing !== total) invalidResponse();
  return {collectedAt: requireTimestamp(collectedAt), date, accountBinding, sections, tips, score: {total, complete, weak, missing, percentage}};
}

function safeUrl(value, {job = false, optional = false} = {}) {
  if (optional && !value) return '';
  let parsed;
  try { parsed = new URL(value); } catch { invalidResponse(); }
  if (parsed.protocol !== 'https:') invalidResponse();
  if (job && !(parsed.hostname === 'www.linkedin.com' && /^\/jobs\/view\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname))) invalidResponse();
  return parsed.href;
}

export function projectJobSuggestions(source, accountBinding, collectedAt = Date.now(), date) {
  requireBinding(accountBinding);
  if (!source || typeof source !== 'object' || !DATE_PATTERN.test(date) || !Array.isArray(source.jobs)) invalidResponse();
  const jobs = source.jobs.slice(0, 10).map(job => ({
    id: boundedText(job?.id, 128, {required: true}),
    title: boundedText(job?.title, 240, {required: true}),
    company: boundedText(job?.company, 240, {required: true}),
    location: boundedText(job?.location, 240),
    url: safeUrl(job?.url, {job: true}),
    logoUrl: safeUrl(job?.logoUrl, {optional: true}),
    postedTime: boundedText(job?.postedTime, 120),
    remote: Boolean(job?.remote ?? job?.isRemote),
  }));
  return {collectedAt: requireTimestamp(collectedAt), date, accountBinding, jobs};
}

export function trimDailyHistory(history, maximum = 365) {
  if (!Array.isArray(history)) return [];
  const byDate = new Map();
  for (const item of history) if (item && DATE_PATTERN.test(item.date)) byDate.set(item.date, structuredClone(item));
  return [...byDate.values()].sort((a, b) => (b.collectedAt ?? 0) - (a.collectedAt ?? 0)).slice(0, maximum);
}

export function buildExport({ssiHistory = [], dailyActivities = null, activityCatalog = {}} = {}) {
  const minimizedHistory = trimDailyHistory(ssiHistory).map(entry => ({date: entry.date, collectedAt: entry.collectedAt, parsed: structuredClone(entry.parsed)}));
  const activities = dailyActivities?.days ? {schemaVersion: 1, days: structuredClone(dailyActivities.days)} : null;
  return {schemaVersion: 2, exportedAt: Date.now(), ssiHistory: minimizedHistory, dailyActivities: activities, activityCatalog: structuredClone(activityCatalog)};
}

export function isBoundTo(record, accountBinding) {
  return Boolean(record && requireBinding(accountBinding) && record.accountBinding === accountBinding);
}
