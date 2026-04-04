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
    "Published an original post",
    "Published a long-form article",
    "Updated a profile section",
    "Requested a skill endorsement",
    "Gave a skill endorsement to a connection",
    "Shared industry content with personal commentary",
    "Refreshed profile photo or banner",
    "Added a quantified achievement to experience",
    "Added or updated featured section",
    "Completed a LinkedIn learning course",
  ],
  find_right_people: [
    "Used advanced search filters to find prospects",
    "Saved 5+ new leads",
    "Saved a new account",
    'Reviewed "People Also Viewed" suggestions',
    "Used TeamLink to find a warm introduction",
    "Browsed recommended accounts",
    "Ran a boolean search query",
    "Filtered by job change in the past 90 days",
    "Searched within a specific account",
    "Reviewed lead recommendations from Sales Navigator",
  ],
  insight_engagement: [
    "Left a thoughtful comment on a lead's post",
    "Shared content with personal insight added",
    "Engaged with a target account's content",
    "Created a poll",
    "Responded to a poll",
    "Sent a relevant article to a prospect",
    "Liked a post from a saved lead",
    "Reposted with added perspective",
    "Replied to a comment on my own post",
    "Tagged a connection in a relevant post",
  ],
  relationship: [
    "Sent a personalized InMail",
    "Followed up with a new connection",
    "Congratulated a lead on a job change",
    "Congratulated a lead on a work anniversary",
    "Reconnected with a dormant contact",
    "Responded to a message within 24 hours",
    "Sent a voice note to a prospect",
    "Accepted a connection request with a personal reply",
    "Introduced two connections to each other",
    "Scheduled a call or meeting with a lead",
  ],
};

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
    items.forEach((label, idx) => {
      pool.push({ id: `${pillar}:${idx}`, pillar, idx, label });
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

  console.log('[SocialEdge] Daily quest generated:', quest.items.map(i => i.label));
  return quest;
}

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

    // ── Save a history snapshot for the analytics chart ────────────────────
    const HISTORY_KEY = 'liAnalyticsHistory';
    const histStored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = histStored[HISTORY_KEY] || [];
    const snapshot = {
      ts: now,
      followers:         result.followers         ?? null,
      connections:       result.connections        ?? null,
      profileViews:      result.profileViews       ?? null,
      searchAppearances: result.searchAppearances  ?? null,
      impressions:       result.postImpressions    ?? null,
      engagements:       result.engagements        ?? null,
    };
    // Avoid duplicate snapshots within 1 hour
    const last = history[history.length - 1];
    if (!last || (now - last.ts) > 3600000) {
      history.push(snapshot);
      // Keep max 90 snapshots
      if (history.length > 90) history.splice(0, history.length - 90);
      await chrome.storage.local.set({ [HISTORY_KEY]: history });
    }

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
      chrome.storage.local.set({ [QUEST_KEY]: quest }, () => sendResponse(quest));
    });
    return true;
  }
  if (msg.action === 'getStreak') {
    getActivityStreak().then(sendResponse);
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
