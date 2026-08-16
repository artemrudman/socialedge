<!--
Sync Impact Report
- Version change: unversioned template -> 1.0.0
- Principles established:
  - Placeholder Principle 1 -> I. User-Directed Access
  - Placeholder Principle 2 -> II. Least Privilege and Isolated Collection
  - Placeholder Principle 3 -> III. Data Minimization and Effective Deletion
  - Placeholder Principle 4 -> IV. Test-First Security Boundaries
  - Placeholder Principle 5 -> V. Fail-Closed, Auditable Releases
- Sections established:
  - Security and Privacy Constraints
  - Development Workflow and Quality Gates
- Removed sections: none; template placeholders were replaced
- Templates and guidance:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
  - ✅ .specify/templates/checklist-template.md
  - ✅ .specify/templates/constitution-template.md reviewed; remains generic setup scaffolding
  - ✅ specs/001-security-hardening/spec.md
  - ✅ specs/001-security-hardening/plan.md
  - ✅ specs/001-security-hardening/tasks.md
  - ✅ related security-hardening design artifacts
  - ✅ README.md governance reference
- Deferred items: none
-->
# SocialEdge Constitution

## Core Principles

### I. User-Directed Access

SocialEdge MUST make authenticated third-party requests only after a user action or under
specific, informed, revocable consent. Installation, startup, upgrade, and scheduled events
MUST default to no authenticated third-party traffic. Passive capture or retention of session
material counts as access and follows the same authorization rule.

Clear and disconnect actions MUST stop automatic collection and prevent deleted data from
returning until the user grants fresh consent or starts a new manual collection. Product copy
MUST state each automatic trigger, affected feature, data category, and disable procedure.

Rationale: users control when SocialEdge uses their accounts and when collection resumes after
deletion.

### II. Least Privilege and Isolated Collection

Each release MUST request only permissions, host access, scripts, and exposed resources that a
tested feature requires. The team MUST remove privileges when their feature disappears. Code
MUST NOT read browser cookie values when the browser can attach session cookies without exposing
them.

Collectors MUST NOT navigate, scroll, focus, or repurpose a user-owned tab. A collector that
needs rendered content MUST use an identified inactive context, track ownership across service
worker restarts, and close the context after success, failure, timeout, cancellation, or restart
recovery. Privileged messages MUST validate sender, origin, action, request schema, and response
schema before producing side effects.

Rationale: narrow privileges and isolated contexts reduce account risk and preserve the user's
browsing state.

### III. Data Minimization and Effective Deletion

Every stored or exported data category MUST have an allowlisted schema, purpose, retention rule,
and deletion path. SocialEdge MUST store parsed fields needed by a user-facing feature and MUST
exclude raw third-party responses, page snippets, cookie values, session secrets, and payload
debug dumps. Session-derived request material MUST use volatile storage, enforce a bounded
lifetime, and clear on authentication failure or account change.

Migrations MUST be idempotent, remove obsolete sensitive data, preserve unrelated preferences,
and fail before enabling collection when they cannot complete. Clear and disconnect operations
MUST cancel in-flight writes so deleted data cannot return from a late response.

Rationale: SocialEdge limits the impact of local compromise and gives users an effective delete
control.

### IV. Test-First Security Boundaries

Developers MUST write failing automated tests before changing session access, permissions,
sensitive storage, migrations, deletion, authentication, privileged messaging, or external
collection behavior. Tests MUST cover success, denial, malformed input, timeout, cancellation,
account change, and lifecycle interruption where those states apply.

Automated integration tests MUST use controlled fixtures and MUST NOT use personal credentials.
A dedicated test account may support a recorded manual release check, but logs and attachments
MUST exclude credentials, headers, raw responses, and personal page content.

Rationale: security claims require repeatable evidence before implementation and at release.

### V. Fail-Closed, Auditable Releases

SocialEdge MUST deny collection or authorization when it cannot verify consent, account identity,
credential validity, migration state, message provenance, or response shape. A failed collector
MUST preserve the last valid user-visible snapshot and return a bounded, safe error without a
response body or stack trace.

Release authentication MUST remain absent until a reviewed implementation provides encrypted
transport, production identity-provider configuration, bounded token expiry, server-side session
revocation, logout, restricted origins, and automated coverage. Each release MUST pass permission,
storage, deletion, documentation, and package audits with no unresolved critical or high security
finding.

Rationale: uncertain state cannot grant access, mix accounts, or weaken a release gate.

## Security and Privacy Constraints

- SocialEdge supports Chrome Manifest V3 and MUST account for service-worker termination in every
  operation that owns temporary resources or changes sensitive state.
- Account-bound data MUST NOT merge or display until SocialEdge verifies the active account. If
  verification fails, the operation returns a safe error and stores no new account data.
- Release packages MUST use an explicit file allowlist and exclude development servers, tests,
  fixtures, databases, secrets, captured artifacts, and dormant privileged code.
- Privacy documentation MUST match observed behavior for collection, storage, retention, export,
  automatic access, sharing, and deletion.

## Development Workflow and Quality Gates

1. A feature specification MUST identify user actions, automatic triggers, permissions, data
   categories, retention, deletion, account boundaries, failure behavior, and measurable outcomes
   when the feature touches any of them.
2. An implementation plan MUST evaluate all five principles before research and after design. A
   failed gate stops planning until the plan removes the conflict or the project amends this
   constitution.
3. Task lists MUST place failing security-boundary tests before implementation tasks and MUST end
   with permission, storage, deletion, documentation, and package checks relevant to the change.
4. Reviewers MUST trace each normative requirement to implementation and evidence. Reviewers MUST
   reject placeholder configuration, unexplained privileges, unbounded retention, and tests that
   depend on personal credentials.
5. A release owner MUST record the test commands, manual checks, retained-permission reasons, and
   unresolved findings before approving a release.

## Governance

This constitution governs specifications, plans, tasks, reviews, and releases in this repository.
If another document conflicts with it, the team MUST update that document before implementation.

An amendment requires a written rationale, a Sync Impact Report, updates to affected templates and
active feature artifacts, and review through the normal change process. The team versions this
document with semantic versioning:

- MAJOR for removal or incompatible redefinition of a principle or governance rule.
- MINOR for a new principle, section, or material expansion of required behavior.
- PATCH for wording corrections that do not change obligations.

Every feature plan and release review MUST check compliance. The project cannot waive a principle
through a task note or implementation shortcut; a required exception needs a constitution
amendment with migration and risk treatment.

**Version**: 1.0.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-11
