# Phase 1 Data Model: Security Hardening

## Storage Areas

- **Session storage**: verified request credentials plus the collection epoch and owned temporary-tab IDs needed for restart cleanup. Cleared by browser/session lifecycle and security events.
- **Local storage**: minimized feature data, preferences, consent, connection metadata, and migration version.
- **Worker memory**: in-flight operation details and staged, unverified header capture. Durable correctness must not depend on this state surviving worker termination.

## Entity: LinkedIn Request Context

**Storage key**: `_se_linkedInRequestContext` in session storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `schemaVersion` | integer | yes | Exact supported version |
| `headers` | object | yes | Only `accept`, `csrf-token`, `x-li-lang`, `x-restli-protocol-version`; string values; no cookie or authorization |
| `capturedAt` | integer | yes | Finite Unix milliseconds, not materially in the future |
| `expiresAt` | integer | yes | Greater than `capturedAt`; no more than 24 hours later |
| `accountBinding` | string | yes | Verified minimal opaque account identifier; bounded length; never cookie-derived |
| `authorizedBy` | enum | yes | `manual` or `automatic` |
| `featureScope` | array | yes | Non-empty subset of `ssi`, `analytics`, `profileTips`, `jobs` |

**State transitions**:

```text
absent -> staged in operation memory (authorized natural capture)
staged -> valid (account identity verified; bound context committed to session storage)
staged -> absent (identity unavailable or mismatched)
valid -> valid (authorized replacement with same account)
valid -> expired (time limit)
valid -> invalidated (401/403, account change, consent revocation, clear, disconnect)
expired/invalidated -> absent (read cleanup)
```

Expired, malformed, unknown-header, unbound, wrong-account, or unauthorized values are deleted before use. Staged headers never enter session storage and cannot authorize a request before account verification.

## Entity: Automatic Refresh Preference

**Storage key**: `_se_autoRefresh` in local storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `schemaVersion` | integer | yes | Exact supported version |
| `enabled` | boolean | yes | Defaults to `false`; missing/invalid means false |
| `features` | array | yes | For this release, empty when disabled and exactly `ssi` when enabled |
| `consentedAt` | integer/null | yes | Required timestamp when enabled; null when disabled |
| `consentVersion` | string/null | yes | Exact current disclosure version when enabled |

**State transitions**:

```text
missing/legacy -> disabled
disabled -> enabled (explicit UI consent)
enabled -> disabled (user action, disconnect, disclosure version change)
```

Enabling never triggers an immediate request unless the same UI action explicitly asks for one.

## Entity: LinkedIn Connection State

**Storage key**: `_se_linkedInConnection` in local storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `schemaVersion` | integer | yes | Exact supported version |
| `status` | enum | yes | `connected`, `verification_required`, or `disconnected` |
| `accountBinding` | string/null | yes | Minimal opaque identifier; null when disconnected/unverified |
| `verifiedAt` | integer/null | yes | Last successful user-authorized account verification |

Account mismatch moves the state to `verification_required`, removes request context, and deletes all local LinkedIn-derived data carrying the prior binding before any new write or display. Disconnect removes the entity after disabling consent.

## Entity: SSI History Entry

**Storage key**: `ssiHistory` in local storage; maximum 365 entries

| Field | Type | Required | Rules |
|---|---|---:|---|
| `date` | string | yes | Local calendar date `YYYY-MM-DD`; unique per account/date in current single-account scope |
| `collectedAt` | integer | yes | Finite Unix milliseconds |
| `accountBinding` | string | yes | Must match the verified connection state |
| `parsed` | object | yes | Allowlisted score projection below |

`parsed` contains nullable finite numbers for `overall`, `prof_brand`, `find_right_people`, `insight_engagement`, and `relationship`; `industry` and `network` contain only their displayed score/rank/group-size/name and four displayed pillar values. Score ranges are validated (overall 0–100; pillars 0–25; ranks/group sizes non-negative). No `raw` field is allowed.

## Entity: Analytics State

**Storage keys**: `liAnalytics` and `liAnalyticsHistory` in local storage; history maximum 365 entries

- Current state: `schemaVersion`, required `accountBinding`, and groups `network`, `dashboard`, `content`; each group has a collection timestamp and allowlisted nullable numeric metrics.
- Daily history: `date`, `collectedAt`, required `accountBinding`, and allowlisted numeric fields: followers, connections, profile views, search appearances, impressions, engagements.
- Counts are finite non-negative integers. No snippets, response bodies, DOM text, or raw API objects are allowed.

## Entity: Activity and Quest State

