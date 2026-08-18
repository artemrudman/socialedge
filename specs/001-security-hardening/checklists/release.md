# Release Checklist: Security Hardening

**Purpose**: Record the Phase 9 (Polish & Cross-Cutting Release Gates) evidence required by `tasks.md` T064–T071 before sign-off.
**Last updated**: 2026-08-11
**Evidence environment**: macOS 26.5.2 (Darwin 25.5.0), Google Chrome 151.0.7922.76, 14 logical CPUs, 48 GiB memory — exceeds the Controlled Performance Profile floor of 2 cores / 4 GiB.

## Post-Implementation Finding: Analytics displayed numbers that don't match the real LinkedIn page

**Found**: 2026-08-11, comparing the side panel's Analytics screen against the real LinkedIn Analytics dashboard open side-by-side in the same screenshot (609 total followers, 100 profile viewers/90 days, 11 search appearances, 3,725 post impressions/7 days on the real page vs. 2, 17, 28, 7 respectively in the panel — no correspondence at all).

**Root cause**: `scrapeAnalytics()`'s regex-based DOM-text fallback (`numberAfter(label)`) only searched for a number *after* the label text, within 40 characters. LinkedIn's real stat cards render the value immediately *before* its label (e.g. `"609\nTotal followers"`), so the search skipped past the real number and matched whatever unrelated digit happened to appear within 40 characters after the next occurrence of that label text elsewhere on the page (e.g. `"17"` came from "17 comments" in an unrelated "Weekly progress" section, not from Profile Views at all).

**Fix** (`extension/background.js`): `numberNear(label)` now tries a tight, immediately-adjacent "number then label" match first (matching the real layout), falling back to the original looser "label then number" search only if that fails.

**Still unverified**: whether `voyager/api/analytics` (the API attempted before falling back to this scrape) is itself the correct endpoint — this scrape path only runs when that API call already failed. Not yet confirmed with a real capture the way the identity endpoint was.

## Post-Implementation Finding: identity check hit the wrong LinkedIn API surface entirely

**Found**: 2026-08-11, from the user's own real-browser network capture (a curl reproduction of the organic request LinkedIn's Sales Navigator frontend fires on `/sales/ssi`).

**Root cause**: `verifyAccount()`'s identity check called `https://www.linkedin.com/voyager/api/me` — an endpoint this hardening effort invented for a brand-new verification step that never existed in the pre-hardening code (which never did a separate identity check at all, so there was no prior working call to copy from). The real capture proved LinkedIn's Sales Navigator frontend uses `https://www.linkedin.com/sales-api/salesApiMe` instead — a different, Sales-Navigator-specific API surface from regular Voyager, matching the pattern of `sales-api/salesApiSsi` (the SSI endpoint, which was already correct since the original, pre-hardening extension relied on it). The wrong URL explains the "session expired" symptom regardless of any header-timing fix, since a 403 from a nonexistent-for-this-purpose endpoint looks identical to a real auth failure. Because every collector (SSI, Analytics, Profile Tips, Jobs) calls this same identity check before its own feature request, all four were failing at this shared step with the same symptom.

**Also found from the same capture**: the real request includes headers (`x-li-identity`, `x-li-page-instance`, `x-li-track`) beyond the four previously allowlisted, and the response shape (`vanityName`, a parenthesized `entityUrn` like `urn:li:fs_salesProfile:(ID, , )`) didn't match what `findAccountBinding()` expected to parse.

**Fix** (`extension/background.js`, `extension/lib/policy.js`): corrected the identity endpoint to `sales-api/salesApiMe`; widened the `chrome.webRequest` capture scope and `ALLOWED_HEADERS` to include the three additional headers (none are credentials/cookies — `x-li-identity` is an opaque per-member correlation token, the other two are client telemetry); fixed `findAccountBinding()` to parse the real response shape (added `vanityName` and a proper `entityUrn` parser alongside the existing candidates); increased the header-capture grace period from 3s to 6s based on the user's measured ~3s real-world organic-request timing.

**Still open**: Analytics' and Jobs' own feature endpoints (`voyager/api/analytics`, `voyager/api/jobs/jobPostings`) are unverified guesses, exactly like the identity endpoint was before this fix. They were untestable until the shared identity-check prerequisite worked at all. Next real-browser retest should reveal whether they now succeed or fail with a *different* symptom (e.g. `invalid_response`/`service_error` instead of `session_expired`), which would mean they need the same real-capture-driven correction.

