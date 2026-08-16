# Feature Specification: Security Hardening

**Feature Branch**: `feat/ssi-research`

**Created**: 2026-08-11

**Status**: Draft

**Input**: User description: "Harden LinkedIn session access, collection behavior, data storage, permissions, account security, testing, and privacy documentation. Treat the first five items in the suggested sequence as the production-readiness milestone."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Control LinkedIn Session Use (Priority: P1)

As a user, I can decide when SocialEdge accesses my LinkedIn session, so installing or starting the extension does not silently make LinkedIn requests and any automatic refresh is an explicit choice.

**Why this priority**: Session access carries the highest privacy and account-security risk. User initiation or explicit consent must precede LinkedIn activity.

**Independent Test**: Install or restart SocialEdge with automatic refresh disabled, observe startup and scheduled events, then initiate a feature manually and verify that only the manual action causes LinkedIn access.

**Acceptance Scenarios**:

1. **Given** a new or upgraded installation with default settings, **When** SocialEdge starts or a scheduled event occurs, **Then** it makes no session-backed LinkedIn request.
2. **Given** automatic refresh is disabled, **When** the user requests analytics, profile tips, jobs, or another LinkedIn-derived result, **Then** the request begins only after that action.
3. **Given** the user explicitly enables automatic refresh under the current consent version after seeing its explanation, **When** a scheduled refresh becomes due, **Then** only the disclosed LinkedIn-derived features refresh; a missing or outdated version performs no request.
4. **Given** automatic refresh is enabled, **When** the user disables it, **Then** later startup and scheduled events make no session-backed LinkedIn requests.
5. **Given** cached request credentials receive an unauthorized or forbidden response, **When** SocialEdge handles the response, **Then** it deletes those credentials and does not reuse them.
6. **Given** SocialEdge cannot verify the active LinkedIn account, **When** it captures request headers or receives account-bound data, **Then** it retains no request context or new feature data and returns an actionable account-verification error.
7. **Given** SocialEdge verifies a different LinkedIn account, **When** it handles the account change, **Then** it deletes all data bound to the prior account, disables automatic refresh, and requires fresh user authorization before it stores or displays data for the new account.

---

### User Story 2 - Collect Without Disrupting Browsing (Priority: P1)

As a user, I can collect analytics, profile tips, and jobs without SocialEdge navigating, scrolling, or otherwise changing a tab I am using.

**Why this priority**: Hijacking an arbitrary tab breaks trust, can destroy user context, and can expose unintended page state.

**Independent Test**: Open unrelated and LinkedIn pages with unsaved position or form state, run each collector, and verify every existing user tab remains at the same address, scroll position, focus state, and content state.

**Acceptance Scenarios**:

1. **Given** one or more arbitrary user tabs are open, **When** analytics, profile tips, or jobs collection runs, **Then** none of those tabs is navigated, scrolled, focused, or repurposed.
2. **Given** no LinkedIn tab is open, **When** the user starts collection, **Then** collection either succeeds in a system-controlled context or fails safely with an actionable message, without changing an existing tab.
3. **Given** a system-controlled browsing context is required, **When** collection finishes, fails, times out, or is cancelled, **Then** that context is closed and never becomes the user's active tab.
4. **Given** the collection context closes unexpectedly, **When** SocialEdge detects the closure, **Then** it stops collection and reports a recoverable failure without affecting other tabs.
5. **Given** a LinkedIn request, temporary-tab load, or collection operation stops making progress, **When** its deadline expires, **Then** SocialEdge cancels the operation, closes its owned context, preserves the last valid snapshot, and returns `timeout`.

---

### User Story 3 - Minimize and Erase LinkedIn Data (Priority: P1)

As a user, I know SocialEdge retains only the LinkedIn-derived fields needed for its features, and I can erase that data or disconnect LinkedIn at any time.

**Why this priority**: Data minimization and effective deletion reduce the impact of accidental exposure and give users meaningful control.

**Independent Test**: Populate every LinkedIn-derived feature, inspect the retained data for prohibited raw content, invoke each deletion control, and verify the specified records and session-derived credentials are gone.

**Acceptance Scenarios**:

1. **Given** an SSI result has been collected, **When** it is retained, **Then** only the parsed fields required for history and display are stored; the complete raw response is not stored.
2. **Given** collection completes or fails, **When** diagnostic information is retained, **Then** it contains no captured page snippet, raw response, session credential, or unnecessary personal content.
3. **Given** LinkedIn-derived data exists, **When** the user selects Clear LinkedIn Data and confirms, **Then** stored headers, SSI history, analytics, activities, tips, jobs, cached LinkedIn identifiers, raw legacy data, and debug snippets are deleted, automatic refresh is disabled, and the user's non-LinkedIn preferences remain.
4. **Given** a LinkedIn connection exists, **When** the user selects Disconnect and confirms, **Then** the same LinkedIn-derived data is deleted, automatic refresh is disabled, and future LinkedIn access requires a new user action or reconnection.
5. **Given** an older installation contains the supported unversioned legacy shapes, **When** the upgraded version first runs, **Then** SocialEdge deletes stale credentials, raw/debug/session material, and account-derived records that lack a verified binding while preserving unrelated preferences.

---

### User Story 4 - Operate With Least Privilege (Priority: P2)

As a user, SocialEdge requests only the browser access necessary for active, documented features and does not directly inspect my LinkedIn cookies.

**Why this priority**: Reducing privileged access and inactive page code lowers attack surface and makes the extension's behavior easier to trust.

**Independent Test**: Review the release package and exercise every supported feature to verify cookie access and inactive interception/relay capabilities are absent, unnecessary privileges are removed, and remaining capabilities have a documented use.

**Acceptance Scenarios**:

1. **Given** the release package is installed, **When** its requested access is reviewed, **Then** it requests no direct browser-cookie access.
2. **Given** analytics and profile tips are used, **When** they collect data, **Then** they do not read or retain the LinkedIn session cookie value.
3. **Given** inactive interception or message-relay code has no required user-facing function, **When** the release package is built, **Then** that code and its associated access are absent.
4. **Given** any page messaging capability remains necessary, **When** a message is received, **Then** unrecognized senders, origins, actions, payloads, and response shapes are rejected.
5. **Given** the release package's tab, page, sign-in, and externally accessible resource privileges are audited, **When** a privilege is not necessary for a supported feature, **Then** it is removed.

---

### User Story 5 - Ship Only Safe Account Authentication (Priority: P2)

As a release user, I am not exposed to unfinished SocialEdge account authentication, and any enabled authentication has clear, secure expiration and logout behavior.

**Why this priority**: An unfinished or insecure account flow can expose account tokens independently of LinkedIn session protections.

**Independent Test**: Build the release configuration with legacy authentication state present and verify sign-in code, insecure endpoints, identity privileges, placeholder provider configuration, and legacy tokens are absent; review the re-enable gate for transport, provider, expiry, revocation, and logout requirements.

**Acceptance Scenarios**:

1. **Given** the authentication service lacks trusted encrypted transport or production identity-provider configuration, **When** a release build is produced, **Then** SocialEdge account sign-in is unavailable.
2. **Given** a change proposes enabling production authentication, **When** the release is reviewed, **Then** approval is blocked unless bounded token expiry, server-side session revocation, and logout behavior are implemented and tested.
3. **Given** the release contains legacy authentication state, **When** upgrade migration runs, **Then** local authentication material is removed without contacting the unfinished service.

---

### User Story 6 - Understand Privacy Behavior (Priority: P3)

As a user or reviewer, I can understand exactly what LinkedIn information SocialEdge reads, stores, retains, exports, and deletes, including what automatic refresh does.

**Why this priority**: Accurate documentation supports informed consent and makes the hardened behavior auditable.

**Independent Test**: Compare the privacy documentation with observed behavior for each LinkedIn-derived feature, export, deletion control, and automatic-refresh state.

**Acceptance Scenarios**:

1. **Given** a user reviews the privacy documentation, **When** they inspect a LinkedIn-derived feature, **Then** they can identify the data read, retained fields, retention behavior, export behavior, and applicable deletion control.
2. **Given** automatic refresh is offered, **When** the user considers enabling it, **Then** the explanation identifies what runs, when it runs, which LinkedIn data it accesses, and how to disable it.
3. **Given** the release behavior changes, **When** the product is prepared for release, **Then** documentation is checked against the release and contains no known material mismatch.

