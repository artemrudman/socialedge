// ── Activity definitions (10 per pillar) ───────────────────────────────────────
const ACTIVITIES = {
  prof_brand: {
    name: "Professional Brand",
    items: [
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
  },
  find_right_people: {
    name: "Find Right People",
    items: [
      { label: "Used advanced search filters to find prospects", difficulty: 1 },
      { label: "Saved 5+ new leads", difficulty: 1 },
      { label: "Saved a new account", difficulty: 1 },
      { label: 'Reviewed "People Also Viewed" suggestions', difficulty: 1 },
      { label: "Used TeamLink to find a warm introduction", difficulty: 2 },
      { label: "Browsed recommended accounts", difficulty: 1 },
      { label: "Ran a boolean search query", difficulty: 2 },
      { label: "Filtered by job change in the past 90 days", difficulty: 1 },
      { label: "Searched within a specific account", difficulty: 1 },
      { label: "Reviewed lead recommendations from Sales Navigator", difficulty: 1 },
    ],
  },
  insight_engagement: {
    name: "Insight Engagement",
    items: [
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
  },
  relationship: {
    name: "Strong Relationships",
    items: [
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
  },
};

const PILLAR_KEYS = [
  "prof_brand",
  "find_right_people",
  "insight_engagement",
  "relationship",
];

// ── Helpers ─────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function fmt(v, dec = 1) {
  return v == null ? "—" : Number(v).toFixed(dec);
}

function scoreColor(v, max = 100) {
  if (v == null) return "#46465A";
  const pct = v / max;
  if (pct >= 0.72) return "#34D399";
  if (pct >= 0.48) return "#60A5FA";
  if (pct >= 0.28) return "#FBBF24";
  return "#F87171";
}

function rankClass(rank) {
  if (rank == null) return "";
  if (rank <= 10) return "rank-green";
  if (rank <= 25) return "rank-blue";
  if (rank <= 50) return "rank-amber";
  return "rank-red";
}

function trend(cur, prev) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return { dir: "flat", label: "—" };
  return {
    dir: d > 0 ? "up" : "down",
    label: `${d > 0 ? "+" : ""}${d.toFixed(1)}`,
  };
}

// For Top-N% rankings: lower percentage = better position
function trendPct(cur, prev) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return null;
  // d < 0 means rank improved (e.g. Top 10% → Top 8%)
  return { dir: d < 0 ? "up" : "down", label: `${Math.abs(Math.round(d))}%` };
}

function animateNum(el, to, dec = 1, duration = 700) {
  const from = parseFloat(el.textContent) || 0;
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (from + (to - from) * e).toFixed(dec);
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

function applyTrend(el, t, cls = "pillar-trend") {
  if (!t || t.dir === "flat") {
    el.textContent = "";
    el.className = `${cls} flat`;
    return;
  }
  el.textContent = (t.dir === "up" ? "↑ " : "↓ ") + t.label;
  el.className = `${cls} ${t.dir}`;
}

// ── Activity storage ─────────────────────────────────────────────────────────────
// Format: { 'YYYY-MM-DD': { prof_brand: [bool,bool,...], ... } }

const ACT_KEY = "dailyActivities";

function today() {
  return new Date().toISOString().split("T")[0];
}

async function loadActivities() {
  return new Promise((res) =>
    chrome.storage.local.get([ACT_KEY], (r) => res(r[ACT_KEY] || {})),
  );
}

async function saveActivitiesForDate(date, pillarKey, checkedArr) {
  const all = await loadActivities();
  if (!all[date]) all[date] = {};
  all[date][pillarKey] = checkedArr;
  return new Promise((res) =>
    chrome.storage.local.set({ [ACT_KEY]: all }, res),
  );
}

function hasActivity(allActivities, date) {
  const day = allActivities[date];
  if (!day) return false;
  return Object.values(day).some((arr) => arr.some(Boolean));
}

// ── State ────────────────────────────────────────────────────────────────────────
let lastPillarData = {};
let currentPillarKey = null;
let allActivities = {};

// ── Render main screen ───────────────────────────────────────────────────────────
function render(current, previous) {
  const p = current.parsed;
  const prev = previous?.parsed;
  lastPillarData = { ...p, _prev: prev || null };

  const overallVal = p.overall ?? 0;
  animateNum($("overall"), overallVal);
  $("overall").style.color = scoreColor(overallVal, 100);
  $("overall-bar").style.width = `${(overallVal / 100) * 100}%`;
  $("overall-bar").style.background = scoreColor(overallVal, 100);
  const ot = trend(p.overall, prev?.overall);
  const otEl = $("overall-trend");
  if (!ot || ot.dir === "flat") {
    otEl.innerHTML = "";
    otEl.className = "hero-trend flat";
  } else {
    otEl.innerHTML = (ot.dir === "up" ? "↑ " : "↓ ") + ot.label;
    otEl.className = `hero-trend ${ot.dir}`;
  }

  $("last-updated").textContent = `Updated ${current.date}`;

  const pillars = [
    {
      key: "prof_brand",
      valId: "val-pb",
      barId: "bar-pb",
      trendId: "trend-pb",
    },
    {
      key: "find_right_people",
      valId: "val-frp",
      barId: "bar-frp",
      trendId: "trend-frp",
    },
    {
      key: "insight_engagement",
      valId: "val-ie",
      barId: "bar-ie",
      trendId: "trend-ie",
    },
    {
      key: "relationship",
      valId: "val-rs",
      barId: "bar-rs",
      trendId: "trend-rs",
    },
  ];

  pillars.forEach(({ key, valId, barId, trendId }) => {
    const val = p[key];
    const color = scoreColor(val, 25);
    const valEl = $(valId);
    if (val != null) animateNum(valEl, val, 1);
    else valEl.textContent = "—";
    valEl.style.color = color;
    $(barId).style.width = val != null ? `${(val / 25) * 100}%` : "0%";
    $(barId).style.background = color;
    applyTrend($(trendId), trend(val, prev?.[key]));
  });

  const ind = p.industry || {};
  const net = p.network || {};
  $("bench-ind-name").textContent = ind.name || "—";
  $("bench-ind-ssi").textContent =
    ind.ssi != null ? fmt(ind.ssi) + " SSI" : "—";
  const indEl = $("bench-ind-top");
  indEl.textContent = ind.top != null ? `Top ${ind.top}%` : "—";
  indEl.className = "bench-rank " + rankClass(ind.top);
  const indTrend = trendPct(ind.top, prev?.industry?.top);
  const indTrendEl = $("bench-ind-trend");
  if (indTrend && indTrend.dir !== "flat") {
    indTrendEl.textContent =
      (indTrend.dir === "up" ? "↑ " : "↓ ") + indTrend.label;
    indTrendEl.className = "bench-trend " + indTrend.dir;
  } else {
    indTrendEl.textContent = "";
    indTrendEl.className = "bench-trend";
  }

  $("bench-net-ssi").textContent =
    net.ssi != null ? fmt(net.ssi) + " SSI" : "—";
  const netEl = $("bench-net-top");
  netEl.textContent = net.top != null ? `Top ${net.top}%` : "—";
  netEl.className = "bench-rank " + rankClass(net.top);
  const netTrend = trendPct(net.top, prev?.network?.top);
  const netTrendEl = $("bench-net-trend");
  if (netTrend && netTrend.dir !== "flat") {
    netTrendEl.textContent =
      (netTrend.dir === "up" ? "↑ " : "↓ ") + netTrend.label;
    netTrendEl.className = "bench-trend " + netTrend.dir;
  } else {
    netTrendEl.textContent = "";
    netTrendEl.className = "bench-trend";
  }
}

// ── Render history table ─────────────────────────────────────────────────────────
function renderHistory(history) {
  initChart(history);
  const tbody = $("history-body");
  $("history-count").textContent = `${Math.min(history.length, 30)} days`;
  // $('history-count').textContent = `open`;
  if (history.length === 1) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">1 day</td></tr>';
    return;
  }

  if (!history.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-cell">No data yet</td></tr>';
    return;
  }

  tbody.innerHTML = history
    .slice(0, 30)
    .map((entry, i) => {
      const p = entry.parsed;
      const prev = history[i + 1]?.parsed;

      function cell(cur, prv) {
        const val = fmt(cur);
        if (cur == null || prv == null) return `<td>${val}</td>`;
        const d = cur - prv;
        if (Math.abs(d) < 0.05) return `<td>${val}</td>`;
        const arrow = d > 0
          ? `<span class="t-up"> ↑</span>`
          : `<span class="t-down"> ↓</span>`;
        return `<td>${val}${arrow}</td>`;
      }

      const hasDayAct = hasActivity(allActivities, entry.date);
      const actCell = hasDayAct
        ? `<td><span class="act-badge" data-date="${entry.date}" title="View activities">✓</span></td>`
        : `<td></td>`;

      return `<tr>
      <td>${entry.date}</td>
      ${cell(p.overall, prev?.overall)}
      ${cell(p.prof_brand, prev?.prof_brand)}
      ${cell(p.find_right_people, prev?.find_right_people)}
      ${cell(p.insight_engagement, prev?.insight_engagement)}
      ${cell(p.relationship, prev?.relationship)}
      ${actCell}
    </tr>`;
    })
    .join("");

  // Bind activity badge clicks
  tbody.querySelectorAll(".act-badge").forEach((badge) => {
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      openActDetail(badge.dataset.date);
    });
  });
}

// ── Status bar ───────────────────────────────────────────────────────────────────
function showStatus(msg, type, duration = 5000) {
  const el = $("status-bar");
  el.textContent = msg;
  el.className = `status-bar ${type}`;
  if (duration > 0)
    setTimeout(() => {
      el.className = "status-bar hidden";
    }, duration);
}

// ── Pillar detail screen ─────────────────────────────────────────────────────────
const detailScreen = $("detail-screen");

