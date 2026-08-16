# Quickstart Validation Guide: Security Hardening

## Prerequisites

- Google Chrome 116 or newer
- Node.js 22 and npm
- Python 3.11 or newer
- A clean Chrome test profile
- For final live smoke tests only: a dedicated LinkedIn test account, never a personal production account

Automated tests must use local fixtures and controlled network responses; they must not require real LinkedIn credentials.

## Baseline Checks

From the repository root:

```bash
python3 -m unittest discover -s analysis -p 'test_*.py'
node --check extension/background.js
node --check extension/popup.js
```

Expected before implementation: existing Python tests and syntax checks pass. These checks do not prove the new security behavior.

## Target Automated Validation

After implementation adds the root test package:

```bash
npm ci
npm run test:unit
npm run test:extension
npm run test:release
python3 -m unittest discover -s analysis -p 'test_*.py'
```

Expected:

- Unit tests pass for TTL boundaries, malformed context rejection, 401/403 eviction, consent versions, account mismatch, data projections, migration idempotency, message schemas, deletion allowlists, and late-write prevention.
- Controlled Chrome tests pass for install/start/alarm silence, opt-in/out, no-open-tab, temporary-tab closure, timeouts/service errors, logout/login, multiple account bindings, clear/disconnect during collection, arbitrary-tab preservation, and service-worker termination.
- Release tests find no `cookies`, `identity`, content scripts, OAuth placeholder, insecure account endpoint, raw/debug storage field, or broad PDF exposure.

See [runtime-messages.md](contracts/runtime-messages.md), [storage-and-deletion.md](contracts/storage-and-deletion.md), and [release-security.md](contracts/release-security.md) for exact assertions.

## Load the Extension

1. Create a new Chrome profile dedicated to testing.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the repository's `extension/` directory.
4. Open the service worker inspector and side panel.
5. In the test profile, keep one unrelated page open with typed form content and a non-zero scroll position.

## Scenario 1 — Default-Off Session Access

1. Install or reload the extension with local/session storage empty.
2. Start/restart Chrome and trigger/wait for the extension alarms through the controlled test harness.
3. Observe extension network activity and LinkedIn fixture requests.

Expected: no session-backed LinkedIn request occurs; automatic refresh is visibly disabled; daily quest behavior may run without LinkedIn traffic.

## Scenario 2 — Manual Collection and Credential Expiry

1. Click **Refresh Score**.
2. Confirm the operation uses a direct same-origin request or creates a dedicated inactive temporary tab.
3. Confirm captured headers remain outside session storage until the fixture supplies a verified account binding.
4. Inspect session storage: only the allowlisted, account-bound request-context schema exists, with expiry no later than 24 hours.
5. Exercise boundary clocks immediately before and at expiry, then repeat with account identity unavailable.

Expected: the manual action authorizes collection; expired context is removed and never reused; unavailable identity returns `account_unverified` and leaves no request context or new feature data; no user-owned tab changes.

## Scenario 3 — 401/403 and Account Change

1. Seed a valid request context through a manual fixture collection.
2. Make the next fixture response return 401, then repeat with 403.
3. Simulate a different minimal account binding before a subsequent collection.

Expected: credentials and verification state are removed before the error returns; errors are `session_expired` or `account_changed`; a verified switch removes the prior account's SSI, analytics, activities/quests, profile tips, and jobs, disables automatic refresh, and leaves startup/alarm access silent until fresh authorization.

## Scenario 4 — Collector Tab Isolation

For SSI, Analytics, Profile Tips, and Jobs:

1. Keep unrelated and LinkedIn user tabs open with recorded URL, active tab, scroll positions, and entered form values.
2. Start the collector.
3. During DOM-dependent collection, close the extension-created inactive tab once; repeat without closing it.
4. Exercise error responses plus request waits over 15 seconds, tab loads over 20 seconds, and operations over 45 seconds.

Expected: every user-owned tab is unchanged; owned tabs never become active and close after all outcomes; early closure returns `context_closed`; each exceeded deadline returns `timeout`; failure does not replace the last good data.

## Scenario 5 — Minimized Storage and Export

1. Complete all four collectors against fixtures containing extra raw fields, HTML/text snippets, debug objects, hostile strings, and non-LinkedIn URLs.
2. Inspect local and session storage.
3. Export history.

Expected: each retained LinkedIn-derived root or history entry carries the verified active binding; only the data model's allowlisted fields are retained/exported; hostile or invalid fields are rejected; job/profile text renders as text; no `raw`, `debug`, snippet, response body, cookie, authorization, page content, or account binding appears in export.

## Scenario 6 — Upgrade Migration

1. Seed every legacy key and shape listed in [storage-and-deletion.md](contracts/storage-and-deletion.md), plus unrelated `theme` and onboarding values.
2. Trigger update/start migration, including a simulated termination mid-migration.
3. Restart the worker and run migration again.

Expected: every inventoried unbound account-derived key, stale header, snippet/debug value, obsolete key, and `_se_session` is removed; malformed values under inventoried LinkedIn keys are removed; automatic refresh is disabled; theme/onboarding and unknown unrelated keys survive; repeated migration produces the same result.

## Scenario 7 — Clear and Disconnect

1. Use the Controlled Performance Profile from `spec.md`: allocate at least two logical CPU cores and 4 GiB of memory; seed 365 SSI entries, 365 analytics entries, every other current and legacy data category, consent, connection/request state, and one collector whose fixture response remains pending until cancellation in a clean Chrome profile without throttling.
2. Confirm **Clear LinkedIn Data** during the delay.
3. Repeat with **Disconnect** and automatic refresh enabled.
4. Measure deletion from service-worker acceptance through response and storage verification; measure the operator flow from rendered controls through the success status.
5. Run Clear and Disconnect three times each and record the environment plus every elapsed time.

Expected: each deletion transaction completes within 5 seconds and each confirmed operator flow within 30 seconds. Each action closes owned tabs, removes all contracted data, disables automatic refresh, and prevents delayed responses from rewriting it. Disconnect also removes connection/reconnection state. Both preserve theme/onboarding, and automatic access requires fresh opt-in.

## Scenario 8 — Permission and Auth Release Audit

1. Inspect the loaded manifest and built release file list.
2. Exercise side panel, manual refresh, consented automatic SSI refresh, quests/notifications, collectors, PDF download, and deletion.
3. Search the release for placeholder OAuth values, `http://localhost:3000`, `Auth.init`, `_se_session`, direct cookie calls, content relay actions, and forbidden permissions.

Expected: supported behavior works with the minimized manifest; unfinished auth is unreachable and absent; the release-security contract passes. If removal of `tabs` breaks a required controlled-context operation, record the exact failing browser test before retaining it with justification.

## Scenario 9 — Privacy Documentation Review

Compare README and `extension/PRIVACY_POLICY.md` with observed fixture/live behavior for every feature, automatic refresh, storage key category, export, Clear, Disconnect, and authentication state.

Expected: reviewers can identify what is read, stored, retained, exported, and deleted, and documentation contains no known material mismatch.

## Final Live Smoke Matrix

Run only after deterministic tests pass, using a dedicated LinkedIn test account:

- logged-in manual SSI, Analytics, Profile Tips, and Jobs;
- logged out/expired session;
- logout then login as a second test account;
- no LinkedIn tab open;
- close temporary context during collection;
- enable then disable automatic refresh;
- clear and disconnect.

Record outcomes without copying cookies, headers, raw responses, page text, personal identifiers, or screenshots containing account data into logs or issue attachments.
