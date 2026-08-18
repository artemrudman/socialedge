# Runtime Message Contract

## Trust Boundary

The service worker accepts messages only from its own extension ID and an allowlisted `chrome-extension://<runtime-id>/` page. Page/content-script senders, external extensions, non-top-level frames where not expected, missing sender metadata, and unknown actions are rejected before any privileged operation.

Every request is a plain JSON object with exactly the fields documented for its action. Unknown fields, wrong types, overlong strings, unexpected arrays/objects, and non-finite numbers are invalid. Removed page-relay actions (`captureHeaders`, `storeSSI`, `storeAnalytics`) must never be accepted.

## Response Envelope

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "stable_machine_code",
    "message": "Safe user-facing message",
    "retryable": false
  }
}
```

Responses never contain cookie/header values, response bodies, raw service payloads, page snippets, stack traces, selector/debug samples, or account identifiers not already needed by the UI.

## Collection Deadlines

- Each LinkedIn request wait ends after 15 seconds.
- Each temporary-tab load wait ends after 20 seconds.
- Each collection operation ends after 45 seconds, including request, rendering, parsing, and cleanup work. The operation deadline overrides a nested deadline that would end later.
- A deadline expiry returns `timeout`, dispatches owned-tab cleanup, preserves the last valid snapshot, and blocks writes from the expired operation. If Chrome does not confirm tab closure before the operation ends, session ownership remains for startup reconciliation.
- Identity verification failure returns `account_unverified`, clears staged and stored request context, and stores no account-bound result.
- Verified account mismatch returns `account_changed` after the worker deletes prior bound LinkedIn data, disables automatic refresh, and blocks new account writes, display, startup access, and alarm access pending fresh authorization.

## Security-Hardening Actions

### `fetchNow`

Request:

```json
{ "action": "fetchNow" }
```

Starts a manual SSI collection. Success `data` contains the minimized SSI entry. It may create an inactive temporary context when no safe existing API context can satisfy the request; it may not navigate or scroll a user tab.

### `fetchAnalytics`

Request:

```json
{ "action": "fetchAnalytics" }
```

Starts manual analytics collection. Success `data` contains current minimized analytics groups, never a raw response.

### `fetchProfileTips`

Request:

```json
{ "action": "fetchProfileTips" }
```

Starts manual Profile Tips collection. Success `data` follows the Profile Tips Snapshot model without slug or debug fields.

### `fetchJobs`

Request:

```json
{ "action": "fetchJobs" }
```

Starts manual Jobs collection. Success `data` follows the Job Suggestions Snapshot model without debug fields.

### `getPrivacySettings`

Request:

```json
{ "action": "getPrivacySettings" }
```

Success data:

```json
{
  "automaticRefresh": {
    "enabled": false,
    "features": [],
    "consentVersion": null
  },
  "connectionStatus": "disconnected",
  "hasLinkedInData": false
}
```

No cached account or credential value is returned.

### `setAutomaticRefresh`

Enable request:

```json
{
  "action": "setAutomaticRefresh",
  "enabled": true,
  "consentVersion": "privacy-v1",
  "features": ["ssi"]
}
```

Disable request:

```json
{
  "action": "setAutomaticRefresh",
  "enabled": false
}
```

The enable request succeeds only for the exact current disclosure version and supported feature scope. Disabling clears any automatically authorized request context. Success returns the public automatic-refresh preference.

### `clearLinkedInData`

Request:

```json
{ "action": "clearLinkedInData", "confirmed": true }
```

`confirmed` must be exactly `true`; the UI obtains confirmation immediately before sending. Success data contains only deletion categories and duration, for example:

```json
{
  "deleted": ["credentials", "ssi", "analytics", "activities", "tips", "jobs", "identifiers"],
  "automaticRefreshEnabled": false
}
```

Clear cancels current collection, prevents late writes, and disables automatic refresh. Automatic access requires a fresh explicit opt-in.

### `disconnectLinkedIn`

Request:

```json
{ "action": "disconnectLinkedIn", "confirmed": true }
```

Success data:

```json
{
  "deleted": ["credentials", "ssi", "analytics", "activities", "tips", "jobs", "identifiers"],
  "automaticRefreshEnabled": false,
  "connectionStatus": "disconnected"
}
```

Disconnect cancels current collection, disables consent, and requires a new manual action or explicit reconnection before LinkedIn access.

## Read and Existing UI Actions

The existing read/actions remain allowlisted only when their exact schemas are defined in code:

- `getHistory`, `getAnalytics`, `getProfileTips`, `getJobs`, `getDailyQuest`, `getStreak`: no additional request fields.
- `updateQuestItem`: exact `itemId` catalog identifier and boolean `done`.
- `swapQuestItem`: exact `itemId` catalog identifier.
- `dismissQuest`: no additional request fields.

All use the normalized response envelope. Read actions return only entities defined in `data-model.md`.

## Stable Error Codes

| Code | Meaning | Retryable |
|---|---|---:|
| `invalid_sender` | Sender is outside the trusted extension UI | no |
| `invalid_request` | Action or schema is invalid | no |
| `not_authorized` | No manual operation or automatic consent authorizes access | no |
| `session_expired` | LinkedIn returned 401/403; request context was cleared | yes, after login |
| `account_changed` | Active account differs; cached context was invalidated | no, reconnect required |
| `no_context` | No safe request context can be created | yes |
| `context_closed` | Owned temporary tab closed during collection | yes |
| `timeout` | Bounded collection wait expired | yes |
| `service_error` | LinkedIn returned a non-auth service failure | yes |
| `invalid_response` | Response failed the allowlisted projection schema | yes |
| `cancelled` | Clear/disconnect or a newer operation cancelled the work | yes |
| `migration_failed` | Safe storage migration did not complete | yes |
| `internal_error` | Safe fallback without internal details | yes |