async function openDetail(key) {
  const info = ACTIVITIES[key];
  const p = lastPillarData;
  if (!info) return;

  currentPillarKey = key;

  const val = p[key];
  const prev = p._prev?.[key];
  const color = scoreColor(val, 25);
  const t = trend(val, prev);

  $("detail-label").textContent = info.name;

  const scoreEl = $("detail-score");
  scoreEl.textContent = val != null ? Number(val).toFixed(1) : "—";
  scoreEl.style.color = color;

  const trendEl = $("detail-trend");
  if (t && t.dir !== "flat") {
    trendEl.textContent = (t.dir === "up" ? "↑ " : "↓ ") + t.label;
    trendEl.className = `detail-trend ${t.dir}`;
  } else {
    trendEl.textContent = "";
    trendEl.className = "detail-trend flat";
  }

  const barEl = $("detail-bar");
  barEl.style.background = color;
  barEl.style.transition = "none";
  barEl.style.width = "0%";
  requestAnimationFrame(() => {
    barEl.style.transition = "";
    barEl.style.width = val != null ? `${(val / 25) * 100}%` : "0%";
  });

  // Load saved state for today
  const todayAct = allActivities[today()]?.[key] || info.items.map(() => false);

  const container = $("detail-activities");
  container.innerHTML = info.items
    .map(
      (item, i) => `
    <label class="activity-item">
      <input type="checkbox" data-index="${i}" ${todayAct[i] ? "checked" : ""}/>
      <span class="activity-label">${item.label}</span>
    </label>
  `,
    )
    .join("");

  // Hide confirmation
  $("save-confirm").classList.add("hidden");

  detailScreen.classList.add("open");
}

function closeDetail() {
  detailScreen.classList.remove("open");
  currentPillarKey = null;
}

document.querySelectorAll(".pillar").forEach((card) => {
  card.style.cursor = "pointer";
  card.addEventListener("click", () => openDetail(card.dataset.key));
});

$("back-btn").addEventListener("click", closeDetail);

// Save activities button
$("save-activity-btn").addEventListener("click", async () => {
  if (!currentPillarKey) return;
  const checks = Array.from(
    $("detail-activities").querySelectorAll('input[type="checkbox"]'),
  ).map((cb) => cb.checked);
  await saveActivitiesForDate(today(), currentPillarKey, checks);
  allActivities = await loadActivities();

  // Particle burst from save button
  spawnSaveParticles($("save-activity-btn"));

  // Button pulse
  const btn = $("save-activity-btn");
  btn.classList.remove("saved-pulse");
  void btn.offsetWidth; // reflow to restart animation
  btn.classList.add("saved-pulse");
  btn.addEventListener(
    "animationend",
    () => btn.classList.remove("saved-pulse"),
    { once: true },
  );

  // Show confirmation with pop-in animation
  const conf = $("save-confirm");
  conf.classList.remove("hidden", "pop-in");
  void conf.offsetWidth;
  conf.classList.add("pop-in");
  setTimeout(() => conf.classList.add("hidden"), 2500);

  // Refresh history table to update Act. column
  chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
    if (history?.length) renderHistory(history);
  });
});

function spawnSaveParticles(btn) {
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = [
    "#34D399",
    "#6EE7B7",
    "#A7F3D0",
    "#FBBF24",
    "#60A5FA",
    "#ffffff",
  ];
  const count = 22;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.6;
    const dist = 40 + Math.random() * 55;
    const dur = 0.5 + Math.random() * 0.35;

    p.className = "save-particle";
    p.style.cssText = [
      `left:${cx}px`,
      `top:${cy}px`,
      `background:${colors[i % colors.length]}`,
      `--tx:${Math.cos(angle) * dist}px`,
      `--ty:${Math.sin(angle) * dist}px`,
      `--dur:${dur}s`,
    ].join(";");

    document.body.appendChild(p);
    p.addEventListener("animationend", () => p.remove(), { once: true });
  }
}

// ── Activity detail screen (history ✓ click) ─────────────────────────────────────
const actDetailScreen = $("act-detail-screen");

function openActDetail(date) {
  $("act-detail-date").textContent = date;

  const dayAct = allActivities[date] || {};
  const body = $("act-detail-body");

  // Build groups — only include pillars that have at least one checked item
  const groups = PILLAR_KEYS.map((key) => {
    const info = ACTIVITIES[key];
    const checked = dayAct[key] || [];
    // Filter to only checked items
    const doneItems = info.items.filter((_, i) => checked[i]);
    return { name: info.name, doneItems };
  }).filter((g) => g.doneItems.length > 0);

  if (groups.length === 0) {
    body.innerHTML =
      '<p style="color:var(--text-3);font-size:13px;padding:8px 0">No activities recorded for this day.</p>';
  } else {
    body.innerHTML = groups
      .map((g) => {
        const rows = g.doneItems
          .map(
            (item) => `
        <div class="act-item-row">
          <div class="act-item-check done">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5.5L4 8L8.5 2.5" stroke="#0C0C10" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="act-item-text">${item.label}</span>
        </div>`,
          )
          .join("");

        return `<div>
        <div class="act-group-title">${g.name}</div>
        <div class="act-group-items">${rows}</div>
      </div>`;
      })
      .join("");
  }

  actDetailScreen.classList.add("open");
}

$("act-detail-back").addEventListener("click", () => {
  actDetailScreen.classList.remove("open");
});

// ── Initial load ─────────────────────────────────────────────────────────────────
const AUTO_REFRESH_KEY = "_se_lastAutoRefresh";

async function loadAndRender() {
  allActivities = await loadActivities();
  chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
    if (history?.length) {
      render(history[0], history[1]);
      renderHistory(history);
      hideSetupCard();
    } else {
      showSetupCard();
    }
  });

  // Auto-refresh stats once per day on open
  const todayStr = today();
  const stored = await new Promise(r => chrome.storage.local.get([AUTO_REFRESH_KEY], r));
  if (stored[AUTO_REFRESH_KEY] !== todayStr) {
    chrome.storage.local.set({ [AUTO_REFRESH_KEY]: todayStr });
    chrome.runtime.sendMessage({ action: "fetchNow" });
    chrome.runtime.sendMessage({ action: "fetchAnalytics" });
  }
}

// ── Setup card — shown on first run when no SSI data exists ──────────────────
function showSetupCard() {
  if ($("setup-card")) return;
  const card = document.createElement("div");
  card.id = "setup-card";
  card.className = "setup-card";
  card.innerHTML = `
    <div class="setup-icon">
      <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
        <line x1="4" y1="22" x2="14" y2="11" stroke="#34D399" stroke-width="2" stroke-linecap="round" opacity=".6"/>
        <line x1="14" y1="11" x2="24" y2="3"  stroke="#34D399" stroke-width="2" stroke-linecap="round"/>
        <circle cx="4"  cy="22" r="3" fill="#34D399" opacity=".45"/>
        <circle cx="14" cy="11" r="3" fill="#34D399" opacity=".72"/>
        <circle cx="24" cy="3"  r="3" fill="#34D399"/>
      </svg>
    </div>
    <div class="setup-title">Welcome to SocialEdge!</div>
    <div class="setup-desc">Let's capture your LinkedIn Social Selling Index score. Follow these quick steps:</div>
    <ol class="setup-steps">
      <li><span class="setup-step-num">1</span> Open <a href="https://www.linkedin.com" target="_blank" rel="noopener">linkedin.com</a> in a tab and sign in</li>
      <li><span class="setup-step-num">2</span> Click <strong>Refresh Score</strong> below — we'll fetch your SSI automatically</li>
      <li><span class="setup-step-num">3</span> Done! Your score updates daily from now on</li>
    </ol>
    <div class="setup-hint">Your score will appear here within a few seconds after refresh.</div>
  `;
  // Insert after hero section
  const hero = document.querySelector(".hero");
  if (hero?.nextElementSibling) {
    hero.parentNode.insertBefore(card, hero.nextElementSibling);
  }
}

function hideSetupCard() {
  const card = $("setup-card");
  if (card) {
    card.style.animation = "setupFadeOut .3s ease forwards";
    setTimeout(() => card.remove(), 300);
  }
}
loadAndRender();

// ── Wide dashboard mode — tab switching when viewport ≥ 700px ───────────────────
function isWideMode() { return window.innerWidth >= 700; }

const DASH_TAB_MAP = {
  quest: "quest-screen",
  history: "history-screen",
  analytics: "analytics-screen",
  tips: "tips-screen",
  jobs: "jobs-screen",
};
let _wideInited = false;
let _activeDashTab = "quest";