## Post-Implementation Finding: `validateSender` rejected every real side-panel message

**Found**: 2026-08-11, during a manual smoke pass in Microsoft Edge (Chromium-based, not the Chrome used by every automated test above).

**Symptom**: every action (Refresh Score, Analytics, Jobs, etc.) failed immediately with the generic `internal_error` UI text, with zero network activity and zero console output anywhere — including the safe diagnostic logging added while investigating.

**Root cause**: `extension/lib/messages.js`'s `validateSender()` required `sender.frameId === 0` unconditionally. Per Chrome's own `runtime.MessageSender` documentation, `frameId` is populated *only when `sender.tab` is set* — which is never true for a side panel/popup/options page (there's no associated tab). This Edge build reports `frameId` as `undefined` for such senders; `undefined !== 0` is `true`, so every legitimate side-panel message was rejected as `invalid_sender` before ever reaching `dispatch()`. All automated real-browser tests used Chrome via Puppeteer, where the same call apparently backfills `frameId: 0` for tab-less senders — a genuine Chromium-fork behavioral divergence that none of today's Chrome-only automated coverage could have caught.

**Fix**: `validateSender` now only enforces `frameId === 0` when `sender.tab` is present (i.e. a real content-script/sub-frame sender); a tab-less extension-page sender is accepted regardless of `frameId`. Added a regression test for the exact case (`tests/extension/messages.test.mjs`, `tests/extension/integration/runtime-messages.test.mjs`) and corrected two existing "framed sender" test cases that had unrealistically omitted `sender.tab`, which is how the original bug passed all suites undetected.

**Process implication**: this is exactly the class of defect T070 (live manual smoke matrix) exists to catch, and it was caught by manual testing rather than automation. Recommend adding an Edge (or non-Chrome Chromium) pass to the manual smoke matrix going forward, not just Chrome, since `plan.md`'s stated target platform is Chrome 116+ but real usage here is Edge.

## Post-Implementation Finding: every LinkedIn request failed with a false "session expired"

**Found**: 2026-08-11, immediately after the fix above, during the same manual smoke pass, once messages started reaching `dispatch()`.

**Symptom**: every collector (SSI, Analytics, Jobs) failed with "Your LinkedIn session expired. Sign in and try again." even though the user's real LinkedIn session was valid. The user's own browser Network tab showed a real request to `voyager/api/me` returning a genuine `403 Forbidden`, with no `csrf-token` request header present.

**Root cause**: `verifyAccount()`'s identity check (`GET https://www.linkedin.com/voyager/api/me`) is new code added by this hardening effort — the pre-hardening extension never performed a separate identity check — and it hardcoded an empty header set. LinkedIn's `voyager`/`sales-api` endpoints require a `csrf-token` header (conventionally the `JSESSIONID` cookie value echoed back) or they return 403. This codebase deliberately never reads cookies directly (`chrome.cookies` was removed; see FR-008/FR-009), so the only legitimate source of a valid `csrf-token` is passively observing it on a request LinkedIn's own frontend fires organically. Two compounding bugs made that capture never actually happen:
1. **Timing**: header-capture registration (`activeCaptures.set(tabId, ...)`) happened inside `collectInTab`, which only runs *after* a freshly created temporary tab finishes loading — but the organic, csrf-token-bearing request fires *during* load, before that registration existed.
2. **Scope**: the `chrome.webRequest.onBeforeSendHeaders` listener only watched `sales-api/salesApiSsi*`, not `voyager/api/me`, so even a well-timed capture on an SSI page load would never have covered the identity-check endpoint specifically.
3. **No fallback for SSI**: when an already-open LinkedIn tab was used (the common case — the user already had a tab open) and its identity check failed for lack of a captured header, Analytics/Profile Tips already retried via a fresh purpose-navigated temporary tab; SSI did not, so it had no path to ever recover.

**Fix** (`extension/lib/collection.js`, `extension/background.js`):
- Added an `onCreated` hook to `withOwnedTemporaryTab`, invoked immediately once the tab exists and *before* the load-wait, so capture can be registered while the organic request is still in flight.
- Widened the capture listener to also cover `voyager/api/me`, `voyager/api/analytics`, `voyager/api/identity/profiles/*`, and `voyager/api/jobs/*`.
- `verifyAccount()` now reuses whatever headers are staged for that tab (or, if none are staged yet, whatever is already committed to the session request context) instead of sending no headers at all.
- The existing-tab retry path no longer excludes `ssi`, and now also retries on `session_expired`/`account_unverified` (previously only `service_error`/`invalid_response`), so a credential-shaped failure on an already-open tab falls back to a fresh, purpose-navigated temporary tab exactly like Analytics/Profile Tips always did.

**Regression coverage added**: `tests/extension/integration/collector-tabs.test.mjs` gained a deterministic (mocked-tabs, no real browser) test proving `onCreated` fires before the load-wait — the exact ordering bug. `tests/extension/fixtures/server.mjs` gained a `requireCsrfToken` option and `linkedin.html` now fires an organic csrf-token-bearing request on load, modeling LinkedIn's real behavior for future use.

**A second, more serious finding from building this regression test**: an earlier attempt at a full real-browser version of this test raced against a freshly created tab's navigation and lost — Puppeteer's request interception wasn't attached before the tab began navigating, so the test made **real, live, unauthenticated requests to production linkedin.com** (anonymous session cookies only; no `li_at`, so no account was ever exposed, but real outbound traffic nonetheless, and a violation of this project's own "no real LinkedIn traffic in automated tests" principle). That test was replaced with the deterministic unit test described above, and `tests/extension/helpers/chrome-extension.mjs`'s `launchExtension` now launches with `--host-resolver-rules` routing `linkedin.com`/`www.linkedin.com` to an unroutable address, so any future test whose interception setup loses the same race fails closed (a connection error) instead of ever reaching a real server. This safety net has no effect on correctly-intercepted requests, which are fulfilled before the network layer is involved.

