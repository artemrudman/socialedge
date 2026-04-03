// ── Activity definitions (10 per pillar) ───────────────────────────────────────
const ACTIVITIES = {
  prof_brand: {
    name: "Professional Brand",
    items: [
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
  },
  find_right_people: {
    name: "Find Right People",
    items: [
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
  },
  insight_engagement: {
    name: "Insight Engagement",
    items: [
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
  },
  relationship: {
    name: "Strong Relationships",
    items: [
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
        return `<td class="${d > 0 ? "t-up" : "t-down"}">${val}${d > 0 ? " ↑" : " ↓"}</td>`;
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
      <span class="activity-label">${item}</span>
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
          <span class="act-item-text">${item}</span>
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
async function loadAndRender() {
  allActivities = await loadActivities();
  chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
    if (history?.length) {
      render(history[0], history[1]);
      renderHistory(history);
    }
  });
}
loadAndRender();

// Live refresh when background stores new SSI data
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ssiHistory) {
    const history = changes.ssiHistory.newValue || [];
    if (history.length) {
      render(history[0], history[1]);
      renderHistory(history);
    }
  }
  if (area === "local" && changes.dailyActivities) {
    allActivities = changes.dailyActivities.newValue || {};
  }
});

// ── Refresh button ────────────────────────────────────────────────────────────────
$("btn-refresh").addEventListener("click", () => {
  const btn = $("btn-refresh");
  btn.disabled = true;
  btn.textContent = "Fetching…";
  showStatus("Fetching in background…", "success", 0);

  chrome.runtime.sendMessage({ action: "fetchNow" }, (result) => {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M11 6.5A4.5 4.5 0 1 1 6.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M6.5 2l1.8-1.8M6.5 2l1.8 1.8" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg> Refresh Score`;

    if (!result) {
      showStatus("No response. Try reloading the extension.", "error");
      return;
    }
    if (result.error) {
      showStatus(result.error, "error");
      return;
    }

    chrome.runtime.sendMessage({ action: "getHistory" }, (history) => {
      if (history?.length) {
        render(history[0], history[1]);
        renderHistory(history);
      }
    });
    showStatus("Score updated!", "success");
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
      <span class="legend-pro-badge">🔒 Pro</span>
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

$("btn-export-main").addEventListener("click", doExport);
$("btn-export-history").addEventListener("click", doExport);

// ── Analytics screen ──────────────────────────────────────────────────────────
const analyticsScreen = $("analytics-screen");

function showAnalyticsStatus(msg, type, duration = 0) {
  const el = $("analytics-status");
  el.textContent = msg;
  el.className = `analytics-status ${type}`;
  if (duration > 0) setTimeout(() => el.classList.add("hidden"), duration);
}

$("btn-analytics").addEventListener("click", () => {
  analyticsScreen.classList.add("open");
  loadAnalytics();
});

$("analytics-refresh-btn").addEventListener("click", () => {
  const btn = $("analytics-refresh-btn");
  btn.disabled = true;
  showAnalyticsStatus("Fetching from LinkedIn…", "info");

  chrome.runtime.sendMessage({ action: "fetchAnalytics" }, (result) => {
    btn.disabled = false;
    if (!result || result.error) {
      showAnalyticsStatus(
        result?.error || "Failed — open a LinkedIn tab and try again.",
        "error",
        6000,
      );
    } else {
      showAnalyticsStatus("Analytics updated!", "success", 3000);
      loadAnalytics();
    }
  });
});
$("analytics-back-btn").addEventListener("click", () =>
  analyticsScreen.classList.remove("open"),
);

function fmtNum(v) {
  if (v == null) return null;
  if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
  if (v >= 1000) return (v / 1000).toFixed(1) + "K";
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

function loadAnalytics() {
  chrome.runtime.sendMessage({ action: "getAnalytics" }, (data) => {
    renderAnalytics(data || {});
  });
}

// Live-refresh analytics when background stores new data
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    changes.liAnalytics &&
    analyticsScreen.classList.contains("open")
  ) {
    renderAnalytics(changes.liAnalytics.newValue || {});
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
