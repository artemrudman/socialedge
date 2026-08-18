# Tasks: Security Hardening

**Input**: Design documents from `specs/001-security-hardening/`

**Prerequisites**: `.specify/memory/constitution.md`, `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required by FR-026, FR-027, SC-007, and SC-009. Write each story's tests first and confirm they fail for the expected reason before implementation.

**Organization**: Tasks are grouped by user story so each security outcome can be implemented and validated independently. The production-readiness milestone comprises User Stories 1–3 plus the cookie-removal and release checks explicitly referenced by those phases.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it targets different files and does not depend on another incomplete task in the same phase
- **[Story]**: Maps the task to a user story in `spec.md`
- Every task names the exact file or directory it changes

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the zero-build Node/Puppeteer validation harness and controlled fixtures required by every story.

- [X] T001 Add root Node 22 scripts for `test:unit`, `test:extension`, and `test:release` plus a pinned Puppeteer development dependency in `package.json` and `package-lock.json`
- [X] T002 [P] Implement Chrome extension launch, service-worker discovery/restart, storage inspection, alarm triggering, tab snapshot, cleanup, and HTTPS LinkedIn request interception without release access to localhost in `tests/extension/helpers/chrome-extension.mjs`
- [X] T003 [P] Implement deterministic fixture responses for intercepted HTTPS LinkedIn routes with controllable status, delay, account identity, SSI, analytics, profile, jobs, and malformed payloads in `tests/extension/fixtures/server.mjs` and `tests/extension/fixtures/linkedin.html`

**Checkpoint**: The test runner can launch isolated Chrome with the unpacked extension and local fixtures without real LinkedIn credentials.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create shared contracts and adapters that all user stories require.

**⚠️ CRITICAL**: No user story implementation begins until this phase is complete.

- [X] T004 [P] Add failing contract tests for trusted sender checks, exact action schemas, normalized success/error envelopes, and rejection of removed relay actions in `tests/extension/messages.test.mjs`
- [X] T005 [P] Add failing unit tests for storage-area adapters, the exact LinkedIn key registry, verified-account switch purge, supported legacy inventory actions, schema-version reads/writes, exact-key deletion, and safe structured cloning in `tests/extension/storage.test.mjs`
- [X] T006 Implement exact request validators, trusted extension-origin sender validation, stable error codes, and normalized result envelopes in `extension/lib/messages.js`
- [X] T007 Implement Promise-based local/session storage adapters, the exact LinkedIn key registry, verified-account switch purge, supported legacy inventory primitives, exact-key helpers, and schema marker primitives in `extension/lib/storage.js`
- [X] T008 Implement the collection operation registry, session-backed monotonic epoch and owned temporary-tab IDs, cancellation state, startup reconciliation, and pre-write epoch guard in `extension/lib/collection.js`
- [X] T009 Load the shared `extension/lib/messages.js`, `extension/lib/storage.js`, and `extension/lib/collection.js` modules before registering service-worker events in `extension/background.js` and `extension/manifest.json`
- [X] T010 Implement a single normalized runtime request helper and safe user-facing error mapping for the side panel in `extension/popup.js`

**Checkpoint**: Shared tests pass; the service worker and side panel communicate only through the normalized internal contract.

---

## Phase 3: User Story 1 — Control LinkedIn Session Use (Priority: P1) 🎯 MVP

**Goal**: Make LinkedIn requests manual by default, support explicit versioned automatic SSI consent, enforce session-only credential TTL/account binding, and clear credentials on authentication failures.

**Independent Test**: Install/restart with automatic refresh disabled, trigger startup and daily alarm events, then manually refresh; verify only the manual action causes LinkedIn access, request context expires within 24 hours, and 401/403 or account change clears it before reuse.

### Tests for User Story 1

- [X] T011 [P] [US1] Add failing policy tests for allowlisted headers, operation-memory staging, mandatory verified account binding before request-context or LinkedIn-record storage/use, `account_unverified`, 24-hour TTL boundaries, malformed timestamps/headers, exact current consent version, default-off migration, and account mismatch in `tests/extension/policy.test.mjs`
- [ ] T012 [P] [US1] Add failing controlled-browser tests for install/startup/alarm silence, manual SSI authorization, explicit opt-in/out, unavailable identity with zero context/data writes, expired context, 401/403 eviction, logout/login, verified switch deletion of all prior bound data plus automatic-refresh disable and startup/alarm silence, no open LinkedIn tab, the 15-second request deadline, and service-worker restart in `tests/extension/integration/session-lifecycle.test.mjs`

### Implementation for User Story 1

- [X] T013 [US1] Implement request-context validation, TTL calculation, header allowlisting, mandatory verified binding, `account_unverified`, consent-version validation, feature scoping, and account-change policy in `extension/lib/policy.js`
- [X] T014 [US1] Replace persistent `ssiExactHeaders` writes with operation-memory staging and commit `_se_linkedInRequestContext` to session storage only after account verification, with timestamps, mandatory binding, authorization source, and feature scope in `extension/background.js`
- [X] T015 [US1] Refactor SSI replay to preserve numeric status, return normalized errors without response bodies, delete context/verification state before returning on 401/403, and reject expired or wrong-account context in `extension/background.js`
- [X] T016 [US1] Gate startup and `dailyFetch` alarm handling on current `_se_autoRefresh` consent while leaving non-LinkedIn daily quest behavior intact in `extension/background.js`
- [X] T017 [US1] Add minimal account verification before any LinkedIn-record write/display; return `account_unverified` and discard staged/stored context when identity is unavailable; on verified mismatch disable `_se_autoRefresh`, call the T007 purge, and transition `_se_linkedInConnection` to verification-required before returning `account_changed` in `extension/background.js` and `extension/lib/policy.js`
- [X] T018 [P] [US1] Add automatic-refresh disclosure, default-off toggle, current connection status, and session-expired/account-changed messaging markup in `extension/popup.html`
- [X] T019 [P] [US1] Style the automatic-refresh consent, connection status, and safe error states in `extension/popup.css`
- [X] T020 [US1] Wire `getPrivacySettings` and `setAutomaticRefresh` with the exact `privacy-v1` SSI-only contract and immediate disable behavior in `extension/popup.js` and `extension/background.js`
- [X] T021 [US1] Update legacy source-level assertions for default-off requests, TTL, session storage, and 401/403 eviction in `analysis/test_extension_hardening.py`

**Checkpoint**: User Story 1 passes independently; default installs generate no session-backed startup/alarm traffic, while manual and explicitly consented SSI refresh behave predictably.

---

## Phase 4: User Story 2 — Collect Without Disrupting Browsing (Priority: P1)

**Goal**: Make SSI, Analytics, Profile Tips, and Jobs collectors API-first and isolate any rendered-content work in a dedicated inactive temporary tab.

**Independent Test**: Record URL, active state, scroll, focus, and form values in unrelated and LinkedIn tabs, run each collector through success, error, timeout, and temporary-tab closure, and verify every user-owned tab is unchanged and every owned context closes.

### Tests for User Story 2

- [X] T022 [P] [US2] Add failing lifecycle tests for all four collectors and their structured/rendered/partial/malformed/5xx/delayed/hostile fixtures; assert each user tab's URL, active/focus state, scroll position, and form values across success/error/timeout; exact `active:false` ownership; 15-second request, 20-second tab-load, and 45-second operation deadlines; `tabs.onRemoved`; service-worker restart cleanup; cancellation; and stale-epoch write rejection in `tests/extension/integration/collector-tabs.test.mjs`, `tests/extension/fixtures/server.mjs`, and `tests/extension/fixtures/linkedin.html`
- [X] T023 [P] [US2] Add a separately runnable failing `cookie-capability` suite that rejects `chrome.cookies`, `JSESSIONID`, manifest `cookies`, and response-body excerpts in `analysis/test_extension_hardening.py` and `tests/extension/integration/release-package.test.mjs` before T026, T027, or T050 implementation

### Implementation for User Story 2

- [X] T024 [US2] Implement reusable API-first execution and dedicated inactive-tab lifecycle with exact ownership checks, monotonic 15-second request/20-second tab-load/45-second operation deadlines, close detection, `finally` cleanup, and startup closure of orphaned session-tracked tabs in `extension/lib/collection.js`
- [X] T025 [US2] Replace SSI bootstrap navigation of `tabs[0]` with an API-safe existing context or extension-owned inactive SSI tab in `extension/background.js`
- [X] T026 [US2] Refactor Analytics to use captured minimal headers and same-origin structured requests first, remove `chrome.cookies`/`JSESSIONID`, and use an owned inactive profile tab only for unavailable displayed fields in `extension/background.js`
- [X] T027 [US2] Refactor Profile Tips to use captured minimal headers and structured profile data first, remove `chrome.cookies`/`JSESSIONID`, and run any section scrolling/scraping only in an owned inactive tab in `extension/background.js`
- [X] T028 [US2] Refactor Jobs navigation, scrolling, and scraping to run only in an owned inactive jobs tab and close it on success, empty results, error, timeout, cancellation, or manual closure in `extension/background.js`
- [X] T029 [US2] Cancel expired operations, dispatch owned-tab cleanup without waiting past the 45-second deadline, retain unconfirmed ownership for restart cleanup, prevent failed/partial collectors from overwriting the last good snapshot, and map `no_context`, `context_closed`, `timeout`, `service_error`, `invalid_response`, and `cancelled` outcomes in `extension/background.js`
- [X] T030 [US2] Update Analytics, Profile Tips, Jobs, and SSI side-panel callbacks to consume normalized envelopes and show actionable recoverable errors without debug payloads in `extension/popup.js`
- [X] T031 [US2] Run `tests/extension/integration/collector-tabs.test.mjs` and the direct-cookie/response-body subset in `analysis/test_extension_hardening.py` after collector refactoring; confirm no user-tab mutation, direct cookie access, or response-body excerpt remains before the US2 checkpoint

**Checkpoint**: User Story 2 passes independently; no collector navigates, scrolls, focuses, restores, or repurposes a user-owned tab.

---

## Phase 5: User Story 3 — Minimize and Erase LinkedIn Data (Priority: P1)

**Goal**: Persist/export only approved parsed fields, migrate legacy raw/debug/session data safely, and provide race-safe Clear LinkedIn Data and Disconnect controls.

**Independent Test**: Seed every legacy/current data category, migrate twice including a worker interruption, inspect storage/export for prohibited fields, then clear and disconnect during delayed collection; verify contracted data stays deleted within five seconds and unrelated preferences survive.

### Tests for User Story 3

- [X] T032 [P] [US3] Add failing unit tests for required verified binding on SSI/analytics/activities/quests/tips/jobs projections, numeric/range/string/URL limits, 365-entry bounds, export v2, every Supported Legacy Inventory key/shape and malformed variant, and rejection of `raw`, `debug`, snippets, secrets, page text, and unsafe URLs in `tests/extension/storage.test.mjs`
- [ ] T033 [P] [US3] Add failing integration tests before T035-T043 for the complete Supported Legacy Inventory, deletion of unbound legacy account data, idempotent/partial migration, clear/disconnect during collection or migration, worker termination during migration/clear/disconnect, exact deletion matrices, stale-write suppression, and three passing runs per action under the Controlled Performance Profile's five-second transaction plus 30-second confirmed UI flow in `tests/extension/integration/migration-deletion.test.mjs`

### Implementation for User Story 3

- [X] T034 [US3] Implement allowlisted SSI, analytics, profile-tips, jobs, activity/quest, and export projection validators with required verified account binding and retention bounds in `extension/lib/storage.js`
- [X] T035 [US3] Implement idempotent migration for every Supported Legacy Inventory shape that deletes unbound account-derived keys, `ssiExactHeaders`, raw/debug/snippet/session material and `_se_session`, removes malformed values under inventoried LinkedIn keys, preserves unrelated/unknown keys, defaults consent off, and advances `_se_dataSchemaVersion` only after success in `extension/lib/storage.js`
- [X] T036 [US3] Run migration before normal event/message work and from `runtime.onInstalled` update handling, with safe retry and automatic LinkedIn access disabled on failure, in `extension/background.js`
- [X] T037 [US3] Change SSI and Analytics persistence to require the verified active binding and write only validated projections with `collectedAt`, never raw responses or page snippets, in `extension/background.js`
- [X] T038 [US3] Change Profile Tips, Jobs, activities, and quest persistence to require the verified active binding, omit slug/debug/page metadata, and retain only validated user-visible fields in `extension/background.js` and `extension/popup.js`
- [X] T039 [US3] Remove profile/job diagnostic rendering and render all collected job/profile strings and URLs through safe DOM properties with LinkedIn HTTPS URL checks in `extension/popup.js`
- [X] T040 [US3] Implement centralized Clear LinkedIn Data and Disconnect transactions that both disable automatic refresh, serialize or invalidate migration writes, increment the epoch, close owned tabs, remove explicit local/session keys, prevent late writes, meet the five-second Controlled Performance Profile budget, and return deletion categories in `extension/lib/storage.js` and `extension/background.js`
- [X] T041 [P] [US3] Add confirmed Clear LinkedIn Data and Disconnect controls with scope explanations and status regions in `extension/popup.html`
- [X] T042 [P] [US3] Style destructive-action confirmations, progress, success, and failure states accessibly in `extension/popup.css`
- [X] T043 [US3] Wire confirmed clear/disconnect requests so the rendered-controls-to-success flow meets the 30-second budget, refresh visible screens after deletion, show automatic refresh disabled after either action, require fresh opt-in, and keep non-LinkedIn preferences intact in `extension/popup.js`
- [X] T044 [US3] Increment the export schema and emit only minimized SSI history, activity history, and the documented catalog without account bindings or internal state in `extension/popup.js`
- [X] T045 [US3] Extend source-level regression coverage for raw/debug removal, migration keys, deletion matrices, safe export, and no late writes in `analysis/test_extension_hardening.py`

**Checkpoint**: User Story 3 passes independently. Phases 3–5 plus T050 and the passing T023 `cookie-capability` suite establish the production-readiness milestone candidate.

---

## Phase 6: User Story 4 — Operate With Least Privilege (Priority: P2)

**Goal**: Remove inactive page interception/relay capabilities and unnecessary release privileges, validate every internal message, and package only approved resources.

**Independent Test**: Load and exercise the release package, forge messages from page/extension-invalid senders, and audit the manifest/files; verify supported features work while cookie/page-relay/broad-resource access is absent and malformed messages cause no side effects.

### Tests for User Story 4

- [X] T046 [P] [US4] Add failing integration tests for invalid sender IDs/origins/frames, unknown actions/fields, oversized/malformed payloads, response schemas, and zero privileged side effects in `tests/extension/integration/runtime-messages.test.mjs`
- [X] T047 [P] [US4] Add failing full-release tests for content scripts, relay actions/files, wildcard schemes, broad web-accessible resources, unsafe collected-value rendering, non-cookie forbidden permissions, and required-feature permission mapping in `tests/extension/integration/release-package.test.mjs`; keep this suite separate from T023 `cookie-capability`

### Implementation for User Story 4

- [X] T048 [US4] Remove page-originated `captureHeaders`, `storeSSI`, and `storeAnalytics` handling and enforce trusted sender plus exact request/response validation for every remaining action in `extension/background.js` and `extension/lib/messages.js`
- [X] T049 [US4] Remove the inactive interceptor and relay declarations/files from `extension/manifest.json`, `extension/content_main.js`, and `extension/content.js`
- [X] T050 [US4] Remove `cookies`, broad-scheme LinkedIn hosts, and broad `web_accessible_resources`; retain only justified HTTPS host/permissions in `extension/manifest.json`
- [X] T051 [US4] Validate all collector and PDF-download scenarios without the `tabs` permission, remove it if tests pass, or document the exact failing browser requirement beside a retained entry in `extension/manifest.json` and `specs/001-security-hardening/contracts/release-security.md`
- [X] T052 [US4] Remove payload, response body, page content, account identifier, header, and stack logging while retaining safe category/status logs in `extension/background.js` and `extension/popup.js`
- [X] T053 [US4] Implement an explicit extension release allowlist/package audit that excludes tests, fixtures, server files, databases, secrets, and debug artifacts in `scripts/package-extension.mjs` and `package.json`
- [X] T054 [US4] Extend source-level assertions for sender validation, removed relay files/actions, safe rendering, HTTPS-only hosts, and manifest least privilege in `analysis/test_extension_hardening.py`

**Checkpoint**: User Story 4 passes independently; each remaining permission/resource maps to an exercised release feature.

---

## Phase 7: User Story 5 — Ship Only Safe Account Authentication (Priority: P2)

**Goal**: Ensure unfinished SocialEdge authentication is absent from the release and document enforceable prerequisites for any future re-enable.

**Independent Test**: Build and inspect the extension release with legacy `_se_session` seeded; verify there is no auth initialization, insecure account request, identity/OAuth permission, placeholder client, or packaged auth module, and migration removes the legacy session.

### Tests for User Story 5

- [X] T055 [US5] Add failing release and migration tests for absent `auth.js`, `Auth.init`, `http://` account origins, identity/OAuth manifest entries, placeholder client IDs, and removal of `_se_session` in `tests/extension/integration/release-package.test.mjs` and `tests/extension/integration/migration-deletion.test.mjs`

