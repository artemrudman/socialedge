const SSI_HEADERS_KEY = 'ssiExactHeaders';
const SSI_HISTORY_KEY  = 'ssiHistory';
const MAX_HISTORY      = 365;
const SALES_URL        = 'https://www.linkedin.com/sales/ssi';

const pendingSSIResolvers = new Set();
let   fetchTabId          = null;   // background tab we opened for the fetch

// ─── Capture exact headers from LinkedIn's own salesApiSsi request ────────────

chrome.webRequest.onBeforeSendHeaders.addListener(
  async (details) => {
    const headers = {};
    for (const h of details.requestHeaders || []) {
      headers[h.name.toLowerCase()] = h.value;
    }
    await chrome.storage.local.set({ [SSI_HEADERS_KEY]: { headers, ts: Date.now() } });
    console.log('[SocialEdge] Captured salesApiSsi headers');

    if (pendingSSIResolvers.size > 0 && details.tabId > 0) {
      await replaySSI(details.tabId, headers);
    }
  },
  { urls: ['*://www.linkedin.com/sales-api/salesApiSsi*'] },
  ['requestHeaders', 'extraHeaders']
);

// ─── Replay request with captured headers (cookies auto-included) ─────────────

async function replaySSI(tabId, capturedHeaders) {
  const FORBIDDEN = new Set([
    'cookie', 'host', 'content-length', 'connection',
    'transfer-encoding', 'keep-alive', 'upgrade',
  ]);
  const headers = Object.fromEntries(
    Object.entries(capturedHeaders).filter(([k]) => !FORBIDDEN.has(k))
  );

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (hdrs) => {
        try {
          const resp = await fetch('https://www.linkedin.com/sales-api/salesApiSsi', {
            credentials: 'include',
            headers: hdrs,
          });
          if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            return { error: `HTTP ${resp.status}`, detail: body.slice(0, 300) };
          }
          return { data: await resp.json() };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [headers],
    });

    const result = results?.[0]?.result;
    if (result?.data) {
      await storeSSI(result.data);
    } else {
      console.error('[SocialEdge] Replay failed:', result?.error, result?.detail || '');
    }
  } catch (e) {
    console.error('[SocialEdge] executeScript error:', e.message);
  }
}

// ─── Parse & store ────────────────────────────────────────────────────────────

function parseSSI(data) {
  const ms   = data.memberScore || {};
  const subs = (arr) => ({
    prof_brand:        arr?.[0]?.score ?? null,
    find_right_people: arr?.[1]?.score ?? null,
    insight_engagement:arr?.[2]?.score ?? null,
    relationship:      arr?.[3]?.score ?? null,
  });

  const industry = data.groupScore?.find((g) => g.groupType === 'INDUSTRY') || {};
  const network  = data.groupScore?.find((g) => g.groupType === 'NETWORK')  || {};

  return {
    overall: ms.overall ?? null,
    ...subs(ms.subScores),
    industry: {
      ssi:           industry.score?.overall ?? null,
      top:           industry.rank ?? null,
      people_amount: industry.groupSize ?? null,
      name:          industry.industry ?? null,
      ...subs(industry.score?.subScores),
    },
    network: {
      ssi:           network.score?.overall ?? null,
      top:           network.rank ?? null,
      people_amount: network.groupSize ?? null,
      ...subs(network.score?.subScores),
    },
  };
}

async function storeSSI(rawData) {
  const date   = new Date().toISOString().split('T')[0];
  const parsed = parseSSI(rawData);
  const entry  = { date, parsed, raw: rawData };

  const stored  = await chrome.storage.local.get([SSI_HISTORY_KEY]);
  let   history = stored[SSI_HISTORY_KEY] || [];
  history = history.filter((h) => h.date !== date);
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [SSI_HISTORY_KEY]: history });

  chrome.action.setBadgeText({ text: '' });
  console.log('[SocialEdge] Stored:', entry.date, 'score:', entry.parsed.overall);

  for (const resolve of pendingSSIResolvers) resolve({ success: true, entry });
  pendingSSIResolvers.clear();

  return entry;
}

// ─── Close the background fetch tab ──────────────────────────────────────────

function closeFetchTab() {
  if (fetchTabId !== null) {
    chrome.tabs.remove(fetchTabId).catch(() => {});
    fetchTabId = null;
  }
}

// ─── Main fetch orchestrator ──────────────────────────────────────────────────

async function runFetch() {
  // Don't stack multiple concurrent fetches
  if (pendingSSIResolvers.size > 0) return { error: 'Fetch already in progress.' };

  return new Promise(async (resolve) => {
    const timer = setTimeout(() => {
      pendingSSIResolvers.delete(wrappedResolve);
      closeFetchTab();
      resolve({
        error:
          'Timed out (25 s). Make sure you are logged in to LinkedIn ' +
          'with an active Sales Navigator subscription.',
      });
    }, 25000);

    function wrappedResolve(result) {
      clearTimeout(timer);
      pendingSSIResolvers.delete(wrappedResolve);
      closeFetchTab();        // ← silently closes the background tab
      resolve(result);
    }
    pendingSSIResolvers.add(wrappedResolve);

    // Open in background (active: false) so the user never sees the tab
    const tab = await chrome.tabs.create({ url: SALES_URL, active: false });
    fetchTabId = tab.id;
  });
}

// ─── Auto-fetch on browser start (if today's data is missing) ─────────────────

chrome.runtime.onStartup.addListener(async () => {
  const stored  = await chrome.storage.local.get([SSI_HISTORY_KEY]);
  const history = stored[SSI_HISTORY_KEY] || [];
  const today   = new Date().toISOString().split('T')[0];
  if (!history[0] || history[0].date !== today) {
    console.log('[SocialEdge] New day detected on startup — fetching score…');
    runFetch();
  }
});

// ─── Daily alarm (fallback for long Chrome sessions) ─────────────────────────

chrome.alarms.create('dailyFetch', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyFetch') runFetch();
});

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'fetchNow') {
    runFetch().then(sendResponse);
    return true;
  }
  if (msg.action === 'getHistory') {
    chrome.storage.local.get([SSI_HISTORY_KEY], (result) => {
      sendResponse(result[SSI_HISTORY_KEY] || []);
    });
    return true;
  }
  if (msg.action === 'storeSSI') {
    storeSSI(msg.data);
  }
});
