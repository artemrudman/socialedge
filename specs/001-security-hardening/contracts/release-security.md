# Release Security Contract

## Required Extension Manifest Baseline

Expected required permissions after implementation:

| Permission | Release disposition | Justification |
|---|---|---|
| `storage` | keep | Minimized local data, consent, migration, session credentials |
| `webRequest` | keep | Allowlisted natural request-header capture for LinkedIn session context |
| `alarms` | keep | Daily quests and explicitly consented SSI schedule |
| `scripting` | keep while collectors require it | Same-origin request/parsed DOM work in controlled contexts |
| `sidePanel` | keep | Primary UI |
| `notifications` | keep | Existing daily quest notifications |
| `cookies` | remove | Direct cookie access is prohibited |
| `identity` | remove | SocialEdge authentication is disabled |
| `tabs` | remove if browser tests pass | Host permission should cover required matching LinkedIn tab fields; basic tab lifecycle remains usable |

Host access is restricted to HTTPS LinkedIn hosts proven necessary by collectors. Wildcard schemes and unrelated origins are prohibited.

## Package Exclusions

- No manifest `oauth2` block or placeholder client ID.
- No `content_scripts` entries and no release inclusion of inactive interceptor/relay files.
- No `auth.js` script loading, `Auth.init()`, insecure account API base, or legacy session use.
- No broad `web_accessible_resources` exposure for `Info Plan.pdf`; the extension page may access its own packaged asset.
- No source map, test fixture, captured response, development secret, database, or debug artifact in the extension release.

## Authentication Re-Enable Gate

SocialEdge account authentication remains disabled until a separately reviewed change demonstrates all of the following:

1. Production API is HTTPS-only and the extension refuses insecure origins.
2. Real provider client configuration exists and placeholders fail build/startup.
3. Provider flow follows the current recommended extension flow and verifies issuer, audience, nonce/state, expiry, and verified email.
4. Access tokens are short-lived; refresh sessions rotate, are server-revocable, have bounded absolute lifetime, and are never accepted indefinitely offline.
5. Logout removes local material and revokes server refresh sessions; 401 clears local material.
6. Server has no default signing secret in production and restricts CORS to approved extension/web origins.
7. Registration/login have appropriate rate limiting and password policy; account-linking requires verified identity and safe confirmation.
8. Plan/admin mutation cannot be performed by an ordinary user without authorization.
9. Privacy documentation covers account data, retention, processors, export, and deletion.
10. Automated tests cover expiration, rotation/reuse rejection, logout/revocation, origin rejection, provider errors, and legacy-session migration.

## Release Gates

- All production-readiness requirements FR-001 through FR-020 pass.
- Controlled integration matrix for FR-026/FR-027 passes, including service-worker termination.
- Manifest/package audit reports no forbidden permissions, scripts, resources, endpoints, or placeholders.
- Storage/export inspection reports no raw response, page snippet, cookie/session secret, or excessive debug payload.
- Arbitrary-tab tests preserve URL, scroll, focus, and entered form state for every collector.
- Clear and Disconnect meet the Controlled Performance Profile's five-second transaction and 30-second confirmed-flow targets, and no late write restores deleted data.
- README and privacy policy match observed collection, retention, export, deletion, and automatic-refresh behavior.
- No unresolved critical or high-severity security finding remains.
