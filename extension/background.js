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
      const errMsg = result?.error || 'fetch_failed';
      const detail = result?.detail || '';
      console.error('[SocialEdge] Replay failed:', errMsg, detail);
      for (const resolve of pendingSSIResolvers) {
        resolve({ error: errMsg, message: detail || 'SSI fetch failed. Try refreshing your LinkedIn page.' });
      }
      pendingSSIResolvers.clear();
    }
  } catch (e) {
    console.error('[SocialEdge] executeScript error:', e.message);
    for (const resolve of pendingSSIResolvers) {
      resolve({ error: 'script_error', message: e.message });
    }
    pendingSSIResolvers.clear();
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
  let cached = stored[SSI_HEADERS_KEY];

  // ── Auto-bootstrap: if no headers cached, try to open SSI page silently ───
  if (!cached?.headers) {
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    if (!tabs.length) {
      return {
        error: 'no_linkedin',
        message: 'Open any LinkedIn page so SocialEdge can capture your score.',
      };
    }
    // Navigate existing LinkedIn tab to SSI page — this triggers LinkedIn's own
    // SSI API call, which our webRequest listener captures automatically.
    try {
      await chrome.tabs.update(tabs[0].id, { url: SALES_URL });
      // Wait for page load + SSI API call to fire
      await new Promise((resolve) => {
        const listener = (tId, info) => {
          if (tId === tabs[0].id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 12000);
      });
      // Give the SSI API request a moment to fire after page load
      await new Promise(r => setTimeout(r, 3000));
      // Re-read headers (webRequest listener should have captured them)
      const refreshed = await chrome.storage.local.get([SSI_HEADERS_KEY]);
      cached = refreshed[SSI_HEADERS_KEY];
      if (!cached?.headers) {
        return {
          error: 'no_headers',
          message: 'Could not capture SSI data. Make sure you are logged into LinkedIn.',
        };
      }
    } catch (e) {
      return { error: 'bootstrap_failed', message: e.message };
    }
  }

  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (!tabs.length) {
    return {
      error: 'no_linkedin',
      message: 'Open a LinkedIn tab, then try again.',
    };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSSIResolvers.delete(wrappedResolve);
      resolve({ error: 'timeout', message: 'Request timed out. Try refreshing your LinkedIn page.' });
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
    runFetch().catch(() => {});
  }
  // Generate daily quest & push notification on browser start
  generateDailyQuest(true);
});

// ── Daily alarm fallback ──────────────────────────────────────────────────────
chrome.alarms.create('dailyFetch', { periodInMinutes: 1440 });

// ── Daily Quest alarm (fires every 6 hours so we catch ~9 AM in any timezone) ─
chrome.alarms.create('dailyQuest', { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyFetch') runFetch();
  if (alarm.name === 'dailyQuest') generateDailyQuest(true);
});

// ── Daily Quest — Duolingo-style activity suggestions ────────────────────────
// 40 activities across 4 pillars. Each day pick 3-5 with smart weighting.
// Avoids recently-done & recently-suggested. Balances across pillars.
// Pushes a Chrome notification to nudge the user.

const QUEST_KEY      = '_se_dailyQuest';
const QUEST_HIST_KEY = '_se_questHistory';    // last 7 days of quest IDs
const ACT_KEY_BG     = 'dailyActivities';     // same key popup uses

const ALL_ACTIVITIES = {
  prof_brand: [
    { label: "Published an original post", difficulty: 2 },
    { label: "Published a long-form article", difficulty: 3 },
    { label: "Updated a profile section", difficulty: 2 },
    { label: "Requested a skill endorsement", difficulty: 1 },
    { label: "Gave a skill endorsement to a connection", difficulty: 1 },
    { label: "Shared industry content with personal commentary", difficulty: 2 },
    { label: "Refreshed profile photo or banner", difficulty: 3 },
    { label: "Added a quantified achievement to experience", difficulty: 2 },
    { label: "Added or updated featured section", difficulty: 3 },
    { label: "Completed a LinkedIn learning course", difficulty: 3 },
  ],
  find_right_people: [
    { label: "Used search filters (title, company, location) to find prospects", difficulty: 1 },
    { label: "Sent 3+ targeted connection requests to people in your industry", difficulty: 1 },
    { label: "Followed a target company's LinkedIn page", difficulty: 1 },
    { label: 'Reviewed "People Also Viewed" suggestions on a relevant profile', difficulty: 1 },
    { label: "Asked a mutual connection to introduce you to a prospect", difficulty: 2 },
    { label: 'Used "People You May Know" to find relevant connections', difficulty: 1 },
    { label: "Ran a boolean search query (AND, OR, NOT keywords)", difficulty: 2 },
    { label: "Found prospects via a target company's People tab", difficulty: 1 },
    { label: "Searched alumni from a specific school or company", difficulty: 1 },
    { label: "Reviewed LinkedIn's suggested connections for relevant prospects", difficulty: 1 },
  ],
  insight_engagement: [
    { label: "Left a thoughtful comment on a lead's post", difficulty: 1 },
    { label: "Shared content with personal insight added", difficulty: 2 },
    { label: "Engaged with a target account's content", difficulty: 1 },
    { label: "Created a poll", difficulty: 3 },
    { label: "Responded to a poll", difficulty: 1 },
    { label: "Sent a relevant article to a prospect", difficulty: 2 },
    { label: "Liked a post from a saved lead", difficulty: 1 },
    { label: "Reposted with added perspective", difficulty: 2 },
    { label: "Replied to a comment on my own post", difficulty: 1 },
    { label: "Tagged a connection in a relevant post", difficulty: 1 },
  ],
  relationship: [
    { label: "Sent a personalized InMail", difficulty: 2 },
    { label: "Followed up with a new connection", difficulty: 1 },
    { label: "Congratulated a lead on a job change", difficulty: 1 },
    { label: "Congratulated a lead on a work anniversary", difficulty: 1 },
    { label: "Reconnected with a dormant contact", difficulty: 2 },
    { label: "Responded to a message within 24 hours", difficulty: 1 },
    { label: "Sent a voice note to a prospect", difficulty: 2 },
    { label: "Accepted a connection request with a personal reply", difficulty: 1 },
    { label: "Introduced two connections to each other", difficulty: 3 },
    { label: "Scheduled a call or meeting with a lead", difficulty: 3 },
  ],
};

// Difficulty → frequency weight: easy=daily, medium=~2x/week, hard=~2-3x/month
const DIFFICULTY_WEIGHT = { 1: 1.0, 2: 0.5, 3: 0.18 };

const PILLAR_NAMES = {
  prof_brand: "Professional Brand",
  find_right_people: "Find Right People",
  insight_engagement: "Insight Engagement",
  relationship: "Strong Relationships",
};

async function generateDailyQuest(sendNotification = false) {
  const todayStr = new Date().toISOString().split('T')[0];
  const stored = await chrome.storage.local.get([QUEST_KEY, QUEST_HIST_KEY, ACT_KEY_BG, SSI_HISTORY_KEY]);

  // Don't regenerate if already have today's quest
  const existing = stored[QUEST_KEY];
  if (existing?.date === todayStr) return existing;

  const questHistory = stored[QUEST_HIST_KEY] || [];    // array of { date, ids:[...] }
  const doneActivities = stored[ACT_KEY_BG] || {};
  const ssiHistory = stored[SSI_HISTORY_KEY] || [];

  // Build a flat list of all activities with IDs
  const pool = [];
  for (const [pillar, items] of Object.entries(ALL_ACTIVITIES)) {
    items.forEach((item, idx) => {
      pool.push({ id: `${pillar}:${idx}`, pillar, idx, label: item.label, difficulty: item.difficulty });
    });
  }

  // ── Weighting ─────────────────────────────────────────────────────────
  // 1. Avoid activities done yesterday or the day before
  // 2. Avoid activities suggested in last 3 days
  // 3. Boost pillars where the user's SSI score is lowest (weakest area)
  // 4. Boost activities the user has never done

  const recentDoneIds = new Set();
  const last2Days = [todayStr];
  for (let i = 1; i <= 2; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    last2Days.push(d.toISOString().split('T')[0]);
  }
  for (const day of last2Days) {
    const dayAct = doneActivities[day];
    if (!dayAct) continue;
    for (const [pillar, checks] of Object.entries(dayAct)) {
      checks.forEach((checked, idx) => {
        if (checked) recentDoneIds.add(`${pillar}:${idx}`);
      });
    }
  }

  const recentSuggestedIds = new Set();
  const last3Quests = questHistory.slice(-3);
  for (const q of last3Quests) {
    (q.ids || []).forEach(id => recentSuggestedIds.add(id));
  }

  // Find weakest pillar from latest SSI data
  const latestSSI = ssiHistory[0]?.parsed;
  const pillarScores = {};
  if (latestSSI) {
    for (const p of Object.keys(ALL_ACTIVITIES)) {
      pillarScores[p] = latestSSI[p] ?? 12.5; // default to mid-range
    }
  }
  const minPillarScore = Math.min(...Object.values(pillarScores));

  // Count lifetime completions per activity
  const lifetimeCounts = {};
  for (const dayActs of Object.values(doneActivities)) {
    for (const [pillar, checks] of Object.entries(dayActs)) {
      checks.forEach((checked, idx) => {
        const key = `${pillar}:${idx}`;
        if (checked) lifetimeCounts[key] = (lifetimeCounts[key] || 0) + 1;
      });
    }
  }

  // Score each activity
  const scored = pool.map(a => {
    let weight = 1.0;

    // Penalise recently done
    if (recentDoneIds.has(a.id)) weight *= 0.15;

    // Penalise recently suggested
    if (recentSuggestedIds.has(a.id)) weight *= 0.3;

    // Boost weak pillars
    if (pillarScores[a.pillar] != null) {
      const diff = pillarScores[a.pillar] - minPillarScore;
      if (diff < 2) weight *= 1.8;       // weakest pillar
      else if (diff < 5) weight *= 1.3;  // below average
    }

    // Boost never-done activities
    if (!lifetimeCounts[a.id]) weight *= 1.5;

    // Difficulty: easy=1.0, medium=0.5, hard=0.18
    weight *= DIFFICULTY_WEIGHT[a.difficulty] || 1.0;

    // Add randomness (seeded by date for reproducibility)
    const seed = hashStr(todayStr + a.id);
    weight *= 0.5 + (seed % 1000) / 1000; // 0.5-1.5x random factor

    return { ...a, weight };
  });

  // Sort by weight descending, then pick 3 from different pillars
  scored.sort((a, b) => b.weight - a.weight);

  const picks = [];
  const usedPillars = {};
  for (const a of scored) {
    if (picks.length >= 3) break;
    // Max 2 from same pillar
    if ((usedPillars[a.pillar] || 0) >= 2) continue;
    picks.push(a);
    usedPillars[a.pillar] = (usedPillars[a.pillar] || 0) + 1;
  }

  // Build quest object
  const quest = {
    date: todayStr,
    items: picks.map(a => ({
      id: a.id,
      pillar: a.pillar,
      pillarName: PILLAR_NAMES[a.pillar],
      idx: a.idx,
      label: a.label,
      difficulty: a.difficulty,
      done: false,
    })),
  };

  // Save quest
  await chrome.storage.local.set({ [QUEST_KEY]: quest });

  // Update quest history (keep last 14 days)
  questHistory.push({ date: todayStr, ids: picks.map(a => a.id) });
  if (questHistory.length > 14) questHistory.splice(0, questHistory.length - 14);
  await chrome.storage.local.set({ [QUEST_HIST_KEY]: questHistory });

  // Calculate streak
  const streak = await getActivityStreak();

  // Push notification
  if (sendNotification) {
    try {
      const actList = quest.items.map(i => `\u2022 ${i.label}`).join('\n');
      chrome.notifications.create('dailyQuest', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: streak > 1 ? `\uD83D\uDD25 ${streak}-day streak! Today's Quest` : "\uD83C\uDFAF Today's Quest",
        message: actList,
        priority: 2,
      });
    } catch (e) {
      console.log('[SocialEdge] Notification error:', e);
    }
  }

  updateQuestBadge(quest);

  console.log('[SocialEdge] Daily quest generated:', quest.items.map(i => i.label));
  return quest;
}