**Storage keys**: `dailyActivities`, `_se_dailyQuest`, `_se_questHistory`, `_se_questSeen`

- Daily activities use a root object with `schemaVersion`, required `accountBinding`, and a `days` map from local date to four pillar arrays of booleans with the catalog's exact lengths.
- Each quest root contains `schemaVersion`, required `accountBinding`, and only catalog IDs, labels, pillar, difficulty, completion/dismissal state, and dates.
- These keys are treated as LinkedIn feature data for Clear and Disconnect because the feature request explicitly includes activities.

## Entity: Profile Tips Snapshot

**Storage key**: `profileTips` in local storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `collectedAt` | integer | yes | Finite Unix milliseconds |
| `date` | string | yes | Local date |
| `accountBinding` | string | yes | Matches verified account |
| `sections` | object | yes | Exact known section names; status `missing`, `weak`, or `complete`; bounded numeric counts/lengths only |
| `tips` | array | yes | Maximum 10 allowlisted/generated tip records with bounded text |
| `score` | object | yes | Total, complete, weak, missing, percentage; internally consistent |

The profile slug, headline/about text, page title, selector diagnostics, HTML samples, API keys/types, and `debug` are prohibited.

## Entity: Job Suggestions Snapshot

**Storage key**: `jobSuggestions` in local storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `collectedAt` | integer | yes | Finite Unix milliseconds |
| `date` | string | yes | Local date |
| `accountBinding` | string | yes | Matches verified account |
| `jobs` | array | yes | Maximum 10 validated job projections |

Each job contains a bounded ID, title, company, location, canonical `https://www.linkedin.com/jobs/view/...` URL, optional safe HTTPS logo URL, bounded posted-time label, and boolean remote/hybrid flag. `debug`, page title/URL, DOM counts, and sample links are prohibited.

## Entity: Storage Schema State

**Storage key**: `_se_dataSchemaVersion` in local storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `version` | integer | yes | Monotonic supported version |
| `migratedAt` | integer | yes | Written only after the full migration succeeds |

Migration is idempotent. The current unversioned account-derived records lack a trustworthy account binding, so migration deletes them instead of assigning them to the active browser session. Migration also removes `ssiExactHeaders`, raw/debug/snippet/session material including `_se_session`, and malformed values under inventoried LinkedIn keys. It defaults automatic refresh off unless current-version consent is verifiable and preserves `theme` plus `_se_onboardDone`. `contracts/storage-and-deletion.md` defines the complete supported legacy inventory.

## Entity: Collection Operation

**Storage**: operation details in worker memory; global epoch and owned temporary-tab IDs in session storage

| Field | Type | Required | Rules |
|---|---|---:|---|
| `operationId` | string | yes | Unique unpredictable identifier |
| `epoch` | integer | yes | Must equal current global epoch before any write |
| `feature` | enum | yes | `ssi`, `analytics`, `profileTips`, or `jobs` |
| `authorization` | enum | yes | `manual` or consented `automatic` |
| `startedAt` | integer | yes | Monotonic-clock origin for the operation |
| `operationDeadline` | integer | yes | Exactly 45 seconds after `startedAt` |
| `activeWaitDeadline` | integer/null | yes | At most 15 seconds for a request or 20 seconds for a tab load; never later than `operationDeadline` |
| `temporaryTabId` | integer/null | yes | Only an extension-created inactive tab |
| `state` | enum | yes | `created`, `collecting`, `succeeded`, `failed`, `cancelled`, `timed_out`, `context_closed` |

Clear and Disconnect increment the session-backed epoch and close every known owned tab. An operation whose epoch is stale may return an error but may not persist data. Deadline expiry moves the operation to `timed_out`, dispatches tab closure, and leaves unconfirmed ownership in session storage. On worker start, the registry closes session-tracked orphan tabs, clears their ownership records, and rejects results from an earlier epoch. No user tab is ever adopted as owned.

## Entity: SocialEdge Authentication Material

**Legacy storage key**: `_se_session`

This entity is prohibited in the release extension and deleted by migration. Future account authentication is outside the active release data model until the release-security contract is satisfied.

## Deletion Relationships

```text
Clear LinkedIn Data
├── LinkedIn Request Context
├── LinkedIn Connection State
├── Automatic Refresh Preference -> disabled/removed
├── SSI History
├── Analytics State
├── Activity and Quest State
├── Profile Tips Snapshot
└── Job Suggestions Snapshot

Disconnect LinkedIn
├── everything in Clear LinkedIn Data
└── connection/reconnection state -> removed

Preserved by both
├── theme
├── onboarding completion
└── unrelated extension preferences
```
