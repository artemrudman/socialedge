// content.js — runs in ISOLATED world
// Relays messages from content_main.js (MAIN world) to background.js.

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  if (event.data.type === '__SSI_HEADERS__') {
    chrome.runtime.sendMessage({ action: 'captureHeaders', headers: event.data.headers });
  }

  if (event.data.type === '__SSI_DATA__') {
    chrome.runtime.sendMessage({ action: 'storeSSI', data: event.data.data });
  }
});
