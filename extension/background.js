// SOCIALEDGE_DEBUG_BUILD 2.1.11-analytics-scrape-fix
import {failure, success, validateRequest, validateSender} from './lib/messages.js';
import {
  AUTO_REFRESH_KEY,
  CONNECTION_KEY,
  REQUEST_CONTEXT_KEY,
  analyticsHistoryEntry,
  createStorageAdapters,
  deleteLinkedInData,
  disabledAutomaticRefresh,
  isBoundTo,
  migrateStorage,
  projectAnalytics,
  projectJobSuggestions,
  projectProfileTips,
  projectSSI,
  purgeForAccountChange,
  readOne,
  trimDailyHistory,
} from './lib/storage.js';
import {
  REQUEST_TIMEOUT_MS,
  createOperationRegistry,
  withDeadline,
  withOwnedTemporaryTab,
} from './lib/collection.js';
import {
  captureAllowedHeaders,
  createAutomaticRefresh,
  createRequestContext,
  evaluateAccountBinding,
  isVerifiedConnection,
  validateAutomaticRefresh,
  validateRequestContext,
} from './lib/policy.js';

const storage = createStorageAdapters(chrome.storage);
const operations = createOperationRegistry({session: storage.session, tabs: chrome.tabs});
const activeCaptures = new Map();

const HISTORY_KEY = 'ssiHistory';
const ANALYTICS_KEY = 'liAnalytics';
const ANALYTICS_HISTORY_KEY = 'liAnalyticsHistory';
const TIPS_KEY = 'profileTips';
const JOBS_KEY = 'jobSuggestions';
const ACTIVITIES_KEY = 'dailyActivities';
const QUEST_KEY = '_se_dailyQuest';
const QUEST_HISTORY_KEY = '_se_questHistory';
const QUEST_SEEN_KEY = '_se_questSeen';

const FEATURE_URLS = Object.freeze({
  ssi: 'https://www.linkedin.com/sales-api/salesApiSsi',
  analytics: 'https://www.linkedin.com/voyager/api/analytics',
  profileTips: 'https://www.linkedin.com/voyager/api/identity/profiles/me',
  jobs: 'https://www.linkedin.com/voyager/api/jobs/jobPostings',
});

const ALL_ACTIVITIES = Object.freeze({
  prof_brand: [
    {label: 'Publish an original post', difficulty: 2},
    {label: 'Update a profile section', difficulty: 1},
    {label: 'Add a quantified achievement', difficulty: 2},
  ],
  find_right_people: [
    {label: 'Find three relevant prospects', difficulty: 1},
    {label: 'Review a target company people list', difficulty: 1},
    {label: 'Ask for a warm introduction', difficulty: 2},
  ],
  insight_engagement: [
    {label: 'Leave a thoughtful comment', difficulty: 1},
    {label: 'Share an insight with context', difficulty: 2},
    {label: 'Reply to a conversation', difficulty: 1},
  ],
  relationship: [
    {label: 'Follow up with a new connection', difficulty: 1},
    {label: 'Reconnect with a dormant contact', difficulty: 2},
    {label: 'Introduce two useful contacts', difficulty: 3},
  ],
});

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function codedError(code) {
  return Object.assign(new Error(code), {code});
}

async function initialize() {
  try {
    await migrateStorage(storage);
    await operations.reconcile();
    await chrome.alarms.create('dailyQuest', {periodInMinutes: 1440});
    await chrome.alarms.create('dailyFetch', {periodInMinutes: 1440});
  } catch (error) {
    console.error('[SocialEdge] initialize failed', error?.name, error?.message);
    await storage.local.set({[AUTO_REFRESH_KEY]: disabledAutomaticRefresh()}).catch(() => {});
    throw codedError('migration_failed');
  }
}

let initialization = initialize();

chrome.runtime.onInstalled.addListener(() => {
  initialization = initialize();
});

chrome.action.onClicked.addListener(tab => {
  if (Number.isInteger(tab?.windowId)) chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {});
});

chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  const staged = activeCaptures.get(details.tabId);
  if (!staged || staged.operation.state === 'cancelled') return;
  const headers = captureAllowedHeaders(details.requestHeaders);
  if (Object.keys(headers).length) staged.headers = headers;
}, {urls: [
  'https://www.linkedin.com/sales-api/salesApiSsi*',
  'https://www.linkedin.com/sales-api/salesApiMe*',
  'https://www.linkedin.com/voyager/api/me*',
  'https://www.linkedin.com/voyager/api/analytics*',
  'https://www.linkedin.com/voyager/api/identity/profiles/*',
  'https://www.linkedin.com/voyager/api/jobs/*',
]}, ['requestHeaders', 'extraHeaders']);

async function clearAuthenticationState() {
  await storage.session.remove([REQUEST_CONTEXT_KEY]);
  await storage.local.remove([CONNECTION_KEY]);
}

async function executeJson(tabId, url, headers, operation) {
  const remaining = Math.max(0, operation.operationDeadline - performance.now());
  const timeout = Math.min(REQUEST_TIMEOUT_MS, remaining);
  if (timeout <= 0) throw codedError('timeout');
  const promise = chrome.scripting.executeScript({
    target: {tabId},
    func: async (requestUrl, requestHeaders, deadlineMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      try {
        const response = await fetch(requestUrl, {
          credentials: 'include',
          headers: requestHeaders,
          signal: controller.signal,
        });
        if (!response.ok) return {status: response.status};
        try { return {status: response.status, data: await response.json()}; }
        catch { return {status: response.status, invalid: true}; }
      } catch (error) {
        return {status: 0, timeout: error?.name === 'AbortError'};
      } finally {
        clearTimeout(timer);
      }
    },
    args: [url, headers, timeout],
  });
  const injected = await withDeadline(promise, timeout, 'timeout');
  const result = injected?.[0]?.result;
  if (result?.timeout) throw codedError('timeout');
  if (result?.status === 401 || result?.status === 403) {
    await clearAuthenticationState();
    throw codedError('session_expired');
  }
  if (!result || result.status === 0 || result.status >= 500) throw codedError('service_error');
  if (result.status < 200 || result.status >= 300) throw codedError('service_error');
  if (result.invalid || !result.data || typeof result.data !== 'object') throw codedError('invalid_response');
  return result.data;
}

function extractEntityUrnId(value) {
  // Real salesApiMe responses report entityUrn as e.g.
  // "urn:li:fs_salesProfile:(ACwAAA..., , )" — parens/commas/spaces make the
  // raw string fail the plain identifier check below, so pull out just the
  // opaque id segment.
  const match = typeof value === 'string' && value.match(/urn:li:fs_salesProfile:\(([A-Za-z0-9_-]+)/);
  return match?.[1];
}

function findAccountBinding(data) {
  const candidates = [
    data?.accountBinding,
    data?.plainId,
    data?.id,
    data?.vanityName,
    extractEntityUrnId(data?.entityUrn),
    data?.miniProfile?.entityUrn,
    data?.data?.plainId,
    data?.data?.id,
    data?.data?.vanityName,
    extractEntityUrnId(data?.data?.entityUrn),
    data?.data?.miniProfile?.entityUrn,
  ];
  const found = candidates.find(value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value));
  return found ?? null;
}

async function waitForStagedHeaders(tabId, maxWaitMs = 6000, stepMs = 150) {
  const deadline = performance.now() + maxWaitMs;
  while (performance.now() < deadline) {
    if (activeCaptures.get(tabId)?.headers) return;
    await new Promise(resolve => setTimeout(resolve, stepMs));
  }
}

