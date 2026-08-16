# Development-only authentication server

The Chrome release does not package, call, or advertise this server. SocialEdge account authentication remains disabled. The extension migration removes the legacy `_se_session` key without making a network request.

Treat the current Express/SQLite code as local development work. Do not expose it to release users.

## Gate for a future authentication release

A separate security review must verify each requirement before the extension enables account authentication:

1. Serve the production API over HTTPS and reject insecure account origins in extension code.
2. Supply a real identity-provider client configuration. Fail build and startup on a placeholder or missing client.
3. Use the provider's current extension flow. Verify issuer, audience, state, nonce, expiry, and verified email.
4. Keep access tokens short lived. A target design uses a 15-minute access token and a rotating, server-revocable refresh session with a 30-day absolute limit.
5. Revoke the refresh session on logout and revoke-all. Remove local tokens on logout and 401.
6. Require a production signing secret. Remove the development fallback and rotate compromised keys.
7. Restrict CORS to approved extension and web origins. Add rate limits for registration, login, provider callbacks, refresh, and recovery.
8. Enforce a reviewed password policy if password login remains. Require a verified provider email and explicit confirmation before linking accounts.
9. Remove self-service plan escalation. Limit plan and administrative changes to authorized server roles.
10. Document account processors, fields, retention, export, and deletion.
11. Test token expiry, refresh rotation and reuse rejection, logout, revoke-all, origin rejection, provider failures, account linking, authorization, and legacy-session migration.

Stateless access tokens can remain valid until their short expiry. Server logout must revoke the refresh session and the extension must remove its local copy at once. The review must record that residual access-token window.