## Post-Implementation Finding: onboarding walkthrough rendered on top of other open panels

**Found**: 2026-08-11, during the same manual smoke pass, unrelated to messaging/collection — this is a `popup.js` UI defect, not something in `background.js` or the security-sensitive `extension/lib/` modules this feature otherwise touches.

**Symptom**: opening the Support/About screen (or several other full-screen panels) while the onboarding walkthrough tooltip was starting or restarting left both visibly rendered at once — Support screen content (Clear LinkedIn Data, Disconnect LinkedIn, Free Boost Strategy PDF, Replay Walkthrough) legible underneath/around the walkthrough's spotlight and tooltip.

**Root cause, part 1**: `startOnboarding()` never closed any other open full-screen panel (`support-screen`, `analytics-screen`, `tips-screen`, `jobs-screen`, `history-screen`, `quest-screen`, `detail-screen`, `act-detail-screen`) before rendering its own overlay. Each of those is an independently `position:fixed` element; the walkthrough overlay's dimming only comes from its spotlight's box-shadow, which does not visually replace another already-rendered full-screen panel.

**Root cause, part 2 (found while verifying the fix in a real, foreground browser via Puppeteer, and independently reproduced by the user in real Microsoft Edge)**: even after closing panels by removing their `"open"` class — which computed style confirmed correctly resolves the panel's CSS transform to fully off-screen (`translateY(-100%)`, bounding rect fully outside the viewport) — the panel still visibly rendered in the actual painted output. Removing the element from the DOM entirely (rather than just toggling the class) reliably hid it; setting `element.style.display = "none"` directly (bypassing the transform-based approach entirely) also reliably hid it. This isolated the discrepancy to a real repaint/compositing gap between "computed style/layout says closed" and "what actually got painted" for `position:fixed` + `transform` + `transition` in this browser, reproducible independently of tab focus and of whether the CSS transition was active or disabled. The class-only (transform-based) close was not reliably sufficient on its own — and, critically, this same gap exists for the *normal* (non-onboarding) open/close of every one of these 8 panels, not just the onboarding-specific interaction, since all 8 use the identical CSS pattern (`position:fixed` + `transform: translate...()` + `transition: transform` + an unconditional `display:flex`, toggled only by an `"open"` class).

**Root cause, part 3**: separately, `renderObStep()` called `scrollIntoView({behavior:"smooth"})` and then measured the target's position only one `requestAnimationFrame` later — long before a "smooth" scroll animation (several hundred ms) actually finishes — so the spotlight/tooltip were positioned against a stale, mid-scroll location. Confirmed directly: the spotlight computed a `top` of 775px while the target's actual final position was 668px.

