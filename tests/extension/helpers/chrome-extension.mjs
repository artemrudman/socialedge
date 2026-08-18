import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

// Defaults to the unpacked source for fast iteration. Release-evidence runs
// override with SOCIALEDGE_EXTENSION_PATH=dist/socialedge-extension so the
// same controlled-browser scenarios exercise the packaged release build.
const EXTENSION_PATH = path.resolve(process.env.SOCIALEDGE_EXTENSION_PATH || 'extension');

export async function launchExtension(options = {}) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'socialedge-chrome-'));
  const browser = await puppeteer.launch({
    headless: options.headless ?? true,
    enableExtensions: [options.extensionPath ?? EXTENSION_PATH],
    userDataDir,
    // Hard safety net: automated tests must never reach real linkedin.com,
    // even if a test's own request-interception setup loses a race against a
    // freshly created tab's navigation (observed in practice — a missed
    // interception window let a real request through to production LinkedIn
    // with an anonymous session). Routing the host to an unroutable address
    // makes any un-intercepted request fail closed instead of leaving the
    // sandbox, while properly intercepted requests are still fulfilled by the
    // fixture router before they ever reach the network layer.
    args: ['--no-first-run', '--disable-default-apps', '--host-resolver-rules=MAP www.linkedin.com 240.0.0.1,MAP linkedin.com 240.0.0.1'],
    ...(options.executablePath || process.env.CHROME_PATH || existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? {executablePath: options.executablePath || process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}
      : {}),
  });
  const target = await browser.waitForTarget(candidate =>
    candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
  {timeout: 10_000});
  const extensionId = new URL(target.url()).hostname;
  assert.ok(extensionId, 'SocialEdge extension was not installed');

  async function cleanup() {
    await browser.close().catch(() => {});
    await rm(userDataDir, {recursive: true, force: true});
  }

  return {browser, extensionId, userDataDir, cleanup};
}

export async function getServiceWorker(browser, extensionId, timeout = 10_000) {
  const target = await browser.waitForTarget(
    candidate => candidate.type() === 'service_worker' &&
      candidate.url().startsWith(`chrome-extension://${extensionId}/`),
    {timeout},
  );
  return target.worker();
}

export async function restartServiceWorker(browser, extensionId, timeout = 5_000) {
  const worker = await getServiceWorker(browser, extensionId);
  // chrome.runtime.reload() is the documented way to make the worker tear down
  // and respawn; a raw CDP target/worker kill (the previous implementation
  // passed a target id where ServiceWorker.stopWorker expects a worker version
  // id, so it silently no-op'd) left Chrome's registration in a state that
  // never respawned. Even this path was not observed to reliably produce a
  // fresh CDP target under Puppeteer + enableExtensions in manual testing, so
  // callers must tolerate the bounded timeout below rather than assume success.
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  return Promise.race([
    getServiceWorker(browser, extensionId, timeout),
    new Promise((_, reject) => setTimeout(() => reject(new Error('restartServiceWorker: no worker observed in time')), timeout)),
  ]);
}

export async function inspectStorage(worker, area = 'local') {
  return worker.evaluate(storageArea => chrome.storage[storageArea].get(null), area);
}

export async function replaceStorage(worker, values, area = 'local') {
  await worker.evaluate(async ({storageArea, next}) => {
    await chrome.storage[storageArea].clear();
    await chrome.storage[storageArea].set(next);
  }, {storageArea: area, next: structuredClone(values)});
}

export async function triggerAlarm(worker, name) {
  return worker.evaluate(async alarmName => {
    const before = await chrome.storage.session.get('_se_testAlarmCount');
    await chrome.alarms.create(alarmName, {when: Date.now() + 25});
    return before._se_testAlarmCount ?? 0;
  }, name);
}

export async function snapshotTabs(browser) {
  const pages = await browser.pages();
  return Promise.all(pages.map(async page => ({
    url: page.url(),
    active: await page.evaluate(() => document.hasFocus()).catch(() => false),
    scrollX: await page.evaluate(() => scrollX).catch(() => 0),
    scrollY: await page.evaluate(() => scrollY).catch(() => 0),
    forms: await page.evaluate(() => Array.from(document.querySelectorAll('input,textarea'))
      .map(element => ({name: element.name, value: element.value}))).catch(() => []),
  })));
}

export async function interceptLinkedIn(page, fixtureRouter) {
  await page.setRequestInterception(true);
  const handler = async request => {
    const url = new URL(request.url());
    if (url.protocol === 'https:' && (url.hostname === 'www.linkedin.com' || url.hostname === 'linkedin.com')) {
      const response = await fixtureRouter({url, method: request.method(), headers: request.headers()});
      if (response) {
        await request.respond({
          status: response.status ?? 200,
          contentType: response.contentType ?? 'application/json',
          body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {}),
        });
        return;
      }
    }
    await request.continue();
  };
  page.on('request', handler);
  return () => page.off('request', handler);
}

export async function withExtension(testFn, options) {
  const context = await launchExtension(options);
  try {
    return await testFn(context);
  } finally {
    await context.cleanup();
  }
}
