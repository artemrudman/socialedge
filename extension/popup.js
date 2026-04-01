// ── Activity definitions (10 per pillar) ───────────────────────────────────────
const ACTIVITIES = {
  prof_brand: {
    name: 'Professional Brand',
    items: [
      'Published an original post',
      'Published a long-form article',
      'Updated a profile section',
      'Requested a skill endorsement',
      'Gave a skill endorsement to a connection',
      'Shared industry content with personal commentary',
      'Refreshed profile photo or banner',
      'Added a quantified achievement to experience',
      'Added or updated featured section',
      'Completed a LinkedIn learning course',
    ],
  },
  find_right_people: {
    name: 'Find Right People',
    items: [
      'Used advanced search filters to find prospects',
      'Saved 5+ new leads',
      'Saved a new account',
      'Reviewed "People Also Viewed" suggestions',
      'Used TeamLink to find a warm introduction',
      'Browsed recommended accounts',
      'Ran a boolean search query',
      'Filtered by job change in the past 90 days',
      'Searched within a specific account',
      'Reviewed lead recommendations from Sales Navigator',
    ],
  },
  insight_engagement: {
    name: 'Insight Engagement',
    items: [
      'Left a thoughtful comment on a lead\'s post',
      'Shared content with personal insight added',
      'Engaged with a target account\'s content',
      'Created a poll',
      'Responded to a poll',
      'Sent a relevant article to a prospect',
      'Liked a post from a saved lead',
      'Reposted with added perspective',
      'Replied to a comment on my own post',
      'Tagged a connection in a relevant post',
    ],
  },
  relationship: {
    name: 'Strong Relationships',
    items: [
      'Sent a personalized InMail',
      'Followed up with a new connection',
      'Congratulated a lead on a job change',
      'Congratulated a lead on a work anniversary',
      'Reconnected with a dormant contact',
      'Responded to a message within 24 hours',
      'Sent a voice note to a prospect',
      'Accepted a connection request with a personal reply',
      'Introduced two connections to each other',
      'Scheduled a call or meeting with a lead',
    ],
  },
};

const PILLAR_KEYS = ['prof_brand', 'find_right_people', 'insight_engagement', 'relationship'];

// ── Helpers ─────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function fmt(v, dec = 1) {
  return v == null ? '—' : Number(v).toFixed(dec);
}

function scoreColor(v, max = 100) {
  if (v == null) return '#46465A';
  const pct = v / max;
  if (pct >= 0.72) return '#34D399';
  if (pct >= 0.48) return '#60A5FA';
  if (pct >= 0.28) return '#FBBF24';
  return '#F87171';
}

function rankClass(rank) {
  if (rank == null) return '';
  if (rank <= 10)  return 'rank-green';
  if (rank <= 25)  return 'rank-blue';
  if (rank <= 50)  return 'rank-amber';
  return 'rank-red';
}

function trend(cur, prev) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return { dir: 'flat', label: '—' };
  return { dir: d > 0 ? 'up' : 'down', label: `${d > 0 ? '+' : ''}${d.toFixed(1)}` };
}

// For Top-N% rankings: lower percentage = better position
function trendPct(cur, prev) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return null;
  // d < 0 means rank improved (e.g. Top 10% → Top 8%)
  return { dir: d < 0 ? 'up' : 'down', label: `${Math.abs(Math.round(d))}%` };
}