// Update extension icon badge with remaining quest tasks
function updateQuestBadge(quest) {
  if (!quest?.items?.length) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const remaining = quest.items.filter(i => !i.done).length;
  if (remaining === 0) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: String(remaining) });
    chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
  }
}

// Restore badge on service worker wake
chrome.storage.local.get([QUEST_KEY], (r) => updateQuestBadge(r[QUEST_KEY]));

// Simple string hash for deterministic randomness
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Calculate activity streak (consecutive days with at least 1 activity done)
async function getActivityStreak() {
  const stored = await chrome.storage.local.get([ACT_KEY_BG]);
  const acts = stored[ACT_KEY_BG] || {};
  let streak = 0;
  const d = new Date();
  // Start from yesterday (today is in progress)
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const dateStr = d.toISOString().split('T')[0];
    const dayActs = acts[dateStr];
    if (dayActs && Object.values(dayActs).some(arr => arr.some(Boolean))) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  // If today also has activity, count it too
  const todayStr = new Date().toISOString().split('T')[0];
  const todayActs = acts[todayStr];
  if (todayActs && Object.values(todayActs).some(arr => arr.some(Boolean))) {
    streak++;
  }
  return streak;
}

// Click handler for the notification
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId === 'dailyQuest') {
    // Open side panel
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.sidePanel.open({ windowId: tabs[0].windowId });
    });
    chrome.notifications.clear('dailyQuest');
  }
});

