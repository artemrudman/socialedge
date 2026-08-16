export const EPOCH_KEY = '_se_collectionEpoch';
export const OWNED_TABS_KEY = '_se_ownedTemporaryTabs';
export const REQUEST_TIMEOUT_MS = 15_000;
export const TAB_TIMEOUT_MS = 20_000;
export const OPERATION_TIMEOUT_MS = 45_000;

const terminalStates = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'context_closed']);
const readOne = async (area, key) => (await area.get([key]))[key];

export function deadlineFor(now, duration, operationDeadline) {
  return Math.min(now + duration, operationDeadline);
}

export function withDeadline(promise, milliseconds, code = 'timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), {code})), Math.max(0, milliseconds));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createOperationRegistry({session, tabs, monotonicNow = () => performance.now()}) {
  const active = new Map();

  async function epoch() {
    const value = await readOne(session, EPOCH_KEY);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  async function ownedTabs() {
    const value = await readOne(session, OWNED_TABS_KEY);
    return Array.isArray(value) ? value.filter(item => Number.isInteger(item?.tabId) && item.tabId >= 0) : [];
  }

  async function writeOwned(items) {
    await session.set({[OWNED_TABS_KEY]: structuredClone(items)});
  }

  async function reconcile() {
    const current = await epoch();
    await session.set({[EPOCH_KEY]: current});
    const remaining = [];
    for (const item of await ownedTabs()) {
      try { await tabs.remove(item.tabId); } catch { remaining.push(item); }
    }
    await writeOwned(remaining);
    return {epoch: current, remaining: remaining.length};
  }

  async function start(feature, authorization) {
    const currentEpoch = await epoch();
    const startedAt = monotonicNow();
    const operation = {
      operationId: crypto.randomUUID(),
      epoch: currentEpoch,
      feature,
      authorization,
      startedAt,
      operationDeadline: startedAt + OPERATION_TIMEOUT_MS,
      activeWaitDeadline: null,
      temporaryTabId: null,
      state: 'created',
    };
    active.set(operation.operationId, operation);
    return operation;
  }

  async function canWrite(operation) {
    return Boolean(operation && !terminalStates.has(operation.state) && operation.epoch === await epoch());
  }

  async function ownTab(operation, tabId) {
    if (!await canWrite(operation)) throw Object.assign(new Error('cancelled'), {code: 'cancelled'});
    const items = (await ownedTabs()).filter(item => item.tabId !== tabId);
    items.push({tabId, epoch: operation.epoch, operationId: operation.operationId});
    await writeOwned(items);
    operation.temporaryTabId = tabId;
  }

  async function releaseTab(operation, {close = true, maxWait = 250} = {}) {
    if (!Number.isInteger(operation?.temporaryTabId)) return;
    const tabId = operation.temporaryTabId;
    let confirmed = !close;
    if (close) {
      confirmed = await Promise.race([
        Promise.resolve(tabs.remove(tabId)).then(() => true, () => true),
        new Promise(resolve => setTimeout(() => resolve(false), Math.max(0, maxWait))),
      ]);
    }
    if (confirmed) {
      await writeOwned((await ownedTabs()).filter(item => item.tabId !== tabId));
      operation.temporaryTabId = null;
    }
  }

  async function finish(operation, state) {
    operation.state = state;
    active.delete(operation.operationId);
  }

  async function cancelAll() {
    const nextEpoch = await epoch() + 1;
    await session.set({[EPOCH_KEY]: nextEpoch});
    for (const operation of active.values()) operation.state = 'cancelled';
    active.clear();
    const remaining = [];
    for (const item of await ownedTabs()) {
      try { await tabs.remove(item.tabId); } catch { remaining.push(item); }
    }
    await writeOwned(remaining);
    return nextEpoch;
  }

  return {reconcile, start, canWrite, ownTab, releaseTab, finish, cancelAll, epoch, ownedTabs};
}

function waitForTabLoad(tabs, tabId, milliseconds) {
  const promise = new Promise((resolve, reject) => {
    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === 'complete') done(resolve);
    };
    const onRemoved = removedId => {
      if (removedId === tabId) done(() => reject(Object.assign(new Error('context_closed'), {code: 'context_closed'})));
    };
    const done = callback => {
      tabs.onUpdated.removeListener(onUpdated);
      tabs.onRemoved.removeListener(onRemoved);
      callback();
    };
    tabs.onUpdated.addListener(onUpdated);
    tabs.onRemoved.addListener(onRemoved);
    tabs.get(tabId).then(tab => { if (tab.status === 'complete') done(resolve); }).catch(() => done(() => reject(Object.assign(new Error('context_closed'), {code: 'context_closed'}))));
  });
  return withDeadline(promise, milliseconds, 'timeout');
}

export async function withOwnedTemporaryTab({registry, tabs, operation, url, collect, onCreated, monotonicNow = () => performance.now()}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(parsed.hostname)) {
    throw Object.assign(new Error('invalid_request'), {code: 'invalid_request'});
  }
  const remaining = () => Math.max(0, operation.operationDeadline - monotonicNow());
  let created;
  try {
    try { created = await tabs.create({url, active: false}); }
    catch { throw Object.assign(new Error('no_context'), {code: 'no_context'}); }
    if (!Number.isInteger(created?.id) || created.active) throw Object.assign(new Error('no_context'), {code: 'no_context'});
    // Register any header-capture listener before waiting for the page to
    // finish loading: the site's own organic API calls (and the csrf-token
    // header they carry) fire during load, not after it completes.
    onCreated?.(created.id);
    await registry.ownTab(operation, created.id);
    operation.state = 'collecting';
    operation.activeWaitDeadline = deadlineFor(monotonicNow(), TAB_TIMEOUT_MS, operation.operationDeadline);
    await waitForTabLoad(tabs, created.id, Math.min(TAB_TIMEOUT_MS, remaining()));
    if (!await registry.canWrite(operation)) throw Object.assign(new Error('cancelled'), {code: 'cancelled'});
    const ownership = await registry.ownedTabs();
    if (!ownership.some(item => item.tabId === created.id && item.operationId === operation.operationId)) {
      throw Object.assign(new Error('context_closed'), {code: 'context_closed'});
    }
    let onRemoved;
    const closed = new Promise((_, reject) => {
      onRemoved = removedId => {
        if (removedId === created.id) reject(Object.assign(new Error('context_closed'), {code: 'context_closed'}));
      };
      tabs.onRemoved.addListener(onRemoved);
    });
    try {
      return await withDeadline(Promise.race([Promise.resolve(collect(created.id)), closed]), remaining(), 'timeout');
    } finally {
      tabs.onRemoved.removeListener(onRemoved);
    }
  } finally {
    if (created?.id != null) await registry.releaseTab(operation, {maxWait: Math.min(250, remaining())});
  }
}