### Implementation for User Story 5

- [X] T056 [US5] Remove authentication script loading, hidden auth markup, initialization, form handlers, token use, and account UI from `extension/popup.html` and `extension/popup.js`
- [X] T057 [US5] Remove the unfinished extension authentication module from `extension/auth.js` and ensure it is excluded from `scripts/package-extension.mjs`
- [X] T058 [US5] Remove `identity` and the placeholder `oauth2` block from `extension/manifest.json`
- [X] T059 [US5] Document the development-only server boundary and HTTPS, provider verification, short-lived access token, rotating/revocable refresh session, logout, CORS, secret, rate-limit, account-linking, and authorization prerequisites in `server/README.md`

**Checkpoint**: User Story 5 passes independently; release users cannot enter or trigger the unfinished SocialEdge account flow.

---

## Phase 8: User Story 6 — Understand Privacy Behavior (Priority: P3)

**Goal**: Make collection, storage, retention, export, deletion, automatic refresh, permissions, and disabled account authentication understandable and verifiably accurate.

**Independent Test**: Compare documentation and consent text with observed fixture/release behavior for every feature and lifecycle action; reviewers can identify exactly what is read, stored, retained, exported, and deleted with no material mismatch.

### Tests for User Story 6

- [X] T060 [US6] Add failing documentation-consistency assertions for all four features, automatic-refresh default/scope/disable flow, retention/export/deletion matrices, permissions, and disabled authentication in `tests/extension/integration/release-package.test.mjs`