function animateNum(el, to, dec = 1, duration = 700) {
  const from  = parseFloat(el.textContent) || 0;
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (from + (to - from) * e).toFixed(dec);
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

function applyTrend(el, t, cls = 'pillar-trend') {
  if (!t || t.dir === 'flat') { el.textContent = ''; el.className = `${cls} flat`; return; }
  el.textContent = (t.dir === 'up' ? '↑ ' : '↓ ') + t.label;
  el.className   = `${cls} ${t.dir}`;
}

// ── Activity storage ─────────────────────────────────────────────────────────────
// Format: { 'YYYY-MM-DD': { prof_brand: [bool,bool,...], ... } }

const ACT_KEY = 'dailyActivities';

function today() { return new Date().toISOString().split('T')[0]; }

async function loadActivities() {
  return new Promise((res) => chrome.storage.local.get([ACT_KEY], (r) => res(r[ACT_KEY] || {})));
}

async function saveActivitiesForDate(date, pillarKey, checkedArr) {
  const all = await loadActivities();
  if (!all[date]) all[date] = {};
  all[date][pillarKey] = checkedArr;
  return new Promise((res) => chrome.storage.local.set({ [ACT_KEY]: all }, res));
}

function hasActivity(allActivities, date) {
  const day = allActivities[date];
  if (!day) return false;
  return Object.values(day).some((arr) => arr.some(Boolean));
}

// ── State ────────────────────────────────────────────────────────────────────────
let lastPillarData   = {};
let currentPillarKey = null;
let allActivities    = {};

// ── Render main screen ───────────────────────────────────────────────────────────
function render(current, previous) {
  const p    = current.parsed;
  const prev = previous?.parsed;
  lastPillarData = { ...p, _prev: prev || null };

  const overallVal = p.overall ?? 0;
  animateNum($('overall'), overallVal);
  $('overall').style.color      = scoreColor(overallVal, 100);
  $('overall-bar').style.width  = `${(overallVal / 100) * 100}%`;
  $('overall-bar').style.background = scoreColor(overallVal, 100);
  const ot = trend(p.overall, prev?.overall);
  const otEl = $('overall-trend');
  if (!ot || ot.dir === 'flat') { otEl.innerHTML = ''; otEl.className = 'hero-trend flat'; }
  else { otEl.innerHTML = (ot.dir === 'up' ? '↑ ' : '↓ ') + ot.label; otEl.className = `hero-trend ${ot.dir}`; }

  $('last-updated').textContent = `Updated ${current.date}`;

  const pillars = [
    { key: 'prof_brand',         valId: 'val-pb',  barId: 'bar-pb',  trendId: 'trend-pb'  },
    { key: 'find_right_people',  valId: 'val-frp', barId: 'bar-frp', trendId: 'trend-frp' },
    { key: 'insight_engagement', valId: 'val-ie',  barId: 'bar-ie',  trendId: 'trend-ie'  },
    { key: 'relationship',       valId: 'val-rs',  barId: 'bar-rs',  trendId: 'trend-rs'  },
  ];

  pillars.forEach(({ key, valId, barId, trendId }) => {
    const val   = p[key];
    const color = scoreColor(val, 25);
    const valEl = $(valId);
    if (val != null) animateNum(valEl, val, 1); else valEl.textContent = '—';
    valEl.style.color = color;
    $(barId).style.width      = val != null ? `${(val / 25) * 100}%` : '0%';
    $(barId).style.background = color;
    applyTrend($(trendId), trend(val, prev?.[key]));
  });

  const ind = p.industry || {};
  const net = p.network  || {};
  $('bench-ind-name').textContent = ind.name || '—';
  $('bench-ind-ssi').textContent  = ind.ssi  != null ? fmt(ind.ssi)  + ' SSI' : '—';
  const indEl = $('bench-ind-top');
  indEl.textContent = ind.top != null ? `Top ${ind.top}%` : '—';
  indEl.className   = 'bench-rank ' + rankClass(ind.top);
  const indTrend = trendPct(ind.top, prev?.industry?.top);
  const indTrendEl = $('bench-ind-trend');
  if (indTrend && indTrend.dir !== 'flat') {
    indTrendEl.textContent = (indTrend.dir === 'up' ? '↑ ' : '↓ ') + indTrend.label;
    indTrendEl.className   = 'bench-trend ' + indTrend.dir;
  } else { indTrendEl.textContent = ''; indTrendEl.className = 'bench-trend'; }

  $('bench-net-ssi').textContent  = net.ssi  != null ? fmt(net.ssi)  + ' SSI' : '—';
  const netEl = $('bench-net-top');
  netEl.textContent = net.top != null ? `Top ${net.top}%` : '—';
  netEl.className   = 'bench-rank ' + rankClass(net.top);
  const netTrend = trendPct(net.top, prev?.network?.top);
  const netTrendEl = $('bench-net-trend');
  if (netTrend && netTrend.dir !== 'flat') {
    netTrendEl.textContent = (netTrend.dir === 'up' ? '↑ ' : '↓ ') + netTrend.label;
    netTrendEl.className   = 'bench-trend ' + netTrend.dir;
  } else { netTrendEl.textContent = ''; netTrendEl.className = 'bench-trend'; }
}

// ── Render history table ─────────────────────────────────────────────────────────
function renderHistory(history) {
  const tbody = $('history-body');
  $('history-count').textContent = `${Math.min(history.length, 30)} entries`;

  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No data yet</td></tr>';
    return;
  }

  tbody.innerHTML = history.slice(0, 30).map((entry, i) => {
    const p    = entry.parsed;
    const prev = history[i + 1]?.parsed;

    function cell(cur, prv) {
      const val = fmt(cur);
      if (cur == null || prv == null) return `<td>${val}</td>`;
      const d = cur - prv;
      if (Math.abs(d) < 0.05) return `<td>${val}</td>`;
      return `<td class="${d > 0 ? 't-up' : 't-down'}">${val}${d > 0 ? ' ↑' : ' ↓'}</td>`;
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
  }).join('');

  // Bind activity badge clicks
  tbody.querySelectorAll('.act-badge').forEach((badge) => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openActDetail(badge.dataset.date);
    });
  });
}