### Edge Cases

- Cached request credentials expire while a collection is already in progress.
- LinkedIn logs out, changes login state, or returns an unauthorized or forbidden response between collection steps.
- The user switches between multiple LinkedIn accounts while cached identifiers or history exist.
- No LinkedIn tab is open, or all browser windows are closed except the extension interface.
- LinkedIn returns partial data, malformed data, a service error, or no response before the timeout.
- A system-controlled collection context is manually closed during collection.
- The user clears or disconnects while collection or migration is in progress.
- Upgrade cleanup encounters partially migrated or corrupt legacy records.
- Automatic refresh becomes due after consent is revoked or after the active LinkedIn account changes.
- A retained message relay receives a valid-looking payload from an unapproved sender or origin.

## Requirements *(mandatory)*

### Functional Requirements

#### Production-Readiness Milestone

- **FR-001**: SocialEdge MUST retain only the minimum request credentials required for approved LinkedIn-derived features.
- **FR-002**: Retained request credentials MUST expire automatically no later than 24 hours after capture and MUST not be used after expiration.
- **FR-003**: SocialEdge MUST replace expired request credentials only as a natural consequence of a user-authorized LinkedIn request or an explicitly enabled automatic refresh; it MUST NOT perform a separate background request solely to keep credentials fresh.
- **FR-004**: SocialEdge MUST immediately clear retained request credentials after an unauthorized or forbidden LinkedIn response.
- **FR-005**: Startup, installation, upgrade, and scheduled events MUST NOT make session-backed LinkedIn requests by default.
- **FR-006**: LinkedIn-derived requests MUST occur only after a user action unless the user has explicitly enabled automatic refresh through a control that explains its behavior.
- **FR-007**: Users MUST be able to disable automatic refresh at any time, and disabling it MUST prevent subsequent startup and scheduled LinkedIn requests.
- **FR-008**: Analytics and Profile Tips MUST operate without directly reading or retaining a LinkedIn session cookie value.
- **FR-009**: The release package MUST request no browser capability that permits direct cookie access.
- **FR-010**: Analytics, Profile Tips, and Jobs MUST NOT navigate, scroll, focus, or repurpose an arbitrary existing user tab.
- **FR-011**: When collection requires a browser-rendered page, SocialEdge MUST use a dedicated, inactive, system-controlled context and MUST close it after success, failure, timeout, cancellation, or unexpected termination where closure remains possible.
- **FR-012**: Collection MUST fail safely and provide an actionable user message when a required context cannot be created, closes early, or times out. SocialEdge MUST cap each LinkedIn request wait at 15 seconds, each temporary-tab load wait at 20 seconds, and each complete collection operation at 45 seconds. The 45-second operation deadline includes requests, navigation, rendering, parsing, and cleanup. At expiry, SocialEdge dispatches tab closure without waiting beyond the deadline and retains unconfirmed ownership for startup reconciliation.
- **FR-013**: SocialEdge MUST store only parsed SSI fields required to present results and history, not complete raw SSI responses.
- **FR-014**: SocialEdge MUST NOT retain captured page snippets, complete page content, session secrets, complete raw service responses, or debug data not required for user-visible operation.
- **FR-015**: Upgrade migration MUST handle every key and shape in the Supported Legacy Inventory. It MUST delete stale request credentials, raw/debug/session material, and unbound account-derived records while preserving unrelated user preferences. An unrecognized shape under an inventoried LinkedIn key MUST be deleted and MUST NOT block migration.
- **FR-016**: Users MUST have a clearly discoverable Clear LinkedIn Data action with confirmation before deletion.
- **FR-017**: Clear LinkedIn Data MUST delete retained request credentials, SSI history, analytics, activities, profile tips, jobs, cached LinkedIn identifiers, and prohibited legacy/debug data; disable automatic refresh; prevent late writes; and preserve non-LinkedIn preferences.
- **FR-018**: Users MUST have a clearly discoverable Disconnect action with confirmation before deletion.
- **FR-019**: Disconnect MUST perform all Clear LinkedIn Data deletion, disable automatic refresh, remove connection state, and require a new user action or reconnection before future LinkedIn access.
- **FR-020**: The production-readiness milestone MUST include FR-001 through FR-019 and their acceptance coverage before the release is considered production-ready.

