const SSI_HEADERS_KEY = 'ssiExactHeaders';
const SSI_HISTORY_KEY  = 'ssiHistory';
const MAX_HISTORY      = 365;
const SALES_URL        = 'https://www.linkedin.com/sales/ssi';

const pendingSSIResolvers = new Set();

// ── Open side panel on action click ──────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Capture exact headers from LinkedIn's own salesApiSsi request ─────────────
// Fires whenever LinkedIn's page calls the endpoint naturally.
// We store the headers so we can replay silently — no tab ever created.

chrome.webRequest.onBeforeSendHeaders.addListener(
  async (details) => {
    const headers = {};
    for (const h of details.requestHeaders || []) {
      headers[h.name.toLowerCase()] = h.value;
    }
    await chrome.storage.local.set({ [SSI_HEADERS_KEY]: { headers, ts: Date.now() } });
    console.log('[SocialEdge] Captured salesApiSsi headers');

    // If a fetchNow is waiting, replay immediately
    if (pendingSSIResolvers.size > 0 && details.tabId > 0) {
      await replaySSI(details.tabId, headers);
    }
  },
  { urls: ['*://www.linkedin.com/sales-api/salesApiSsi*'] },
  ['requestHeaders', 'extraHeaders']
);

// ── Replay SSI request inside an existing LinkedIn tab ────────────────────────
// The tab stays on its current page — no navigation, completely invisible.

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
        } catch (e) { return { error: e.message }; }
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

// ── Parse & store ─────────────────────────────────────────────────────────────

function parseSSI(data) {
  const ms   = data.memberScore || {};
  const subs = (arr) => ({
    prof_brand:         arr?.[0]?.score ?? null,
    find_right_people:  arr?.[1]?.score ?? null,
    insight_engagement: arr?.[2]?.score ?? null,
    relationship:       arr?.[3]?.score ?? null,
  });
  const industry = data.groupScore?.find((g) => g.groupType === 'INDUSTRY') || {};
  const network  = data.groupScore?.find((g) => g.groupType === 'NETWORK')  || {};
  return {
    overall: ms.overall ?? null,
    ...subs(ms.subScores),
    industry: {
      ssi: industry.score?.overall ?? null, top: industry.rank ?? null,
      people_amount: industry.groupSize ?? null, name: industry.industry ?? null,
      ...subs(industry.score?.subScores),
    },
    network: {
      ssi: network.score?.overall ?? null, top: network.rank ?? null,
      people_amount: network.groupSize ?? null, ...subs(network.score?.subScores),
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

// ── Main fetch orchestrator ───────────────────────────────────────────────────
// Never creates new tabs. Uses an existing LinkedIn tab silently.

async function runFetch() {
  if (pendingSSIResolvers.size > 0) return { error: 'Fetch already in progress.' };

  const stored = await chrome.storage.local.get([SSI_HEADERS_KEY]);
  const cached = stored[SSI_HEADERS_KEY];

  if (!cached?.headers) {
    return {
      error: 'Visit LinkedIn Sales Navigator once to initialize SocialEdge — ' +
             'your score will be captured automatically after that.',
    };
  }

  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (!tabs.length) {
    return { error: 'Open a LinkedIn tab, then try again.' };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSSIResolvers.delete(wrappedResolve);
      resolve({ error: 'Request timed out. Try refreshing your LinkedIn page.' });
    }, 15000);

    function wrappedResolve(result) {
      clearTimeout(timer);
      pendingSSIResolvers.delete(wrappedResolve);
      resolve(result);
    }
    pendingSSIResolvers.add(wrappedResolve);
    replaySSI(tabs[0].id, cached.headers);
  });
}

// ── Auto-fetch on browser start ───────────────────────────────────────────────
// Passive: relies on webRequest capture when user navigates LinkedIn naturally.
// Also handles the case where headers are already cached from yesterday.

chrome.runtime.onStartup.addListener(async () => {
  const stored  = await chrome.storage.local.get([SSI_HISTORY_KEY]);
  const history = stored[SSI_HISTORY_KEY] || [];
  const today   = new Date().toISOString().split('T')[0];
  if (!history[0] || history[0].date !== today) {
    console.log('[SocialEdge] New day on startup — will fetch when LinkedIn tab is available.');
    // Attempt now; if no LinkedIn tab, webRequest will catch it when user opens one
    runFetch().catch(() => {});
  }
});

// ── Daily alarm fallback ──────────────────────────────────────────────────────
chrome.alarms.create('dailyFetch', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyFetch') runFetch();
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'fetchNow') {
    runFetch().then(sendResponse);
    return true;
  }
  if (msg.action === 'getHistory') {
    chrome.storage.local.get([SSI_HISTORY_KEY], (r) => sendResponse(r[SSI_HISTORY_KEY] || []));
    return true;
  }
  if (msg.action === 'storeSSI') {
    storeSSI(msg.data);
  }
});