async function verifyAccount(tabId, operation) {
  let staged = activeCaptures.get(tabId)?.headers;
  const committed = staged ? null : await readOne(storage.session, REQUEST_CONTEXT_KEY);
  if (!staged && !committed) {
    // No header captured yet and nothing usable already committed — this is
    // a fresh tab whose own organic, csrf-token-bearing request may not have
    // fired yet even though the tab already reached "complete" (page-load
    // completion and an SPA's own async data-fetch bootstrap are not the
    // same event, and can race). Give it a bounded grace period rather than
    // firing our own request immediately with nothing to send.
    await waitForStagedHeaders(tabId);
    staged = activeCaptures.get(tabId)?.headers;
  }
  const stagedHeaders = staged ?? committed?.headers ?? {};
  const identity = await executeJson(tabId, 'https://www.linkedin.com/sales-api/salesApiMe', stagedHeaders, operation);
  const observed = findAccountBinding(identity);
  const existing = await readOne(storage.local, CONNECTION_KEY);
  const decision = evaluateAccountBinding(observed, isVerifiedConnection(existing) ? existing.accountBinding : null);
  if (!decision.ok && decision.error === 'account_unverified') {
    await clearAuthenticationState();
    throw codedError('account_unverified');
  }
  if (!decision.ok && decision.error === 'account_changed') {
    await operations.cancelAll();
    await purgeForAccountChange(storage);
    throw codedError('account_changed');
  }
  if (decision.state === 'connect') {
    await storage.local.set({
      [CONNECTION_KEY]: {schemaVersion: 1, status: 'connected', accountBinding: observed, verifiedAt: Date.now()},
    });
  }
  return observed;
}

async function headersFor(tabId, accountBinding, feature) {
  const context = await readOne(storage.session, REQUEST_CONTEXT_KEY);
  const validation = validateRequestContext(context, {accountBinding, feature});
  if (validation.ok) return validation.value.headers;
  if (context) await storage.session.remove([REQUEST_CONTEXT_KEY]);
  // No committed context yet (e.g. the very first collection): fall back to
  // whatever was staged for this tab during verifyAccount's identity check,
  // so the feature request itself carries the same freshly observed
  // csrf-token rather than going out with no headers at all.
  return activeCaptures.get(tabId)?.headers ?? {};
}

async function commitStagedContext(tabId, operation, accountBinding) {
  const staged = activeCaptures.get(tabId)?.headers;
  if (!staged || !Object.keys(staged).length || !await operations.canWrite(operation)) return;
  const context = createRequestContext({
    headers: staged,
    capturedAt: Date.now(),
    accountBinding,
    authorizedBy: operation.authorization,
    featureScope: operation.authorization === 'automatic' ? ['ssi'] : ['ssi', 'analytics', 'profileTips', 'jobs'],
  });
  await storage.session.set({[REQUEST_CONTEXT_KEY]: context});
}