// ── Status bar ───────────────────────────────────────────────────────────────────
function showStatus(msg, type, duration = 5000) {
  const el = $('status-bar');
  el.textContent = msg;
  el.className   = `status-bar ${type}`;
  if (duration > 0) setTimeout(() => { el.className = 'status-bar hidden'; }, duration);
}

// ── Pillar detail screen ─────────────────────────────────────────────────────────
const detailScreen = $('detail-screen');

async function openDetail(key) {
  const info  = ACTIVITIES[key];
  const p     = lastPillarData;
  if (!info) return;

  currentPillarKey = key;

  const val   = p[key];
  const prev  = p._prev?.[key];
  const color = scoreColor(val, 25);
  const t     = trend(val, prev);

  $('detail-label').textContent = info.name;

  const scoreEl = $('detail-score');
  scoreEl.textContent = val != null ? Number(val).toFixed(1) : '—';
  scoreEl.style.color = color;

  const trendEl = $('detail-trend');
  if (t && t.dir !== 'flat') {
    trendEl.textContent = (t.dir === 'up' ? '↑ ' : '↓ ') + t.label;
    trendEl.className   = `detail-trend ${t.dir}`;
  } else { trendEl.textContent = ''; trendEl.className = 'detail-trend flat'; }

  const barEl = $('detail-bar');
  barEl.style.background = color;
  barEl.style.transition = 'none'; barEl.style.width = '0%';
  requestAnimationFrame(() => {
    barEl.style.transition = '';
    barEl.style.width = val != null ? `${(val / 25) * 100}%` : '0%';
  });

  // Load saved state for today
  const todayAct = allActivities[today()]?.[key] || info.items.map(() => false);

  const container = $('detail-activities');
  container.innerHTML = info.items.map((item, i) => `
    <label class="activity-item">
      <input type="checkbox" data-index="${i}" ${todayAct[i] ? 'checked' : ''}/>
      <span class="activity-label">${item}</span>
    </label>
  `).join('');

  // Hide confirmation
  $('save-confirm').classList.add('hidden');

  detailScreen.classList.add('open');
}

function closeDetail() {
  detailScreen.classList.remove('open');
  currentPillarKey = null;
}

document.querySelectorAll('.pillar').forEach((card) => {
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => openDetail(card.dataset.key));
});

$('back-btn').addEventListener('click', closeDetail);

