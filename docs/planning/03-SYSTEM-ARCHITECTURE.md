# System Architecture

## Context

```text
User / connected agent
          │
          ▼
Plugin / MCP / CLI ─────────────────────────┐
          │                                 │
          ├─ Contract + Decision Engine     │
          ├─ State + Goal/Evidence Ledger   │ governance ownership
          ├─ Scope + Evidence Guard         │
          ├─ Gate + Closure Engine          │
          └─ Runtime/Adapter Registry ──────┘
                    │
                    ├─ Generic / Codex adapters
                    ├─ Gajae / Ouroboros adapters
                    └─ Internal OMO Bridge
                              │
                              ▼
                    Private pinned OMO runtime
                    (task/routing/recovery only)
```

External and internal runtimes may own code-generation sessions. Shipping Harness owns the release contract, accepted evidence, budgets, blocker policy, human stop, and final state transition.

## Repository state

```text
.shipping/
├── contract.yaml          # JSON-compatible YAML 1.2
├── contract.lock          # hash, baseline SHA, revision
├── state.json             # current durable state
├── ledger.jsonl           # append-only events
├── issues.json            # normalized findings
├── backlog.json           # next-version findings
├── integrations.json      # adapter probe status
├── hooks.jsonl            # normalized lifecycle events
├── evidence/              # ignored, potentially large/raw
│   └── <run-id>/
│       ├── manifest.json
│       └── <criterion>.log
└── releases/              # tracked closure receipts
    └── <version>.json
```

## State machine

```text
DRAFT → LOCKED → RUNNING → VERIFYING → TRIAGE
                                         │
                     blockers + budget   ├→ FIXING ─┐
                     blockers exhausted  ├→ BLOCKED │
                     no blockers         └→ SHIPPABLE
                                                   │
                                                   ▼
                                                 CLOSED

Any non-terminal active state → PAUSED → RESUMED
Any non-CLOSED state          → ABORTED
```

Only the state module writes `state.json`. Every write is atomic: create temporary file, fsync-compatible rename, then append a ledger event. Invalid transitions fail before mutation.

## Core modules

### Contract Engine

- Parse deterministic JSON-compatible YAML.
- Validate schema and stable IDs.
- Canonicalize object keys and hash canonical bytes.
- Create/compare lock receipt.
- Reject hidden contract amendment.

### Git and Scope Guard

- Resolve repository root and current HEAD.
- Enumerate committed delta plus untracked paths from baseline.
- Apply dependency-free glob matching.
- Ignore `.shipping/evidence/**` and other runtime-only files.
- Emit a policy-linked scope blocker.

### Evidence Runner

- Spawn explicit contract commands in repository-contained working directories.
- Bound duration and captured bytes.
- Preserve full digest even when displayed output is truncated.
- Redact tokens, bearer headers, API keys, private-key blocks, and credential assignments.
- Write evidence before gate evaluation.

### Gate and Closure Engine

Mechanical decision order:

1. Contract hash matches lock.
2. Required evidence exists for current Git SHA.
3. Required command exits are zero.
4. Scope drift is empty.
5. Normalized BLOCKER count is zero.
6. Human stop and budgets allow transition.

LLM judgment is optional and may suggest a classification; it cannot directly transition release state.

### Adapter Registry

```js
{
  name,
  aliases,
  probe(context),
  execute(context, request),
  collect(context),
  stopDecision(context, event)
}
```

Capabilities are data, not assumptions:

```text
execute, resume, cancel, jsonOutput, hooks,
durableGoals, durableLedger, artifactCollection, costTelemetry
```

## Planned internal OMO boundary

From v0.7, actual OMO code runs outside Shipping Core in a private pinned runtime. Shipping sends a hash-bound work order and receives normalized task/event/evidence receipts.

Shipping remains authoritative for:

- contract and scope;
- acceptance and current Git-SHA evidence;
- execution budgets;
- pause and abort;
- blocker classification;
- SHIPPABLE and CLOSED.

OMO remains authoritative only for its child-task/process lifecycle, model/category routing inside allowed policy, and internal recovery. Team/DAG capabilities stay disabled until v0.8 entry criteria pass.

The bridge is fail-closed: an absent, stale, incompatible, or unhealthy runtime becomes truthful fallback or durable BLOCKED, never inferred success.

## Security boundaries

- Repository path containment is checked after realpath resolution.
- Symlinked contract/runtime paths outside the repository are rejected.
- Shell execution is opt-in through a committed contract or explicit CLI option.
- External adapters never read provider credential stores.
- Probes use version/help/status-class commands with a short timeout.
- Logs are redacted before persistence.
- No auto-push, deployment, package installation, or permission escalation.

## Architectural decisions

| ADR | Decision | Reason |
|---|---|---|
| ADR-001 | Node 22 ESM, zero runtime dependencies. | Offline reproducibility and small supply-chain surface. |
| ADR-002 | JSON-compatible YAML contract. | Human-visible `.yaml` with deterministic built-in parsing. |
| ADR-003 | Repository-native files before database. | Local-first auditability and crash recovery. |
| ADR-004 | Deterministic gate with optional LLM advice. | Avoid hallucinated completion authority. |
| ADR-005 | Adapter commands configurable. | External harness CLI flags evolve. |
| ADR-006 | Evidence stores digests and redacted logs. | Fresh proof without credential leakage. |
| ADR-007 | Closure receipt is tracked; raw evidence is ignored. | Audit trail without repository bloat. |
| ADR-008 | Actual OMO code runs in a separate private internal runtime from v0.7. | Preserve tested upstream interactions, license boundary, independent updates, and rollback. |
| ADR-009 | OMO task completion is never release completion. | Keep Finisher and acceptance authority deterministic and Shipping-owned. |