# Implementation Plan: Security Hardening

**Branch**: `feat/ssi-research` | **Date**: 2026-08-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-security-hardening/spec.md`

## Summary

Harden the Chrome extension so LinkedIn access is user-initiated by default, cached request credentials are minimal and short-lived, collectors never navigate or scroll a user-owned tab, retained data contains only documented parsed fields, and users can clear or disconnect all LinkedIn-derived state. The implementation centralizes session policy, storage schemas, migration, collection lifecycle, deletion, and runtime-message validation in the extension service worker; uses direct same-origin requests where possible and a tracked inactive temporary tab only for rendered-content collection; removes cookie/content-script/unfinished-auth exposure from the release; and adds deterministic unit plus controlled browser integration coverage.

The production-readiness milestone implements the first five sequence items in the specification: credential expiration and automatic-request policy, removal of direct cookie access, replacement of tab-navigation collectors, minimized/migrated storage, and clear/disconnect controls. Permission/auth cleanup, complete session integration coverage, and privacy documentation follow before final release approval.

## Technical Context

**Language/Version**: JavaScript ES2022 for the Chrome extension; Node.js 22 for automated extension tests and the existing optional server; Python 3.11+ for the existing analyzer and source-level regression suite

**Primary Dependencies**: Chrome Manifest V3 APIs (`runtime`, `storage`, `webRequest`, `scripting`, `tabs`, `alarms`, `sidePanel`, `notifications`); browser-managed LinkedIn session; Node built-in test runner; Puppeteer as a development-only controlled-browser test dependency; existing Express 4/SQLite authentication server remains excluded from the release extension

**Storage**: `chrome.storage.session` for request credentials and in-flight sensitive state; `chrome.storage.local` for one verified account's bound LinkedIn history, feature/activity/quest data, versioned consent/connection state, schema version, and non-sensitive preferences; existing SQLite storage is confined to the disabled development authentication server

**Testing**: `node:test` for pure policy/schema/migration units; Puppeteer-controlled Chrome for Manifest V3 integration scenarios; existing Python `unittest` analyzer and extension regression checks; manual smoke validation against a dedicated LinkedIn test account only for behavior that cannot be represented by local fixtures

**Target Platform**: Google Chrome 116+ with Manifest V3 and Side Panel support; unpacked extension during development and a release package containing only approved extension files

**Project Type**: Browser extension with a local side-panel UI and service worker; separate optional development-only web service

**Performance Goals**: Under the specification's Controlled Performance Profile with at least two logical CPU cores and 4 GiB of available memory, three Clear runs and three Disconnect runs each finish the transaction within 5 seconds and the confirmed operator flow within 30 seconds. Each LinkedIn request has a 15-second deadline, each temporary-tab load has a 20-second deadline, and each complete collection operation has a 45-second deadline. Expiry cancels work, dispatches owned-tab cleanup, preserves the last valid snapshot, and returns `timeout`.

**Constraints**: No direct `JSESSIONID` access; no navigation, scrolling, focusing, or repurposing of user-owned tabs; no session-backed startup/alarm request without current versioned opt-in consent; no request context or LinkedIn-derived record storage before account verification; one verified account at a time; verified account change purges prior bound data, disables automatic refresh, and requires fresh authorization before new writes; request credentials expire within 24 hours and are removed on 401/403 or unverifiable identity; no raw SSI responses, page snippets, response bodies, or collector debug payloads are retained; clear/disconnect must suppress late writes from in-flight operations; no real LinkedIn credentials in automated tests

**Scale/Scope**: One extension service worker, one side-panel UI, four LinkedIn-derived feature families (SSI, analytics, profile tips, jobs), up to 365 minimized daily SSI/analytics snapshots, one active LinkedIn account binding at a time, and migration from the exact unversioned key/shape inventory in `contracts/storage-and-deletion.md`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **User-Directed Access — PASS**: manual actions or versioned SSI-only consent authorize requests; startup and alarms default to no LinkedIn traffic; Clear and Disconnect disable consent and require fresh authorization.
- **Least Privilege and Isolated Collection — PASS**: release work removes cookie/content/auth privileges; API-first collectors preserve user tabs; session-backed ownership lets restart recovery close temporary tabs.
- **Data Minimization and Effective Deletion — PASS**: allowlisted projections, bounded retention, idempotent migration, volatile request context, deletion matrices, and stale-epoch guards cover stored and in-flight data.
- **Test-First Security Boundaries — PASS**: each story starts with failing unit or controlled browser tests; fixtures use intercepted LinkedIn HTTPS requests and no personal credentials.
- **Fail-Closed, Auditable Releases — PASS**: unverified identity, consent, credentials, migration, sender, or response state denies collection; release gates audit permissions, package contents, storage, deletion, and documentation.

Post-design re-check: **PASS**. The data model and contracts include authorization, ownership recovery, deletion, and release evidence. No constitution exception is requested.

## Project Structure

### Documentation (this feature)

```text
specs/001-security-hardening/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── runtime-messages.md
│   ├── storage-and-deletion.md
│   └── release-security.md
├── checklists/
│   ├── requirements.md
│   └── release.md
└── tasks.md                 # Created by /speckit-tasks, not this command
```

### Source Code (repository root)

```text
extension/
├── manifest.json            # Minimal release permissions/resources
├── background.js            # MV3 event registration and orchestration
├── lib/
│   ├── policy.js            # Consent, TTL, account-binding, error policy
│   ├── storage.js           # Schemas, migration, clear/disconnect
│   ├── messages.js          # Sender/request/response validation
│   └── collection.js        # API/temp-tab lifecycle and cancellation
├── popup.html               # Consent, clear, disconnect, and feature UI
├── popup.js                 # Validated UI requests and safe rendering
├── popup.css
├── PRIVACY_POLICY.md
├── Info Plan.pdf
└── icons/