// ── Active analytics replay (same pattern as SSI replay) ──────────────────────
async function replayAnalytics() {
  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (!tabs.length) return { error: 'Open a LinkedIn tab, then try again.' };

  // CSRF token from httpOnly cookie (background can read it)
  let csrfToken = null;
  try {
    const c = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' });
    if (c?.value) {
      const raw = c.value.replace(/^"(.*)"$/, '$1');
      csrfToken = raw.startsWith('ajax:') ? raw : 'ajax:' + raw;
    }
  } catch (_) {}

  const apiHeaders = {
    'accept': 'application/vnd.linkedin.normalized+json+2.1',
    'csrf-token': csrfToken || '',
    'x-restli-protocol-version': '2.0.0',
  };

  let result;
  try {
    // ── Phase 1: get profile slug from /me ──────────────────────────────────
    const [meRes] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async (hdrs) => {
        const r = await fetch('/voyager/api/me', { credentials: 'include', headers: hdrs });
        if (!r.ok) return null;
        const j = await r.json();
        const p = (j?.included || []).find(x => x?.publicIdentifier);
        return p?.publicIdentifier ?? null;
      },
      args: [apiHeaders],
    });
    const slug = meRes?.result;
    if (!slug) return { error: 'Could not find profile slug. Open LinkedIn and try again.' };

    // ── Phase 2: navigate tab to profile page, wait, then scrape live DOM ───
    const tabId = tabs[0].id;
    const currentUrl = tabs[0].url || '';
    const profileUrl = `https://www.linkedin.com/in/${slug}/`;
    const isAlreadyOnProfile = currentUrl.includes(`/in/${slug}`);

    if (!isAlreadyOnProfile) {
      await chrome.tabs.update(tabId, { url: profileUrl });
      // Wait for the page to finish loading
      await new Promise((resolve) => {
        const listener = (tId, info) => {
          if (tId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Safety timeout
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 12000);
      });
      // Extra wait for dynamic content to render
      await new Promise(r => setTimeout(r, 3000));
    }

    // ── Phase 3: scroll page to trigger lazy-loading of analytics section ──
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        for (let i = 0; i < 12; i++) {
          window.scrollBy(0, 600);
          await new Promise(r => setTimeout(r, 350));
        }
        window.scrollTo(0, 0);
      },
    });
    // Wait for lazy content to render
    await new Promise(r => setTimeout(r, 2500));

    // ── Phase 4: scrape the LIVE DOM ────────────────────────────────────────
    const [scrapeRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const out = {};

        // ── A) Parse embedded <code> JSON blobs ──────────────────────────────
        const allIncluded = [];
        for (const el of document.querySelectorAll('code')) {
          let txt = el.textContent || '';
          txt = txt.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
          if (!txt.startsWith('{') && !txt.startsWith('[')) continue;
          try {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed?.included)) allIncluded.push(...parsed.included);
            if (parsed?.$type) allIncluded.push(parsed);
          } catch (_) {}
        }
        out._includedCount = allIncluded.length;

        function findField(fieldNames) {
          for (const item of allIncluded) {
            for (const f of fieldNames) {
              if (item?.[f] !== undefined && item[f] !== null) {
                const v = item[f];
                return typeof v === 'object' ? (v.value ?? v.count ?? v) : v;
              }
            }
          }
          return null;
        }

        out.connections       = findField(['connectionsCount', 'numConnections', 'totalConnectionCount']);
        out.followers         = findField(['followersCount', 'followerCount']);
        out.following         = findField(['followingCount']);
        out.profileViews      = findField(['numProfileViews', 'profileViewsInPeriod', 'viewedByMemberCount', 'profileViewCount']);
        out.searchAppearances = findField(['numSearchAppearances', 'searchAppearancesInPeriod', 'numAppearancesInSearch']);
        out.postImpressions   = findField(['postImpressionsInPeriod', 'totalImpressionCount', 'impressionCount']);
        out.engagements       = findField(['totalEngagementCount', 'engagementCount']);

        // ── B) innerText regex on the live rendered page ─────────────────────
        const allText = document.body?.innerText || '';
        const pn = (m) => m ? parseInt(m[1].replace(/[,.\s+]/g, '')) : null;

        // LinkedIn 2024/2025 shows:
        //   "N profile viewers" or "N\nprofile viewers"
        //   "N post impressions" or "N\npost impressions"
        //   "N search appearances" or "N\nsearch appearances"
        //   "N followers"
        //   "N+ connections" or "N connections"
        if (out.profileViews == null) {
          out.profileViews = pn(allText.match(/(\d[\d,]*)\s*\n?\s*profile\s*viewer/i))
                          ?? pn(allText.match(/(\d[\d,]*)\s*\n?\s*profile\s*view/i));
        }
        if (out.searchAppearances == null) {
          out.searchAppearances = pn(allText.match(/(\d[\d,]*)\s*\n?\s*search\s*appear/i));
        }
        if (out.postImpressions == null) {
          out.postImpressions = pn(allText.match(/(\d[\d,]*)\s*\n?\s*post\s*impression/i))
                             ?? pn(allText.match(/(\d[\d,]*)\s*\n?\s*impression/i));
        }
        if (out.followers == null) {
          out.followers = pn(allText.match(/(\d[\d,]*)\s*follower/i));
        }
        if (out.connections == null) {
          out.connections = pn(allText.match(/(\d[\d,]*)\+?\s*connection/i));
        }

        // ── C) Analytics card links ──────────────────────────────────────────
        const links = document.querySelectorAll(
          'a[href*="analytics"], a[href*="who-viewed"], a[href*="search-appearances"], ' +
          'a[href*="post-impressions"], [class*="analytics"] a, [id*="analytics"] a'
        );
        for (const el of links) {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const n = pn(t.match(/(\d[\d,]*)/));
          if (n == null) continue;
          if (/profile\s*viewer/i.test(t) && out.profileViews == null)      out.profileViews = n;
          if (/search\s*appear/i.test(t) && out.searchAppearances == null)  out.searchAppearances = n;
          if (/impression/i.test(t) && out.postImpressions == null)         out.postImpressions = n;
        }

        // ── D) Small element scan for followers / connections ────────────────
        if (out.followers == null || out.connections == null) {
          for (const el of document.querySelectorAll('span, a, p, li')) {
            const t = el.textContent?.trim() || '';
            if (t.length > 60) continue;
            if (out.followers == null) {
              const m = t.match(/^([\d,]+)\s*followers?$/i);
              if (m) out.followers = pn(m);
            }
            if (out.connections == null) {
              const m = t.match(/^([\d,]+)\+?\s*connections?$/i);
              if (m) out.connections = pn(m);
            }
          }
        }

        // ── E) Debug: snippet around "Analytics" section in innerText ────────
        const aidx = allText.indexOf('Analytics');
        if (aidx >= 0) {
          out._analyticsSnippet = allText.slice(Math.max(0, aidx - 20), aidx + 400)
            .replace(/\n{2,}/g, '\n').trim();
        } else {
          // Maybe different heading text?
          out._analyticsSnippet = 'NOT FOUND — looking for alternatives...';
          for (const heading of ['Profile viewers', 'Post impressions', 'Search appearances', 'Who viewed']) {
            const hi = allText.indexOf(heading);
            if (hi >= 0) {
              out._analyticsSnippet = `Found "${heading}" at ${hi}: ` +
                allText.slice(Math.max(0, hi - 30), hi + 200).replace(/\n{2,}/g, '\n').trim();
              break;
            }
          }
        }

        return out;
      },
    });
    result = scrapeRes?.result;

    // ── Phase 5: navigate back if we changed the page ───────────────────────
    if (!isAlreadyOnProfile && currentUrl) {
      chrome.tabs.update(tabId, { url: currentUrl });
    }
  } catch (e) {
    return { error: `executeScript failed: ${e.message}` };
  }

  if (!result) return { error: 'No result from profile scrape.' };
  if (result.error) return result;

  console.log('[SocialEdge] Profile scrape result:', JSON.stringify(result, null, 2));

  // ── Store directly into the liAnalytics format popup.js expects ────────────
  const stored  = await chrome.storage.local.get([ANALYTICS_KEY]);
  const current = stored[ANALYTICS_KEY] || {};
  const now     = Date.now();
  let anyStored = false;

  const hasNetwork = result.connections != null || result.followers != null;
  if (hasNetwork) {
    current.network = {
      ts: now, type: 'network',
      connections:  result.connections,
      followers:    result.followers,
      following:    result.following,
      profileViews: null,
    };
    anyStored = true;
  }

  const hasDashboard = result.profileViews != null || result.searchAppearances != null;
  if (hasDashboard) {
    current.dashboard = {
      ts: now, type: 'dashboard',
      profileViews:     result.profileViews,
      searchAppearances: result.searchAppearances,
    };
    anyStored = true;
  }

  const hasContent = result.postImpressions != null || result.engagements != null;
  if (hasContent) {
    current.content = {
      ts: now, type: 'content',
      impressions: result.postImpressions,
      engagements: result.engagements,
      uniqueViews: null,
      clicks:      null,
    };
    anyStored = true;
  }

  if (anyStored) {
    await chrome.storage.local.set({ [ANALYTICS_KEY]: current });

    // ── Save a history snapshot for the analytics chart (one per day, best values) ─
    const HISTORY_KEY = 'liAnalyticsHistory';
    const histStored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = histStored[HISTORY_KEY] || [];
    const todayDate = new Date(now).toISOString().split('T')[0];
    const snapshot = {
      ts: now,
      date: todayDate,
      followers:         result.followers         ?? null,
      connections:       result.connections        ?? null,
      profileViews:      result.profileViews       ?? null,
      searchAppearances: result.searchAppearances  ?? null,
      impressions:       result.postImpressions    ?? null,
      engagements:       result.engagements        ?? null,
    };
    // One entry per day — keep the biggest value for each metric
    const existingIdx = history.findIndex(h => h.date === todayDate);
    if (existingIdx >= 0) {
      const prev = history[existingIdx];
      const METRICS = ['followers', 'connections', 'profileViews', 'searchAppearances', 'impressions', 'engagements'];
      for (const m of METRICS) {
        if (snapshot[m] != null && prev[m] != null) {
          snapshot[m] = Math.max(snapshot[m], prev[m]);
        } else if (snapshot[m] == null) {
          snapshot[m] = prev[m];
        }
      }
      snapshot.ts = now;
      history[existingIdx] = snapshot;
    } else {
      history.push(snapshot);
    }
    // Keep max 365 daily snapshots
    if (history.length > 365) history.splice(0, history.length - 365);
    await chrome.storage.local.set({ [HISTORY_KEY]: history });

    const summary = [
      result.connections != null       ? `${result.connections} conn` : null,
      result.followers != null         ? `${result.followers} followers` : null,
      result.profileViews != null      ? `${result.profileViews} views` : null,
      result.searchAppearances != null ? `${result.searchAppearances} searches` : null,
      result.postImpressions != null   ? `${result.postImpressions} impressions` : null,
    ].filter(Boolean).join(', ');
    console.log('[SocialEdge] Analytics stored:', summary);
    return { success: true, statuses: summary };
  }

  return {
    error: `No analytics found on profile page. ` +
           `Found ${result._includedCount ?? 0} embedded objects, ` +
           `${result._types?.length ?? 0} types.`,
  };
}

// ── Analytics parsing & storage ───────────────────────────────────────────────
const ANALYTICS_KEY = 'liAnalytics';