#### Follow-Up Hardening

- **FR-021**: Inactive page interception and message-relay capabilities MUST be removed from the release package unless a current, documented feature requires them.
- **FR-022**: If page messaging is retained, SocialEdge MUST allow only explicitly approved senders, origins, actions, request fields, and response fields and MUST reject all other messages without privileged side effects.
- **FR-023**: Every requested privilege related to tabs, cookies, page access, SocialEdge account sign-in, and externally accessible resources MUST map to a current documented feature; privileges without such a mapping MUST be removed.
- **FR-024**: Unfinished SocialEdge account authentication MUST be disabled in release builds until trusted encrypted transport and production identity-provider configuration are both available.
- **FR-025**: Before SocialEdge account authentication is enabled in a release, authentication material MUST have a defined expiration, MUST cease authorizing activity after expiration, and MUST be removed locally on logout.
- **FR-026**: Controlled integration coverage MUST include expired LinkedIn sessions, logout and login changes, multiple LinkedIn accounts, no open LinkedIn tab, service errors, malformed responses, timeouts, and collection-context closure.
- **FR-027**: Account changes MUST invalidate request credentials, disable automatic refresh, and delete all data bound to the prior account before data from the newly active account is collected or displayed. Every new LinkedIn-derived record MUST contain the verified active account binding. The new account requires fresh user authorization. If account identity cannot be verified, SocialEdge MUST fail closed and MUST NOT collect, merge, store, or display new account-bound data.
- **FR-028**: Privacy documentation MUST identify, for every LinkedIn-derived feature, what data is read, which fields are stored, how long or under what condition data is retained, what is exported, and what each deletion action removes.
- **FR-029**: Privacy documentation and the automatic-refresh consent control MUST clearly explain its default-off state, triggers, accessed data, affected features, and disable procedure.
- **FR-030**: Release approval MUST include verification that product behavior, requested privileges, deletion behavior, and privacy documentation materially agree.

### Key Entities *(include if feature involves data)*

- **Request Credential Cache**: The minimum session-derived request values needed for an approved LinkedIn request, with capture time, expiration time, and a verified minimal account binding; excludes direct cookie values. SocialEdge may stage captured headers only inside the active operation while it verifies identity. It MUST NOT write or use a session request context without the verified binding.
- **Automatic Refresh Preference**: The user's explicit enabled/disabled choice, exact consent/disclosure version, disclosed feature scope, and consent timestamp. A missing or outdated consent version means disabled.
- **LinkedIn Account Identity**: The minimum cached identifier needed to prevent data from different LinkedIn accounts being mixed; removed by clear and disconnect actions.
- **SSI History Entry**: Parsed SSI measurements, collection time, and verified account binding needed for display or comparison; excludes the complete raw response.
- **LinkedIn-Derived Feature Data**: Stored analytics, activities, profile tips, jobs, and quest state with a verified account binding plus the timestamps or identifiers needed to present those features.
- **Collection Context**: A temporary, inactive context controlled by SocialEdge for collection that cannot be satisfied without rendered content; it is not a user-owned tab and is not retained after collection.
- **Legacy Sensitive Data**: The exact unversioned keys and shapes listed in the Supported Legacy Inventory. Account-derived legacy records have no trustworthy binding and are deleted during migration.
- **Supported Legacy Inventory**: The unversioned shapes for `ssiExactHeaders`, `ssiHistory`, `liAnalytics`, `liAnalyticsHistory`, `dailyActivities`, `_se_dailyQuest`, `_se_questHistory`, `_se_questSeen`, `profileTips`, `jobSuggestions`, `_se_session`, `_se_autoRefresh`, `_se_linkedInConnection`, `theme`, and `_se_onboardDone`. `contracts/storage-and-deletion.md` defines each accepted shape and action; this release supports no other prior schema.
- **SocialEdge Authentication Material**: Account sign-in state with defined issue, expiration, and logout invalidation behavior; distinct from LinkedIn-derived session data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested default installations, restarts, upgrades, and scheduled events, no session-backed LinkedIn request occurs before user action.
- **SC-002**: In 100% of tested unauthorized and forbidden response cases, retained request credentials are deleted before another LinkedIn request can reuse them.
- **SC-003**: In 100% of analytics, profile-tips, and jobs collection tests, existing user tabs retain their address, scroll position, focus state, and user-entered state.
- **SC-004**: Inspection after each supported collection flow finds zero complete raw SSI responses, captured page snippets, direct cookie values, session secrets, or excessive debug payloads in retained data.
- **SC-005**: Under the Controlled Performance Profile, Clear LinkedIn Data and Disconnect each remove 100% of assigned LinkedIn-derived data within 5 seconds. A test operator can complete either flow, including confirmation, within 30 seconds.
- **SC-006**: Upgrade testing covers 100% of keys and shapes in the Supported Legacy Inventory, deletes each prohibited or unbound value, deletes malformed values under inventoried LinkedIn keys, and preserves unrelated preferences.
- **SC-007**: The production-readiness milestone passes all acceptance scenarios and controlled session tests associated with FR-001 through FR-020, with no unresolved critical or high-severity security finding.
- **SC-008**: Every release privilege and externally exposed resource has a documented, currently exercised feature justification; the audit finds zero unnecessary privileges.
- **SC-009**: All required session integration scenarios complete with a deterministic success or user-visible recoverable failure within the applicable 15-second request, 20-second tab-load, and 45-second operation deadlines, with zero cross-account data mixing and zero lasting changes to arbitrary user tabs.
- **SC-010**: In a documentation review, reviewers can correctly identify the read, stored, retained, exported, and deleted data for every LinkedIn-derived feature and the effects of automatic refresh, with 100% agreement between documented and observed behavior.
- **SC-011**: Unfinished SocialEdge authentication is unavailable in 100% of release builds until every account-security prerequisite is met.