### Implementation for User Story 6

- [X] T061 [US6] Rewrite data collection, storage, retention, export, Clear, Disconnect, automatic-refresh, permission, third-party, and disabled-auth disclosures in `extension/PRIVACY_POLICY.md`
- [X] T062 [US6] Update setup, architecture, automatic behavior, collector isolation, local data/export, permissions, deletion, troubleshooting, and authentication status in `README.md`
- [X] T063 [US6] Align side-panel onboarding/help/consent copy with manual-default access, temporary inactive contexts, clear/disconnect effects, and recoverable session errors in `extension/popup.html` and `extension/popup.js`
- [X] T064 [US6] Add a release documentation review matrix mapping every documented claim to an automated or manual validation step in `specs/001-security-hardening/checklists/release.md`

**Checkpoint**: User Story 6 passes independently; privacy behavior is understandable and agrees with the release.

---

## Phase 9: Polish & Cross-Cutting Release Gates

**Purpose**: Complete cross-story races, performance, packaging, and controlled live validation before final release approval.

- [X] T065 [P] Run the service-worker termination/restart cases authored in T012, T022, and T033 against the release package and record collection, migration, clear, disconnect, orphan-tab, and stale-write results in `specs/001-security-hardening/checklists/release.md`
- [X] T066 Run the deadline and Controlled Performance Profile cases authored in T012, T022, and T033 against the release package after T065 writes its evidence; record request/tab/operation deadline outcomes, three Clear and three Disconnect runs, seeded record counts, Chrome/OS versions, available CPU/memory, five-second transaction times, and 30-second UI flow times in `specs/001-security-hardening/checklists/release.md`
- [X] T067 Audit all storage reads/writes and extension package files against the approved schemas and Supported Legacy Inventory; record results in `specs/001-security-hardening/checklists/release.md`; if the audit finds an uncatalogued LinkedIn/auth key or shape, block release and return to T032/T033 failing coverage before updating T035 and rerunning this audit
- [X] T068 Run `npm run test:unit`, `npm run test:extension`, `npm run test:release`, Python `unittest`, and JavaScript syntax validation and record command outcomes in `specs/001-security-hardening/checklists/release.md`
- [X] T069 Build the release package, load it in clean Chrome, exercise side panel/quests/notifications/PDF/collectors/deletion, and record the permission/resource audit in `specs/001-security-hardening/checklists/release.md`
- [ ] T070 Execute the dedicated LinkedIn test-account smoke matrix for logged-in, expired, logout/login, second account, no open tab, temporary-tab closure, consent enable/disable, clear, and disconnect without retaining sensitive artifacts in `specs/001-security-hardening/checklists/release.md`
- [ ] T071 Verify FR-001–FR-030 and SC-001–SC-011 traceability, document any justified retained permission, confirm no unresolved critical/high security finding, and sign off the production-readiness/final release gates in `specs/001-security-hardening/checklists/release.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: No dependencies; starts immediately.
- **Phase 2 — Foundational**: Depends on Phase 1 and blocks every user story.
- **Phase 3 — US1**: Depends on Phase 2; establishes session authorization, credential, consent, and account policy used by LinkedIn collectors.
- **Phase 4 — US2**: Depends on Phase 2 for lifecycle primitives and integrates with US1 credential policy; fixture/lifecycle work can begin in parallel with late US1 UI work.
- **Phase 5 — US3**: Depends on Phase 2; projection/migration tests can begin in parallel with US1/US2, but final persistence/deletion integration depends on their write paths.
- **Phase 6 — US4**: Can begin after Phase 2; final permission removal/package audit depends on completed US1–US3 behavior so required privileges are known.
- **Phase 7 — US5**: Can begin after Phase 2 and in parallel with US1–US4; final release audit joins US4.
- **Phase 8 — US6**: Documentation tests can start after Phase 2; final copy depends on stable US1–US5 behavior.
- **Phase 9 — Polish**: Depends on every story selected for release.

### User Story Dependency Graph

```text
Setup -> Foundation -> US1 (session control) ---------+
                    -> US2 (non-disruptive collect) --+-> US4 (least privilege) -> US6 (privacy docs) -> Release
                    -> US3 (minimize/delete) ---------+
                    -> US5 (disable auth) ------------+