function deepFind(obj, keys) {
  // Recursively search obj for any of the given keys, return first match found
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = deepFind(v, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function parseAnalytics(tag, data) {
  const result = { ts: Date.now() };

  // LinkedIn normalized JSON has two shapes:
  //   REST:    { data: { viewedByMemberCount: 42, ... }, included: [...] }
  //   GraphQL: { data: { identityDashProfileNetworkInfo: { viewedByMemberCount: 42 } }, included: [...] }
  // "included" array often contains the actual typed objects.
  const topData      = data?.data || data || {};
  const graphqlData  = (data?.data && typeof data.data === 'object') ? data.data : {};
  const graphqlValues = Object.values(graphqlData);
  const included     = Array.isArray(data?.included) ? data.included : [];

  // Helper: search an array of objects for a field
  function findInIncluded(keys) {
    for (const obj of included) {
      for (const k of keys) {
        if (obj?.[k] !== undefined) return obj[k];
      }
    }
    return undefined;
  }

  // ── Network info (followers, connections — synthesised from two endpoints) ──
  if (/networkinfo/i.test(tag)) {
    result.type = 'network';

    // Synthetic object assembled in replayAnalytics
    if (data?._synthetic) {
      const cn   = data.connections;  // /relationships/connections response
      const prof = data.profile;      // /identity/profiles/{slug} response

      // ── Connections from /relationships/connections paging.total ──────────
      result.connections = cn?.paging?.total
                           ?? deepFind(cn?.data ?? {}, ['totalConnectionCount','numConnections'])
                           ?? null;

      // ── Followers / profile views from full profile response ──────────────
      const profAll = [prof?.data, ...(prof?.included ?? [])].filter(Boolean);
      const rawFollowers = profAll.reduce((a, d) => a ?? deepFind(d, ['followersCount','followerCount']), null);
      result.followers = (rawFollowers && typeof rawFollowers === 'object')
                         ? (rawFollowers.followerCount ?? rawFollowers.value ?? null)
                         : (rawFollowers ?? null);
      result.following    = profAll.reduce((a, d) => a ?? deepFind(d, ['followingCount']), null) ?? null;
      result.profileViews = profAll.reduce((a, d) => a ?? deepFind(d, ['numProfileViews','viewedByMemberCount','profileViewCount']), null) ?? null;

      if (result.connections !== null || result.followers !== null) return result;
    }

    // Passive-capture shape (GraphQL or old REST)
    const d = graphqlValues.find(v => v && typeof v === 'object' && 'viewedByMemberCount' in v)
              ?? graphqlData.identityDashProfileNetworkInfo
              ?? (topData.viewedByMemberCount !== undefined ? topData : null)
              ?? null;

    if (d) {
      const connRaw   = deepFind(d, ['connections', 'connectionsCount', 'numConnections', 'totalConnectionCount'])
                        ?? findInIncluded(['connections', 'connectionsCount', 'numConnections']);
      const conns     = (connRaw && typeof connRaw === 'object') ? (connRaw.value ?? connRaw.paging?.total) : connRaw;
      const followers = deepFind(d, ['followersCount', 'followerCount'])
                        ?? findInIncluded(['followersCount', 'followerCount']);
      const followerVal = (followers && typeof followers === 'object')
                          ? (followers.followerCount ?? followers.value) : followers;
      result.profileViews = deepFind(d, ['viewedByMemberCount']) ?? findInIncluded(['viewedByMemberCount']) ?? null;
      result.connections  = conns       ?? null;
      result.followers    = followerVal ?? null;
      result.following    = deepFind(d, ['followingCount']) ?? null;
      if (result.profileViews !== null || result.connections !== null || result.followers !== null) return result;
    }
  }

  // ── Profile dashboard (search appearances, profile views) ────────────────
  if (/dashboardcore|profileinsights|profiledashboard|profileviews|profilestats|memberstats|searchstats|memberanalytics/i.test(tag)) {
    // profileViews endpoint: { data: { numProfileViews: N } } or { data: { count: N } }
    // searchStats endpoint:  { data: { numAppearancesInSearch: N } } or elements[]
    // Legacy dash: { data: { numAppearancesInSearch: N, numProfileViews: N } }

    // Search through every likely object
    const candidates = [
      ...graphqlValues.filter(v => v && typeof v === 'object'),
      topData,
      ...(Array.isArray(data?.elements) ? data.elements : []),
      ...included,
    ];

    const appearances = candidates.reduce((a, d) =>
      a ?? deepFind(d, ['numAppearancesInSearch', 'searchAppearances', 'numSearchAppearances']), null);
    const views = candidates.reduce((a, d) =>
      a ?? deepFind(d, ['numProfileViews', 'profileViewCount', 'viewCount', 'count']), null);

    if (appearances != null || views != null) {
      result.type              = 'dashboard';
      result.searchAppearances = appearances ?? null;
      result.profileViews      = views ?? null;
      return result;
    }
  }

  // ── Content / creator analytics (impressions, engagements) ──────────────
  if (/contentdashboard|creatordashboard|analyticsfor/i.test(tag)) {
    // elements[] array — sum all returned months for totals
    const elements = data?.elements ?? deepFind(graphqlData, ['elements']) ?? [];
    const sum = (key) => {
      const alts = {
        imp: ['totalImpressionCount', 'totalImpressions', 'impressionCount'],
        uniq: ['uniqueImpressionsCount', 'uniqueImpressions'],
        eng: ['totalEngagementCount', 'totalEngagements', 'engagementCount'],
        clk: ['totalClickCount', 'totalClicks', 'clickCount'],
      }[key];
      if (!elements.length) return deepFind(graphqlData, alts);
      return elements.reduce((acc, el) => {
        const v = deepFind(el, alts);
        return (v != null) ? (acc ?? 0) + v : acc;
      }, null);
    };
    const impressions = sum('imp');
    if (impressions != null) {
      result.type        = 'content';
      result.impressions = impressions;
      result.uniqueViews = sum('uniq') ?? null;
      result.engagements = sum('eng')  ?? null;
      result.clicks      = sum('clk')  ?? null;
      return result;
    }
  }

  return null;
}

async function storeAnalytics(tag, raw) {
  console.log('[SocialEdge] Analytics raw received, tag:', tag.slice(0, 120));
  const parsed = parseAnalytics(tag, raw);
  if (!parsed) {
    console.log('[SocialEdge] Analytics: no matching pattern, skipping');
    return;
  }

  const stored  = await chrome.storage.local.get([ANALYTICS_KEY]);
  const current = stored[ANALYTICS_KEY] || {};
  current[parsed.type] = parsed;
  await chrome.storage.local.set({ [ANALYTICS_KEY]: current });
  console.log('[SocialEdge] Analytics stored:', parsed.type, JSON.stringify(parsed));
}

// ── Profile Tips — analyze LinkedIn profile and give actionable advice ───────
const TIPS_KEY = 'profileTips';

async function replayProfileTips() {
  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (!tabs.length) return { error: 'Open a LinkedIn tab, then try again.' };

  // CSRF token
  let csrfToken = null;
  try {
    const c = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' });
    if (c?.value) {
      const raw = c.value.replace(/^"(.*)"$/, '$1');
      csrfToken = raw.startsWith('ajax:') ? raw : 'ajax:' + raw;
    }
  } catch (_) {}

  const apiHeaders = {
    'accept': 'application/vnd.linkedin.normalized+json+2.1',
    'csrf-token': csrfToken || '',
    'x-restli-protocol-version': '2.0.0',
  };

  try {
    // Phase 1: get profile slug
    const tabId = tabs[0].id;
    const [meRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (hdrs) => {
        const r = await fetch('/voyager/api/me', { credentials: 'include', headers: hdrs });
        if (!r.ok) return null;
        const j = await r.json();
        const p = (j?.included || []).find(x => x?.publicIdentifier);
        return p?.publicIdentifier ?? null;
      },
      args: [apiHeaders],
    });
    const slug = meRes?.result;
    if (!slug) return { error: 'Could not find profile slug.' };

    // Phase 2: get headline, about, photo, banner from Voyager API (reliable structured data)
    const [apiRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (profileSlug, hdrs) => {
        try {
          const r = await fetch(`/voyager/api/identity/profiles/${profileSlug}`, {
            credentials: 'include', headers: hdrs,
          });
          if (!r.ok) return { _error: `HTTP ${r.status}`, _keys: [] };
          const data = await r.json();
          // Data may be top-level or inside data/included
          const p = data?.data || data || {};
          const included = data?.included || [];
          // Find the profile entity in included
          const profileEntity = included.find(e =>
            e.publicIdentifier === profileSlug ||
            (e.$type || '').includes('Profile')
          ) || p;
          // Search all included entities for headline
          let headline = profileEntity.headline || p.headline || '';
          let summary = profileEntity.summary || p.summary || '';
          if (!headline || !summary) {
            for (const e of included) {
              if (!headline && e.headline) headline = e.headline;
              if (!summary && e.summary) summary = e.summary;
            }
          }
          return {
            headline: headline.trim(),
            summary: summary.trim(),
            hasPhoto: !!(
              profileEntity.profilePicture || p.profilePicture ||
              profileEntity.displayPictureUrl || p.displayPictureUrl ||
              profileEntity.picture || p.picture ||
              included.some(e => e.profilePicture || e.picture)
            ),
            hasBanner: !!(
              profileEntity.backgroundImage || p.backgroundImage ||
              profileEntity.backgroundPicture || p.backgroundPicture ||
              included.some(e => e.backgroundImage || e.backgroundPicture)
            ),
            _keys: Object.keys(profileEntity).slice(0, 30),
            _pKeys: Object.keys(p).slice(0, 30),
            _includedCount: included.length,
            _includedTypes: [...new Set(included.map(e => e.$type || ''))].slice(0, 10),
          };
        } catch (e) { return { _error: e.message, _keys: [] }; }
      },
      args: [slug, apiHeaders],
    });
    const apiData = apiRes?.result;

    // Phase 3: navigate to profile and scrape DOM for section detection
    const profileUrl = `https://www.linkedin.com/in/${slug}/`;
    const currentUrl = tabs[0].url || '';
    if (!currentUrl.includes(`/in/${slug}`)) {
      await chrome.tabs.update(tabId, { url: profileUrl });
      await new Promise((resolve) => {
        const listener = (tId, info) => {
          if (tId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    // Phase 4: scroll page to load lazy sections, find them by text in <section> headings
    const [scrapeRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        // Scroll twice to load all lazy sections
        for (let pass = 0; pass < 2; pass++) {
          const totalH = document.body.scrollHeight;
          for (let y = 0; y <= totalH; y += 300) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 300));
          }
          await new Promise(r => setTimeout(r, 500));
        }
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 500));

        // Collect all <section> elements — grab the first ~100 chars for matching
        const allSections = [...document.querySelectorAll('section')];
        const sectionTexts = allSections.map(sec => {
          // Get heading text (first h2/h3 or header-like element)
          const heading = sec.querySelector('h2, h3, [class*="pvs-header"] span, [class*="header"] span');
          const headingText = heading ? heading.textContent.trim().toLowerCase() : '';
          // Also get first 150 chars of section for broader matching
          const fullText = sec.textContent.substring(0, 150).toLowerCase();
          return { el: sec, headingText, fullText };
        });

        const debug = {};

        // ── Find section by keyword ──
        function findSec(...keywords) {
          for (const kw of keywords) {
            const kwl = kw.toLowerCase();
            // First try heading match (more precise)
            for (const s of sectionTexts) {
              if (s.headingText.includes(kwl)) return s.el;
            }
            // Then try full text match
            for (const s of sectionTexts) {
              if (s.fullText.includes(kwl)) return s.el;
            }
          }
          return null;
        }

        function countListItems(sec) {
          if (!sec) return 0;
          return sec.querySelectorAll('li').length;
        }

        // ── Detect each section ──
        const CHECKS = {
          experience:      ['experience'],
          education:       ['education'],
          skills:          ['skills'],
          certifications:  ['licenses', 'certification'],
          recommendations: ['recommendation'],
          featured:        ['featured'],
          volunteer:       ['volunteer'],
          projects:        ['project'],
          publications:    ['publication'],
          activity:        ['activity'],
        };

        const result = {};
        for (const [key, keywords] of Object.entries(CHECKS)) {
          const sec = findSec(...keywords);
          const found = !!sec;
          debug[key] = found ? keywords[0] : 'not found';

          if (key === 'skills' && sec) {
            let count = countListItems(sec);

            // LinkedIn uses div-based skill chips, not always <li>
            if (count === 0) {
              const skillSelectors = [
                '[class*="artdeco-list__item"]',
                '[class*="pvs-list__item"]',
                '[class*="skill"]',
                '[data-view-name="profile-component-entity"]',
              ];
              for (const sel of skillSelectors) {
                const n = sec.querySelectorAll(sel).length;
                if (n > 0) { count = n; break; }
              }
            }

            // Fallback: parse "(n)" from heading like "Skills (66)"
            if (count === 0) {
              const heading = sec.querySelector('h2, h3, [class*="header"] span, [class*="pvs-header"] span');
              const hText = heading ? heading.textContent : sec.textContent.substring(0, 100);
              const numMatch = hText.match(/\((\d+)\)/);
              if (numMatch) count = parseInt(numMatch[1], 10);
            }

            debug.skillCount = count;
            result[key] = { status: count === 0 ? 'missing' : count < 5 ? 'weak' : 'complete', count };
          } else if (key === 'recommendations' && sec) {
            let count = countListItems(sec); // li elements

            // LinkedIn uses div-based cards, not <li> — try multiple selectors
            if (count === 0) {
              const cardSelectors = [
                '[class*="artdeco-list__item"]',
                '[class*="recommendation"]',
                '[class*="pvs-list__item"]',
                '[class*="profile-component-entity"]',
                '[data-view-name="profile-component-entity"]',
                'article',
              ];
              for (const sel of cardSelectors) {
                const n = sec.querySelectorAll(sel).length;
                if (n > 0) { count = n; break; }
              }
            }

            // Fallback: parse "(n)" from heading
            if (count === 0) {
              const heading = sec.querySelector('h2, h3, [class*="header"] span, [class*="pvs-header"] span');
              const hText = heading ? heading.textContent : sec.textContent.substring(0, 100);
              const numMatch = hText.match(/\((\d+)\)/);
              if (numMatch) count = parseInt(numMatch[1], 10);
            }

            // Last resort: section exists and has substantial text → at least 1 recommendation
            if (count === 0) {
              const secText = sec.textContent.trim();
              // More than 300 chars beyond just the heading = actual recommendation content
              const headingLen = sec.querySelector('h2, h3')?.textContent.length || 0;
              if (secText.length - headingLen > 300) count = 1;
            }

            debug.recCount = count;
            result[key] = { status: count === 0 ? 'missing' : count < 3 ? 'weak' : 'complete', count };
          } else {
            result[key] = { status: found ? 'complete' : 'missing' };
          }
        }

        // ── About section quality check via DOM ──
        const aboutSec = findSec('about');
        debug.aboutFound = !!aboutSec;
        if (aboutSec) {
          // Get longest text block in the section (the actual about text)
          let longest = '';
          for (const el of aboutSec.querySelectorAll('span, p, div')) {
            const t = el.textContent.trim();
            if (t.length > longest.length && !t.includes('\n')) longest = t;
          }
          // Fallback: full section text minus heading
          if (longest.length < 30) {
            longest = aboutSec.textContent.replace(/^\s*about\s*/i, '').trim();
          }
          debug.aboutLength = longest.length;
          if (longest.length < 20) result.about = { status: 'missing', length: 0 };
          else if (longest.length < 100) result.about = { status: 'weak', length: longest.length };
          else result.about = { status: 'complete', length: longest.length };
        } else {
          result.about = { status: 'missing', length: 0 };
        }

        // ── Headline detection ──
        // Note: LinkedIn may NOT have an <h1> element on the page anymore.
        // Get the profile name from document.title: "Name | LinkedIn"
        let domHeadline = '';
        const pgTitle = document.title || '';
        debug.pageTitle = pgTitle.substring(0, 150);
        const titleName = pgTitle.replace(/\s*\|.*$/, '').replace(/\s*[-–—].*$/, '').trim();
        const nameLower = titleName.toLowerCase();
        debug.profileName = titleName;

        // Also try h1 as fallback for name
        const h1 = document.querySelector('h1');
        debug.h1Found = !!h1;
        if (h1) debug.h1Text = h1.textContent.trim();

        function isHeadlineCandidate(t) {
          if (!t || t.length < 5 || t.length > 300) return false;
          const tl = t.toLowerCase();
          if (tl === nameLower) return false;
          if (nameLower && tl.includes(nameLower)) return false;
          if (/^(connect|follow|more|message|open to|pending|edit|save|cancel)/i.test(t)) return false;
          if (/^\d+\s*(connection|follower|mutual)/i.test(t)) return false;
          if (/^(contact info|show all|about|experience|education|skills|activity|featured|see all)/i.test(t)) return false;
          if (/^(licenses|certification|recommendation|project|publication|language|interest|volunteer)/i.test(t)) return false;
          if (/^(who your|people you|you might|analytics|\d+ notification)/i.test(t)) return false;
          return true;
        }

        // ── Headline detection helpers ──
        function decodeJsonString(s) {
          return s.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                  .replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\"/g, '"').trim();
        }

        // Search a text blob for headline candidates using multiple patterns.
        // Handles BOTH flat strings and LinkedIn's nested {"text":"..."} format.
        function extractHeadlineFromBlob(blob) {
          let best = '';
          function tryCandidate(raw) {
            const c = decodeJsonString(raw);
            if (isHeadlineCandidate(c) && c.length > best.length) best = c;
          }
          // Pattern A: flat string  "occupation":"..." or "headline":"..."
          for (const m of blob.matchAll(/"(?:occupation|headline)"\s*:\s*"([^"]{5,500})"/g)) tryCandidate(m[1]);
          // Pattern B: nested object — search around every "headline" / "occupation" occurrence
          //   e.g. "headline":{"attributes":[...],"text":"Data & Operations Analyst..."}
          let pos = 0;
          const keys = ['"headline"', '"occupation"'];
          for (const key of keys) {
            pos = 0;
            while ((pos = blob.indexOf(key, pos)) !== -1) {
              // Look for "text":"..." within the next 2000 chars
              const window2k = blob.substring(pos, pos + 2000);
              const tm = window2k.match(/"text"\s*:\s*"([^"]{5,500})"/);
              if (tm?.[1]) tryCandidate(tm[1]);
              pos += key.length;
            }
          }
          return best;
        }

        // Strategy 0: DOM — script[type="application/json"] tags (LinkedIn's current SSR format)
        const scriptJsonEls = document.querySelectorAll('script[type="application/json"]');
        debug.scriptJsonCount = scriptJsonEls.length;
        const codeEls = document.querySelectorAll('code');
        debug.codeTagCount = codeEls.length;

        let bestHeadline = '';
        for (const el of [...scriptJsonEls, ...codeEls]) {
          const txt = el.textContent;
          if (!txt || txt.length < 50) continue;
          const found = extractHeadlineFromBlob(txt);
          if (found.length > bestHeadline.length) bestHeadline = found;
        }
        if (bestHeadline) {
          domHeadline = bestHeadline;
          debug.headlineStrategy = '0-dom-json';
        }

        // Strategy 0b: JSON-LD <script> tags
        if (!domHeadline) {
          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const ld = JSON.parse(script.textContent);
              const candidate = ld.jobTitle || ld.headline || '';
              if (candidate && isHeadlineCandidate(candidate)) {
                domHeadline = candidate.trim();
                debug.headlineStrategy = '0b-jsonld';
                break;
              }
            } catch (_) {}
          }
        }

        // Strategy 1: DOM class selectors — LinkedIn profile top card
        if (!domHeadline) {
          // Try every class pattern LinkedIn uses for headline text
          const domSelectors = [
            '.text-body-medium.break-words',
            '.text-body-medium',
            '[class*="top-card__headline"]',
            '[class*="pv-text-details__left-panel"] .mt2',
            '[class*="profile-info-subheader"]',
            '[class*="headline"]',
            '[data-generated-suggestion-type]',
          ];
          debug.domSelectorSamples = {};
          for (const sel of domSelectors) {
            const els = document.querySelectorAll(sel);
            // Log first 3 texts for diagnostics
            debug.domSelectorSamples[sel] = [...els].slice(0, 3).map(e => e.textContent.trim().substring(0, 80));
            for (const el of els) {
              const t = el.textContent.trim().replace(/\s+/g, ' ');
              if (isHeadlineCandidate(t) && t.length > domHeadline.length) {
                domHeadline = t;
                debug.headlineStrategy = `1-dom:${sel}`;
              }
            }
            if (domHeadline) break;
          }
        }

        // Strategy 2: Walk UP from name element, check siblings at every level
        // LinkedIn uses CSS modules — no class names we can predict. Position is the only signal.
        if (!domHeadline) {
          const nameEl = [...document.querySelectorAll('h1, h2, h3, div, span')]
            .find(el => {
              const t = el.textContent.trim();
              return t.toLowerCase() === nameLower && t.length < 80 && el.children.length <= 2;
            });
          debug.nameElTag = nameEl ? (nameEl.tagName + ' ' + nameEl.className.substring(0, 60)) : 'not found';
          if (nameEl) {
            const siblingTexts = [];
            let cur = nameEl;
            for (let level = 0; level < 10 && !domHeadline; level++) {
              const parent = cur.parentElement;
              if (!parent || parent === document.body) break;
              for (const child of parent.children) {
                if (child === cur || child.contains(nameEl)) continue;
                const t = child.textContent.trim().replace(/\s+/g, ' ');
                siblingTexts.push(`L${level}:"${t.substring(0, 100)}"`);
                if (t.length >= 10 && t.length <= 400 && isHeadlineCandidate(t)) {
                  domHeadline = t;
                  debug.headlineStrategy = `2-walkup-L${level}`;
                  break;
                }
                // Also check direct children of this sibling
                for (const grandchild of child.children) {
                  const gt = grandchild.textContent.trim().replace(/\s+/g, ' ');
                  siblingTexts.push(`L${level}c:"${gt.substring(0, 100)}"`);
                  if (gt.length >= 10 && gt.length <= 400 && isHeadlineCandidate(gt)) {
                    domHeadline = gt;
                    debug.headlineStrategy = `2-walkup-L${level}-child`;
                    break;
                  }
                }
                if (domHeadline) break;
              }
              cur = parent;
            }
            debug.siblingTexts = siblingTexts.slice(0, 15);
          }
        }

        // Strategy 3b: Full page leaf-text scan — nuclear option
        // Scans ALL leaf text nodes for professional headline patterns
        if (!domHeadline) {
          const leafEls = [...document.querySelectorAll('span, div, p, h1, h2, h3')];
          for (const el of leafEls) {
            if (el.children.length > 0) continue; // leaf nodes only
            const t = el.textContent.trim().replace(/\s+/g, ' ');
            if (t.length < 20 || t.length > 350) continue;
            if (!isHeadlineCandidate(t)) continue;
            // Must contain a professional keyword or pipe separator
            if (t.includes(' | ') || t.includes(' / ') ||
                /\b(analyst|engineer|manager|developer|director|founder|consultant|specialist|executive|architect|scientist|designer|researcher|strategist|advisor|associate|officer)\b/i.test(t)) {
              domHeadline = t;
              debug.headlineStrategy = '3b-leafscan';
              break;
            }
          }
        }

        // Strategy 3: Fetch raw HTML — handles nested {"text":"..."} format
        if (!domHeadline) {
          try {
            const rawResp = await fetch(window.location.href, { credentials: 'include' });
            const rawHtml = await rawResp.text();
            debug.rawHtmlLen = rawHtml.length;
            // Sample the first "headline" context for diagnostics
            const sampleIdx = rawHtml.indexOf('"headline"');
            if (sampleIdx !== -1) debug.headlineSample = rawHtml.substring(sampleIdx, sampleIdx + 200);
            const rawBest = extractHeadlineFromBlob(rawHtml);
            if (rawBest) {
              domHeadline = rawBest;
              debug.headlineStrategy = '3-raw-html';
            }
            // Fallback: title tag "Name - Headline | LinkedIn"
            if (!domHeadline) {
              const rawTitle = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
              debug.rawTitle = rawTitle?.[1]?.substring(0, 150) || '';
              const rm = rawTitle?.[1]?.match(/^.+?\s*[-–—]\s*(.+?)\s*\|\s*LinkedIn/i);
              if (rm?.[1] && isHeadlineCandidate(rm[1].trim())) {
                domHeadline = rm[1].trim();
                debug.headlineStrategy = '3-raw-title';
              }
            }
          } catch (e) { debug.rawFetchError = e.message; }
        }

        // Strategy 4: document.title (works for other profiles "Name - Headline | LinkedIn")
        if (!domHeadline) {
          const tm = pgTitle.match(/^.+?\s*[-–—]\s*(.+?)\s*\|\s*LinkedIn/i);
          if (tm?.[1] && isHeadlineCandidate(tm[1].trim())) {
            domHeadline = tm[1].trim();
            debug.headlineStrategy = '4-title';
          }
        }

        debug.headlineMatchCount = domHeadline ? 1 : 0;

        debug.domHeadline = domHeadline.substring(0, 300);

        // ── Photo from DOM — search ENTIRE page, not just one section ──
        let domPhoto = false;
        debug.photoStrategy = 'none';
        // Strategy 1: LinkedIn CDN URL patterns (most reliable)
        for (const img of document.querySelectorAll('img')) {
          if (img.src && (
            img.src.includes('profile-displayphoto') ||
            img.src.includes('shrink_100_100') ||
            img.src.includes('shrink_200_200') ||
            img.src.includes('shrink_400_400') ||
            img.src.includes('shrink_800_800')
          )) {
            domPhoto = true;
            debug.photoStrategy = '1-cdn-url';
            break;
          }
        }
        // Strategy 2: Any non-ghost img on media.licdn.com in the top area
        if (!domPhoto) {
          for (const img of document.querySelectorAll('img')) {
            if (img.src && img.src.includes('media.licdn.com') &&
                !img.src.includes('ghost') && !img.src.includes('company') &&
                !img.src.includes('default')) {
              const w = img.naturalWidth || img.width || img.offsetWidth || 0;
              const ht = img.naturalHeight || img.height || img.offsetHeight || 0;
              if (w >= 40 && ht >= 40 && Math.abs(w - ht) < w * 0.8) {
                domPhoto = true;
                debug.photoStrategy = '2-media-licdn';
                break;
              }
            }
          }
        }
        // Strategy 3: class name patterns anywhere on page
        if (!domPhoto) {
          const photoEls = document.querySelectorAll(
            '[class*="profile-photo"], [class*="avatar"], [class*="presence-entity"], ' +
            '[class*="pv-top-card-profile-picture"], [class*="profile-picture"]'
          );
          for (const el of photoEls) {
            const img = el.tagName === 'IMG' ? el : el.querySelector('img');
            if (img?.src && !img.src.includes('ghost') && !img.src.includes('default')) {
              domPhoto = true;
              debug.photoStrategy = '3-classname';
              break;
            }
            const bg = getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && bg.includes('url(') && !bg.includes('ghost')) {
              domPhoto = true;
              debug.photoStrategy = '3-classname-bg';
              break;
            }
          }
        }
        debug.domPhoto = domPhoto;

        // ── Banner from DOM — search ENTIRE page ──
        let domBanner = false;
        debug.bannerStrategy = 'none';
        // Strategy 1: LinkedIn CDN banner URL pattern
        for (const img of document.querySelectorAll('img')) {
          if (img.src && (
            img.src.includes('profile-displaybackgroundimage') ||
            img.src.includes('background') && img.src.includes('shrink')
          )) {
            domBanner = true;
            debug.bannerStrategy = '1-cdn-url';
            break;
          }
        }
        // Strategy 2: class name patterns for banner
        if (!domBanner) {
          const bannerEls = document.querySelectorAll(
            '[class*="profile-background"], [class*="banner"], ' +
            '[class*="cover-img"], [class*="pv-top-card--photo-resize"]'
          );
          for (const el of bannerEls) {
            const img = el.tagName === 'IMG' ? el : el.querySelector('img');
            if (img?.src && !img.src.includes('default') && !img.src.includes('ghost')) {
              domBanner = true;
              debug.bannerStrategy = '2-classname';
              break;
            }
            const bg = getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && bg.includes('url(') && !bg.includes('default') && !bg.includes('ghost')) {
              domBanner = true;
              debug.bannerStrategy = '2-classname-bg';
              break;
            }
          }
        }
        // Strategy 3: wide images anywhere on page (ratio > 2:1, 200px+)
        if (!domBanner) {
          for (const img of document.querySelectorAll('img')) {
            if (!img.src || !img.src.startsWith('http') || img.src.includes('default')) continue;
            const w = img.naturalWidth || img.width || img.offsetWidth || 0;
            const ht = img.naturalHeight || img.height || img.offsetHeight || 0;
            if (w >= 200 && ht > 0 && w > ht * 2) {
              domBanner = true;
              debug.bannerStrategy = '3-wide-img';
              break;
            }
          }
        }
        // Strategy 4: background-image on any wide div near top of page
        if (!domBanner) {
          for (const el of document.querySelectorAll('div, section')) {
            const bg = getComputedStyle(el).backgroundImage;
            if (bg && bg !== 'none' && bg.includes('url(') && !bg.includes('default') && !bg.includes('ghost')) {
              const rect = el.getBoundingClientRect();
              if (rect.width >= 300 && rect.height >= 50 && rect.width > rect.height * 1.5 && rect.top < 600) {
                domBanner = true;
                debug.bannerStrategy = '4-bg-image-div';
                break;
              }
            }
          }
        }
        debug.domBanner = domBanner;

        // Log all section headings for debugging
        debug.sectionHeadings = sectionTexts.map(s => s.headingText).filter(Boolean);

        result._debug = debug;
        return result;
      },
    });

    const domSections = scrapeRes?.result || {};
    const debug = domSections._debug || {};
    delete domSections._debug;

    // Phase 5: merge API data + DOM results
    // RULE: if EITHER source says it exists, mark as complete. Never let a broken API override DOM.
    const sections = { ...domSections };
    const apiHasRealData = apiData && apiData._keys && apiData._keys.length > 3;

    // Photo — true if DOM OR API says it exists
    const hasPhoto = debug.domPhoto || (apiHasRealData && apiData.hasPhoto);
    sections.photo = { status: hasPhoto ? 'complete' : 'missing' };
    debug.photoSource = debug.domPhoto ? 'dom' : (apiHasRealData ? 'api' : 'none');

    // Banner — true if DOM OR API says it exists
    const hasBanner = debug.domBanner || (apiHasRealData && apiData.hasBanner);
    sections.banner = { status: hasBanner ? 'complete' : 'missing' };
    debug.bannerSource = debug.domBanner ? 'dom' : (apiHasRealData ? 'api' : 'none');

    // Headline — use API text if available, else DOM text
    const headlineText = (apiHasRealData && apiData.headline) ? apiData.headline : (debug.domHeadline || '');
    debug.headlineApi = (apiData?.headline || '').substring(0, 60);
    debug.headlineFinal = headlineText.substring(0, 60);
    debug.headlineSource = (apiHasRealData && apiData.headline) ? 'api' : 'dom';
    if (!headlineText) sections.headline = { status: 'missing', length: 0 };
    else if (headlineText.length < 20) sections.headline = { status: 'weak', length: headlineText.length };
    else sections.headline = { status: 'complete', length: headlineText.length };

    // About — prefer whichever source gives more text
    if (apiHasRealData && apiData.summary) {
      const apiAbout = apiData.summary;
      const domLen = sections.about?.length || 0;
      if (apiAbout.length > domLen) {
        debug.aboutApi = apiAbout.length;
        if (apiAbout.length < 100) sections.about = { status: 'weak', length: apiAbout.length };
        else sections.about = { status: 'complete', length: apiAbout.length };
      }
    }

    debug.apiKeys = apiData?._keys || [];
    debug.apiPKeys = apiData?._pKeys || [];
    debug.apiIncludedCount = apiData?._includedCount ?? 0;
    debug.apiIncludedTypes = apiData?._includedTypes || [];
    debug.apiError = apiData?._error || '';
    console.log('[SocialEdge] Profile scrape debug:', JSON.stringify(debug));

    // Generate tips
    const ssiStored = await chrome.storage.local.get([SSI_HISTORY_KEY]);
    const latestSSI = (ssiStored[SSI_HISTORY_KEY] || [])[0]?.parsed;
    const tips = generateProfileTips(sections, latestSSI);

    // Completeness score
    const allStatuses = Object.values(sections).map(s => s.status);
    const total = allStatuses.length;
    const complete = allStatuses.filter(s => s === 'complete').length;
    const weak = allStatuses.filter(s => s === 'weak').length;
    const pct = Math.round(((complete + weak * 0.5) / total) * 100);

    const result = {
      ts: Date.now(),
      date: new Date().toISOString().split('T')[0],
      slug,
      sections,
      tips,
      score: { total, complete, weak, missing: total - complete - weak, pct },
      debug,
    };

    await chrome.storage.local.set({ [TIPS_KEY]: result });
    console.log('[SocialEdge] Profile tips generated:', tips.length, 'tips, score:', pct + '%');
    return result;
  } catch (e) {
    console.error('[SocialEdge] Profile tips error:', e.message);
    return { error: e.message };
  }
}