### Controlled Performance Profile

- Run Chrome 116 or newer in a clean test profile with at least two logical CPU cores and 4 GiB of available memory, no CPU or network throttling, and the extension's local fixture interception enabled.
- Seed 365 SSI entries, 365 analytics entries, every current feature and activity/quest key, every identified legacy key, automatic-refresh consent, connection state, a verified session request context, and one collection operation whose fixture response remains pending until cancellation.
- Measure the five-second deletion interval from service-worker acceptance of a confirmed request until the response resolves and local plus session storage expose none of the assigned data.
- Measure the 30-second operator flow from the moment the privacy controls render until the success status appears after confirmation. Run Clear and Disconnect three times each; every run must pass. The release checklist records Chrome version, operating system, available CPU/memory, elapsed time, and seeded record counts.

## Assumptions

- The production-readiness milestone follows the first five items in the suggested sequence: header expiration and automatic-request policy; removal of cookie access; replacement of tab-navigation collectors; minimized storage plus migration cleanup; and clear/disconnect controls.
- Request credentials are considered short-lived and expire no later than 24 hours after capture; an earlier natural service expiration or security event takes precedence.
- Automatic refresh is an SSI-only opt-in preference for this release and remains off for new and upgraded installations unless verifiable consent meets the current disclosure standard.
- SocialEdge supports one verified LinkedIn account at a time. A verified account change deletes the prior account's SSI, analytics, activities, quests, profile tips, and jobs, disables automatic refresh, and requires fresh authorization before new account data is stored or displayed.
- Clear LinkedIn Data preserves non-LinkedIn display and product preferences but disables automatic refresh. Disconnect also removes connection state and requires reconnection.
- A confirmation step is appropriate for Clear LinkedIn Data and Disconnect because deletion is not locally reversible.
- A dedicated temporary context is permitted only when a user-authorized collection cannot be completed without rendered page content; direct background collection is preferred from a user-experience perspective.
- Diagnostic event names, timestamps, and non-sensitive error categories may be retained when needed for operation, but payloads and page content are excluded.
- Exported data, if an export feature exists, must contain only the minimized user-visible fields documented for export.
- SocialEdge account authentication is separate from access to the user's LinkedIn session and may remain unavailable without blocking local LinkedIn-derived features.
- The SocialEdge Constitution v1.0.0 governs this feature. Its user-access, least-privilege, minimization, test-first, and fail-closed rules are mandatory release gates.
