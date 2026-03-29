// ── Advice database ────────────────────────────────────────────────────────────
const ADVICE = {
  prof_brand: {
    name: 'Professional Brand',
    tips: [
      'Publish original posts or articles at least twice a week',
      'Complete your profile to 100% — photo, banner, headline, summary',
      'Request skill endorsements from recent collaborators',
      'Add quantified achievements to your experience section',
    ],
  },
  find_right_people: {
    name: 'Find Right People',
    tips: [
      'Use Sales Navigator advanced filters to target decision-makers',
      'Save 5+ new leads or accounts every day',
      'Use TeamLink to find warm paths to key prospects',
      'Browse "Similar leads" suggestions to expand your pipeline',
    ],
  },
  insight_engagement: {
    name: 'Insight Engagement',
    tips: [
      'Leave thoughtful comments on posts from your saved leads',
      'Share industry news with your own expert take, not just a repost',
      'Engage with content from target accounts at least once a day',
      'Use polls or questions to spark discussions with your network',
    ],
  },
  relationship: {
    name: 'Strong Relationships',
    tips: [
      'Send personalized InMail — never copy-paste the same template',
      'Follow up within 24 h of connecting with a new prospect',
      'Congratulate leads on promotions, work anniversaries, and news',
      'Reconnect with dormant connections using a relevant article or insight',
    ],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(v, dec = 1) {
  return v == null ? '—' : Number(v).toFixed(dec);
}

// Color by score vs its max (sub-scores max=25, overall max=100)
function scoreColor(v, max = 100) {
  if (v == null) return '#46465A';
  const pct = v / max;
  if (pct >= 0.72) return '#34D399';   // green
  if (pct >= 0.48) return '#60A5FA';   // blue
  if (pct >= 0.28) return '#FBBF24';   // amber
  return '#F87171';                    // red
}

// Rank badge class (rank = top N%)
function rankClass(rank) {
  if (rank == null) return '';
  if (rank <= 10)   return 'rank-green';
  if (rank <= 25)   return 'rank-blue';
  if (rank <= 50)   return 'rank-amber';
  return 'rank-red';
}

// Trend object: compare current to previous
function trend(cur, prev) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return { dir: 'flat', label: '—' };
  return { dir: d > 0 ? 'up' : 'down', label: `${d > 0 ? '+' : ''}${d.toFixed(1)}` };
}

// Animate a number counter
function animateNum(el, to, dec = 1, duration = 700) {
  const from  = parseFloat(el.textContent) || 0;
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);           // ease-out cubic
    el.textContent = (from + (to - from) * e).toFixed(dec);
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}

// Apply trend badge to an element
function applyTrend(el, t) {
  if (!t || t.dir === 'flat') {
    el.textContent = '';
    el.className   = 'pillar-trend flat';
    return;
  }
  el.textContent = (t.dir === 'up' ? '↑ ' : '↓ ') + t.label;
  el.className   = `pillar-trend ${t.dir}`;
}

// Apply hero trend badge
function applyHeroTrend(el, t) {
  if (!t || t.dir === 'flat') { el.innerHTML = ''; el.className = 'hero-trend flat'; return; }
  el.innerHTML  = (t.dir === 'up' ? '↑ ' : '↓ ') + t.label;
  el.className  = `hero-trend ${t.dir}`;
}