function generateProfileTips(sections, ssi) {
  const TIPS_DB = [
    { section: 'photo', status: 'missing', pillar: 'prof_brand', priority: 1, impact: 'high',
      title: 'Add a professional headshot',
      desc: 'Profiles with photos get 14x more views. Use a clear, friendly photo with good lighting.' },
    { section: 'banner', status: 'missing', pillar: 'prof_brand', priority: 2, impact: 'medium',
      title: 'Upload a custom banner image',
      desc: 'Replace the default banner with one that reflects your brand, industry, or value proposition.' },
    { section: 'headline', status: 'missing', pillar: 'prof_brand', priority: 1, impact: 'high',
      title: 'Add a headline',
      desc: 'Your headline appears everywhere on LinkedIn. Write one that showcases your expertise and value.' },
    { section: 'headline', status: 'weak', pillar: 'prof_brand', priority: 1, impact: 'high',
      title: 'Expand your headline',
      desc: 'Your headline is short. Go beyond your job title — include your specialty and the value you bring (aim for 80+ characters).' },
    { section: 'about', status: 'missing', pillar: 'prof_brand', priority: 1, impact: 'high',
      title: 'Write an About section',
      desc: "It's your elevator pitch. Explain who you help, how you help them, and what makes you different." },
    { section: 'about', status: 'weak', pillar: 'prof_brand', priority: 1, impact: 'high',
      title: 'Expand your About section',
      desc: 'Your About is under 100 characters. Aim for 300+ words with industry keywords to boost search visibility.' },
    { section: 'experience', status: 'missing', pillar: 'prof_brand', priority: 1, impact: 'high',
      title: 'Add your work experience',
      desc: 'Experience entries are essential for credibility. Include descriptions with quantified achievements.' },
    { section: 'education', status: 'missing', pillar: 'prof_brand', priority: 2, impact: 'medium',
      title: 'Add your education',
      desc: 'Education builds credibility and helps alumni find you.' },
    { section: 'skills', status: 'missing', pillar: 'find_right_people', priority: 1, impact: 'high',
      title: 'Add skills to your profile',
      desc: 'Skills boost your ranking in LinkedIn search. Add at least 10 relevant skills.' },
    { section: 'skills', status: 'weak', pillar: 'find_right_people', priority: 2, impact: 'medium',
      title: 'Add more skills',
      desc: 'You have fewer than 5 skills listed. Profiles with 5+ skills get up to 17x more profile views.' },
    { section: 'certifications', status: 'missing', pillar: 'prof_brand', priority: 3, impact: 'low',
      title: 'Add certifications & licenses',
      desc: 'Certifications signal expertise. Add relevant ones to stand out from competitors.' },
    { section: 'recommendations', status: 'missing', pillar: 'relationship', priority: 2, impact: 'high',
      title: 'Get recommendations',
      desc: 'Recommendations are powerful social proof. Ask colleagues and clients for specific, detailed recommendations.' },
    { section: 'recommendations', status: 'weak', pillar: 'relationship', priority: 2, impact: 'medium',
      title: 'Get more recommendations',
      desc: 'You have fewer than 3 recommendations. Aim for 5+ to build stronger social proof.' },
    { section: 'featured', status: 'missing', pillar: 'insight_engagement', priority: 2, impact: 'medium',
      title: 'Add featured content',
      desc: 'Showcase your best posts, articles, links, or media in the Featured section to make a strong first impression.' },
    { section: 'volunteer', status: 'missing', pillar: 'relationship', priority: 3, impact: 'low',
      title: 'Add volunteer experience',
      desc: 'Volunteer work signals values and broadens your network. 41% of hiring managers consider it equal to work experience.' },
    { section: 'publications', status: 'missing', pillar: 'insight_engagement', priority: 3, impact: 'low',
      title: 'Add publications',
      desc: 'If you\'ve written articles or papers, add them to demonstrate thought leadership.' },
    { section: 'projects', status: 'missing', pillar: 'prof_brand', priority: 3, impact: 'low',
      title: 'Showcase projects',
      desc: 'Add relevant projects to demonstrate hands-on experience and real-world results.' },
  ];

  // Find weakest pillar to boost priority for those tips
  let weakestPillar = null;
  if (ssi) {
    const pillarScores = {
      prof_brand: ssi.prof_brand ?? 25,
      find_right_people: ssi.find_right_people ?? 25,
      insight_engagement: ssi.insight_engagement ?? 25,
      relationship: ssi.relationship ?? 25,
    };
    weakestPillar = Object.entries(pillarScores).sort((a, b) => a[1] - b[1])[0][0];
  }

  const tips = [];
  for (const tip of TIPS_DB) {
    const sec = sections[tip.section];
    if (sec && sec.status === tip.status) {
      const t = { ...tip };
      // Boost priority for tips that help the weakest pillar
      if (weakestPillar && tip.pillar === weakestPillar && t.priority > 1) {
        t.priority = Math.max(1, t.priority - 1);
        t.boosted = true;
      }
      tips.push(t);
    }
  }

  tips.sort((a, b) => a.priority - b.priority);
  return tips.slice(0, 10);
}