tests/
└── extension/
    ├── policy.test.mjs
    ├── storage.test.mjs
    ├── messages.test.mjs
    ├── fixtures/
    └── integration/
        ├── session-lifecycle.test.mjs
        ├── collector-tabs.test.mjs
        ├── migration-deletion.test.mjs
        ├── release-package.test.mjs
        └── runtime-messages.test.mjs

scripts/
└── package-extension.mjs

analysis/
├── analyze_ssi.py
├── test_analyze_ssi.py
└── test_extension_hardening.py

server/                       # Development-only; excluded from extension release
├── README.md
├── index.js
├── db.js
├── middleware/auth.js
└── routes/auth.js

README.md
package.json                  # Extension validation/test scripts only
package-lock.json
```

**Structure Decision**: Preserve the zero-build extension and existing side-panel/service-worker entry points, while extracting security-sensitive pure logic into small files under `extension/lib/` so Node tests can execute it independently of Chrome. Keep browser lifecycle behavior in `background.js`, UI behavior in `popup.js`, and treat `server/` as a separate development-only component. Remove `content.js` and `content_main.js` from the release and remove `auth.js` from the extension until the release-security contract is satisfied.

## Implementation Strategy

### Phase A — Production-Readiness Foundation

1. Introduce versioned storage schemas with required account binding, session-only credential caching after account verification, TTL enforcement, normalized errors, and an idempotent migration that deletes unbound legacy account data plus raw/debug/session material before other handlers operate. Keep captured headers in operation memory until identity verification supplies the required binding; discard them on verification failure.
2. Add versioned automatic-refresh consent, default it off for new and upgraded users, and gate startup/alarm work before any session-backed action or passive credential retention.
3. Refactor SSI, analytics, and profile tips onto the shared authenticated request policy without cookie reads; replace every navigation/scroll path with API-first collection or the dedicated inactive-tab lifecycle. Enforce 15-second request, 20-second tab-load, and 45-second operation deadlines through one monotonic deadline service.
4. Refactor Jobs to the inactive-tab lifecycle where direct requests cannot provide the required fields; allowlist and safely render stored job fields.
5. Add operation epochs/cancellation so clear or disconnect closes owned temporary tabs and prevents late storage writes; expose confirmed Clear LinkedIn Data and Disconnect controls.
6. Remove the `cookies` permission after collector refactoring and pass the cookie-specific source and release-package tests before approving the production-readiness milestone.

### Phase B — Release Hardening

1. Remove content scripts and page relay actions; validate all remaining internal message senders, actions, requests, and response envelopes.
2. Finish manifest and package minimization: remove `identity`, OAuth configuration, content scripts, unnecessary web-accessible resources, and, after browser validation, `tabs`; narrow LinkedIn host access to required HTTPS hosts and confirm the milestone already removed `cookies`.
3. Remove authentication initialization/code from the release, delete legacy `_se_session` during migration, and enforce a release test that rejects placeholder OAuth, insecure account endpoints, or identity permission.
4. Build deterministic unit and Puppeteer integration coverage for consent, TTL, 401/403, account switching, error/timeout/context closure, migration, deletion during collection, arbitrary-tab preservation, and service-worker termination.
5. Update README and privacy documentation from observed release behavior, run the permission/data audit, and require all production-readiness acceptance tests plus no unresolved critical/high security finding before release approval.

## Key Risks and Mitigations

- **Undocumented LinkedIn endpoints and DOM change**: Keep collectors behind normalized contracts, prefer the smallest structured response, use a temporary tab only where unavoidable, and fail without overwriting the last good snapshot.
- **Cross-account data mixing**: Store the verified binding on every LinkedIn-derived record. On verified mismatch, invalidate credentials, disable automatic refresh, purge prior bound feature/activity/quest data, reset connection state, and require a fresh user-authorized collection before new writes or display.
- **Unbound legacy data**: Treat current unversioned account-derived records as unverifiable. Delete them during migration, preserve only unrelated preferences, and cover each inventoried shape before migration implementation.
- **Unverified header capture**: Stage headers in the active operation only. Commit a request context to session storage after account verification; discard staged values and return `account_unverified` when verification fails.
- **Service-worker termination**: Persist the operation epoch and owned temporary-tab IDs in session storage, reconcile them when the worker starts, make migration retry-safe, and test termination/restart.
- **Clear/disconnect races**: Increment a collection epoch, cancel/close owned contexts, delete allowlisted keys, and reject any result from an older epoch.
- **Stored DOM injection**: Validate LinkedIn-derived types, lengths, and URL origins and render text through safe DOM APIs rather than interpolating untrusted values into `innerHTML`.
- **Permission regression**: Validate the unpacked/packed release in real Chrome after removing `tabs`; retain it only if a documented required behavior fails with host permission alone.
- **Temporary-tab visibility**: Use `active: false`, never focus it, close it in `finally`, and prefer direct requests so the tab exists only for rendered-only collectors.
- **Deadline drift**: Compute request, tab-load, and overall deadlines from a monotonic clock. The overall 45-second deadline wins when a nested deadline would finish later, and timeout cleanup never permits a stale result write.
- **Authentication scope creep**: Keep account features absent from release. Re-enable only through a separate reviewed change satisfying the HTTPS, provider, expiry, rotation/revocation, logout, CORS, secret, and authorization prerequisites in `contracts/release-security.md`.