**Fix — architectural, not a patch** (`extension/popup.js`): given the rendering gap affects every panel that relies on transform-only hiding, and given this codebase's own wide (desktop) mode *already* solves the identical problem correctly by driving visibility through `display:none`/`flex` via a `dash-active` class instead of a transform (see `popup.css`'s `@media (min-width: 700px)` block), the same principle was extended to narrow mode for all 8 panels rather than special-cased only for onboarding:
- New `openScreen(el)`/`closeScreen(el)` helpers centralize show/hide for `detail-screen`, `quest-screen`, `history-screen`, `act-detail-screen`, `analytics-screen`, `tips-screen`, `jobs-screen`, and `support-screen`. `display:none` is now the authoritative hidden state (set on load and by `closeScreen`); `openScreen` clears it and waits two animation frames before adding `"open"` so the existing slide transition still plays; `closeScreen` removes `"open"`, plays the closing transition, and applies `display:none` on `transitionend` (with a timeout fallback). The animation is fully preserved — this was not a "disable animations" compromise.
- Every existing `.classList.add/remove("open")` call site for these 8 elements (support, pillar/activity detail, quest, history, analytics, profile tips, jobs — across narrow-mode click handlers and the onboarding force-close) now goes through these two functions instead of touching the class directly.
- `applyWideMode()` was updated so entering wide mode clears any leftover inline `display` override (letting the existing `dash-active` + media-query CSS govern visibility, unchanged from before) and leaving wide mode re-establishes the narrow-mode `display:none` baseline — verified not to regress wide mode's existing, already-correct tab-switching behavior.
- `startOnboarding()`/`endOnboarding()` were simplified to just call `closeScreen()` for each panel; the redundant ad-hoc `display` bookkeeping from the initial narrower fix was removed.

**Verification**: reproduced the overlap, the stale-position bug, and the underlying render/computed-style discrepancy directly in a real (non-headless-throttled, foregrounded) browser via Puppeteer, with exact DOM measurements (not screenshots alone) confirming each root cause. After the refactor, a Puppeteer script exercised all 8 panels' open/close in narrow mode (400×700) — confirming each starts hidden and correctly toggles visible/hidden via its real trigger button — and separately exercised wide mode (900×700) confirming tab-switching still shows exactly one of the four tab-panels at a time and Support still opens/closes correctly; all 13 checks passed. Discovered in the process: an existing real-browser test (`runtime-messages.test.mjs`) had been clicking "Clear LinkedIn Data" *without ever opening the Support screen* — it only worked because of the same rendering bug this fix closes. Updated that test to open Support first, matching the real user flow; it now passes reliably across repeated runs. Full suite after the refactor: 17/16/5/19 (unit/extension/release/Python) passing.

## T064 — Documentation Review Matrix

| Documented claim | Source | Validation step | Result |
|---|---|---|---|
| LinkedIn access is manual by default; no session-backed request on install/startup/alarm | README.md:3, PRIVACY_POLICY.md | `session-lifecycle.test.mjs`: "new installs and alarms remain default-off in real Chrome" (real Chrome, source + release package) | PASS |
| Automatic refresh is SSI-only, versioned consent, off by default | README.md:37, PRIVACY_POLICY.md | `policy.test.mjs`: "accepts only current SSI-only automatic refresh consent"; `release-package.test.mjs` doc-consistency test | PASS |
| No direct cookie/`JSESSIONID` access; only 4 allowlisted headers captured | README.md:31, PRIVACY_POLICY.md | `test_cookie_capability_is_absent` (Python); `release-package.test.mjs` cookie-capability suite; `policy.test.mjs` header allowlist test | PASS |
| Request context is session-only, ≤24h, account-bound | README.md:31 | `policy.test.mjs` TTL boundary test; `data-model.md` entity definition matches `policy.js` | PASS |
| Analytics/Profile Tips/Jobs never navigate/scroll/focus a user's existing tab; only an inactive owned tab is used when unavoidable | README.md, `contracts/release-security.md` | `test_background_refresh_never_navigates_without_user_action` (Python, source-level absence of `tabs.update`/`.focus(`/`tabs[0]`); real-browser "real SSI collection ... preserves unrelated and LinkedIn tab state" test (source and release package) | PASS |
| Retention table (SSI/analytics 365 entries, activities/tips/jobs until replaced or deleted) | README.md:56-60 | `storage.test.mjs` "history is bounded to 365..."; `storage.js` `trimDailyHistory` | PASS |
| Export v2 excludes account binding, raw data, internal state | README.md, PRIVACY_POLICY.md | `storage.test.mjs` export test; `popup.js` `doExport` (schema_version 2, no `accountBinding`) | PASS |
| Clear LinkedIn Data / Disconnect LinkedIn effects and scope | README.md:76-81, `popup.html` privacy section | `runtime-messages.test.mjs` real-browser Clear flow; `migration-deletion.test.mjs` deletion-matrix test; T066 timing evidence below | PASS |
| Permissions table maps every privilege to a feature | README.md:85-89 | See T067 manifest audit below | PASS |
| SocialEdge account authentication is disabled and absent from the release | README.md, PRIVACY_POLICY.md, `server/README.md` | `release-package.test.mjs` (`auth.js` absent, no `identity`/`oauth2`); `migration-deletion.test.mjs` (`_se_session` removed) | PASS |