// ── Message handler ───────────────────────────────────────────────────────────
// ── Job Suggestions ─────────────────────────────────────────────────────────
const JOBS_KEY = 'jobSuggestions';

async function fetchJobSuggestions() {
  console.log('[SocialEdge][Jobs] Starting job fetch...');
  const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (!tabs.length) return { error: 'Open a LinkedIn tab, then try again.' };

  const tabId = tabs[0].id;
  const originalUrl = tabs[0].url || '';
  console.log('[SocialEdge][Jobs] Tab:', tabId, 'URL:', originalUrl);

  try {
    // Navigate to LinkedIn Recommended Jobs page (not generic /jobs/ search page)
    const jobsUrl = 'https://www.linkedin.com/jobs/collections/recommended/';
    const needsNav = !originalUrl.includes('/jobs/collections/recommended');
    if (needsNav) {
      console.log('[SocialEdge][Jobs] Navigating to jobs page...');
      await chrome.tabs.update(tabId, { url: jobsUrl });
      await new Promise((resolve) => {
        const listener = (tId, info) => {
          if (tId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
      });
      // Wait extra time for React to hydrate and render job cards
      await new Promise(r => setTimeout(r, 7000));
      console.log('[SocialEdge][Jobs] Navigation done, waited 7s');
    }

    // Scroll to trigger lazy-loading of job cards
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        // Scroll down in the jobs list container (not just window)
        const scrollTargets = [
          document.querySelector('.jobs-search-results-list'),
          document.querySelector('.scaffold-layout__list'),
          document.querySelector('[class*="jobs-search-results"]'),
          window,
        ].filter(Boolean);
        for (let step = 0; step < 8; step++) {
          const y = step * 400;
          for (const t of scrollTargets) {
            if (t === window) window.scrollTo(0, y);
            else t.scrollTop = y;
          }
          await new Promise(r => setTimeout(r, 400));
        }
        // Scroll back to top
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 600));
      },
    });
    console.log('[SocialEdge][Jobs] Scrolling done');

    // Scrape job cards from the DOM
    const [scrapeRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const jobs = [];
        const seen = new Set();
        const debug = {};

        debug.url = window.location.href;
        debug.title = document.title;

        // Helper: get clean text from element
        function cleanText(el) {
          if (!el) return '';
          return el.textContent.trim().replace(/\s+/g, ' ');
        }

        // Find all job view links on the page
        const allAnchors = [...document.querySelectorAll('a[href*="/jobs/view/"]')];
        debug.totalAnchors = document.querySelectorAll('a').length;
        debug.jobViewLinks = allAnchors.length;
        debug.sampleLinks = allAnchors.slice(0, 3).map(a => a.getAttribute('href')?.substring(0, 80));

        // Also count container-level job elements for diagnostics
        const jobCardEls = document.querySelectorAll(
          '[data-occludable-job-id], [data-job-id], [class*="job-card-container"], ' +
          '[class*="job-card-list"], li[class*="scaffold-layout"]'
        );
        debug.jobCardElements = jobCardEls.length;
        const listItems = document.querySelectorAll('ul[class*="scaffold"] li, ul[class*="jobs-search"] li');
        debug.jobListItems = listItems.length;

        // Approach 1: links with /jobs/view/
        for (const link of allAnchors) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/\/jobs\/view\/(\d+)/);
          if (!match) continue;
          const jobId = match[1];
          if (seen.has(jobId)) continue;
          seen.add(jobId);

          // Walk up to find the best card container
          const card = link.closest('[data-occludable-job-id]')
            || link.closest('[data-job-id]')
            || link.closest('li')
            || link.closest('[class*="job-card"]')
            || link.closest('[class*="artdeco-entity-lockup"]')
            || link.parentElement?.parentElement?.parentElement
            || link.parentElement;

          // Extract title — link text is most reliable, then fallbacks
          let title = '';
          const titleCandidates = [
            link.querySelector('span[aria-hidden="true"]'),
            link.querySelector('strong'),
            link,
            card?.querySelector('[class*="job-card-list__title"]'),
            card?.querySelector('[class*="title"]'),
            card?.querySelector('strong'),
            card?.querySelector('span[dir="ltr"]'),
          ].filter(Boolean);
          for (const el of titleCandidates) {
            const t = cleanText(el);
            if (t.length >= 3 && t.length <= 150) { title = t; break; }
          }
          if (!title) continue;

          // Extract company
          let company = '';
          const companyCandidates = [
            card?.querySelector('[class*="subtitle"]'),
            card?.querySelector('[class*="primary-description"]'),
            card?.querySelector('[class*="company-name"]'),
            card?.querySelector('[class*="entity-lockup__subtitle"] span'),
            card?.querySelector('[class*="job-card-container__company-name"]'),
          ].filter(Boolean);
          for (const el of companyCandidates) {
            const t = cleanText(el);
            if (t.length >= 2 && t.length <= 100 && !t.match(/^\d+ (hour|day|week|month)/i)) {
              company = t; break;
            }
          }

          // Extract location
          let location = '';
          const locCandidates = [
            card?.querySelector('[class*="caption"]'),
            card?.querySelector('[class*="metadata-item"]'),
            card?.querySelector('[class*="job-card-container__metadata-item"]'),
            card?.querySelector('[class*="location"]'),
          ].filter(Boolean);
          for (const el of locCandidates) {
            const t = cleanText(el);
            if (t.length >= 2 && t.length <= 100) { location = t; break; }
          }

          // Extract logo
          let logo = '';
          const logoImg = card?.querySelector('img');
          if (logoImg?.src && !logoImg.src.includes('ghost') && !logoImg.src.includes('data:') && !logoImg.src.includes('profile-displayphoto')) {
            logo = logoImg.src;
          }

          // Check remote/hybrid
          const cardText = (card?.textContent || '').toLowerCase();
          const isRemote = cardText.includes('remote') || cardText.includes('hybrid');

          // Extract time posted
          let timeText = '';
          const timeEl = card?.querySelector('time');
          if (timeEl) {
            timeText = cleanText(timeEl);
          } else {
            const timeMatch = cardText.match(/(\d+\s*(minute|hour|day|week|month)s?\s*ago)/i);
            if (timeMatch) timeText = timeMatch[1];
          }

          jobs.push({
            id: jobId,
            title: title.substring(0, 120),
            company: company.substring(0, 80),
            location: location.substring(0, 80),
            url: `https://www.linkedin.com/jobs/view/${jobId}/`,
            logo,
            timeText,
            workRemoteAllowed: isRemote,
          });

          if (jobs.length >= 10) break;
        }

        // Approach 2: If no /jobs/view/ links, try scraping text from any job-related list
        if (!jobs.length && listItems.length) {
          debug.approach2 = true;
          for (const li of listItems) {
            const link = li.querySelector('a[href*="/jobs/"]');
            if (!link) continue;
            const href = link.getAttribute('href') || '';
            const idMatch = href.match(/(\d{8,})/);
            if (!idMatch) continue;
            const jobId = idMatch[1];
            if (seen.has(jobId)) continue;
            seen.add(jobId);

            const title = (li.querySelector('strong') || li.querySelector('[class*="title"]') || link).textContent.trim().replace(/\s+/g, ' ');
            if (!title || title.length < 3) continue;

            jobs.push({
              id: jobId,
              title: title.substring(0, 120),
              company: '',
              location: '',
              url: `https://www.linkedin.com/jobs/view/${jobId}/`,
              logo: '',
              timeText: '',
              workRemoteAllowed: false,
            });
            if (jobs.length >= 10) break;
          }
        }

        debug.jobsFound = jobs.length;
        return { jobs, debug };
      },
    });
    console.log('[SocialEdge][Jobs] Scrape result:', JSON.stringify(scrapeRes?.result?.debug));

    // Navigate back to original page
    if (needsNav && originalUrl.includes('linkedin.com')) {
      chrome.tabs.update(tabId, { url: originalUrl }).catch(() => {});
    }

    const result = scrapeRes?.result || {};
    const jobs = result.jobs || [];

    const stored = {
      ts: Date.now(),
      date: new Date().toISOString().split('T')[0],
      jobs,
      debug: result.debug || {},
    };
    await chrome.storage.local.set({ [JOBS_KEY]: stored });
    console.log('[SocialEdge][Jobs] Stored', jobs.length, 'jobs');
    return stored;
  } catch (e) {
    console.error('[SocialEdge][Jobs] Error:', e.message, e.stack);
    // Try to navigate back
    if (originalUrl.includes('linkedin.com') && !originalUrl.includes('/jobs')) {
      chrome.tabs.update(tabId, { url: originalUrl }).catch(() => {});
    }
    return { error: e.message };
  }
}

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
  if (msg.action === 'storeAnalytics') {
    storeAnalytics(msg.url, msg.data);
  }
  if (msg.action === 'getAnalytics') {
    chrome.storage.local.get([ANALYTICS_KEY], (r) => sendResponse(r[ANALYTICS_KEY] || {}));
    return true;
  }
  if (msg.action === 'fetchAnalytics') {
    replayAnalytics().then(sendResponse);
    return true;
  }
  if (msg.action === 'getDailyQuest') {
    generateDailyQuest(false).then(sendResponse);
    return true;
  }
  if (msg.action === 'updateQuestItem') {
    // Toggle a quest item done/undone
    chrome.storage.local.get([QUEST_KEY], (r) => {
      const quest = r[QUEST_KEY];
      if (!quest) return sendResponse(null);
      const item = quest.items.find(i => i.id === msg.itemId);
      if (item) item.done = msg.done;
      chrome.storage.local.set({ [QUEST_KEY]: quest }, () => {
        updateQuestBadge(quest);
        sendResponse(quest);
      });
    });
    return true;
  }
  if (msg.action === 'swapQuestItem') {
    chrome.storage.local.get([QUEST_KEY], (r) => {
      const quest = r[QUEST_KEY];
      if (!quest) return sendResponse(null);
      const idx = quest.items.findIndex(i => i.id === msg.itemId);
      if (idx === -1) return sendResponse(quest);
      const old = quest.items[idx];

      // Build pool of same-difficulty alternatives, excluding current quest items
      const currentIds = new Set(quest.items.map(i => i.id));
      const candidates = [];
      for (const [pillar, items] of Object.entries(ALL_ACTIVITIES)) {
        items.forEach((item, i) => {
          const id = `${pillar}:${i}`;
          if (item.difficulty === old.difficulty && !currentIds.has(id)) {
            candidates.push({ id, pillar, idx: i, label: item.label, difficulty: item.difficulty });
          }
        });
      }
      if (!candidates.length) return sendResponse(quest);

      // Pick a random one
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      quest.items[idx] = {
        id: pick.id,
        pillar: pick.pillar,
        pillarName: PILLAR_NAMES[pick.pillar],
        idx: pick.idx,
        label: pick.label,
        difficulty: pick.difficulty,
        done: false,
      };
      chrome.storage.local.set({ [QUEST_KEY]: quest }, () => {
        updateQuestBadge(quest);
        sendResponse(quest);
      });
    });
    return true;
  }
  if (msg.action === 'getStreak') {
    getActivityStreak().then(sendResponse);
    return true;
  }
  if (msg.action === 'fetchProfileTips') {
    replayProfileTips().then(sendResponse);
    return true;
  }
  if (msg.action === 'getProfileTips') {
    chrome.storage.local.get([TIPS_KEY], (r) => sendResponse(r[TIPS_KEY] || null));
    return true;
  }
  if (msg.action === 'fetchJobs') {
    fetchJobSuggestions().then(sendResponse);
    return true;
  }
  if (msg.action === 'getJobs') {
    chrome.storage.local.get([JOBS_KEY], (r) => sendResponse(r[JOBS_KEY] || null));
    return true;
  }
  if (msg.action === 'dismissQuest') {
    chrome.storage.local.get([QUEST_KEY], (r) => {
      const quest = r[QUEST_KEY];
      if (quest) {
        quest.dismissed = true;
        chrome.storage.local.set({ [QUEST_KEY]: quest }, () => sendResponse(quest));
      } else {
        sendResponse(null);
      }
    });
    return true;
  }
});
