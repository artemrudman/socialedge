export const CONSENT_VERSION = 'privacy-v1';

const ERROR_DEFINITIONS = Object.freeze({
  invalid_sender: ['This request did not come from SocialEdge.', false],
  invalid_request: ['The request was not valid.', false],
  not_authorized: ['Start this request yourself or enable automatic refresh.', false],
  session_expired: ['Your LinkedIn session expired. Sign in and try again.', true],
  account_changed: ['Your LinkedIn account changed. Reconnect before collecting new data.', false],
  account_unverified: ['SocialEdge could not verify the active LinkedIn account.', true],
  no_context: ['Open LinkedIn, sign in, and try again.', true],
  context_closed: ['The temporary collection tab was closed. Try again.', true],
  timeout: ['LinkedIn did not respond in time. Try again.', true],
  service_error: ['LinkedIn could not complete the request. Try again.', true],
  invalid_response: ['LinkedIn returned data SocialEdge could not safely use.', true],
  cancelled: ['The collection was cancelled.', true],
  migration_failed: ['Stored data could not be upgraded safely.', true],
  internal_error: ['SocialEdge could not complete the request.', true],
});

const NO_FIELD_ACTIONS = new Set([
  'fetchNow', 'fetchAnalytics', 'fetchProfileTips', 'fetchJobs',
  'getHistory', 'getAnalytics', 'getAnalyticsHistory', 'getProfileTips', 'getJobs',
  'getDailyQuest', 'getStreak', 'getActivities', 'getPrivacySettings', 'dismissQuest',
]);

const REMOVED_ACTIONS = new Set(['captureHeaders', 'storeSSI', 'storeAnalytics']);

const isPlainObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, expected) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

export function validateSender(sender, runtimeId) {
  if (!sender || sender.id !== runtimeId) {
    return {ok: false, error: 'invalid_sender'};
  }
  // frameId is only populated when a tab is associated with the sender (i.e. a
  // content script). Extension-page senders (side panel, popup, options) have
  // no tab and may report frameId as undefined depending on the browser build;
  // only enforce top-frame-only when a tab is actually present.
  if (sender.tab && sender.frameId !== 0) {
    return {ok: false, error: 'invalid_sender'};
  }
  const prefix = `chrome-extension://${runtimeId}/`;
  if (typeof sender.url !== 'string' || !sender.url.startsWith(prefix)) {
    return {ok: false, error: 'invalid_sender'};
  }
  if (sender.origin && sender.origin !== `chrome-extension://${runtimeId}`) {
    return {ok: false, error: 'invalid_sender'};
  }
  return {ok: true};
}

export function validateRequest(message) {
  if (!isPlainObject(message) || typeof message.action !== 'string' ||
      message.action.length > 64 || REMOVED_ACTIONS.has(message.action)) {
    return {ok: false, error: 'invalid_request'};
  }
  if (NO_FIELD_ACTIONS.has(message.action)) {
    return exactKeys(message, ['action'])
      ? {ok: true, value: {action: message.action}}
      : {ok: false, error: 'invalid_request'};
  }
  if (message.action === 'setAutomaticRefresh') {
    if (message.enabled === false && exactKeys(message, ['action', 'enabled'])) {
      return {ok: true, value: {action: message.action, enabled: false}};
    }
    const validEnabled = message.enabled === true &&
      message.consentVersion === CONSENT_VERSION &&
      Array.isArray(message.features) && message.features.length === 1 && message.features[0] === 'ssi' &&
      exactKeys(message, ['action', 'enabled', 'consentVersion', 'features']);
    return validEnabled
      ? {ok: true, value: structuredClone(message)}
      : {ok: false, error: 'invalid_request'};
  }
  if (message.action === 'clearLinkedInData' || message.action === 'disconnectLinkedIn') {
    return message.confirmed === true && exactKeys(message, ['action', 'confirmed'])
      ? {ok: true, value: {action: message.action, confirmed: true}}
      : {ok: false, error: 'invalid_request'};
  }
  if (message.action === 'updateQuestItem') {
    const valid = exactKeys(message, ['action', 'itemId', 'done']) &&
      typeof message.itemId === 'string' && /^[a-z_]+:\d{1,3}$/i.test(message.itemId) &&
      message.itemId.length <= 128 && typeof message.done === 'boolean';
    return valid ? {ok: true, value: structuredClone(message)} : {ok: false, error: 'invalid_request'};
  }
  if (message.action === 'swapQuestItem') {
    const valid = exactKeys(message, ['action', 'itemId']) &&
      typeof message.itemId === 'string' && /^[a-z_]+:\d{1,3}$/i.test(message.itemId) &&
      message.itemId.length <= 128;
    return valid ? {ok: true, value: structuredClone(message)} : {ok: false, error: 'invalid_request'};
  }
  if (message.action === 'saveActivities') {
    const valid = exactKeys(message, ['action', 'date', 'pillar', 'values']) &&
      typeof message.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(message.date) &&
      ['prof_brand', 'find_right_people', 'insight_engagement', 'relationship'].includes(message.pillar) &&
      Array.isArray(message.values) && message.values.length <= 10 && message.values.every(value => typeof value === 'boolean');
    return valid ? {ok: true, value: structuredClone(message)} : {ok: false, error: 'invalid_request'};
  }
  return {ok: false, error: 'invalid_request'};
}

export function success(data = {}) {
  return {ok: true, data: structuredClone(data)};
}

export function failure(code = 'internal_error') {
  const safeCode = Object.hasOwn(ERROR_DEFINITIONS, code) ? code : 'internal_error';
  const [message, retryable] = ERROR_DEFINITIONS[safeCode];
  return {ok: false, error: {code: safeCode, message, retryable}};
}

export function isResponseEnvelope(value) {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return exactKeys(value, ['ok', 'data']);
  return exactKeys(value, ['ok', 'error']) && isPlainObject(value.error) &&
    exactKeys(value.error, ['code', 'message', 'retryable']) &&
    Object.hasOwn(ERROR_DEFINITIONS, value.error.code) &&
    typeof value.error.message === 'string' && typeof value.error.retryable === 'boolean';
}
