# SocialEdge

SocialEdge is a Chrome 116+ side-panel extension for LinkedIn SSI history, analytics, profile tips, job suggestions, activities, and daily tasks. You control LinkedIn access from the panel. A new install, extension startup, upgrade, or alarm does not use your LinkedIn session unless you enable the SSI-only automatic refresh setting.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome and enable Developer mode.
3. Select **Load unpacked** and choose the `extension/` directory.
4. Sign in to LinkedIn in the same Chrome profile.
5. Open the SocialEdge side panel and choose a feature.

The repository also has a release packager:

```bash
npm ci
npm run package:extension
```

The packager writes its allowlisted output to `dist/socialedge-extension/`. It excludes tests, fixtures, the development server, databases, dormant content scripts, and account-authentication code.

## LinkedIn access

The four collection buttons start manual operations:

- **Refresh Score** reads SSI scores and benchmark fields.
- **Analytics** reads the displayed follower, profile-view, search, impression, and engagement counts supported by the current collector.
- **Profile Tips** reads section completeness measurements and stores generated tip text. It does not keep profile text, a profile slug, HTML, or selector diagnostics.
- **Jobs** reads up to ten job cards with title, company, location, LinkedIn job URL, HTTPS logo URL, posted label, and remote status.

The browser attaches its own LinkedIn cookies to same-origin requests. SocialEdge does not read cookie values and does not request Chrome's `cookies` permission. It captures only `accept`, `csrf-token`, `x-li-lang`, and `x-restli-protocol-version` during an authorized operation. SocialEdge stores a verified, account-bound request context in `chrome.storage.session` for no more than 24 hours. A 401, 403, expiry, account change, clear, or disconnect removes it.

SocialEdge verifies one LinkedIn account at a time before it writes or displays LinkedIn-derived records. A verified account change clears the prior account's data, disables automatic refresh, and requires a fresh manual collection. A failed identity check stores nothing and reports an account-verification error.

## Automatic SSI refresh

Automatic refresh is off by default. Open **About → LinkedIn privacy** to enable it. The current `privacy-v1` consent covers SSI only. The `dailyFetch` alarm may start an SSI collection while that consent remains current. Enabling the switch does not start an immediate request.

Turn the switch off to stop later scheduled LinkedIn requests. **Clear LinkedIn Data** and **Disconnect LinkedIn** also turn it off. You must opt in again after either action.

Daily task generation and notifications can run without contacting LinkedIn. Those local operations use existing account-bound data.

## Collector isolation

SocialEdge can run structured requests in an existing LinkedIn tab without changing the tab. It does not navigate, scroll, focus, or restore that user-owned tab.

Some collection paths need a rendered page. SocialEdge creates a dedicated tab with `active: false`, records the tab ID in session storage, and closes it after success, failure, timeout, cancellation, or browser-worker recovery. Closing that tab during collection returns a recoverable error. Each request has a 15-second limit, tab loading has a 20-second limit, and the whole operation has a 45-second limit. A failed collection preserves the last valid snapshot.

## Local data and retention

SocialEdge stores these account-bound records in `chrome.storage.local`:

| Data | Stored fields | Retention |
|---|---|---|
| SSI history | Date, collection time, overall score, four pillar scores, and displayed industry/network scores and ranks | Up to 365 daily entries |
| Analytics | Current supported counts and up to 365 daily snapshots | Until replaced, cleared, disconnected, or account change |
| Activities and tasks | Activity booleans, catalog task IDs/labels, completion state, and dates | Until clear, disconnect, or account change; task history is bounded to 365 days |
| Profile Tips | Section status/counts, up to ten tip records, and summary score | Latest snapshot |
| Jobs | Up to ten validated job projections | Latest snapshot |
| Connection and consent | Verified opaque account binding, connection status, and automatic-refresh choice | Until clear, disconnect, consent change, or account change |

SocialEdge stores request context, collection epoch, and owned temporary-tab IDs in `chrome.storage.session`. It does not retain raw SSI responses, response bodies, cookies, authorization values, page snippets, full page text, HTML, profile text, or collector debug objects.

Theme and onboarding completion are separate preferences. Clear and Disconnect preserve them.