// Save activities button
$('save-activity-btn').addEventListener('click', async () => {
  if (!currentPillarKey) return;
  const checks = Array.from($('detail-activities').querySelectorAll('input[type="checkbox"]'))
    .map((cb) => cb.checked);
  await saveActivitiesForDate(today(), currentPillarKey, checks);
  allActivities = await loadActivities();

  // Show confirmation
  $('save-confirm').classList.remove('hidden');
  setTimeout(() => $('save-confirm').classList.add('hidden'), 2500);

  // Refresh history table to update Act. column
  chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
    if (history?.length) renderHistory(history);
  });
});

// ── Activity detail screen (history ✓ click) ─────────────────────────────────────
const actDetailScreen = $('act-detail-screen');

function openActDetail(date) {
  $('act-detail-date').textContent = date;

  const dayAct = allActivities[date] || {};
  const body   = $('act-detail-body');

  // Build groups — only include pillars that have at least one checked item
  const groups = PILLAR_KEYS.map((key) => {
    const info    = ACTIVITIES[key];
    const checked = dayAct[key] || [];
    // Filter to only checked items
    const doneItems = info.items.filter((_, i) => checked[i]);
    return { name: info.name, doneItems };
  }).filter((g) => g.doneItems.length > 0);

  if (groups.length === 0) {
    body.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px 0">No activities recorded for this day.</p>';
  } else {
    body.innerHTML = groups.map((g) => {
      const rows = g.doneItems.map((item) => `
        <div class="act-item-row">
          <div class="act-item-check done">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5.5L4 8L8.5 2.5" stroke="#0C0C10" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="act-item-text">${item}</span>
        </div>`).join('');

      return `<div>
        <div class="act-group-title">${g.name}</div>
        <div class="act-group-items">${rows}</div>
      </div>`;
    }).join('');
  }

  actDetailScreen.classList.add('open');
}

$('act-detail-back').addEventListener('click', () => {
  actDetailScreen.classList.remove('open');
});

// ── Initial load ─────────────────────────────────────────────────────────────────
async function loadAndRender() {
  allActivities = await loadActivities();
  chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
    if (history?.length) {
      render(history[0], history[1]);
      renderHistory(history);
    }
  });
}
loadAndRender();

// Live refresh when background stores new SSI data
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.ssiHistory) {
    const history = changes.ssiHistory.newValue || [];
    if (history.length) { render(history[0], history[1]); renderHistory(history); }
  }
  if (area === 'local' && changes.dailyActivities) {
    allActivities = changes.dailyActivities.newValue || {};
  }
});

// ── Refresh button ────────────────────────────────────────────────────────────────
$('btn-refresh').addEventListener('click', () => {
  const btn = $('btn-refresh');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  showStatus('Fetching in background…', 'success', 0);

  chrome.runtime.sendMessage({ action: 'fetchNow' }, (result) => {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M11 6.5A4.5 4.5 0 1 1 6.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M6.5 2l1.8-1.8M6.5 2l1.8 1.8" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg> Refresh Score`;

    if (!result) { showStatus('No response. Try reloading the extension.', 'error'); return; }
    if (result.error) { showStatus(result.error, 'error'); return; }

    chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
      if (history?.length) { render(history[0], history[1]); renderHistory(history); }
    });
    showStatus('Score updated!', 'success');
  });
});

// ── History screen ────────────────────────────────────────────────────────────────
const historyScreen = $('history-screen');

$('btn-history').addEventListener('click', () => historyScreen.classList.add('open'));
$('history-back-btn').addEventListener('click', () => historyScreen.classList.remove('open'));

// ── Export buttons ────────────────────────────────────────────────────────────────
function doExport() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
    const json    = JSON.stringify(history, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
    const a       = document.createElement('a');
    a.href     = dataUrl;
    a.download = `socialedge_${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

$('btn-export-main').addEventListener('click', doExport);
$('btn-export-history').addEventListener('click', doExport);

// ── Support / About screen ────────────────────────────────────────────────────
const supportScreen = $('support-screen');
$('brand-btn').addEventListener('click', () => supportScreen.classList.add('open'));
$('support-back-btn').addEventListener('click', () => supportScreen.classList.remove('open'));