// ── DOM refs ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Render a history entry ──────────────────────────────────────────────────────
function render(current, previous) {
  const p    = current.parsed;
  const prev = previous?.parsed;

  // Overall
  const overallVal = p.overall ?? 0;
  animateNum($('overall'), overallVal);
  $('overall').style.color = scoreColor(overallVal, 100);
  $('overall-bar').style.width      = `${(overallVal / 100) * 100}%`;
  $('overall-bar').style.background = scoreColor(overallVal, 100);
  applyHeroTrend($('overall-trend'), trend(p.overall, prev?.overall));

  // Last updated
  $('last-updated').textContent = `Updated ${current.date}`;

  // Pillars
  const pillars = [
    { key: 'prof_brand',         valId: 'val-pb',  barId: 'bar-pb',  trendId: 'trend-pb'  },
    { key: 'find_right_people',  valId: 'val-frp', barId: 'bar-frp', trendId: 'trend-frp' },
    { key: 'insight_engagement', valId: 'val-ie',  barId: 'bar-ie',  trendId: 'trend-ie'  },
    { key: 'relationship',       valId: 'val-rs',  barId: 'bar-rs',  trendId: 'trend-rs'  },
  ];

  pillars.forEach(({ key, valId, barId, trendId }) => {
    const val   = p[key];
    const color = scoreColor(val, 25);

    // Score number
    const valEl = $(valId);
    if (val != null) animateNum(valEl, val, 1);
    else valEl.textContent = '—';
    valEl.style.color = color;

    // Bar
    const barEl = $(barId);
    barEl.style.width      = val != null ? `${(val / 25) * 100}%` : '0%';
    barEl.style.background = color;

    // Trend
    applyTrend($(trendId), trend(val, prev?.[key]));
  });

  // Benchmarks
  const ind = p.industry || {};
  const net = p.network  || {};

  $('bench-ind-name').textContent = ind.name || '';
  $('bench-ind-ssi').textContent  = fmt(ind.ssi) + ' SSI';
  const indTopEl = $('bench-ind-top');
  indTopEl.textContent  = ind.top != null ? `Top ${ind.top}%` : '—';
  indTopEl.className    = 'bench-rank ' + rankClass(ind.top);

  $('bench-net-ssi').textContent  = fmt(net.ssi) + ' SSI';
  const netTopEl = $('bench-net-top');
  netTopEl.textContent  = net.top != null ? `Top ${net.top}%` : '—';
  netTopEl.className    = 'bench-rank ' + rankClass(net.top);
}

// ── Render history table ────────────────────────────────────────────────────────
function renderHistory(history) {
  const tbody = $('history-body');
  $('history-count').textContent = `${Math.min(history.length, 30)} entries`;

  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No data yet</td></tr>';
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
      const cls = d > 0 ? 't-up' : 't-down';
      const arrow = d > 0 ? ' ↑' : ' ↓';
      return `<td class="${cls}">${val}${arrow}</td>`;
    }

    return `<tr>
      <td>${entry.date}</td>
      ${cell(p.overall, prev?.overall)}
      ${cell(p.prof_brand, prev?.prof_brand)}
      ${cell(p.find_right_people, prev?.find_right_people)}
      ${cell(p.insight_engagement, prev?.insight_engagement)}
      ${cell(p.relationship, prev?.relationship)}
    </tr>`;
  }).join('');
}

// ── Status bar ──────────────────────────────────────────────────────────────────
function showStatus(msg, type, duration = 5000) {
  const el = $('status-bar');
  el.textContent = msg;
  el.className   = `status-bar ${type}`;
  if (duration > 0) setTimeout(() => { el.className = 'status-bar hidden'; }, duration);
}

// ── Tips panel (pillar hover) ────────────────────────────────────────────────────
const tipsPanel = $('tips-panel');
const tipsTitle = $('tips-title');
const tipsList  = $('tips-list');

document.querySelectorAll('.pillar').forEach((card) => {
  card.addEventListener('mouseenter', () => {
    const info = ADVICE[card.dataset.key];
    if (!info) return;
    tipsTitle.textContent = `Improve ${info.name}`;
    tipsList.innerHTML    = info.tips.map((t) => `<li>${t}</li>`).join('');
    tipsPanel.classList.add('visible');
  });
  card.addEventListener('mouseleave', () => {
    tipsPanel.classList.remove('visible');
  });
});

// ── Initial load ────────────────────────────────────────────────────────────────
chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
  if (history?.length) {
    render(history[0], history[1]);
    renderHistory(history);
  }
});

// ── Refresh button ──────────────────────────────────────────────────────────────
$('btn-refresh').addEventListener('click', () => {
  const btn = $('btn-refresh');
  btn.disabled    = true;
  btn.textContent = 'Fetching…';
  showStatus('Opening LinkedIn in background…', 'success', 0);

  chrome.runtime.sendMessage({ action: 'fetchNow' }, (result) => {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M12 7A5 5 0 1 1 7 2" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round"/>
        <path d="M7 2l2-2M7 2l2 2" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Refresh Score`;

    if (!result) { showStatus('No response. Try reloading the extension.', 'error'); return; }
    if (result.error) { showStatus(result.error, 'error'); return; }

    chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
      if (history?.length) {
        render(history[0], history[1]);
        renderHistory(history);
      }
    });
    showStatus('Score updated!', 'success');
  });
});

// ── Export button ───────────────────────────────────────────────────────────────
$('btn-export').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (history) => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `socialedge_${new Date().toISOString().split('T')[0]}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  });
});
