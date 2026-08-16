# Phase 0 Research: Security Hardening

## 1. Request Credential Lifetime and Storage

**Decision**: Store only the allowlisted request headers needed by approved LinkedIn collectors in `chrome.storage.session`, with `capturedAt`, `expiresAt`, schema version, and a minimal account binding. Enforce a hard maximum lifetime of 24 hours on every read; session shutdown, update, disable, 401/403, account mismatch, clear, and disconnect may expire them sooner.

**Rationale**: The current `ssiExactHeaders` value is persisted indefinitely in local storage and reused without account validation. Chrome documents that session storage is memory-backed, clears on browser restart/reload/update, and is not exposed to content scripts by default, making it the safer default for session-derived material ([Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)). A TTL remains necessary for long-running browser sessions.

**Alternatives considered**:

- Keep credentials in local storage with a 24-hour TTL: supports automatic refresh immediately after restart but leaves sensitive values on disk longer than needed.
- Keep no cache at all: strongest minimization, but forces every manual action to bootstrap a new request and increases tab/network churn.
- Store cookie-derived values: rejected because it preserves direct cookie access and requires the `cookies` permission.

## 2. Capture Authorization and Automatic Refresh

**Decision**: Retain captured headers only while a user-initiated collection authorization is active or versioned automatic-refresh consent is enabled for that feature. Represent consent as a versioned, feature-scoped object, not a legacy boolean. Missing, malformed, or legacy consent means disabled. Startup and alarm listeners check consent before creating an operation or retaining credentials.

**Rationale**: Blocking navigation alone is insufficient: the current startup/alarm path still replays a request whenever cached headers exist. A versioned consent record makes the disclosed scope auditable and prevents future features from silently joining automatic refresh.

**Alternatives considered**:

- A single boolean: simpler, but cannot show which features or disclosure version the user approved.
- Keep passive capture at all times but block replay: causes background collection/retention the user did not request.
- Remove automatic refresh permanently: safest, but exceeds the requirement, which permits explicit opt-in.

## 3. 401/403 and Account Changes

**Decision**: Preserve numeric response status through every collector. On 401 or 403, delete request credentials and connection verification state before resolving the operation with `session_expired`. Stage captured headers in operation memory until SocialEdge verifies the active minimal account binding. Verification commits the bound request context to session storage. Missing identity yields `account_unverified`. A verified mismatch yields `account_changed`, discards request context, disables automatic refresh, and deletes the prior account's bound SSI, analytics, activities/quests, profile tips, and jobs before the extension accepts new writes or display. The new account requires fresh user authorization.

**Rationale**: The current replay reduces failures to text and may include a response-body excerpt. Stable status-driven policy is testable, prevents credential reuse, and avoids retaining page/service content. TTL alone cannot detect switching LinkedIn accounts inside the TTL window.

**Alternatives considered**:

- Detect account changes only after collection: risks writing one account's data into another's history.
- Partition all history by account: retains more identifiers and broadens the current single-account product scope.
- Keep prior data after a verified switch: requires multi-account partitioning and creates a cross-account display risk.

## 4. Cookie-Free LinkedIn Requests

**Decision**: Continue browser-managed `credentials: "include"` requests in a LinkedIn origin context, but derive required CSRF/request headers only from the allowlisted natural request capture. Analytics and Profile Tips must not call `chrome.cookies`. Remove the `cookies` permission.

**Rationale**: Existing SSI replay already demonstrates that same-origin requests can let the browser attach session cookies without exposing their values to extension code. Chrome confirms cookie access requires both the cookies API permission and matching host permission, so removing the direct API use enables removing that privilege ([Chrome permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)).

**Alternatives considered**:

- Extension-origin cross-site fetch: cookie/SameSite behavior is less predictable and does not provide DOM when required.
- Continue constructing CSRF from `JSESSIONID`: directly violates the feature boundary.
- Page/content-script interception: expands the trusted surface and is unnecessary for current features.

## 5. Collector Context