No documented claim was found to materially mismatch observed/tested behavior.

## T065 — Service-Worker Termination/Restart Evidence (Release Package)

Ran the controlled-browser suites from T012/T022/T033 with `SOCIALEDGE_EXTENSION_PATH=dist/socialedge-extension` (the actual packaged release, built via `npm run package:extension`) instead of the unpacked source:

```
SOCIALEDGE_EXTENSION_PATH=dist/socialedge-extension node --test \
  tests/extension/integration/session-lifecycle.test.mjs \
  tests/extension/integration/collector-tabs.test.mjs \
  tests/extension/integration/runtime-messages.test.mjs
# 12/12 passed, 0 failed
```

Results against the release package:

- **Collection**: real SSI collection against a fixture-intercepted LinkedIn tab succeeds, writes an account-bound history entry, and leaves the unrelated tab and the LinkedIn tab's URL/scroll/form state byte-identical before and after.
- **Install/alarm default-off**: fresh install leaves `_se_autoRefresh.enabled === false` and no session request context; a manually triggered `dailyFetch` alarm does not create one.
- **Runtime-message validation**: forged senders, unknown actions, and removed relay actions (`storeSSI`, `captureHeaders`, `storeAnalytics`) are all rejected before dispatch.
- **Clear (real UI flow)**: clicking **Clear LinkedIn Data** in the real side panel completes and preserves `theme`/`_se_onboardDone` while removing `ssiHistory` and the session request context.
- **Disconnect / orphan-tab / stale-write**: see T066 below for the release-package timing run (3× Clear, 3× Disconnect) with a full seeded dataset and one deliberately stalled in-flight collection; each run's post-deletion inspection found none of the deleted categories present, i.e. the stalled operation's eventual response never restored a deleted key.

**Known gap — genuine service-worker kill/respawn while Chrome stays open**: I attempted to force a real MV3 service-worker termination via CDP (`ServiceWorker.stopWorker` with the correct worker version id, then `chrome.runtime.reload()` from within the worker) and verify that `operations.reconcile()` closes a session-tracked orphaned tab on respawn. Under Puppeteer's `enableExtensions` launch mode neither approach produced an observable new CDP target within a bounded timeout in repeated manual testing — the reload call returns successfully but Chrome did not detach/recreate the service-worker target within 5–30s, and forcing it further risked a hanging test. I did not commit a test that depends on this; the underlying reconciliation logic itself remains covered at the unit level (`collection.test.mjs`: "startup reconciliation closes orphaned extension-owned tabs", executed against the exact `extension/lib/collection.js` shipped in the release package). **This specific scenario (in-browser forced worker kill → respawn → orphan-tab cleanup) is not verified end-to-end in a real browser** and would need either a newer Puppeteer/Chrome combination with reliable `ServiceWorker` CDP event support, or manual verification via `chrome://serviceworker-internals`.

## T066 — Deadline and Controlled Performance Profile Timing (Release Package)

Request/tab/operation deadlines (`REQUEST_TIMEOUT_MS`=15s, `TAB_TIMEOUT_MS`=20s, `OPERATION_TIMEOUT_MS`=45s) are unit-verified in `collection.test.mjs` ("nested deadlines never exceed the whole-operation deadline") and exercised structurally in `collector-tabs.test.mjs`'s owned-tab lifecycle tests, all running the exact `extension/lib/collection.js` shipped in the release package.