function switchDashTab(tab) {
  _activeDashTab = tab;
  // Update tab buttons
  document.querySelectorAll(".dash-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  // Show/hide panels
  for (const [key, id] of Object.entries(DASH_TAB_MAP)) {
    const el = $(id);
    if (el) el.classList.toggle("dash-active", key === tab);
  }
  // Lazy-load analytics on first view
  if (tab === "analytics" && !_wideInited) {
    _wideInited = true;
    loadAnalytics();
  }
  // Lazy-load tips on first view
  if (tab === "tips") {
    loadProfileTips();
  }
  // Lazy-load jobs on first view
  if (tab === "jobs") {
    loadJobs();
  }
}

// Tab click handlers
document.querySelectorAll(".dash-tab").forEach(btn => {
  btn.addEventListener("click", () => switchDashTab(btn.dataset.tab));
});

function applyWideMode() {
  if (isWideMode()) {
    // Open panels (needed for JS that checks .open)
    for (const id of Object.values(DASH_TAB_MAP)) {
      const el = $(id);
      if (el) el.classList.add("open");
    }
    switchDashTab(_activeDashTab);
    loadAnalytics();
  } else {
    for (const id of Object.values(DASH_TAB_MAP)) {
      const el = $(id);
      if (el) el.classList.remove("open", "dash-active");
    }
    _wideInited = false;
  }
}
applyWideMode();
window.addEventListener("resize", applyWideMode);

// ── Daily Quest (screen-based) ──────────────────────────────────────────────────
const questScreen = $("quest-screen");
const QUEST_SEEN_KEY = "_se_questSeen";
let _currentQuest = null;

const QUEST_CHECK_ICON = `<svg class="dq-check-svg" width="13" height="13" viewBox="0 0 14 14" fill="none">
  <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="#0C0C10" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function renderQuest(quest) {
  _currentQuest = quest;
  const itemsEl = $("dq-items");
  const doneEl = $("dq-done");

  if (!quest || !quest.items?.length) return;

  const doneCount = quest.items.filter(i => i.done).length;
  const total = quest.items.length;
  const allDone = doneCount === total;

  // Progress
  $("dq-progress-fill").style.width = `${(doneCount / total) * 100}%`;
  $("dq-progress-label").textContent = allDone
    ? "All done — you're on fire!"
    : `${doneCount} / ${total} completed`;

  // Items
  const DIFF_LABELS = ['Easy', 'Medium', 'Hard'];
  itemsEl.innerHTML = quest.items.map(item => `
    <div class="dq-item ${item.done ? 'done' : ''}" data-quest-id="${item.id}">
      <div class="dq-check">${QUEST_CHECK_ICON}</div>
      <div class="dq-item-text">
        <div class="dq-item-label">${item.label}</div>
        <div class="dq-item-meta">
          <span class="dq-item-pillar">${item.pillarName}</span>
          ${item.difficulty ? `<span class="dq-difficulty dq-diff-${item.difficulty}">${DIFF_LABELS[item.difficulty - 1]}</span>` : ''}
        </div>
      </div>
      <button class="dq-swap-btn${item.done ? ' hidden' : ''}" data-swap-id="${item.id}" title="Swap for another task">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M11.5 1.5L14 4l-2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 4h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M4.5 14.5L2 12l2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 12H2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `).join("");

  // Done banner
  if (allDone) {
    doneEl.classList.remove("hidden");
  } else {
    doneEl.classList.add("hidden");
  }

  // Click handlers — checkbox toggle
  itemsEl.querySelectorAll(".dq-item").forEach(el => {
    el.addEventListener("click", (e) => {
      // Ignore clicks on the swap button
      if (e.target.closest('.dq-swap-btn')) return;

      const id = el.dataset.questId;
      const item = quest.items.find(i => i.id === id);
      if (!item) return;
      item.done = !item.done;

      // Sync to dailyActivities
      const [pillar, idxStr] = id.split(":");
      syncQuestToActivities(pillar, parseInt(idxStr, 10), item.done);

      // Persist quest state
      chrome.runtime.sendMessage({
        action: "updateQuestItem",
        itemId: id,
        done: item.done,
      });

      renderQuest(quest);
      // Refresh streak after toggling
      chrome.runtime.sendMessage({ action: "getStreak" }, (s) => updateStreak(s || 0));
    });
  });

  // Click handlers — swap button
  itemsEl.querySelectorAll(".dq-swap-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.swapId;
      btn.classList.add("swapping");
      chrome.runtime.sendMessage({ action: "swapQuestItem", itemId: id }, (updated) => {
        if (updated) renderQuest(updated);
      });
    });
  });
}

async function syncQuestToActivities(pillarKey, idx, done) {
  const all = await loadActivities();
  const todayStr = today();
  if (!all[todayStr]) all[todayStr] = {};
  if (!all[todayStr][pillarKey]) {
    const itemCount = ACTIVITIES[pillarKey]?.items.length || 10;
    all[todayStr][pillarKey] = new Array(itemCount).fill(false);
  }
  all[todayStr][pillarKey][idx] = done;
  await new Promise(res =>
    chrome.storage.local.set({ [ACT_KEY]: all }, res),
  );
  allActivities = all;
}

function updateStreak(streak) {
  const el = $("dq-streak");
  const countEl = $("dq-streak-count");
  if (streak > 0) {
    el.classList.remove("hidden");
    countEl.textContent = streak;
  } else {
    el.classList.add("hidden");
  }
}

function updateQuestDot(quest) {
  const dot = $("quest-trigger-dot");
  if (!quest || !quest.items?.length) { dot.classList.remove("active"); return; }
  // Show dot if quest hasn't been opened/seen today
  chrome.storage.local.get([QUEST_SEEN_KEY], (r) => {
    const seen = r[QUEST_SEEN_KEY];
    if (seen === quest.date) {
      dot.classList.remove("active");
    } else {
      dot.classList.add("active");
    }
  });
}

// Open quest screen
$("quest-trigger").addEventListener("click", () => {
  questScreen.classList.add("open");
  // Mark as seen — hide dot
  if (_currentQuest?.date) {
    chrome.storage.local.set({ [QUEST_SEEN_KEY]: _currentQuest.date });
    $("quest-trigger-dot").classList.remove("active");
  }
});
$("quest-back-btn").addEventListener("click", () => {
  questScreen.classList.remove("open");
});

// Load quest on popup open
chrome.runtime.sendMessage({ action: "getDailyQuest" }, (quest) => {
  renderQuest(quest);
  updateQuestDot(quest);
});
chrome.runtime.sendMessage({ action: "getStreak" }, (streak) => {
  updateStreak(streak || 0);
});

// Live-refresh quest when items change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes._se_dailyQuest) {
    const q = changes._se_dailyQuest.newValue;
    renderQuest(q);
    updateQuestDot(q);
  }
});

// Live refresh when background stores new SSI data
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ssiHistory) {
    const history = changes.ssiHistory.newValue || [];
    if (history.length) {
      render(history[0], history[1]);
      renderHistory(history);
      hideSetupCard();
    }
  }
  if (area === "local" && changes.dailyActivities) {
    allActivities = changes.dailyActivities.newValue || {};
  }
});

// ── Shared refresh icon SVGs ──────────────────────────────────────────────────
const REFRESH_SVG = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 6.5A4.5 4.5 0 1 1 6.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6.5 2l1.8-1.8M6.5 2l1.8 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK_SVG = `<svg class="btn-check" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 7L5.5 10L10.5 3.5" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function animateBtn(btn, origHTML, state) {
  // state: 'loading' | 'success' | 'error'
  btn.classList.remove('loading', 'success-pulse', 'error-shake');
  void btn.offsetWidth;

  if (state === 'loading') {
    btn.classList.add('loading');
    btn.innerHTML = `<span class="btn-spinner"></span> Fetching…`;
  } else if (state === 'success') {
    btn.classList.add('success-pulse');
    btn.innerHTML = `${CHECK_SVG} Updated!`;
    spawnSaveParticles(btn);
    btn.addEventListener('animationend', () => btn.classList.remove('success-pulse'), { once: true });
    setTimeout(() => { btn.innerHTML = origHTML; }, 2200);
  } else if (state === 'error') {
    btn.classList.add('error-shake');
    btn.innerHTML = `${REFRESH_SVG} Try again`;
    btn.addEventListener('animationend', () => btn.classList.remove('error-shake'), { once: true });
    setTimeout(() => { btn.innerHTML = origHTML; }, 3000);
  }
}

// ── Refresh button ───────────────────────────────────────────────────────────────
const REFRESH_BTN_HTML = `${REFRESH_SVG} Refresh Score`;
$("btn-refresh").addEventListener("click", () => {
  const btn = $("btn-refresh");
  if (btn.classList.contains('loading')) return;
  animateBtn(btn, REFRESH_BTN_HTML, 'loading');

  chrome.runtime.sendMessage({ action: "fetchNow" }, (result) => {
    if (!result || result.error) {
      animateBtn(btn, REFRESH_BTN_HTML, 'error');
      // Show user-friendly error in status bar
      const msg = result?.message || result?.error || 'Could not fetch score.';
      const bar = $("status-bar");
      bar.textContent = msg;
      bar.classList.remove("hidden");
      setTimeout(() => bar.classList.add("hidden"), 6000);
      return;
    }
    animateBtn(btn, REFRESH_BTN_HTML, 'success');
    hideSetupCard();
    chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
      if (history?.length) {
        render(history[0], history[1]);
        renderHistory(history);
      }
    });
  });
});

// ── Score Chart ───────────────────────────────────────────────────────────────
const OVERALL_COLOR = "#E8E8F0";
let chartData = []; // oldest → newest
let forecastPtsPro = []; // [{ dayOffset, value, label }]
// hoverIdx: 0..n-1 = real; n..n+2 = pro forecast
let hoverIdx = -1;

// ── Forecast computation ──────────────────────────────────────────────────────
function computeForecast(data) {
  if (!data.length) return [];
  const base = new Date(data[0].date);
  const toDay = (d) => Math.round((new Date(d) - base) / 86400000);
  const lastDay = toDay(data[data.length - 1].date);
  const lastVal = data[data.length - 1].parsed?.overall ?? 0;

  // Pro: personal target 60–65 (deterministic per user)
  const seed = data.reduce((a, e) => a + (e.parsed?.overall ?? 0), 0);
  const pseudo = ((seed * 9301 + 49297) % 233280) / 233280;
  const personalTarget = 60 + pseudo * 5;
  const proTarget =
    lastVal < personalTarget
      ? personalTarget
      : Math.min(100, lastVal + (100 - lastVal) * 0.18);
  return [30, 60, 90].map((d) => ({
    dayOffset: lastDay + d,
    value: lastVal + (proTarget - lastVal) * (d / 90),
    label: `+${d}d`,
  }));
}