**Decision**: Use direct same-origin API requests when they return the required parsed fields without changing page state. Apply a 15-second deadline to each LinkedIn request, a 20-second deadline to each temporary-tab load, and a 45-second deadline to the complete collection operation. If rendered content is required, create a dedicated tab with `active: false`, record its exact ID and operation epoch, handle `tabs.onRemoved`, collect only allowlisted fields, and close that tab in `finally`. The 45-second operation deadline overrides any later nested deadline. Timeout dispatches cleanup, records an unconfirmed tab as owned for startup reconciliation, preserves the last valid snapshot, and returns `timeout`. Never navigate, scroll, focus, or restore a user-owned tab.

**Rationale**: Analytics, Profile Tips, and Jobs currently pick the first LinkedIn tab, navigate and scroll it, and inconsistently restore it. Chrome's Tabs API supports inactive tab creation and tab-removal lifecycle events; most basic tab operations do not themselves require the `tabs` permission ([Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)).

**Alternatives considered**:

- API-only for all features: smallest surface, but some LinkedIn internal endpoints may not expose rendered-only fields.
- Temporary tab for all features: simpler collector shape but slower and more visible, and retains more scripting surface.
- Reuse and restore an arbitrary LinkedIn tab: rejected because restoration is racy and cannot recover form, scroll, focus, or application state reliably.

## 6. Storage Minimization and Migration

**Decision**: Store each new SSI, analytics, activity/quest, profile-tips, and jobs record with the verified active account binding. Remove `raw`, `debug`, snippets, page titles/text samples, response-body excerpts, selector samples, and API-shape diagnostics. The current unversioned records carry no trustworthy binding, so migration deletes them instead of assigning them to the active browser account. Run an idempotent schema migration on update and as a service-worker-start fallback. Advance the schema marker only after success.

**Rationale**: Current `ssiHistory` embeds complete raw responses and export repeats them; Profile Tips and Jobs persist broad debug objects; Analytics captures a page snippet. A retry-safe fallback is needed because extension service workers can terminate between events.

**Alternatives considered**:

- Bind legacy history to the account active during upgrade: can misattribute records if the user switched accounts before migration.
- Keep debug data behind a flag: still creates sensitive retention and complicates deletion/documentation.
- One-time update event only: misses partial failures and environments where the worker stops mid-migration.

## 7. Clear, Disconnect, and In-Flight Work

**Decision**: Centralize both actions in the background worker using explicit key allowlists, never `storage.local.clear()`. Clear deletes LinkedIn-derived histories, activities/quests, feature caches, credentials, and account identifiers; disables automatic refresh; and preserves theme/onboarding. Disconnect performs the same deletion and also removes connection state. Both actions increment the operation epoch, close owned temporary tabs, and require fresh opt-in before automatic LinkedIn access. Late operations may not write after either action.

**Rationale**: Explicit schemas protect unrelated preferences and make deletion auditable. Epoch invalidation handles the specification's clear-during-collection case without relying on timing.

**Alternatives considered**:

- Clear all extension storage: easy but deletes unrelated user preferences.
- Disable UI until collection completes: does not cover tab closure, worker restart, or requests already resolving.
- Best-effort delete without cancellation: allows deleted data to reappear from a late response.

## 8. Content Scripts and Runtime Messaging

**Decision**: Remove both current content scripts and the page-originated `storeSSI`, `storeAnalytics`, and unused header-capture messages. For every remaining internal message, require the extension's own sender ID and extension origin, allowlist the action, reject unknown fields/types/oversized values, and return one normalized result envelope.

**Rationale**: `content_main.js` is inactive, while `content.js` accepts forgeable page `postMessage` events and forwards privileged storage actions; the background ignores sender identity and payload shape. Chrome advises treating content scripts as less trustworthy and validating/sanitizing all messages and limiting privileged actions ([Chrome message-passing security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)).

**Alternatives considered**:

- Retain relay with origin/type checks: a page script can still forge same-page messages, and no active feature needs the relay.
- Add a page-visible nonce: raises complexity and remains unnecessary.
- Validate only action names: leaves payload and response-shape abuse possible.

## 9. Permission and Package Baseline

**Decision**: Keep `webRequest`, `storage`, `alarms`, `scripting`, `sidePanel`, and `notifications`; narrow host access to required HTTPS LinkedIn hosts. Remove `cookies`, `identity`, OAuth configuration, content scripts, and broad web-accessible PDF exposure. Remove `tabs` after controlled-browser tests prove that matching host permission covers required sensitive LinkedIn tab fields; retain only with a documented failed test and justification.

**Rationale**: The current manifest carries permissions for hidden or inactive code. Chrome documents that `tabs` gates sensitive tab properties while matching host permissions also expose those properties for matching pages, and creating/navigating tabs usually does not require `tabs` permission ([Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)). The PDF is already an extension-owned resource linked from the side panel and need not be exposed to all sites.

**Alternatives considered**:

- Remove `webRequest`: would require a new way to obtain the minimal CSRF request context.
- Remove alarms/notifications: would break existing non-LinkedIn daily quest behavior and optional consented SSI scheduling.
- Use `activeTab`: grants temporary access to the user's active tab, which is the wrong context for inactive collection.

## 10. Release Authentication

**Decision**: Disable SocialEdge account authentication unconditionally in the current release: do not load `auth.js`, do not initialize `Auth`, remove identity/OAuth manifest entries, and delete legacy `_se_session` during upgrade. Keep the server development-only. A future change must supply HTTPS, production provider configuration, verified identities, short-lived access tokens, rotating/revocable refresh sessions, server logout, restricted CORS, no default secrets, and protected plan administration before release enablement.

**Rationale**: The current hidden UI still loads auth and may call `http://localhost:3000` with a legacy token. The backend uses a default secret, permissive CORS, 90-day stateless tokens, and no revocation. Hiding the UI is not equivalent to disabling the behavior.

**Alternatives considered**:

- Runtime UI flag only: still ships permissions, insecure endpoint code, and startup token verification.
- Harden and enable auth in this feature: depends on external production infrastructure/configuration not currently available and is outside the production-readiness milestone.
- Remove the development server: unnecessary for extension hardening and may discard future work.

## 11. Test Architecture

**Decision**: Extract pure policy, schema, migration, and message validation functions for `node:test`; add Puppeteer-controlled Chrome tests for service-worker/network/tab/storage lifecycle; keep current Python tests; and reserve a dedicated test LinkedIn account for a final manual smoke matrix only. CI never uses personal or live LinkedIn credentials.

**Rationale**: Existing extension checks are source substring assertions and cannot prove TTL, credential eviction, tab preservation, migration, or termination behavior. Chrome documents loading and testing extensions with Puppeteer and explicitly covers service-worker termination testing ([Testing extensions with Puppeteer](https://developer.chrome.com/docs/extensions/how-to/test/puppeteer), [service-worker termination test](https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer)).

**Alternatives considered**:

- Python static tests only: fast but cannot exercise Chrome events or race conditions.
- Live LinkedIn end-to-end CI: brittle, credential-sensitive, and likely to trigger anti-automation controls.
- Add a full application test framework: unnecessary; `node:test` plus Puppeteer is sufficient.

## 12. Safe Rendering of Collected Values

**Decision**: Validate collected strings, numbers, arrays, and URLs before persistence, allow only expected LinkedIn HTTPS URLs for job/profile links and safe image schemes, and render collected text with text nodes/properties rather than HTML interpolation.

**Rationale**: Current Jobs UI inserts LinkedIn-derived title, company, location, image URL, and link into `innerHTML`. Data minimization does not prevent stored DOM injection; schema validation and safe rendering are both required.

**Alternatives considered**:

- Escape strings before templates: workable but easier to apply inconsistently.
- Trust LinkedIn responses: upstream or compromised page content is outside the extension's trust boundary.
- Remove Jobs: exceeds the requested scope.
