// content_main.js — MAIN world, document_start
// Intercepts LinkedIn's own API requests (SSI + analytics) and forwards
// responses to background via postMessage — no CSRF issues.

(function () {
  if (window.__ssiMainPatch) return;
  window.__ssiMainPatch = true;

  function isSsiUrl(url) {
    return typeof url === 'string' && url.includes('salesApiSsi');
  }

  // LinkedIn 2024 uses GraphQL at /voyager/api/graphql with queryId in the URL
  // e.g. queryId=voyagerIdentityDashProfileNetworkInfo.abc123
  // Also matches older REST-style voyager endpoints
  const ANALYTICS_RE = new RegExp(
    'NetworkInfo|networkinfo|' +
    'contentDashboard|DashboardCore|' +
    'profileInsights|creatorDashboard|' +
    'voyagerIdentityDash|memberAnalytics|' +
    'analyticsFor',
    'i'
  );

  function isAnalyticsUrl(url) {
    return typeof url === 'string' && !isSsiUrl(url) && ANALYTICS_RE.test(url);
  }

  // For POST graphql requests the queryId is in the body, not just the URL
  function isAnalyticsBody(body) {
    if (!body || typeof body !== 'string') return false;
    return ANALYTICS_RE.test(body);
  }

  function relay(data) {
    window.postMessage({ type: '__SSI_DATA__', data }, '*');
  }

  function relayAnalytics(url, data) {
    window.postMessage({ type: '__ANALYTICS_DATA__', url, data }, '*');
  }

  // ── Patch fetch ───────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url  = typeof input === 'string' ? input : (input?.url || '');
    const body = (typeof init?.body === 'string') ? init.body : '';

    const response = await origFetch.apply(this, arguments);

    if (isSsiUrl(url)) {
      response.clone().json().then(relay).catch(() => {});
    } else if (isAnalyticsUrl(url) || (url.includes('graphql') && isAnalyticsBody(body))) {
      // Tag URL with the body queryId so background can identify the type
      const tag = isAnalyticsUrl(url) ? url : url + '|' + body.slice(0, 300);
      response.clone().json().then((d) => relayAnalytics(tag, d)).catch(() => {});
    }

    return response;
  };

  // ── Patch XMLHttpRequest ──────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._patchedUrl    = url;
    this._patchedMethod = method;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url     = this._patchedUrl || '';
    const bodyStr = typeof body === 'string' ? body : '';

    if (isSsiUrl(url)) {
      this.addEventListener('load', () => {
        try { relay(JSON.parse(this.responseText)); } catch (_) {}
      });
    } else if (isAnalyticsUrl(url) || (url.includes('graphql') && isAnalyticsBody(bodyStr))) {
      const tag = isAnalyticsUrl(url) ? url : url + '|' + bodyStr.slice(0, 300);
      this.addEventListener('load', () => {
        try { relayAnalytics(tag, JSON.parse(this.responseText)); } catch (_) {}
      });
    }

    return origSend.apply(this, arguments);
  };
})();