// ── Static legend ─────────────────────────────────────────────────────────────
(function buildLegend() {
  $("chart-legend").innerHTML = `
    <span class="legend-item">
      <span class="legend-line-solid"></span>Overall Score
    </span>
    <span class="legend-item">
      <span class="legend-line-dashed"></span>3-Month Forecast
      <span class="legend-pro-badge">🔒Pro</span>
    </span>`;
})();

// ── Draw ──────────────────────────────────────────────────────────────────────
function drawChart() {
  const canvas = $("score-chart");
  if (!canvas || !chartData.length) return;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (!W || !H) return;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const pad = { top: 14, right: 14, bottom: 8, left: 32 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  // Date → pixel x (using real calendar days so forecast spacing is proportional)
  const base = new Date(chartData[0].date);
  const toDay = (d) => Math.round((new Date(d) - base) / 86400000);
  const realDays = chartData.map((e) => toDay(e.date));
  const allFcPts = [...forecastPtsPro];
  const maxDay = allFcPts.length
    ? allFcPts[allFcPts.length - 1].dayOffset
    : realDays[realDays.length - 1];
  const xOf = (day) => pad.left + (maxDay ? (day / maxDay) * cw : cw / 2);
  const yOf = (v) => pad.top + (1 - v / 100) * ch;

  // ── Grid ────────────────────────────────────────────────────────────────
  ctx.font = "9px -apple-system,sans-serif";
  ctx.textAlign = "right";
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = yOf(v);
    ctx.strokeStyle = "#1A1A24";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#42425A";
    ctx.fillText(v, pad.left - 5, y + 3.5);
  });

  // ── Forecast region tint ─────────────────────────────────────────────────
  if (forecastPtsPro.length) {
    const fx = xOf(realDays[realDays.length - 1]);
    const fGrad = ctx.createLinearGradient(fx, 0, W - pad.right, 0);
    fGrad.addColorStop(0, "rgba(96,165,250,.05)");
    fGrad.addColorStop(1, "rgba(96,165,250,.11)");
    ctx.fillStyle = fGrad;
    ctx.fillRect(fx, pad.top, W - pad.right - fx, ch);

    // divider at junction
    ctx.strokeStyle = "rgba(96,165,250,.18)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(fx, pad.top);
    ctx.lineTo(fx, pad.top + ch);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // X-axis labels intentionally omitted

  // ── Area fill under real line ────────────────────────────────────────────
  {
    const scores = chartData.map((e) => e.parsed?.overall ?? null);
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, "rgba(232,232,240,.12)");
    grad.addColorStop(1, "rgba(232,232,240,.00)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    let fI = -1;
    let lI = -1;
    let started = false;
    scores.forEach((v, i) => {
      if (v == null) return;
      const x = xOf(realDays[i]);
      const y = yOf(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
        fI = i;
      } else {
        const pp = scores[i - 1] ?? v;
        const cpx = (xOf(realDays[i - 1]) + x) / 2;
        ctx.bezierCurveTo(cpx, yOf(pp), cpx, y, x, y);
      }
      lI = i;
    });
    if (lI >= 0) {
      ctx.lineTo(xOf(realDays[lI]), H - pad.bottom);
      ctx.lineTo(xOf(realDays[fI]), H - pad.bottom);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ── Real overall line ────────────────────────────────────────────────────
  {
    const scores = chartData.map((e) => e.parsed?.overall ?? null);
    ctx.strokeStyle = OVERALL_COLOR;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let started = false;
    scores.forEach((v, i) => {
      if (v == null) {
        started = false;
        return;
      }
      const x = xOf(realDays[i]);
      const y = yOf(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
        return;
      }
      const pp = scores[i - 1] ?? v;
      const cpx = (xOf(realDays[i - 1]) + x) / 2;
      ctx.bezierCurveTo(cpx, yOf(pp), cpx, y, x, y);
    });
    ctx.stroke();

    // Dots
    scores.forEach((v, i) => {
      if (v == null) return;
      const isHov = hoverIdx === i;
      ctx.beginPath();
      ctx.arc(xOf(realDays[i]), yOf(v), isHov ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isHov ? OVERALL_COLOR : OVERALL_COLOR + "99";
      ctx.fill();
      if (isHov) {
        ctx.strokeStyle = "#0C0C10";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }

  // ── Helper: draw one dashed forecast line + hollow dots ─────────────────
  function drawForecastLine(pts, color, dashPat, idxOffset) {
    const lastReal = chartData[chartData.length - 1].parsed?.overall;
    if (!pts.length || lastReal == null) return;
    const x0 = xOf(realDays[realDays.length - 1]);
    const x1 = xOf(pts[pts.length - 1].dayOffset);
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, `${color}88`);
    grad.addColorStop(1, `${color}44`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.8;
    ctx.setLineDash(dashPat);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, yOf(lastReal));
    pts.forEach((fp) => ctx.lineTo(xOf(fp.dayOffset), yOf(fp.value)));
    ctx.stroke();
    ctx.setLineDash([]);

    pts.forEach((fp, fi) => {
      const isHov = hoverIdx === idxOffset + fi;
      const fx = xOf(fp.dayOffset);
      const fy = yOf(fp.value);
      ctx.beginPath();
      ctx.arc(fx, fy, isHov ? 5 : 3.2, 0, Math.PI * 2);
      ctx.fillStyle = isHov ? color + "28" : "#111118";
      ctx.strokeStyle = isHov ? color : color + "88";
      ctx.lineWidth = isHov ? 2 : 1.5;
      ctx.fill();
      ctx.stroke();
    });
  }

  const n = chartData.length;
  // Pro forecast: green dashes
  drawForecastLine(forecastPtsPro, "#34D399", [7, 4], n);

  // ── Crosshair + tooltip ───────────────────────────────────────────────────
  const allPts = [
    ...realDays.map((day, i) => ({ i, x: xOf(day), isPro: false })),
    ...forecastPtsPro.map((fp, fi) => ({
      i: n + fi,
      x: xOf(fp.dayOffset),
      isPro: true,
      fp,
    })),
  ];
  const hov = allPts.find((p) => p.i === hoverIdx);

  if (hov) {
    ctx.strokeStyle = "#46465A";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(hov.x, pad.top);
    ctx.lineTo(hov.x, H - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const tooltip = $("chart-tooltip");

    function topEstRows(fp, exponent) {
      const lastEntry = chartData[chartData.length - 1];
      const lastScore = lastEntry.parsed?.overall ?? 0;
      const lastIndTop = lastEntry.parsed?.industry?.top;
      const lastNetTop = lastEntry.parsed?.network?.top;
      const ratio = lastScore > 0 ? lastScore / fp.value : 1;
      const eInd =
        lastIndTop != null
          ? Math.max(1, Math.round(lastIndTop * Math.pow(ratio, exponent)))
          : null;
      const eNet =
        lastNetTop != null
          ? Math.max(1, Math.round(lastNetTop * Math.pow(ratio, exponent)))
          : null;
      return [
        eInd != null
          ? `<div class="ct-row"><span class="ct-label" style="color:var(--text-3)">Top Industry</span><span class="ct-val">~Top ${eInd}%</span></div>`
          : "",
        eNet != null
          ? `<div class="ct-row"><span class="ct-label" style="color:var(--text-3)">Top Network</span><span class="ct-val">~Top ${eNet}%</span></div>`
          : "",
      ].join("");
    }

    if (hov.isPro) {
      const rows = topEstRows(hov.fp, 3.2);
      tooltip.innerHTML = `
        <div class="ct-date">Pro Forecast ${hov.fp.label}</div>
        <div class="ct-row">
          <span class="ct-dot" style="background:#34D399"></span>
          <span class="ct-label">Projected SSI</span>
          <span class="ct-val">~${hov.fp.value.toFixed(1)}<span style="color:var(--text-3);font-weight:400">/100</span></span>
        </div>
        ${rows ? `<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">${rows}</div>` : ""}
        <div class="ct-note">With consistent daily activity<br>from the Advanced Plan</div>`;
    } else {
      const e = chartData[hov.i];
      const indTop = e.parsed?.industry?.top;
      const netTop = e.parsed?.network?.top;
      const topRows = [
        indTop != null
          ? `<div class="ct-row"><span class="ct-label" style="color:var(--text-3)">Top Industry</span><span class="ct-val">Top ${indTop}%</span></div>`
          : "",
        netTop != null
          ? `<div class="ct-row"><span class="ct-label" style="color:var(--text-3)">Top Network</span><span class="ct-val">Top ${netTop}%</span></div>`
          : "",
      ].join("");
      tooltip.innerHTML = `
        <div class="ct-date">${e.date}</div>
        <div class="ct-row">
          <span class="ct-dot" style="background:${OVERALL_COLOR}"></span>
          <span class="ct-label">Overall SSI</span>
          <span class="ct-val">${(e.parsed?.overall ?? 0).toFixed(1)}<span style="color:var(--text-3);font-weight:400">/100</span></span>
        </div>
        ${topRows ? `<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">${topRows}</div>` : ""}`;
    }
    tooltip.classList.remove("hidden");
    const tipW = tooltip.offsetWidth || 160;
    tooltip.style.left = `${hov.x + 12 + tipW > W ? hov.x - tipW - 12 : hov.x + 12}px`;
    tooltip.style.top = `${pad.top}px`;
  } else {
    $("chart-tooltip").classList.add("hidden");
  }
}

function initChart(history) {
  chartData = history.slice(0, 30).slice().reverse();
  forecastPtsPro = computeForecast(chartData);
  drawChart();
}

// Mouse interaction
(function bindChartEvents() {
  const canvas = $("score-chart");

  function nearestIdx(mouseX) {
    if (!chartData.length) return -1;
    const base = new Date(chartData[0].date);
    const toDay = (d) => Math.round((new Date(d) - base) / 86400000);
    const realDays = chartData.map((e) => toDay(e.date));
    const maxDay = forecastPtsPro.length
      ? forecastPtsPro[forecastPtsPro.length - 1].dayOffset
      : realDays[realDays.length - 1];
    const padL = 32;
    const padR = 14;
    const cw = canvas.offsetWidth - padL - padR;
    const xOf = (day) => padL + (maxDay ? (day / maxDay) * cw : cw / 2);
    const n = chartData.length;

    const all = [
      ...realDays.map((day, i) => ({ i, x: xOf(day) })),
      ...forecastPtsPro.map((fp, fi) => ({ i: n + fi, x: xOf(fp.dayOffset) })),
    ];
    let best = -1;
    let bestD = Infinity;
    all.forEach(({ i, x }) => {
      const d = Math.abs(x - mouseX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < 28 ? best : -1;
  }

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    hoverIdx = nearestIdx(e.clientX - rect.left);
    drawChart();
  });
  canvas.addEventListener("mouseleave", () => {
    hoverIdx = -1;
    drawChart();
  });
})();

// ── History screen ────────────────────────────────────────────────────────────────
const historyScreen = $("history-screen");

$("btn-history").addEventListener("click", () => {
  historyScreen.classList.add("open");
  // Canvas was hidden (zero size) before open — redraw now that it has dimensions
  requestAnimationFrame(() => requestAnimationFrame(drawChart));
});
$("history-back-btn").addEventListener("click", () =>
  historyScreen.classList.remove("open"),
);

// ── Export buttons ────────────────────────────────────────────────────────────────
function doExport() {
  chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
    const json = JSON.stringify(history, null, 2);
    const dataUrl =
      "data:application/json;charset=utf-8," + encodeURIComponent(json);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `socialedge_${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

$("btn-export-history").addEventListener("click", doExport);

// ── Analytics screen ──────────────────────────────────────────────────────────
const analyticsScreen = $("analytics-screen");

$("btn-analytics").addEventListener("click", () => {
  analyticsScreen.classList.add("open");
  loadAnalytics();
});

const ANALYTICS_BTN_HTML = `${REFRESH_SVG} Refresh`;
$("analytics-refresh-btn").addEventListener("click", () => {
  const btn = $("analytics-refresh-btn");
  if (btn.classList.contains('loading')) return;
  animateBtn(btn, ANALYTICS_BTN_HTML, 'loading');

  chrome.runtime.sendMessage({ action: "fetchAnalytics" }, (result) => {
    if (!result || result.error) {
      animateBtn(btn, ANALYTICS_BTN_HTML, 'error');
      return;
    }
    animateBtn(btn, ANALYTICS_BTN_HTML, 'success');
    loadAnalytics();
  });
});
$("analytics-back-btn").addEventListener("click", () =>
  analyticsScreen.classList.remove("open"),
);

function fmtNum(v) {
  if (v == null) return null;
  if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
  if (v >= 10000) return (v / 1000).toFixed(1) + "K";
  return String(v);
}

function timeAgo(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function makeCard(icon, iconBg, label, value, sub) {
  const val = fmtNum(value);
  const valHtml =
    val != null
      ? `<span class="analytics-card-value">${val}</span>`
      : `<span class="analytics-card-value na">—</span>`;
  return `
    <div class="analytics-card">
      <div class="analytics-card-icon" style="background:${iconBg}">${icon}</div>
      ${valHtml}
      <div class="analytics-card-label">${label}</div>
      ${sub ? `<div class="analytics-card-sub">${sub}</div>` : ""}
    </div>`;
}

function renderAnalytics(data) {
  const empty = $("analytics-empty");
  const cards = $("analytics-cards");
  const net = data.network || {};
  const cont = data.content || {};
  const dash = data.dashboard || {};

  const hasAny = Object.keys(data).length > 0;
  empty.style.display = hasAny ? "none" : "flex";
  cards.innerHTML = "";

  if (!hasAny) return;

  // Merge profile views: prefer dashboard value, fallback to network
  const profileViews = dash.profileViews ?? net.profileViews;
  const searchApp = dash.searchAppearances;
  const followers = net.followers;
  const connections = net.connections;
  const impressions = cont.impressions;
  const engagements = cont.engagements;
  const uniqueViews = cont.uniqueViews;

  const latestTs = Math.max(net.ts || 0, cont.ts || 0, dash.ts || 0);

  const svgEye = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M1 7C1 7 3.5 2.5 7 2.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z"
          stroke="#60A5FA" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="7" cy="7" r="1.8" fill="#60A5FA"/></svg>`;
  const svgSearch = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="6" cy="6" r="4" stroke="#A78BFA" stroke-width="1.4"/>
    <line x1="9" y1="9" x2="13" y2="13" stroke="#A78BFA" stroke-width="1.4"
          stroke-linecap="round"/></svg>`;
  const svgFollower = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="5" r="2.5" stroke="#34D399" stroke-width="1.4"/>
    <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="#34D399"
          stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const svgConnect = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="4" cy="5" r="2" stroke="#FBBF24" stroke-width="1.4"/>
    <circle cx="10" cy="5" r="2" stroke="#FBBF24" stroke-width="1.4"/>
    <path d="M1 12c0-1.7 1.3-3 3-3s3 1.3 3 3M7 12c0-1.7 1.3-3 3-3s3 1.3 3 3"
          stroke="#FBBF24" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const svgImpression = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1"  y="8" width="3" height="5" rx="1" fill="#F87171"/>
    <rect x="5.5" y="5" width="3" height="8" rx="1" fill="#F87171" opacity=".75"/>
    <rect x="10" y="2" width="3" height="11" rx="1" fill="#F87171" opacity=".5"/></svg>`;
  const svgHeart = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 11.5S1.5 8 1.5 4.5a2.8 2.8 0 0 1 5.5-.8 2.8 2.8 0 0 1 5.5.8C12.5 8 7 11.5 7 11.5z"
          fill="#F472B6" opacity=".8"/></svg>`;

  cards.innerHTML = `
    <div class="analytics-section-title">Profile</div>
    ${makeCard(svgEye, "rgba(96,165,250,.12)", "Profile Views", profileViews, "Last 90 days")}
    ${makeCard(svgSearch, "rgba(167,139,250,.12)", "Search Appearances", searchApp, "Last 90 days")}
    ${makeCard(svgFollower, "rgba(52,211,153,.12)", "Followers", followers, null)}
    ${makeCard(svgImpression, "rgba(248,113,113,.12)", "Post Impressions", impressions, "Across all posts")}
    <div class="analytics-updated">Updated ${timeAgo(latestTs)}</div>`;

  // cards.innerHTML = `
  //   <div class="analytics-section-title">Profile</div>
  //   ${makeCard(svgEye,    'rgba(96,165,250,.12)',  'Profile Views',       profileViews, 'Last 90 days')}
  //   ${makeCard(svgSearch, 'rgba(167,139,250,.12)', 'Search Appearances',  searchApp,    'Last 90 days')}
  //   ${makeCard(svgFollower,'rgba(52,211,153,.12)', 'Followers',           followers,    null)}
  //   ${makeCard(svgConnect,'rgba(251,191,36,.12)',  'Connections',         connections,  null)}
  //   <div class="analytics-section-title">Content</div>
  //   ${makeCard(svgImpression,'rgba(248,113,113,.12)','Post Impressions',  impressions,  'Across all posts')}
  //   ${makeCard(svgImpression,'rgba(248,113,113,.08)','Unique Views',      uniqueViews,  'Unique viewers')}
  //   ${makeCard(svgHeart,  'rgba(244,114,182,.12)', 'Engagements',         engagements,  'Likes, comments, shares')}
  //   <div class="analytics-updated">Updated ${timeAgo(latestTs)}</div>`;
}

// ── Analytics Chart ──────────────────────────────────────────────────────────
const ANALYTICS_METRICS = [
  { key: 'followers',    label: 'Followers',           color: '#34D399', src: 'network',   field: 'followers' },
  // { key: 'connections',  label: 'Connections',         color: '#FBBF24', src: 'network',   field: 'connections' },
  { key: 'profileViews', label: 'Profile Views',      color: '#60A5FA', src: 'dashboard',  field: 'profileViews' },
  { key: 'searchAppearances', label: 'Search Appearances', color: '#A78BFA', src: 'dashboard', field: 'searchAppearances' },
  { key: 'impressions', label: 'Impressions',          color: '#F87171', src: 'content',   field: 'impressions' },
  { key: 'engagements', label: 'Engagements',          color: '#F472B6', src: 'content',   field: 'engagements' },
];
let analyticsActiveMetric = 'followers';
let analyticsHoverIdx = -1;

function getAnalyticsHistory() {
  // Pull from liAnalyticsHistory: array of timestamped snapshots
  return new Promise(resolve => {
    chrome.storage.local.get(['liAnalyticsHistory'], r => resolve(r.liAnalyticsHistory || []));
  });
}

function buildAnalyticsChartTabs(history) {
  const tabsEl = $('analytics-chart-tabs');
  // Only show tabs for metrics that have at least one data point in history
  const available = ANALYTICS_METRICS.filter(m =>
    history.some(snap => snap[m.key] != null)
  );
  if (!available.length) {
    $('analytics-chart-section').classList.add('hidden');
    return;
  }
  $('analytics-chart-section').classList.remove('hidden');

  // If active metric has no data, switch to first available
  if (!available.find(m => m.key === analyticsActiveMetric)) {
    analyticsActiveMetric = available[0].key;
  }

  tabsEl.innerHTML = available.map(m =>
    `<button class="analytics-chart-tab${m.key === analyticsActiveMetric ? ' active' : ''}"
             data-metric="${m.key}"
             style="--metric-color:${m.color}">${m.label}</button>`
  ).join('');

  tabsEl.querySelectorAll('.analytics-chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      analyticsActiveMetric = btn.dataset.metric;
      analyticsHoverIdx = -1;
      tabsEl.querySelectorAll('.analytics-chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawAnalyticsChart(history);
    });
  });
}

function drawAnalyticsChart(history) {
  const canvas = $('analytics-chart');
  if (!canvas || !history.length) return;

  const metric = ANALYTICS_METRICS.find(m => m.key === analyticsActiveMetric);
  if (!metric) return;

  // Build data points: one per day (max value), sorted by time
  const byDay = {};
  for (const snap of history) {
    const v = snap[metric.key];
    if (v == null) continue;
    const day = snap.date || new Date(snap.ts).toISOString().split('T')[0];
    if (!byDay[day] || v > byDay[day].value) {
      byDay[day] = { ts: snap.ts, value: v, date: day };
    }
  }
  const pts = Object.values(byDay).sort((a, b) => a.ts - b.ts);

  if (!pts.length) return;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (!W || !H) return;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 16, right: 14, bottom: 22, left: 40 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  // Value range
  const vals = pts.map(p => p.value);
  let vMin = Math.min(...vals);
  let vMax = Math.max(...vals);
  const margin = Math.max(1, (vMax - vMin) * 0.15);
  vMin = Math.max(0, vMin - margin);
  vMax = vMax + margin;
  if (vMax === vMin) vMax = vMin + 10;

  // Time range
  const tMin = pts[0].ts;
  const tMax = pts[pts.length - 1].ts;
  const tSpan = Math.max(1, tMax - tMin);

  const xOf = (t) => pad.left + ((t - tMin) / tSpan) * cw;
  const yOf = (v) => pad.top + (1 - (v - vMin) / (vMax - vMin)) * ch;

  // Grid lines
  const isDay = document.documentElement.classList.contains('day');
  const gridColor = isDay ? '#E5E7EB' : '#1A1A24';
  const labelColor = isDay ? '#9CA3BF' : '#42425A';
  const gridSteps = 4;
  ctx.font = '9px -apple-system,sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= gridSteps; i++) {
    const v = vMin + (vMax - vMin) * (i / gridSteps);
    const y = yOf(v);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.fillText(fmtNum(Math.round(v)), pad.left - 5, y + 3.5);
  }

  // X-axis dates
  ctx.textAlign = 'center';
  ctx.fillStyle = labelColor;
  const xLabels = pts.length <= 6 ? pts : [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
  xLabels.forEach(p => {
    const d = new Date(p.ts);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    ctx.fillText(label, xOf(p.ts), H - pad.bottom + 12);
  });

  // Area fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, metric.color + '20');
  grad.addColorStop(1, metric.color + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = xOf(p.ts), y = yOf(p.value);
    if (i === 0) ctx.moveTo(x, y);
    else {
      const pp = pts[i - 1];
      const cpx = (xOf(pp.ts) + x) / 2;
      ctx.bezierCurveTo(cpx, yOf(pp.value), cpx, y, x, y);
    }
  });
  ctx.lineTo(xOf(pts[pts.length - 1].ts), H - pad.bottom);
  ctx.lineTo(xOf(pts[0].ts), H - pad.bottom);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.strokeStyle = metric.color;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = xOf(p.ts), y = yOf(p.value);
    if (i === 0) { ctx.moveTo(x, y); return; }
    const pp = pts[i - 1];
    const cpx = (xOf(pp.ts) + x) / 2;
    ctx.bezierCurveTo(cpx, yOf(pp.value), cpx, y, x, y);
  });
  ctx.stroke();

  // Dots
  pts.forEach((p, i) => {
    const isHov = analyticsHoverIdx === i;
    ctx.beginPath();
    ctx.arc(xOf(p.ts), yOf(p.value), isHov ? 4.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isHov ? metric.color : metric.color + '99';
    ctx.fill();
    if (isHov) {
      ctx.strokeStyle = isDay ? '#FFFFFF' : '#0C0C10';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // Crosshair + tooltip
  if (analyticsHoverIdx >= 0 && analyticsHoverIdx < pts.length) {
    const hov = pts[analyticsHoverIdx];
    const hx = xOf(hov.ts);
    ctx.strokeStyle = isDay ? '#CBD5E1' : '#46465A';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, pad.top);
    ctx.lineTo(hx, H - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    const tooltip = $('analytics-chart-tooltip');
    const d = new Date(hov.ts);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    tooltip.innerHTML = `
      <div class="ct-date">${dateStr}</div>
      <div class="ct-val" style="color:${metric.color}">${fmtNum(hov.value)} <span style="color:var(--text-3);font-weight:400;font-size:10px">${metric.label}</span></div>`;
    tooltip.classList.remove('hidden');
    const tipW = tooltip.offsetWidth || 130;
    tooltip.style.left = `${hx + 12 + tipW > W ? hx - tipW - 12 : hx + 12}px`;
    tooltip.style.top = `${pad.top}px`;
  } else {
    $('analytics-chart-tooltip').classList.add('hidden');
  }
}

// Analytics chart mouse interaction
(function bindAnalyticsChartEvents() {
  const canvas = $('analytics-chart');
  let currentHistory = [];

  function nearestIdx(mouseX) {
    if (!currentHistory.length) return -1;
    const metric = ANALYTICS_METRICS.find(m => m.key === analyticsActiveMetric);
    if (!metric) return -1;
    // Must match the same daily-grouped logic as drawAnalyticsChart
    const byDay = {};
    for (const snap of currentHistory) {
      const v = snap[metric.key];
      if (v == null) continue;
      const day = snap.date || new Date(snap.ts).toISOString().split('T')[0];
      if (!byDay[day] || v > byDay[day].value) {
        byDay[day] = { ts: snap.ts, value: v, date: day };
      }
    }
    const pts = Object.values(byDay).sort((a, b) => a.ts - b.ts);
    if (!pts.length) return -1;

    const W = canvas.offsetWidth;
    const padL = 40, padR = 14;
    const cw = W - padL - padR;
    const tMin = pts[0].ts, tMax = pts[pts.length - 1].ts, tSpan = Math.max(1, tMax - tMin);
    const xOf = (t) => padL + ((t - tMin) / tSpan) * cw;

    let closest = 0, minDist = Infinity;
    pts.forEach((p, i) => {
      const dist = Math.abs(xOf(p.ts) - mouseX);
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    return minDist < 30 ? closest : -1;
  }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const idx = nearestIdx(e.clientX - rect.left);
    if (idx !== analyticsHoverIdx) {
      analyticsHoverIdx = idx;
      drawAnalyticsChart(currentHistory);
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (analyticsHoverIdx !== -1) {
      analyticsHoverIdx = -1;
      drawAnalyticsChart(currentHistory);
    }
  });

  // Expose setter for history data
  window._setAnalyticsChartHistory = (h) => { currentHistory = h; };
})();

async function initAnalyticsChart() {
  const history = await getAnalyticsHistory();
  window._setAnalyticsChartHistory(history);
  buildAnalyticsChartTabs(history);
  drawAnalyticsChart(history);
}

function loadAnalytics() {
  chrome.runtime.sendMessage({ action: "getAnalytics" }, (data) => {
    renderAnalytics(data || {});
    initAnalyticsChart();
  });
}

// Live-refresh analytics when background stores new data
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && analyticsScreen.classList.contains("open")) {
    if (changes.liAnalytics) {
      renderAnalytics(changes.liAnalytics.newValue || {});
    }
    if (changes.liAnalyticsHistory) {
      const h = changes.liAnalyticsHistory.newValue || [];
      window._setAnalyticsChartHistory(h);
      buildAnalyticsChartTabs(h);
      drawAnalyticsChart(h);
    }
  }
});

// ── Profile Tips screen ──────────────────────────────────────────────────────
const tipsScreen = $("tips-screen");

$("btn-tips").addEventListener("click", () => {
  tipsScreen.classList.add("open");
  loadProfileTips();
});
$("tips-back-btn").addEventListener("click", () =>
  tipsScreen.classList.remove("open"),
);

const TIPS_BTN_HTML = `${REFRESH_SVG} Analyze`;
$("tips-refresh-btn").addEventListener("click", () => {
  const btn = $("tips-refresh-btn");
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  btn.innerHTML = `${REFRESH_SVG} Analyzing…`;

  chrome.runtime.sendMessage({ action: "fetchProfileTips" }, (result) => {
    btn.classList.remove('loading');
    if (!result || result.error) {
      btn.innerHTML = `${REFRESH_SVG} Try again`;
      // Show error in status bar
      const bar = $("status-bar");
      bar.textContent = result?.error || 'Could not analyze profile.';
      bar.classList.remove("hidden");
      setTimeout(() => bar.classList.add("hidden"), 6000);
      setTimeout(() => { btn.innerHTML = TIPS_BTN_HTML; }, 3000);
      return;
    }
    btn.innerHTML = `${CHECK_SVG} Done`;
    setTimeout(() => { btn.innerHTML = TIPS_BTN_HTML; }, 2000);
    renderProfileTips(result);
  });
});

const PILLAR_LABELS = {
  prof_brand: 'Professional Brand',
  find_right_people: 'Find Right People',
  insight_engagement: 'Insight Engagement',
  relationship: 'Relationships',
};

function loadProfileTips() {
  chrome.runtime.sendMessage({ action: "getProfileTips" }, (data) => {
    if (data && data.tips) renderProfileTips(data);
  });
}

const SECTION_NAMES = {
  photo: 'Profile Photo',
  banner: 'Banner Image',
  headline: 'Headline',
  about: 'About',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  certifications: 'Certifications',
  recommendations: 'Recommendations',
  featured: 'Featured',
  activity: 'Activity',
  volunteer: 'Volunteer',
  projects: 'Projects',
  publications: 'Publications',
};

const STATUS_ICONS = {
  complete: '✓',
  weak: '!',
  missing: '✗',
};

function renderProfileTips(data) {
  const emptyEl = $("tips-empty");
  const contentEl = $("tips-content");
  const listEl = $("tips-list");
  const listTitle = $("tips-list-title");
  const sectionsEl = $("tips-sections");
  const statsEl = $("tips-gauge-stats");
  const pctEl = $("tips-gauge-pct");
  const arcEl = $("tips-gauge-arc");

  if (!data || !data.tips) {
    emptyEl.style.display = "";
    contentEl.classList.add("hidden");
    return;
  }

  emptyEl.style.display = "none";
  contentEl.classList.remove("hidden");

  // Gauge
  const score = data.score || { pct: 0, complete: 0, weak: 0, missing: 0 };
  const pct = score.pct;
  const circumference = 2 * Math.PI * 52; // ~326.7
  const dashLen = (pct / 100) * circumference;
  arcEl.setAttribute("stroke-dasharray", `${dashLen} ${circumference}`);

  // Gauge color
  if (pct >= 80) arcEl.setAttribute("stroke", "var(--green)");
  else if (pct >= 50) arcEl.setAttribute("stroke", "var(--amber)");
  else arcEl.setAttribute("stroke", "var(--red)");

  pctEl.textContent = pct + "%";

  statsEl.innerHTML = `
    <div class="tips-stat-row"><span class="tips-stat-dot complete"></span>${score.complete} complete</div>
    <div class="tips-stat-row"><span class="tips-stat-dot weak"></span>${score.weak} needs work</div>
    <div class="tips-stat-row"><span class="tips-stat-dot missing"></span>${score.missing} missing</div>
  `;

  // Sections overview — show all sections with status
  if (data.sections) {
    sectionsEl.innerHTML = Object.entries(data.sections)
      .filter(([key]) => SECTION_NAMES[key])
      .map(([key, sec]) => {
        const st = sec.status || 'missing';
        return `<div class="tips-sec-item">
          <span class="tips-sec-icon ${st}">${STATUS_ICONS[st]}</span>
          <span>${SECTION_NAMES[key]}</span>
        </div>`;
      }).join('');
  }

  // Tips list
  if (!data.tips.length) {
    listTitle.style.display = 'none';
    listEl.innerHTML = `<div style="text-align:center;color:var(--green);padding:20px;font-weight:600;">
      Your profile looks great! No major improvements needed.
    </div>`;
    return;
  }

  listTitle.style.display = '';
  listEl.innerHTML = data.tips.map(tip => `
    <div class="tip-card">
      <div class="tip-card-header">
        <span class="tip-card-title">${tip.title}</span>
        <span class="tip-impact ${tip.impact}">${tip.impact}</span>
      </div>
      <div class="tip-card-desc">${tip.desc}</div>
      <div class="tip-card-meta">
        <span class="tip-pillar-badge">${PILLAR_LABELS[tip.pillar] || tip.pillar}</span>
        ${tip.boosted ? '<span class="tip-boosted">&#9889; Priority boost</span>' : ''}
      </div>
    </div>
  `).join('');

  // Debug diagnostics (collapsible) — helps fix detection issues
  const debugEl = document.getElementById('tips-debug');
  if (debugEl && data.debug) {
    const d = data.debug;
    const lines = Object.entries(d)
      .filter(([k]) => k !== 'pageIds')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');
    const idList = (d.pageIds || []).join(', ');
    debugEl.innerHTML = `<details class="tips-debug-details">
      <summary>Diagnostics</summary>
      <pre class="tips-debug-pre">${lines}\n\npageIds: ${idList}</pre>
    </details>`;
  }
}

// Live-refresh tips when background stores new data
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.profileTips) {
    const data = changes.profileTips.newValue;
    if (data && data.tips) renderProfileTips(data);
  }
});

// ── Day / Night theme ─────────────────────────────────────────────────────────
function setThemeHint(isDay) {
  const el = $("theme-hint");
  if (el) el.textContent = isDay ? "Day mode" : "Night mode";
}

(function initTheme() {
  chrome.storage.local.get(["theme"], ({ theme }) => {
    const isDay = theme === "day";
    if (isDay) document.documentElement.classList.add("day");
    setThemeHint(isDay);
  });
})();

$("theme-toggle").addEventListener("click", () => {
  const isDay = document.documentElement.classList.toggle("day");
  chrome.storage.local.set({ theme: isDay ? "day" : "night" });
  setThemeHint(isDay);
  requestAnimationFrame(drawChart);
});

// ── Support / About screen ────────────────────────────────────────────────────
const supportScreen = $("support-screen");
$("brand-btn").addEventListener("click", () =>
  supportScreen.classList.add("open"),
);
$("support-back-btn").addEventListener("click", () =>
  supportScreen.classList.remove("open"),
);

// ── Auth / Account screen ────────────────────────────────────────────────────
const authScreen = $("auth-screen");
const authForms = $("auth-forms");
const authAccount = $("auth-account");
const loginForm = $("login-form");
const registerForm = $("register-form");
const tabLogin = $("tab-login");
const tabRegister = $("tab-register");
const userBtn = $("user-btn");

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function updateAuthUI() {
  const user = Auth.getUser();
  const loggedIn = Auth.isLoggedIn();
  const pro = Auth.isPro();

  // Update header user button
  if (userBtn) userBtn.classList.toggle("logged-in", loggedIn);
  if (userBtn) userBtn.classList.toggle("is-pro", pro);
  const initialsEl = $("user-btn-initials");
  if (loggedIn && user) {
    initialsEl.textContent = getInitials(user.name);
    initialsEl.classList.remove("hidden");
  } else {
    initialsEl.classList.add("hidden");
  }

  // Toggle forms vs account view
  if (loggedIn && user) {
    authForms.classList.add("hidden");
    authAccount.classList.remove("hidden");
    $("auth-screen-title").textContent = "Account";

    // Populate account info
    $("auth-avatar").textContent = getInitials(user.name);
    $("auth-avatar").classList.toggle("pro", pro);
    $("auth-user-name").textContent = user.name;
    $("auth-user-email").textContent = user.email;

    // Avatar image (from Google)
    const avatarImg = $("auth-avatar-img");
    if (user.avatarUrl) {
      avatarImg.src = user.avatarUrl;
      avatarImg.classList.remove("hidden");
      avatarImg.classList.toggle("pro", pro);
    } else {
      avatarImg.classList.add("hidden");
    }

    // Google connected badge
    const googleBadge = $("auth-google-linked");
    if (user.googleLinked) {
      googleBadge.classList.remove("hidden");
    } else {
      googleBadge.classList.add("hidden");
    }

    const badge = $("auth-plan-badge");
    badge.textContent = pro ? "Pro" : "Free";
    badge.className = `auth-plan-badge ${pro ? "pro" : "free"}`;
  } else {
    authForms.classList.remove("hidden");
    authAccount.classList.add("hidden");
    $("auth-screen-title").textContent = "Account";
    // Reset error states
    $("login-error").classList.add("hidden");
    $("register-error").classList.add("hidden");
    $("auth-google-error").classList.add("hidden");
  }
}

// Open / close auth screen
if (userBtn) userBtn.addEventListener("click", () => {
  updateAuthUI();
  if (authScreen) authScreen.classList.add("open");
});
// Auth UI only wires up when the auth-screen is present in the DOM
// (it's currently commented out in HTML — guard prevents null crashes)
if (authScreen) {
  $("auth-back-btn").addEventListener("click", () => {
    authScreen.classList.remove("open");
  });

  // Tab switching
  if (tabLogin) tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    $("login-error").classList.add("hidden");
  });
  if (tabRegister) tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    $("register-error").classList.add("hidden");
  });

  // Login form submit
  if (loginForm) loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    const errEl = $("login-error");
    const submitBtn = loginForm.querySelector(".auth-submit");
    errEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in\u2026";
    try {
      await Auth.login(email, password);
      loginForm.reset();
      updateAuthUI();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  });

  // Register form submit
  if (registerForm) registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("register-name").value.trim();
    const email = $("register-email").value.trim();
    const password = $("register-password").value;
    const errEl = $("register-error");
    const submitBtn = registerForm.querySelector(".auth-submit");
    errEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account\u2026";
    try {
      await Auth.register(name, email, password);
      registerForm.reset();
      updateAuthUI();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account";
    }
  });

  // Google Sign-In
  const googleBtn = $("auth-google-btn");
  if (googleBtn) googleBtn.addEventListener("click", async () => {
    const btn = $("auth-google-btn");
    const errEl = $("auth-google-error");
    errEl.classList.add("hidden");
    btn.disabled = true;
    btn.querySelector(".google-icon").style.display = "none";
    btn.innerHTML = `<span class="btn-spinner"></span> Signing in\u2026`;
    try {
      await Auth.loginWithGoogle();
      updateAuthUI();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg class="google-icon" width="16" height="16" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg> Continue with Google`;
    }
  });

  // Skip / continue without account
  const authSkip = $("auth-skip");
  if (authSkip) authSkip.addEventListener("click", () => {
    authScreen.classList.remove("open");
  });

  // Logout
  const authLogout = $("auth-logout-btn");
  if (authLogout) authLogout.addEventListener("click", async () => {
    await Auth.logout();
    updateAuthUI();
    authScreen.classList.remove("open");
  });
}

// Init auth on load
Auth.init().then(() => updateAuthUI());

// ── Jobs Suggestions ───────────────────────────────────────────────────────────
let _jobsLoaded = false;

function loadJobs() {
  chrome.runtime.sendMessage({ action: "getJobs" }, (data) => {
    if (data && data.jobs?.length) {
      renderJobs(data);
      _jobsLoaded = true;
    }
  });
}

function renderJobs(data) {
  const emptyEl = $("jobs-empty");
  const listEl = $("jobs-list");
  const footerEl = $("jobs-footer");
  if (!emptyEl || !listEl || !footerEl) return;

  if (!data?.jobs?.length) {
    emptyEl.classList.remove("hidden");
    listEl.classList.add("hidden");
    footerEl.classList.add("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  listEl.classList.remove("hidden");
  footerEl.classList.remove("hidden");

  listEl.innerHTML = data.jobs.map((job, i) => {
    const remoteBadge = job.workRemoteAllowed
      ? '<span class="job-badge job-remote">Remote</span>'
      : '';
    const timeStr = job.timeText || '';
    const timeBadge = timeStr ? `<span class="job-time">${timeStr}</span>` : '';
    const logoHtml = job.logo
      ? `<img class="job-logo" src="${job.logo}" alt="" onerror="this.style.display='none'">`
      : `<div class="job-logo job-logo-placeholder">
           <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
             <rect x="3" y="6" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/>
             <path d="M7 6V5a3 3 0 0 1 6 0v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
           </svg>
         </div>`;

    return `<a class="job-card" href="${job.url}" target="_blank" rel="noopener">
      ${logoHtml}
      <div class="job-card-body">
        <div class="job-title">${job.title}</div>
        <div class="job-company">${job.company}</div>
        <div class="job-meta">
          ${job.location ? `<span class="job-location">${job.location}</span>` : ''}
          ${remoteBadge}
          ${timeBadge}
        </div>
      </div>
      <svg class="job-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>`;
  }).join("");
}

