# Storage, Migration, and Deletion Contract

## Approved Persistent Keys

| Key | Category | Retention | Clear | Disconnect |
|---|---|---|---:|---:|
| `_se_dataSchemaVersion` | schema metadata | extension lifetime | preserve | preserve |
| `_se_autoRefresh` | consent | until changed | disable/remove | disable/remove |
| `_se_linkedInConnection` | account binding/status | until clear/disconnect/account change | remove | remove |
| `ssiHistory` | minimized SSI history | maximum 365 daily entries | remove | remove |
| `liAnalytics` | current parsed analytics | until replaced/cleared | remove | remove |
| `liAnalyticsHistory` | parsed analytics history | maximum 365 daily entries | remove | remove |
| `dailyActivities` | user activity history | until user deletion | remove | remove |
| `_se_dailyQuest` | current quest | daily | remove | remove |
| `_se_questHistory` | quest history | existing bounded policy | remove | remove |
| `_se_questSeen` | quest UI state | current quest/day | remove | remove |
| `profileTips` | current minimized tips | until replaced/cleared | remove | remove |
| `jobSuggestions` | current minimized jobs | until replaced/cleared | remove | remove |
| `theme` | unrelated preference | until changed | preserve | preserve |
| `_se_onboardDone` | unrelated preference | until walkthrough reset | preserve | preserve |

`_se_linkedInRequestContext` exists only in session storage and is removed by clear, disconnect, expiry, auth failure, account change, and consent invalidation.

No new persistent key may contain raw LinkedIn responses, full page/section text, HTML, request/response bodies, cookie values, authorization values, header maps, collector debug objects, or stack traces.

Every current-schema value under `ssiHistory`, `liAnalytics`, `liAnalyticsHistory`, `dailyActivities`, `_se_dailyQuest`, `_se_questHistory`, `_se_questSeen`, `profileTips`, and `jobSuggestions` carries the verified `_se_linkedInConnection.accountBinding` at its root or on each history entry. Validators reject missing or mismatched bindings before storage or display.

## Supported Legacy Inventory

The release supports migration from the current unversioned schema, represented by a missing or non-current `_se_dataSchemaVersion`. The migration handles this exact inventory:

| Legacy key | Recognized unversioned shape | Migration action |
|---|---|---|
| `ssiExactHeaders` | `{headers, ts}` | Delete the key without reading values into logs. |
| `ssiHistory` | Array of `{date, parsed, raw}` or partial variants | Delete the key because entries have no trustworthy account binding. |
| `liAnalytics` | Object with `network`, `dashboard`, or `content` metric groups and possible extra snippet/debug fields | Delete the key because the root has no trustworthy account binding. |
| `liAnalyticsHistory` | Array of daily metric snapshots with `ts`/`date` | Delete the key because entries have no trustworthy account binding. |
| `dailyActivities` | Date-keyed object containing pillar boolean arrays | Delete the key because the root has no trustworthy account binding. |
| `_se_dailyQuest` | `{date, items}` | Delete the key because the root has no trustworthy account binding. |
| `_se_questHistory` | Array of `{date, ids}` | Delete the key because entries have no trustworthy account binding. |
| `_se_questSeen` | Date string | Delete the key because the value has no trustworthy account binding. |
| `profileTips` | `{ts, date, slug, sections, tips, score, debug}` or partial variants | Delete the key because the record has no trustworthy account binding and may contain profile text/debug data. |
| `jobSuggestions` | `{ts, date, jobs, debug}` or partial variants | Delete the key because the record has no trustworthy account binding and may contain page/debug data. |
| `_se_session` | `{user, token}` or malformed/partial variants | Delete the key while release authentication is disabled. |
| `_se_autoRefresh` | Missing, boolean, or object without the current consent version | Replace with the current disabled form; never infer consent. |
| `_se_linkedInConnection` | Missing, malformed, or non-current object | Delete the key. |
| `theme` | String preference | Preserve without transformation. |
| `_se_onboardDone` | Boolean preference | Preserve without transformation. |

The migration deletes any unrecognized value under an inventoried LinkedIn/auth key. It preserves an unknown key outside this inventory and flags it during the pre-implementation storage audit; it never uses a prefix or `storage.local.clear()` to broaden deletion.

## Migration Properties

1. Runs before normal collection/message handling on worker initialization and on extension update.
2. Is idempotent: rerunning after any partial state produces the same approved schema.
3. Writes the new schema marker only after all transforms/removals succeed.
4. On failure, reports a safe error, leaves automatic LinkedIn access disabled, and retries next initialization.
5. Preserves unrelated preferences. It deletes unbound legacy history instead of assigning it to the active browser account.
6. Never logs migrated values or deleted payloads.

## Verified Account Change Transaction

1. Compare the newly verified binding with `_se_linkedInConnection.accountBinding`.
2. If they differ, increment the collection epoch and reject stale writes.
3. Remove `_se_linkedInRequestContext`, disable `_se_autoRefresh`, and remove all bound LinkedIn-derived local keys listed in the Approved Persistent Keys table, including activities and quests.
4. Set connection status to `verification_required` without retaining the prior binding.
5. Return `account_changed` after storage verification; accept no new account write, display, startup request, or alarm request.
6. Require fresh user authorization to establish the new bound connection, consent, and data.

## Clear LinkedIn Data Transaction

1. Validate trusted sender and confirmed request.
2. Increment collection epoch and mark all operations cancelled.
3. Close every tracked extension-owned temporary tab, ignoring already-closed errors.
4. Remove session request context.
5. Remove the approved LinkedIn-derived local keys listed in the table.
6. Disable/remove `_se_autoRefresh`; preserve `theme`, `_se_onboardDone`, and schema metadata.
7. Return deletion categories only after storage no longer exposes deleted values.
8. Any operation from the prior epoch must fail its pre-write check.

## Disconnect Transaction

Performs every Clear step and removes connection/reconnection state. Subsequent startup/alarm events are no-ops for LinkedIn access. A future automatic request requires fresh explicit opt-in.

## Deletion Timing Contract

The Controlled Performance Profile uses a clean, unthrottled Chrome 116 or newer profile with at least two logical CPU cores and 4 GiB of available memory. It seeds 365 SSI entries, 365 analytics entries, all other current and identified legacy categories, consent, connection/request state, and one collection operation whose fixture response remains pending until cancellation. Clear and Disconnect each have five seconds from service-worker request acceptance through response resolution and verified local/session removal. The confirmed UI flow has 30 seconds from rendered privacy controls through the success status. Run each action three times; every run must pass. Release evidence records the Chrome version, operating system, available CPU/memory, seed counts, and elapsed times.

## Export Contract

- Export schema version increments from the current raw-capable format.
- Export includes only minimized SSI history, user activity history, and the documented activity catalog unless another minimized category is explicitly added and documented.
- Export excludes request context, consent timestamps unless explicitly user-visible, account binding, raw/debug data, internal schema metadata, and SocialEdge authentication material.
- Exported SSI entries have no `raw` property under any input/migration path.
