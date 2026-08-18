import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {packageExtension} from '../../../scripts/package-extension.mjs';

async function source(file) { return readFile(file, 'utf8'); }

test('cookie-capability: release has no direct cookie API, identifier, permission, or response excerpts', async () => {
  const manifest = JSON.parse(await source('extension/manifest.json'));
  const background = await source('extension/background.js');
  const allJs = `${background}\n${await source('extension/popup.js')}`;
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.doesNotMatch(allJs, /chrome\.cookies|JSESSIONID|response\.text\(|body\.slice/);
});

test('manifest contains only justified HTTPS release privileges and no relay/auth exposure', async () => {
  const manifest = JSON.parse(await source('extension/manifest.json'));
  assert.deepEqual(new Set(manifest.permissions), new Set(['webRequest', 'storage', 'alarms', 'scripting', 'sidePanel', 'notifications']));
  assert.deepEqual(manifest.host_permissions, ['https://www.linkedin.com/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.oauth2, undefined);
  assert.equal(manifest.permissions.includes('identity'), false);
  assert.equal(manifest.permissions.includes('tabs'), false);
});

test('release package uses an allowlist and excludes dormant/auth/development artifacts', async () => {
  const result = await packageExtension();
  for (const forbidden of ['auth.js', 'content.js', 'content_main.js', 'server', 'tests']) {
    assert.equal(result.files.some(file => file === forbidden || file.startsWith(`${forbidden}/`)), false);
  }
  await assert.rejects(access(path.join(result.directory, 'auth.js')));
});

test('safe rendering and disabled authentication are enforced in source', async () => {
  const popup = await source('extension/popup.js');
  const html = await source('extension/popup.html');
  const background = await source('extension/background.js');
  assert.match(popup, /title\.textContent = job\.title/);
  assert.match(popup, /description\.textContent = tip\.text/);
  assert.doesNotMatch(`${popup}\n${html}`, /Auth\.init|auth\.js|http:\/\//);
  assert.doesNotMatch(background, /storeSSI|storeAnalytics|captureHeaders/);
});

test('privacy documentation covers four features, automatic refresh, retention, export, deletion, permissions, and disabled auth', async () => {
  const docs = `${await source('README.md')}\n${await source('extension/PRIVACY_POLICY.md')}`.toLowerCase();
  for (const claim of ['ssi', 'analytics', 'profile tips', 'jobs', 'automatic refresh', 'clear linkedin data', 'disconnect', 'export', 'permissions', 'authentication']) {
    assert.ok(docs.includes(claim), `missing documentation claim: ${claim}`);
  }
});
