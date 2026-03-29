// content_main.js — MAIN world, document_start
// Intercepts LinkedIn's own salesApiSsi requests (both fetch and XHR)
// and forwards the response directly to background — no CSRF needed.

(function () {
  if (window.__ssiMainPatch) return;
  window.__ssiMainPatch = true;

  function isSsiUrl(url) {
    return typeof url === 'string' && url.includes('salesApiSsi');
  }

  function relay(data) {
    window.postMessage({ type: '__SSI_DATA__', data }, '*');
  }

  // ── Patch fetch ──────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const response = await origFetch.apply(this, arguments);

    if (isSsiUrl(url)) {
      response.clone().json().then(relay).catch(() => {});
    }

    return response;
  };

  // ── Patch XMLHttpRequest ─────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._ssiUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (isSsiUrl(this._ssiUrl)) {
      this.addEventListener('load', () => {
        try {
          relay(JSON.parse(this.responseText));
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };
})();