// Jobs refresh button
if ($("jobs-refresh-btn")) {
  $("jobs-refresh-btn").addEventListener("click", () => {
    const icon = $("jobs-refresh-icon");
    if (icon) icon.classList.add("spinning");
    const emptyEl = $("jobs-empty");
    if (emptyEl) {
      emptyEl.innerHTML = '<p style="color:var(--text-3);font-size:13px">Fetching job suggestions from LinkedIn...</p>';
      emptyEl.classList.remove("hidden");
    }
    const listEl = $("jobs-list");
    const footerEl = $("jobs-footer");
    if (listEl) listEl.classList.add("hidden");
    if (footerEl) footerEl.classList.add("hidden");

    chrome.runtime.sendMessage({ action: "fetchJobs" }, (data) => {
      if (icon) icon.classList.remove("spinning");
      if (data?.error) {
        if (emptyEl) emptyEl.innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`;
        return;
      }
      if (!data?.jobs?.length) {
        const d = data?.debug || {};
        if (emptyEl) emptyEl.innerHTML = `<p style="color:var(--text-3);font-size:13px">No job recommendations found. Try visiting <a href="https://www.linkedin.com/jobs/" target="_blank" style="color:var(--green)">LinkedIn Jobs</a> first.</p>
          <details style="margin-top:12px;font-size:11px;color:var(--text-3)">
            <summary style="cursor:pointer">Debug info</summary>
            <pre style="white-space:pre-wrap;margin-top:4px;text-align:left">${JSON.stringify(d, null, 2)}</pre>
          </details>`;
        return;
      }
      renderJobs(data);
    });
  });
}

// Jobs back button (narrow mode)
if ($("jobs-back-btn")) {
  $("jobs-back-btn").addEventListener("click", () => {
    $("jobs-screen").classList.remove("open");
  });
}

// ── Onboarding Walkthrough ──────────────────────────────────────────────────────
const OB_KEY = "_se_onboardDone";

const OB_STEPS_ALL = [
  {
    target: "#btn-refresh",
    title: "Getting Started",
    desc: "First, open linkedin.com in any tab and sign in. Then click Refresh Score \u2014 SocialEdge will fetch your SSI automatically. After this one-time setup, your score updates every day behind the scenes.",
    pos: "above",
  },
  {
    target: ".hero",
    title: "Your Overall Score",
    desc: "This is your LinkedIn Social Selling Index \u2014 a single number (0\u2013100) that shows how effectively you're building your brand, finding the right people, and engaging on LinkedIn. It updates automatically every day.",
    pos: "below",
  },
  {
    target: ".pillars-grid",
    title: "Score by Topics & Activity",
    desc: "Your score breaks down into four pillars \u2014 Professional Brand, Find Right People, Insight Engagement, and Strong Relationships. Tap any pillar to see daily activities you can complete to boost it.",
    pos: "below",
  },
  {
    target: "#quest-trigger",
    title: "Daily Quest",
    desc: "Every day we pick 3 personalised activities just for you, focusing on your weakest areas. Complete them to build a streak! The orange dot means you have a new quest waiting.",
    pos: "below",
  },
  {
    target: ".benchmarks",
    title: "Top Scores & Benchmarks",
    desc: "See how you stack up against your industry and your network. Track your percentile ranking and watch it improve over time.",
    pos: "below",
  },
  {
    target: "#btn-history",
    title: "Score History",
    desc: "View your full score history with trends, a visual chart, and 30/60/90-day forecasts. Every data point is saved automatically.",
    pos: "above",
    narrowOnly: true,
  },
  {
    target: "#btn-analytics",
    title: "LinkedIn Analytics",
    desc: "Track your profile views, followers, connections, search appearances, and post impressions \u2014 all captured directly from your LinkedIn profile.",
    pos: "above",
    narrowOnly: true,
  },
  {
    target: ".boost-link",
    title: "Free Boost Strategy",
    desc: "Download our free PDF guide with proven strategies and daily routines to grow your Social Selling Score faster. One click and it's yours!",
    pos: "below",
  },
];

// Filter out steps whose target doesn't exist or isn't relevant to current mode
function getObSteps() {
  return OB_STEPS_ALL.filter(s => {
    if (s.narrowOnly && isWideMode()) return false;
    return !!document.querySelector(s.target);
  });
}
let OB_STEPS = getObSteps();

let obStep = 0;

function startOnboarding() {
  OB_STEPS = getObSteps();
  obStep = 0;
  $("ob-overlay").classList.remove("hidden");
  renderObStep();
}

function endOnboarding() {
  $("ob-overlay").classList.add("hidden");
  chrome.storage.local.set({ [OB_KEY]: true });
}

function renderObStep() {
  if (obStep >= OB_STEPS.length) {
    endOnboarding();
    return;
  }

  const step = OB_STEPS[obStep];
  const targetEl = document.querySelector(step.target);

  // Scroll target into view if needed
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Wait a tick for scroll to settle, then position
  requestAnimationFrame(() => {
    positionSpotlight(targetEl, step);
    renderObTooltip(step);
  });
}

function positionSpotlight(el, step) {
  const spotlight = $("ob-spotlight");
  const backdrop = $("ob-backdrop");

  if (!el) {
    spotlight.style.display = "none";
    backdrop.style.opacity = "1";
    return;
  }

  spotlight.style.display = "block";
  backdrop.style.opacity = "0"; // backdrop is replaced by spotlight box-shadow

  const rect = el.getBoundingClientRect();
  const pad = 6;
  spotlight.style.top = (rect.top - pad) + "px";
  spotlight.style.left = (rect.left - pad) + "px";
  spotlight.style.width = (rect.width + pad * 2) + "px";
  spotlight.style.height = (rect.height + pad * 2) + "px";
}

function renderObTooltip(step) {
  const tooltip = $("ob-tooltip");
  const targetEl = document.querySelector(step.target);

  // Title & desc
  $("ob-title").textContent = step.title;
  $("ob-desc").textContent = step.desc;

  // Step dots
  const dotsHTML = OB_STEPS.map((_, i) => {
    let cls = "ob-dot";
    if (i === obStep) cls += " active";
    else if (i < obStep) cls += " done";
    return `<span class="${cls}"></span>`;
  }).join("");
  $("ob-step-indicator").innerHTML = dotsHTML;

  // Button labels
  const isLast = obStep === OB_STEPS.length - 1;
  $("ob-next").textContent = isLast ? "Get Started" : "Next";
  $("ob-skip").textContent = obStep === 0 ? "Skip" : "Skip";

  // Position tooltip above or below target
  const rect = targetEl?.getBoundingClientRect();
  // Reset animation
  tooltip.style.animation = "none";
  void tooltip.offsetWidth;
  tooltip.style.animation = "";

  if (rect) {
    if (step.pos === "above") {
      tooltip.style.bottom = "auto";
      tooltip.style.top = Math.max(8, rect.top - tooltip.offsetHeight - 16) + "px";
    } else {
      tooltip.style.top = (rect.bottom + 16) + "px";
      tooltip.style.bottom = "auto";
    }
  }

  // If tooltip goes off-screen, clamp it
  requestAnimationFrame(() => {
    const tRect = tooltip.getBoundingClientRect();
    const vh = window.innerHeight;
    if (tRect.bottom > vh - 8) {
      tooltip.style.top = Math.max(8, vh - tRect.height - 8) + "px";
    }
    if (tRect.top < 8) {
      tooltip.style.top = "8px";
    }
  });
}

// Button handlers
$("ob-next").addEventListener("click", () => {
  obStep++;
  renderObStep();
});
$("ob-skip").addEventListener("click", () => {
  endOnboarding();
});

// Launch on first install
chrome.storage.local.get([OB_KEY], (r) => {
  if (!r[OB_KEY]) {
    // Short delay so the UI renders first
    setTimeout(startOnboarding, 600);
  }
});

// Replay walkthrough from About screen
$("replay-walkthrough").addEventListener("click", () => {
  // Close the support screen
  $("support-screen").classList.remove("open");
  // Make sure dashboard tab is on the main "score" view
  switchDashTab("score");
  // Scroll main container to top so dashboard elements are in DOM
  const main = document.querySelector(".container") || document.documentElement;
  main.scrollTop = 0;
  chrome.storage.local.remove(OB_KEY);
  // Longer delay to let DOM settle after closing support screen
  setTimeout(startOnboarding, 600);
});
