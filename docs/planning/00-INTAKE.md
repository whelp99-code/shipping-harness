# Shipping Harness — Project Intake

## Decision record

- **Project:** `shipping-harness`
- **Worker:** `shipping-harness`
- **Profile:** Internal production CLI with AI/Agent overlay
- **Target releases:** `v0.1.0` and `v0.2.0`
- **Primary user problem:** Coding agents can implement and review indefinitely without producing a durable, auditable release boundary.
- **Product decision:** Build an agent-agnostic Completion Control Plane rather than another coding agent.

## Problem statement

The current AI coding loop frequently becomes:

```text
idea → code → review → more findings → refactor → scope growth → repeat
```

The missing capability is not raw coding intelligence. It is governance over scope, acceptance evidence, issue severity, resource limits, human interruption, and version closure.

## Product hypothesis

When a version has a locked contract, deterministic acceptance checks, evidence tied to the current source revision, bounded repair loops, and an independent closure policy, the percentage of started versions that are actually closed will increase without requiring a new code-generation model.

## Outcome chain

```text
WHY      Vibe-coded projects fail to close.
WHAT     A shipping governance layer controls the release boundary.
HOW      Contract, state machine, ledger, evidence, gates, budgets, adapters.
BUILD    Dependency-light local CLI and adapter SDK.
VERIFY   Unit, integration, adversarial, security, and license checks.
RELEASE  Signed-off local commits/tags; push only when a remote exists.
OPERATE  Repository-native state with audit/recovery commands.
LEARN    Compare ship rate, false-done rate, drift, cycles, and cost.
```

## Assumptions and unknowns

| ID | Type | Statement | Handling |
|---|---|---|---|
| ASM-001 | Assumed | Node 22+ is available. | Enforce via package engine and doctor. |
| ASM-002 | Assumed | The governed project uses Git. | v0.1.0 requires a valid Git HEAD before lock. |
| ASM-003 | Assumed | Operators trust commands committed in their own contract. | Never execute uncommitted contract changes after lock. |
| UNK-001 | Unknown | External harness CLIs may change command flags. | Use capability probes and operator-configured command templates. |
| UNK-002 | Unknown | Gajae/Ouroboros/OMO may be absent on a machine. | Distinguish live, configured, and fixture verification. |
| UNK-003 | Unknown | A universal external hook schema exists. | Provide normalized event ingestion without claiming native plugin support. |

## Completion rule for this repository

`v0.2.0` is complete only when required acceptance tests pass, no release blocker remains, non-blocking findings are in `BACKLOG.md`, release reports exist for both versions, Git is clean, and commits/tags exist. Push is attempted only if a remote is configured.