Controlled Performance Profile run — seeded 365 SSI entries, 365 analytics entries, every other current data category (activities, quests, tips, jobs), consent, connection/request state, and one collection operation whose fixture response was held pending (60s artificial delay) until cancellation; against `dist/socialedge-extension` in real Chrome, three runs each of Clear and Disconnect via the real side-panel button click (confirm dialog auto-accepted, same as a user confirming):

| Action | Run | Confirmed UI flow (budget 30s) | Reported transaction (budget 5s) |
|---|---:|---:|---:|
| Clear LinkedIn Data | 1 | 39 ms | 1 ms |
| Clear LinkedIn Data | 2 | 31 ms | 1 ms |
| Clear LinkedIn Data | 3 | 26 ms | 1 ms |
| Disconnect LinkedIn | 1 | 26 ms | 1 ms |
| Disconnect LinkedIn | 2 | 24 ms | 1 ms |
| Disconnect LinkedIn | 3 | 31 ms | 1 ms |

All 6 runs passed. Every run's post-deletion inspection confirmed `theme`/`_se_onboardDone` preserved, all nine LinkedIn-derived local keys and the session request context removed, and — because one collection operation was deliberately left pending past the deletion — that the eventual (cancelled) response never re-wrote a deleted key.

Environment recorded above (macOS 26.5.2, Chrome 151.0.7922.76, 14 logical CPUs, 48 GiB memory, seed counts as stated).

## T067 — Storage and Package Audit

**Storage key audit**: every `chrome.storage.local`/`chrome.storage.session` write in `extension/background.js` and `extension/lib/storage.js` goes through a named constant from the registries in `extension/lib/storage.js` (`LINKEDIN_DATA_KEYS`, `LINKEDIN_LOCAL_KEYS`, `LEGACY_KEYS`, `REQUEST_CONTEXT_KEY`). Grepping `background.js` for every `storage.local`/`storage.session` `set`/`remove`/`get` call found no key literal outside that registry. This registry matches the Approved Persistent Keys and Supported Legacy Inventory tables in `contracts/storage-and-deletion.md` exactly (cross-checked key-by-key). **No uncatalogued LinkedIn/auth key or shape was found.**

**Manifest/package audit**: `extension/manifest.json` permissions are exactly `webRequest`, `storage`, `alarms`, `scripting`, `sidePanel`, `notifications`; `host_permissions` is exactly `["https://www.linkedin.com/*"]`. No `cookies`, `identity`, `tabs`, `oauth2`, or `content_scripts` entries. This matches every "keep"/"remove" disposition in `contracts/release-security.md`'s Required Extension Manifest Baseline table, including `tabs` removal (all controlled-browser tests pass without it) and `cookies`/`identity` removal.

**Package contents**: `npm run package:extension` against the allowlist in `scripts/package-extension.mjs` produced exactly 15 files (`manifest.json`, `background.js`, `popup.{html,js,css}`, `PRIVACY_POLICY.md`, `Info Plan.pdf`, `lib/{collection,messages,policy,storage}.js`, `icons/*`). No `auth.js`, `content.js`, `content_main.js`, test/fixture/server files, `.db`, or source maps present; the packager's own `auditRelease()` (which also scans file contents for `YOUR_GOOGLE_CLIENT_ID`, `http://localhost`, `JSESSIONID`, `chrome.cookies`) ran clean.

## T068 — Full Command Matrix

| Command | Result |
|---|---|
| `npm run test:unit` | 17/17 passed |
| `npm run test:extension` | 14/14 passed |
| `npm run test:release` | 5/5 passed |
| `python3 -m unittest discover -s analysis -p 'test_*.py'` | 19/19 passed |
| `node --check extension/background.js` / `popup.js` / `lib/*.js` | all syntax-valid |

Re-run against the release package (`SOCIALEDGE_EXTENSION_PATH=dist/socialedge-extension`) for the three real-Chrome-dependent files: 12/12 passed (see T065).

## T069 — Release Package Load and Exercise

Built `dist/socialedge-extension` via `npm run package:extension` and loaded it (not the unpacked source) in a fresh, real, headless Chrome 151 profile via Puppeteer with no seeded state:

