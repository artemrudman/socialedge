# Privacy Policy for SocialEdge

Last updated: August 11, 2026

SocialEdge processes LinkedIn data inside your Chrome profile. The current release has no SocialEdge account sign-in and sends no LinkedIn-derived record to a SocialEdge server.

## LinkedIn session access

SocialEdge makes a LinkedIn request after you select Refresh Score, Analytics, Profile Tips, or Jobs. Startup, installation, upgrade, and scheduled alarms do not use your LinkedIn session by default.

You can enable Automatic SSI refresh in About. The current `privacy-v1` consent covers SSI only and lets the daily alarm start an SSI collection. The switch starts off. You can turn it off in the same panel. Clear LinkedIn Data and Disconnect LinkedIn turn it off and require fresh consent before another scheduled request.

Chrome attaches your LinkedIn cookies to same-origin requests. SocialEdge does not read or store cookie values. During an authorized operation it may capture four request headers: `accept`, `csrf-token`, `x-li-lang`, and `x-restli-protocol-version`. SocialEdge stores a verified account-bound request context in Chrome session storage for up to 24 hours. It removes the context after expiry, a 401 or 403 response, account change, clear, or disconnect.

## Feature data

| Feature | Data read | Data stored | Retention | Export |
|---|---|---|---|---|
| SSI | Overall score, four pillar scores, and displayed industry/network score and rank fields | Date, collection time, verified account binding, and those parsed fields | Up to 365 daily entries; clear, disconnect, or account change removes them sooner | Minimized entries without account binding |
| Analytics | Supported follower, connection, profile-view, search-appearance, impression, and engagement counts | Current parsed groups and up to 365 daily parsed snapshots with account binding | Until replaced or deleted; history stays within 365 daily entries | Excluded from the current export |
| Activities and daily tasks | Checkboxes you select and task catalog choices | Account-bound daily booleans, task IDs/labels, completion state, and dates | Until clear, disconnect, or account change; task history stays bounded | Daily activity history and the documented catalog, without account binding |
| Profile Tips | Profile section completeness measurements needed to score the supported sections | Section status/counts, up to ten tip records, summary score, date, and account binding | Latest snapshot until deletion or account change | Excluded |
| Jobs | Up to ten displayed job cards | Job ID, title, company, location, LinkedIn job URL, optional HTTPS logo URL, posted label, remote flag, date, and account binding | Latest snapshot until deletion or account change | Excluded |

SocialEdge does not retain complete SSI or service responses, response bodies, page snippets, HTML, full page content, profile headline/about text, profile slugs, cookie values, authorization values, request-header logs, selector samples, stack traces, or collector debug payloads.

## Account boundaries

SocialEdge supports one verified LinkedIn account at a time. It adds a minimal opaque account binding to each LinkedIn-derived record. It does not expose that binding in export.

If SocialEdge verifies a different account, it removes the prior account's request context, SSI, analytics, activities/tasks, tips, and jobs. It also disables automatic refresh. You must start a new manual collection before SocialEdge stores data for the new account. If SocialEdge cannot verify the account, it stores no new request context or LinkedIn-derived data.

## Temporary collection tabs

SocialEdge runs structured requests in a LinkedIn context without changing your tab. A feature that needs rendered content uses an extension-owned tab created with `active: false`. SocialEdge tracks the tab and closes it after success, failure, timeout, cancellation, or worker recovery. It does not navigate, scroll, focus, or restore a tab you already own.

Each LinkedIn request stops after 15 seconds, a temporary tab load stops after 20 seconds, and the full operation stops after 45 seconds. A failed operation keeps the previous valid snapshot.

## Storage

Chrome local storage holds minimized feature records, the connection state, automatic-refresh choice, and schema marker. Chrome session storage holds request context plus temporary-tab ownership and collection epoch state. Browser restart, extension update, clear, disconnect, authentication failure, account change, and TTL rules can remove session data before the 24-hour limit.

SocialEdge preserves theme and onboarding completion when you clear or disconnect. Chrome controls extension storage deletion after uninstall.

## Export

Export schema version 2 includes minimized SSI history, daily activities, and the activity catalog. It excludes account bindings, request context, consent timestamps, internal schema metadata, analytics, tips, jobs, raw responses, debug data, and SocialEdge authentication material.

## Delete or disconnect

Open About and use one of these confirmed actions:

- **Clear LinkedIn Data** cancels collection, closes owned tabs, removes LinkedIn request context, identifiers, SSI, analytics, activities/tasks, tips, and jobs, and disables automatic refresh.
- **Disconnect LinkedIn** performs the same deletion and leaves LinkedIn disconnected.

Both actions block a late collector from restoring deleted data. They preserve theme and onboarding completion.

## Permissions

SocialEdge uses Chrome `storage`, `webRequest`, `alarms`, `scripting`, `sidePanel`, and `notifications`, plus host access to `https://www.linkedin.com/*`. The extension uses these permissions for the storage, authorized header capture, task/SSI schedules, LinkedIn-context execution, panel, and task reminder described above.

The release does not request browser-cookie access, Chrome identity access, or the `tabs` permission. It ships no content script, page relay, OAuth configuration, or broad web-accessible resource.

## Third parties and sharing

LinkedIn receives the requests you authorize because it provides the source data. Chrome stores extension data on your device and may sync browser-level settings according to your Chrome configuration; SocialEdge uses `storage.local` and `storage.session` for the data described here. The current release does not send LinkedIn-derived records to the development server, Google Sign-In, analytics providers, advertisers, or data brokers.

## SocialEdge authentication

SocialEdge account authentication is disabled in the release. The package contains no account UI, auth module, OAuth client, identity permission, or insecure development endpoint. Upgrade migration removes the old `_se_session` value without contacting a server. A separate reviewed release must satisfy the documented HTTPS, provider-verification, token-expiry, session-revocation, logout, origin, secret, rate-limit, account-linking, and authorization checks before account authentication can return.

## Contact

Email privacy questions to artsiom.kharytonchyk@outlook.com.