async function scrapeJobs(tabId) {
  const result = await chrome.scripting.executeScript({
    target: {tabId},
    func: () => Array.from(document.querySelectorAll('[data-job-id], .job-card-container')).slice(0, 10).map(card => {
      const link = card.querySelector('a[href*="/jobs/view/"]');
      const url = link?.href ?? '';
      const match = url.match(/\/jobs\/view\/([A-Za-z0-9_-]+)/);
      return {
        id: card.getAttribute('data-job-id') || match?.[1] || '',
        title: (card.querySelector('.job-card-list__title, strong')?.textContent || link?.textContent || '').trim(),
        company: (card.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle')?.textContent || '').trim(),
        location: (card.querySelector('.job-card-container__metadata-item, .artdeco-entity-lockup__caption')?.textContent || '').trim(),
        url,
        logoUrl: card.querySelector('img')?.src || '',
        postedTime: (card.querySelector('time')?.textContent || '').trim(),
        remote: /remote|hybrid/i.test(card.textContent || ''),
      };
    }),
  });
  return {jobs: result?.[0]?.result ?? []};
}

async function scrapeAnalytics(tabId) {
  const result = await chrome.scripting.executeScript({
    target: {tabId},
    func: () => {
      const body = document.body?.innerText || '';
      const parseNumber = raw => {
        const cleaned = raw.replace(/,/g, '');
        const suffix = cleaned.slice(-1).toLowerCase();
        const numeric = Number.parseFloat(cleaned);
        return Number.isFinite(numeric) ? Math.round(numeric * (suffix === 'k' ? 1000 : suffix === 'm' ? 1000000 : 1)) : null;
      };
      const numberNear = label => {
        // LinkedIn's own stat cards show the value immediately before its
        // label (e.g. "609\nTotal followers"), not after — a loose
        // "label then number within 40 chars" search matches whatever
        // unrelated digit happens to follow the label text later in the
        // page (confirmed: it was picking up the day-count from "in 7 days"
        // and an unrelated "17 comments" elsewhere on the page). Prefer a
        // tight, immediately-adjacent value-before-label match first.
        const before = body.match(new RegExp(`([0-9][0-9,.]*[KkMm]?)[^0-9A-Za-z]{0,10}${label}`, 'i'));
        if (before) return parseNumber(before[1]);
        const after = body.match(new RegExp(`${label}[^0-9]{0,40}([0-9][0-9,.]*[KkMm]?)`, 'i'));
        return after ? parseNumber(after[1]) : null;
      };
      return {
        followers: numberNear('followers'), connections: numberNear('connections'),
        profileViews: numberNear('profile views'), searchAppearances: numberNear('search appearances'),
        impressions: numberNear('impressions'), engagements: numberNear('engagements'),
      };
    },
  });
  return result?.[0]?.result ?? {};
}

async function scrapeProfileTips(tabId) {
  const result = await chrome.scripting.executeScript({
    target: {tabId},
    func: async () => {
      for (let step = 0; step < 4; step += 1) {
        scrollTo({top: document.documentElement.scrollHeight * (step + 1) / 4, behavior: 'instant'});
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      const definitions = {
        photo: ['img.pv-top-card-profile-picture__image', '.profile-photo-edit__preview'],
        headline: ['.text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium'],
        about: ['#about', '[data-view-name="profile-component-entity"] #about'],
        experience: ['#experience'], education: ['#education'], skills: ['#skills'], featured: ['#featured'],
      };
      const sections = {};
      const tips = [];
      for (const [name, selectors] of Object.entries(definitions)) {
        const element = selectors.map(selector => document.querySelector(selector)).find(Boolean);
        const length = (element?.textContent || '').trim().length;
        const status = !element ? 'missing' : length > 40 || name === 'photo' ? 'complete' : 'weak';
        sections[name] = {status, length};
        if (status !== 'complete') tips.push({id: `tip-${name}`, section: name, text: status === 'missing' ? `Add your ${name} section.` : `Add more specific detail to your ${name} section.`});
      }
      const complete = Object.values(sections).filter(section => section.status === 'complete').length;
      const weak = Object.values(sections).filter(section => section.status === 'weak').length;
      const missing = Object.values(sections).filter(section => section.status === 'missing').length;
      const total = complete + weak + missing;
      return {sections, tips: tips.slice(0, 10), score: {total, complete, weak, missing, percentage: total ? Math.round(complete / total * 100) : 0}};
    },
  });
  return result?.[0]?.result ?? {};
}

async function persistFeature(feature, source, accountBinding, operation) {
  if (!await operations.canWrite(operation)) throw codedError('cancelled');
  const connection = await readOne(storage.local, CONNECTION_KEY);
  if (!isVerifiedConnection(connection) || connection.accountBinding !== accountBinding) throw codedError('account_changed');
  const now = Date.now();
  const date = localDateKey(now);
  if (feature === 'ssi') {
    const entry = projectSSI(source, accountBinding, now, date);
    const previous = await readOne(storage.local, HISTORY_KEY);
    const history = trimDailyHistory([entry, ...(Array.isArray(previous) ? previous.filter(item => item?.date !== date) : [])]);
    if (!await operations.canWrite(operation)) throw codedError('cancelled');
    await storage.local.set({[HISTORY_KEY]: history});
    return entry;
  }
  if (feature === 'analytics') {
    const current = projectAnalytics(source, accountBinding, now);
    const entry = analyticsHistoryEntry(current, date);
    const previous = await readOne(storage.local, ANALYTICS_HISTORY_KEY);
    const history = trimDailyHistory([entry, ...(Array.isArray(previous) ? previous.filter(item => item?.date !== date) : [])]);
    if (!await operations.canWrite(operation)) throw codedError('cancelled');
    await storage.local.set({[ANALYTICS_KEY]: current, [ANALYTICS_HISTORY_KEY]: history});
    return current;
  }
  if (feature === 'profileTips') {
    const snapshot = projectProfileTips(source, accountBinding, now, date);
    if (!await operations.canWrite(operation)) throw codedError('cancelled');
    await storage.local.set({[TIPS_KEY]: snapshot});
    return snapshot;
  }
  const snapshot = projectJobSuggestions(source, accountBinding, now, date);
  if (!await operations.canWrite(operation)) throw codedError('cancelled');
  await storage.local.set({[JOBS_KEY]: snapshot});
  return snapshot;
}

async function collectInTab(tabId, feature, operation, {renderedFallback = false} = {}) {
  if (!activeCaptures.has(tabId)) activeCaptures.set(tabId, {operation, headers: null});
  try {
    const accountBinding = await verifyAccount(tabId, operation);
    const headers = await headersFor(tabId, accountBinding, feature);
    let source;
    if (renderedFallback) {
      try { source = await executeJson(tabId, FEATURE_URLS[feature], headers, operation); }
      catch (error) {
        if (!['service_error', 'invalid_response'].includes(error.code)) throw error;
        if (feature === 'jobs') source = await scrapeJobs(tabId);
        else if (feature === 'analytics') source = await scrapeAnalytics(tabId);
        else source = await scrapeProfileTips(tabId);
      }
    } else {
      source = await executeJson(tabId, FEATURE_URLS[feature], headers, operation);
    }
    await commitStagedContext(tabId, operation, accountBinding);
    return await persistFeature(feature, source, accountBinding, operation);
  } finally {
    activeCaptures.delete(tabId);
  }
}

async function findSafeLinkedInTab() {
  const tabs = await chrome.tabs.query({url: ['https://www.linkedin.com/*']});
  return tabs.find(tab => Number.isInteger(tab.id) && typeof tab.url === 'string' && tab.url.startsWith('https://www.linkedin.com/')) ?? null;
}

async function collectFeature(feature, authorization = 'manual') {
  await initialization;
  const operation = await operations.start(feature, authorization);
  try {
    let result;
    if (feature !== 'jobs') {
      const existing = await findSafeLinkedInTab();
      if (existing) {
        try { result = await collectInTab(existing.id, feature, operation); }
        catch (error) {
          // An already-open tab may predate this operation and never send a
          // fresh, csrf-token-bearing request we can observe, so credential
          // and transient failures here fall back to a purpose-navigated
          // temporary tab rather than failing the whole collection outright.
          if (!['service_error', 'invalid_response', 'session_expired', 'account_unverified'].includes(error.code)) throw error;
        }
      }
    }
    if (!result) {
      const targetUrl = feature === 'jobs' ? 'https://www.linkedin.com/jobs/collections/recommended/' :
        feature === 'ssi' ? 'https://www.linkedin.com/sales/ssi' :
        feature === 'profileTips' ? 'https://www.linkedin.com/in/me/' : 'https://www.linkedin.com/dashboard/';
      result = await withOwnedTemporaryTab({
        registry: operations,
        tabs: chrome.tabs,
        operation,
        url: targetUrl,
        onCreated: tabId => { if (!activeCaptures.has(tabId)) activeCaptures.set(tabId, {operation, headers: null}); },
        collect: tabId => collectInTab(tabId, feature, operation, {renderedFallback: feature !== 'ssi'}),
      });
    }
    await operations.finish(operation, 'succeeded');
    return result;
  } catch (error) {
    const code = error?.code ?? 'internal_error';
    if (!error?.code) console.error('[SocialEdge] collectFeature uncoded failure', feature, error?.name, error?.message);
    await operations.finish(operation, code === 'timeout' ? 'timed_out' : code === 'context_closed' ? 'context_closed' : 'failed');
    throw codedError(code);
  }
}

async function readConnection() {
  const value = await readOne(storage.local, CONNECTION_KEY);
  return isVerifiedConnection(value) ? value : null;
}

async function readBound(key, fallback) {
  const connection = await readConnection();
  if (!connection) return fallback;
  const value = await readOne(storage.local, key);
  if (Array.isArray(value)) return value.filter(item => item?.accountBinding === connection.accountBinding);
  return isBoundTo(value, connection.accountBinding) ? value : fallback;
}

async function privacySettings() {
  const preference = validateAutomaticRefresh(await readOne(storage.local, AUTO_REFRESH_KEY));
  const connection = await readConnection();
  const local = await storage.local.get(['ssiHistory', 'liAnalytics', 'dailyActivities', 'profileTips', 'jobSuggestions']);
  return {
    automaticRefresh: {enabled: preference.enabled, features: preference.features, consentVersion: preference.consentVersion},
    connectionStatus: connection ? 'connected' : 'disconnected',
    hasLinkedInData: Object.values(local).some(Boolean),
  };
}

async function setAutomaticRefresh(message) {
  const preference = createAutomaticRefresh(message.enabled);
  if (message.enabled && !await readConnection()) throw codedError('account_unverified');
  await storage.local.set({[AUTO_REFRESH_KEY]: preference});
  if (!message.enabled) {
    const context = await readOne(storage.session, REQUEST_CONTEXT_KEY);
    if (context?.authorizedBy === 'automatic') await storage.session.remove([REQUEST_CONTEXT_KEY]);
  }
  return {enabled: preference.enabled, features: preference.features, consentVersion: preference.consentVersion};
}

async function deleteTransaction(disconnect) {
  const startedAt = performance.now();
  await operations.cancelAll();
  const deleted = await deleteLinkedInData(storage, {disconnect});
  return {
    deleted,
    automaticRefreshEnabled: false,
    ...(disconnect ? {connectionStatus: 'disconnected'} : {}),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

function questItems(date) {
  return Object.entries(ALL_ACTIVITIES).map(([pillar, items], index) => {
    const itemIndex = (date.charCodeAt(date.length - 1) + index) % items.length;
    const item = items[itemIndex];
    return {id: `${pillar}:${itemIndex}`, pillar, pillarName: pillar, idx: itemIndex, label: item.label, difficulty: item.difficulty, done: false};
  });
}

async function getDailyQuest(force = false) {
  const connection = await readConnection();
  if (!connection) return null;
  const date = localDateKey();
  const current = await readOne(storage.local, QUEST_KEY);
  if (!force && current?.date === date && current.accountBinding === connection.accountBinding) return current;
  const quest = {schemaVersion: 1, accountBinding: connection.accountBinding, date, items: questItems(date), dismissed: false};
  const history = await readOne(storage.local, QUEST_HISTORY_KEY);
  const nextHistory = [{date, ids: quest.items.map(item => item.id)}, ...(Array.isArray(history?.entries) ? history.entries.filter(item => item.date !== date) : [])].slice(0, 365);
  await storage.local.set({
    [QUEST_KEY]: quest,
    [QUEST_HISTORY_KEY]: {schemaVersion: 1, accountBinding: connection.accountBinding, entries: nextHistory},
  });
  return quest;
}

async function updateQuest(message, swap = false) {
  const quest = await readBound(QUEST_KEY, null);
  if (!quest) return null;
  const index = quest.items.findIndex(item => item.id === message.itemId);
  if (index < 0) return quest;
  if (swap) {
    const items = ALL_ACTIVITIES[quest.items[index].pillar] ?? [];
    const nextIndex = (quest.items[index].idx + 1) % items.length;
    const item = items[nextIndex];
    quest.items[index] = {...quest.items[index], id: `${quest.items[index].pillar}:${nextIndex}`, idx: nextIndex, label: item.label, difficulty: item.difficulty, done: false};
  } else quest.items[index].done = message.done;
  await storage.local.set({[QUEST_KEY]: quest});
  return quest;
}

async function getStreak() {
  const activities = await readBound(ACTIVITIES_KEY, null);
  if (!activities?.days) return 0;
  let streak = 0;
  const cursor = new Date();
  while (Object.values(activities.days[localDateKey(cursor)] ?? {}).flat().some(Boolean)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function getActivities() {
  const root = await readBound(ACTIVITIES_KEY, null);
  return root?.days ?? {};
}

async function saveActivities(message) {
  const connection = await readConnection();
  if (!connection) throw codedError('account_unverified');
  const current = await readBound(ACTIVITIES_KEY, null);
  const days = structuredClone(current?.days ?? {});
  days[message.date] ??= {};
  days[message.date][message.pillar] = [...message.values];
  const root = {schemaVersion: 1, accountBinding: connection.accountBinding, days};
  await storage.local.set({[ACTIVITIES_KEY]: root});
  return days;
}

async function dispatch(message) {
  switch (message.action) {
    case 'fetchNow': return collectFeature('ssi');
    case 'fetchAnalytics': return collectFeature('analytics');
    case 'fetchProfileTips': return collectFeature('profileTips');
    case 'fetchJobs': return collectFeature('jobs');
    case 'getHistory': return readBound(HISTORY_KEY, []);
    case 'getAnalytics': return readBound(ANALYTICS_KEY, {});
    case 'getAnalyticsHistory': return readBound(ANALYTICS_HISTORY_KEY, []);
    case 'getProfileTips': return readBound(TIPS_KEY, null);
    case 'getJobs': return readBound(JOBS_KEY, null);
    case 'getPrivacySettings': return privacySettings();
    case 'setAutomaticRefresh': return setAutomaticRefresh(message);
    case 'clearLinkedInData': return deleteTransaction(false);
    case 'disconnectLinkedIn': return deleteTransaction(true);
    case 'getDailyQuest': return getDailyQuest();
    case 'updateQuestItem': return updateQuest(message);
    case 'swapQuestItem': return updateQuest(message, true);
    case 'getStreak': return getStreak();
    case 'getActivities': return getActivities();
    case 'saveActivities': return saveActivities(message);
    case 'dismissQuest': {
      const quest = await readBound(QUEST_KEY, null);
      if (quest) { quest.dismissed = true; await storage.local.set({[QUEST_KEY]: quest}); }
      return quest;
    }
    default: throw codedError('invalid_request');
  }
}

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const senderValidation = validateSender(sender, chrome.runtime.id);
  if (!senderValidation.ok) {
    sendResponse(failure(senderValidation.error));
    return false;
  }
  const requestValidation = validateRequest(rawMessage);
  if (!requestValidation.ok) {
    sendResponse(failure(requestValidation.error));
    return false;
  }
  (async () => {
    try {
      await initialization;
      sendResponse(success(await dispatch(requestValidation.value)));
    } catch (error) {
      if (!error?.code) console.error('[SocialEdge] dispatch uncoded failure', requestValidation.value.action, error?.name, error?.message);
      sendResponse(failure(error?.code ?? 'internal_error'));
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  try {
    await initialization;
    if (alarm.name === 'dailyQuest') {
      const quest = await getDailyQuest();
      if (quest && !quest.dismissed) {
        await chrome.notifications.create('daily-quest', {
          type: 'basic', iconUrl: 'icons/icon128.png', title: 'SocialEdge daily tasks',
          message: 'Your daily LinkedIn improvement tasks are ready.',
        });
      }
      return;
    }
    if (alarm.name === 'dailyFetch') {
      const preference = validateAutomaticRefresh(await readOne(storage.local, AUTO_REFRESH_KEY));
      if (preference.enabled) await collectFeature('ssi', 'automatic');
    }
  } catch {
    // Alarm failures are intentionally silent and never broaden authorization.
  }
});
