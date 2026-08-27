# Project Charter, Goals, Scope, and Non-Goals

## Charter

Shipping Harness exists to turn coding-agent execution into a bounded, auditable software release process. It owns the version contract and closure decision while delegating implementation to existing coding agents and harnesses.

## Goals

| ID | Goal | Measure |
|---|---|---|
| GOAL-001 | Prevent false completion. | No state transition to SHIPPABLE from agent text alone. |
| GOAL-002 | Prevent stale proof. | Every accepted result matches contract hash and Git SHA. |
| GOAL-003 | Prevent scope creep. | Unapproved path drift creates a blocker. |
| GOAL-004 | Prevent infinite repair. | Runs stop at configured cycle, time, and output limits. |
| GOAL-005 | Preserve human authority. | Pause/abort overrides every adapter continuation request. |
| GOAL-006 | Close versions despite optional debt. | NEXT/IGNORE findings do not block closure. |
| GOAL-007 | Integrate rather than replace. | External harnesses connect through adapters/capabilities. |

## v0.1.0 scope

### Included

- Repository initialization and JSON-compatible YAML contract
- Contract validation and immutable lock hash
- Durable state machine and append-only ledger
- Acceptance commands with timeout/output bounds
- Evidence manifests and redacted logs
- Git SHA freshness and path-based scope drift
- BLOCKER/NEXT/IGNORE issue model
- Pause, resume, abort, verify, close, and status commands
- Generic and Codex-oriented execution profiles
- Release report and next-version backlog generation

### Excluded

- Web UI, cloud service, database, multi-user/RBAC
- Automatic deployment, push, tag, credential changes
- Custom model, prompt marketplace, multi-agent debate
- Automatic contract amendment
- Unbounded repair or “until perfect” loops

## v0.2.0 scope

### Included

- Stable adapter contract and capability negotiation
- Generic, Codex, Gajae, Ouroboros, and OMO adapters
- Executable discovery and non-mutating version/help probes
- Operator-configured launch commands
- External artifact/evidence collection
- Normalized lifecycle event ingestion and stop-decision response
- Adapter fixture suite and integration-status report

### Excluded

- Copying or embedding external harness source
- Installing or configuring provider credentials
- Claiming a native integration where only a bridge is verified
- Depending on unstable private APIs
- OMO Team Mode, Ouroboros evolution, or Gajae interview reimplementation

## Governance invariants

1. `Human stop > automatic continuation`.
2. `Release policy > agent preference`.
3. `Current evidence > historical evidence`.
4. `Acceptance contract > reviewer opinion`.
5. `Bounded blocked result > infinite activity`.
6. `New version > reopening a closed version`.