## Export

The JSON export uses schema version 2. It contains minimized SSI history, activity history, and the documented activity catalog. It excludes request headers, consent timestamps, account bindings, internal schema state, raw responses, debug data, and SocialEdge account tokens.

You can analyze an export with:

```bash
python3 analysis/analyze_ssi.py socialedge_YYYY-MM-DD.json --lags 0 1 2 3 --output ssi-analysis.json
```

## Clear and Disconnect

Open **About → LinkedIn privacy**:

- **Clear LinkedIn Data** asks for confirmation, cancels collection, closes owned tabs, removes LinkedIn request context, identifiers, SSI, analytics, activities/tasks, tips, and jobs, then disables automatic refresh.
- **Disconnect LinkedIn** performs the same deletion and leaves the connection state disconnected.

Both actions block late collector writes and preserve theme plus onboarding completion. Uninstalling the extension lets Chrome remove its extension storage.

## Permissions

The release manifest requests:

| Permission | Use |
|---|---|
| `storage` | Local minimized data, session context, consent, and migration |
| `webRequest` | Allowlisted request-header capture during authorized SSI collection |
| `alarms` | Local daily tasks and consented SSI schedule |
| `scripting` | Same-origin requests and parsing inside a LinkedIn context |
| `sidePanel` | Main interface |
| `notifications` | Daily task reminder |
| `https://www.linkedin.com/*` | LinkedIn request and controlled-tab access |

The release does not request `cookies`, `identity`, or `tabs`. It declares no content scripts, OAuth configuration, or broad web-accessible resources.

## SocialEdge account authentication

Release builds do not contain SocialEdge sign-in. They do not load `auth.js`, contact the development server, request Chrome identity access, or use an OAuth client. Migration deletes the legacy `_se_session` key without contacting a server. See [server/README.md](server/README.md) for the requirements that must pass before a separate change can enable account authentication.

## Architecture

```text
extension/
├── manifest.json
├── background.js
├── lib/
│   ├── collection.js
│   ├── messages.js
│   ├── policy.js
│   └── storage.js
├── popup.html
├── popup.js
├── popup.css
└── PRIVACY_POLICY.md

tests/extension/       Node unit and controlled Chrome tests
analysis/              Python analyzer and source regression tests
scripts/               Release allowlist packager
server/                Development-only account service, excluded from release
```

The service worker runs migration before message or alarm work. It validates the sender and exact request schema, applies account and consent policy, owns collection lifecycles, validates projections, then writes minimized records. Responses use `{ok: true, data}` or `{ok: false, error}` envelopes.

## Test

```bash
npm run test:unit
npm run test:extension
npm run test:release
python3 -m unittest discover -s analysis -p 'test_*.py'
node --check extension/background.js
node --check extension/popup.js
```

The controlled Chrome tests use fixtures and an isolated profile. They do not require a personal LinkedIn account. Use a dedicated test account for the final live smoke matrix and keep credentials, headers, raw responses, page text, and personal screenshots out of logs.

## Troubleshooting

- **Account verification error:** Sign in at `https://www.linkedin.com/` in the same Chrome profile, then start the feature again.
- **Session expired:** Sign in to LinkedIn again. SocialEdge already removed the rejected request context.
- **Account changed:** Start a fresh manual collection. SocialEdge cleared prior bound data and disabled automatic refresh.
- **No context:** Keep Chrome able to create an inactive LinkedIn tab. The collector will not repurpose another tab.
- **Temporary tab closed or timeout:** Retry the feature. The previous valid snapshot remains available.
- **Automatic refresh did not run:** Check the switch in About. Missing or outdated consent stays disabled.
- **PDF download:** Open About and select **Free Boost Strategy PDF**. The PDF remains an extension-owned resource and is not exposed to websites.

See [extension/PRIVACY_POLICY.md](extension/PRIVACY_POLICY.md) for the full data matrix.

## Credits

SocialEdge was originally created by [Artyom Rudman](https://github.com/artemrudman) ([original repository](https://github.com/artemrudman/socialedge)). This fork is maintained by [Artsiom Kharytonchyk](https://github.com/AKharytonchyk). The project remains licensed under the [MIT License](LICENSE).