```

### Within Each User Story

1. Write the story's unit/contract/integration tests and confirm expected failures.
2. Implement pure schemas/policy/lifecycle before service-worker orchestration.
3. Implement background actions before side-panel integration.
4. Run the independent story test and existing regression suite at the checkpoint.
5. Do not weaken a prior story's acceptance criteria to make a later story pass.

## Parallel Opportunities

- T002 and T003 can build browser helpers and fixtures concurrently after T001.
- T004 and T005 can define message and storage contracts concurrently.
- US1 policy tests (T011) and controlled-browser session tests (T012) can be authored concurrently; US1 markup (T018) and styling (T019) can follow in parallel.
- US2 collector/fixture tests (T022) and cookie-boundary tests (T023) can be authored concurrently.
- US3 schema/export tests (T032) and migration/deletion integration tests (T033) can be authored concurrently; Clear/Disconnect markup (T041) and styling (T042) can be implemented concurrently.
- US4 sender tests (T046) and release-package tests (T047) can be authored concurrently.
- US5 implementation can proceed in parallel with US1–US4 after Foundation because release authentication is isolated.
- Documentation consistency tests for US6 can be prepared while US4/US5 release work finishes.
- T065 writes termination evidence before T066 appends timing evidence to the same release checklist.

## Parallel Examples by User Story

### User Story 1

```text
Task T011: policy/schema unit tests in tests/extension/policy.test.mjs
Task T012: startup/alarm/session integration tests in tests/extension/integration/session-lifecycle.test.mjs
```

### User Story 2

```text
Task T022: tab lifecycle integration tests in tests/extension/integration/collector-tabs.test.mjs
Task T023: cookie-capability source/package tests in analysis/ and tests/extension/integration/
```

### User Story 3

```text
Task T032: projection/export tests in tests/extension/storage.test.mjs
Task T033: migration/deletion race tests in tests/extension/integration/migration-deletion.test.mjs
```

### User Story 4

```text
Task T046: runtime sender/schema abuse tests in tests/extension/integration/runtime-messages.test.mjs
Task T047: manifest/package permission tests in tests/extension/integration/release-package.test.mjs
```

### User Story 5

```text
Task T055: release-auth absence and legacy-session migration tests
Task T059: development-only auth re-enable contract in server/README.md after tests define release exclusion
```

### User Story 6

```text
Task T060: automated documentation-consistency assertions
Task T064: manual/automated claim review matrix after behavior stabilizes
```

## Implementation Strategy

### MVP First — User Story 1

1. Complete Setup and Foundation.
2. Complete US1 tests and implementation.
3. Stop and validate that default startup/alarm behavior is silent, manual SSI works, consent is explicit, TTL is enforced, and 401/403/account changes invalidate context.
4. Treat this as an internal MVP only; it is not yet the requested production-readiness milestone.

### Production-Readiness Milestone

1. Complete US2 to remove direct cookie access and arbitrary-tab mutation.
2. Complete US3 to minimize/migrate/delete data and add Clear/Disconnect.
3. Complete T023, T031, and T050 so the source and manifest request no direct cookie capability; pass the separate T023 `cookie-capability` suite.
4. Require all FR-001–FR-020 tests to pass before calling the first five sequence items production-ready. Content-script, identity/OAuth, broad-resource, and optional `tabs` cleanup remain in full US4 unless an FR-001–FR-020 test depends on them.

### Incremental Delivery

1. **MVP**: Setup + Foundation + US1.
2. **Production milestone candidate**: US2 + US3, T050 cookie removal, and the T023 `cookie-capability` release check.
3. **Release hardening**: US4 + US5.
4. **Transparency and final approval**: US6 + Polish gates.

## Notes

- The constitution gate is mandatory: user-directed access, least privilege, minimized storage, boundary tests, and fail-closed release checks must pass before merge.
- `[P]` marks work safe to execute concurrently; tasks modifying the same large entry point are intentionally sequential.
- Story labels provide traceability to the six scenarios in `spec.md`.
- Automated tests use fixtures; live LinkedIn validation uses only a dedicated test account and stores no sensitive artifacts.
- A retained `tabs` permission requires a reproducible controlled-browser failure and explicit justification.
- Commit after each task or coherent dependency group and rerun the affected story tests at every checkpoint.
