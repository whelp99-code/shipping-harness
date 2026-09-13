# Shipping Harness

[![CI](https://github.com/whelp99-code/shipping-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/whelp99-code/shipping-harness/actions/workflows/ci.yml)

**Version:** 1.11.0

Coding agents already know how to write code. Shipping Harness decides whether the current software version is actually safe to close.

> **Your coding agent writes code. Shipping Harness closes the version.**

## Why

Vibe coding often stalls at 80–90% because planning, implementation, review, and improvement happen without a binding release contract. Reviewers keep finding optional improvements, agents keep resuming, scope grows, and the project never reaches a durable version boundary. Shipping Harness adds an independent governance layer that wraps Codex, Gajae Code, Ouroboros, and OMO Native (or a generic process) with a deterministic completion policy. It is not a coding model or another autonomous agent.

## Core guarantees

- Completion is proven by evidence, not by an agent saying "done".
- Evidence is bound to both the contract hash and the current Git SHA.
- A release blocker must cite an acceptance criterion or policy rule.
- Optional improvements move to the next-version backlog.
- Fix loops, agent runs, command duration, and output size are bounded.
- A human pause or abort always wins over automatic continuation.
- A closed version cannot silently reopen; further changes require a new release contract.

## Install

Recommended path — pack the tagged commit and install into a user-global prefix:

```bash
npm pack   # from a clean, tagged checkout
npm install --global --prefix "$HOME/.local" ./shipping-harness-1.11.0.tgz \
  --ignore-scripts --no-audit --no-fund
```

See [`docs/operations/INSTALL-UPGRADE-ROLLBACK.md`](docs/operations/INSTALL-UPGRADE-ROLLBACK.md) for upgrade, rollback, and the planned GitHub Release tarball path.

## Five-minute start: CLI

```bash
shipping-harness init
# Edit .shipping/contract.yaml, commit the baseline, then:
shipping-harness contract check
shipping-harness lock
shipping-harness verify
shipping-harness status
shipping-harness close
```

The generated `contract.yaml` is JSON-compatible YAML 1.2, parsed without a YAML library.

## Five-minute start: MCP

Connect one target repository to an MCP client (Codex shown; see [`docs/MCP.md`](docs/MCP.md) for other clients):

```bash
codex mcp add shipping-harness -- \
  shipping-harness-mcp --root /absolute/path/to/target-project
```

Restart the client, then ask in ordinary language:

```text
Use Shipping Harness to finish this project as version 0.1.0.
Keep only the smallest useful scope and show me the scope before approving it.
```

The agent calls `shipping_start` once. Shipping always completes bounded read-only repository analysis first, then presents scope, exclusions, acceptance checks, and a short plan. A terse or ambiguous request such as `Analyze this project with Shipping Harness` produces exactly one workflow-boundary question and defaults to `ANALYZE_ONLY`; it does not create Goal Discovery, a Goal Charter, a Release Train, implementation authority, or closure authority before that intent is confirmed. Explicit planning requests may produce a non-executing plan; only explicit `IMPLEMENT` or `AUTOPILOT` requests can enter the scope-approval flow, and `shipping_approve_scope` may be called only after explicit user approval with the exact proposal hash. No MCP tool accepts a raw shell command.

The stable intent modes are `ANALYZE_ONLY`, `PLAN_ONLY`, `IMPLEMENT`, and `AUTOPILOT`. Intent confirmation reuses `shipping_refine`; the MCP surface remains exactly nine tools. A dirty baseline remains visible evidence but cannot hide the intent question or trigger a baseline commit before the requested workflow boundary is known.

## Release flow

```text
Contract Lock → Agent Execution → Evidence → Release Gate
              → BLOCKER / NEXT / IGNORE → Bounded Fix → Version Close
```

## Safety boundary

Shipping Harness runs only commands explicitly stored in a repository-owned contract or supplied by the operator. It does not auto-push, auto-deploy, mutate provider credentials, install external harnesses, allow model self-approval, or bypass a human stop. A closed release cannot reopen. See [`docs/HANDOVER.md`](docs/HANDOVER.md) for the authority order and [`docs/ADAPTERS.md`](docs/ADAPTERS.md) for the capability, artifact, and lifecycle protocols.

## Documentation map

| Role | Docs |
|---|---|
| Start | [`docs/MCP.md`](docs/MCP.md), [`docs/BEGINNER-QUICKSTART-KO.md`](docs/BEGINNER-QUICKSTART-KO.md) |
| Operate | [`docs/ADAPTERS.md`](docs/ADAPTERS.md), [`docs/operations/INSTALL-UPGRADE-ROLLBACK.md`](docs/operations/INSTALL-UPGRADE-ROLLBACK.md), [`docs/operations/OMP-MAIN-HARNESS.md`](docs/operations/OMP-MAIN-HARNESS.md), [`docs/operations/AUTOPILOT-RUNBOOK.md`](docs/operations/AUTOPILOT-RUNBOOK.md), [`docs/internal-remote/README.md`](docs/internal-remote/README.md), [`docs/internal-runtime/README.md`](docs/internal-runtime/README.md), [`docs/HANDOVER.md`](docs/HANDOVER.md) |
| Design | [`docs/planning/00-INTAKE.md`](docs/planning/00-INTAKE.md), [`01-CHARTER-AND-SCOPE.md`](docs/planning/01-CHARTER-AND-SCOPE.md), [`02-REQUIREMENTS.md`](docs/planning/02-REQUIREMENTS.md), [`03-SYSTEM-ARCHITECTURE.md`](docs/planning/03-SYSTEM-ARCHITECTURE.md), [`04-DEVELOPMENT-PLAN.md`](docs/planning/04-DEVELOPMENT-PLAN.md), [`05-TEST-AND-RELEASE-GATE.md`](docs/planning/05-TEST-AND-RELEASE-GATE.md), [`06-ADAPTER-INTEGRATION.md`](docs/planning/06-ADAPTER-INTEGRATION.md) |
| Plans | [`08-V0.4-AUTO-DECISION-DIRECTION.md`](docs/planning/08-V0.4-AUTO-DECISION-DIRECTION.md), [`09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md`](docs/planning/09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md), [`10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](docs/planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md), [`11-V0.4.0-AUTO-DECISION-DEVELOPMENT-PLAN.md`](docs/planning/11-V0.4.0-AUTO-DECISION-DEVELOPMENT-PLAN.md), [`12-V0.5.0-GOAL-EVIDENCE-RUNTIME-DEVELOPMENT-PLAN.md`](docs/planning/12-V0.5.0-GOAL-EVIDENCE-RUNTIME-DEVELOPMENT-PLAN.md), [`13-V0.6.0-BEGINNER-PLUGIN-DEVELOPMENT-PLAN.md`](docs/planning/13-V0.6.0-BEGINNER-PLUGIN-DEVELOPMENT-PLAN.md), [`14-V0.7.0-INTERNAL-OMO-RUNTIME-DEVELOPMENT-PLAN.md`](docs/planning/14-V0.7.0-INTERNAL-OMO-RUNTIME-DEVELOPMENT-PLAN.md), [`15-V0.8.0-BOUNDED-TEAM-DAG-DEVELOPMENT-PLAN.md`](docs/planning/15-V0.8.0-BOUNDED-TEAM-DAG-DEVELOPMENT-PLAN.md), [`16-V0.9.0-INTERNAL-REMOTE-OPERATIONS-DEVELOPMENT-PLAN.md`](docs/planning/16-V0.9.0-INTERNAL-REMOTE-OPERATIONS-DEVELOPMENT-PLAN.md), [`17-V1.0.0-STABLE-INTERNAL-CONTROL-PLANE-DEVELOPMENT-PLAN.md`](docs/planning/17-V1.0.0-STABLE-INTERNAL-CONTROL-PLANE-DEVELOPMENT-PLAN.md), [`25-V1.4.0-EVIDENCE-FIRST-PLAIN-BRIEF-DEVELOPMENT-PLAN.md`](docs/planning/25-V1.4.0-EVIDENCE-FIRST-PLAIN-BRIEF-DEVELOPMENT-PLAN.md), [`26-V1.5.0-RELEASE-TRAIN-PLANNER-DEVELOPMENT-PLAN.md`](docs/planning/26-V1.5.0-RELEASE-TRAIN-PLANNER-DEVELOPMENT-PLAN.md), and the rest of `docs/planning/` in sequence; see [`CHANGELOG.md`](CHANGELOG.md) for what each version shipped |
| Reports | [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md), `docs/reports/*.json` (field evidence, not distributed in the package) |
| Research | [`docs/research/upstream-code-audit/README.md`](docs/research/upstream-code-audit/README.md), [`docs/research/PAPERTHIN-APPLICATION-DECISION.md`](docs/research/PAPERTHIN-APPLICATION-DECISION.md) |

## License

MIT. See [`THIRD_PARTY.md`](THIRD_PARTY.md) for third-party integration boundaries.
