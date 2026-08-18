# Architecture

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