- Extension installs; service worker starts; `_se_autoRefresh.enabled === false` and no session request context (matches T065).
- Side panel (`popup.html`) loads with **zero console/page errors**.
- `getDailyQuest` with no verified account returns `{ok: true, data: null}` — no LinkedIn access attempted, no crash.
- `getPrivacySettings` returns the exact `disconnected` / auto-refresh-off shape the UI expects.
- Theme toggle (`#theme-toggle`) is present and functional (local-only, no LinkedIn access).
- A removed relay action (`storeSSI`) sent as a raw runtime message is rejected with `invalid_request` — no privileged side effect.
- Real collector-against-fixtures exercise (SSI, with an open fixture-intercepted LinkedIn tab) passed against this exact release build (see T065).
- Permission/resource audit: see T067 (manifest and package both minimal and justified).

**Deliberately not exercised via automation**: PDF download (`Info Plan.pdf` is a packaged static asset served from the extension's own page; opening it doesn't exercise security-relevant code and wasn't prioritized), and a full manual visual/UX pass in an interactive (non-headless) Chrome window. A human reviewer opening `chrome://extensions`, loading `dist/socialedge-extension` unpacked, and clicking through every screen once is still recommended before shipping, per `quickstart.md` Scenario 8 — this is quick (a few minutes) and catches purely visual issues that a headless functional pass cannot.

## T070 — Live LinkedIn Test-Account Smoke Matrix

**Not executed.** This requires a dedicated LinkedIn test account's real credentials in a real, human-operated browser session (`quickstart.md`, Final Live Smoke Matrix: logged-in collection for all four features, logged-out/expired session, logout→login as a second test account, no LinkedIn tab open, temporary-tab closure mid-collection, automatic-refresh enable/disable, Clear, Disconnect). I do not have and should not be given real LinkedIn credentials, and this step is explicitly scoped in `spec.md`/`quickstart.md` to a human operator using a non-production test account. A human should complete this matrix and record outcomes here (without copying cookies, headers, raw responses, page text, personal identifiers, or account-revealing screenshots into this file) before final release sign-off.

## T071 — Traceability and Sign-Off

**FR-001–FR-020 (production-readiness milestone)**: all pass based on the automated evidence above — credential TTL/eviction (`policy.test.mjs`, `session-lifecycle.test.mjs`), default-off startup/alarms (T065/T069), no cookie access (`test_cookie_capability_is_absent`, `release-package.test.mjs`), no arbitrary-tab mutation (T065's real-browser tab-preservation test, `test_background_refresh_never_navigates_without_user_action`), minimized storage (`storage.test.mjs`), legacy migration (`migration-deletion.test.mjs`), Clear/Disconnect (T066).

**FR-021–FR-030 (release hardening + transparency)**: pass — sender/action validation (`runtime-messages.test.mjs`), manifest/package minimization (T067), disabled authentication (`release-package.test.mjs`, `server/README.md`), account-change handling (`storage.test.mjs` "account switch purges..."), documentation agreement (T064). FR-026's controlled-integration list is covered except for the one documented gap in T065 (in-browser forced service-worker kill/respawn).

**SC-001–SC-011**: SC-001–SC-004, SC-006–SC-008, SC-010, SC-011 are supported by the evidence above. SC-005 is supported by the T066 timing run. SC-009's "zero cross-account data mixing... zero lasting changes to arbitrary user tabs" is supported for the scenarios actually exercised (T065); the service-worker-termination sub-case of FR-026/SC-009 carries the same documented gap as T065.

**Justified retained permissions**: `webRequest`, `storage`, `alarms`, `scripting`, `sidePanel`, `notifications`, and `https://www.linkedin.com/*` host access — each maps to an exercised feature per `contracts/release-security.md`; `cookies`, `identity`, and `tabs` were removed and their removal is validated by passing tests.

**Unresolved findings**: none at critical/high severity. One documented **medium** gap: real in-browser service-worker kill→respawn→orphan-tab-cleanup is not verified end-to-end (T065), mitigated by unit-level coverage of the same reconciliation logic. One **process gap** (not a code finding): T070's live-account smoke matrix has not been run by a human operator.

**Sign-off**: The production-readiness milestone (US1–US3 + cookie removal, T023) and release-hardening stories (US4–US6) are supported by passing automated evidence, including against the built release package. **Final release sign-off is withheld pending T070** (human-operated live LinkedIn smoke matrix) and, ideally, a short manual visual pass per T069's note. No code change is blocked on this — it is a verification/process gate, not a known defect.
