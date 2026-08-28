# Sequential Roadmap and Development Plan — v0.4.0 to v1.0.0

## Delivery rule

Each version must be completed and closed before the next version begins.

```text
DRAFT → scope approved → LOCKED → BUILD → VERIFY → blocker-only FIX
      → SHIPPABLE → CLOSED → next version
```

New ideas never enter an active release unless they repair an accepted requirement. They move to the next-version backlog.

## Upstream code-audit note

The official Gajae Code, Q00 Ouroboros, and OMO repositories were downloaded at exact pinned revisions and audited at the function/control-path level before v0.4 implementation. The audit leaves the active v0.4 contract unchanged, but recommends splitting durable Goal/Evidence work from the much larger OMO-style orchestration runtime. See [`../research/upstream-code-audit/README.md`](../research/upstream-code-audit/README.md) and [`../research/upstream-code-audit/05-PROPOSED-PLAN-CORRECTIONS.md`](../research/upstream-code-audit/05-PROPOSED-PLAN-CORRECTIONS.md).

The product sequence below remains the previously approved plan until that correction proposal is explicitly adopted. No later-version scope is silently changed by the research audit.

## Product sequence

| Version | Outcome | User-visible change |
|---|---|---|
| v0.4.0 | Auto-Decision Core | The AI chooses the smallest operable release and the user approves one brief. |
| v0.5.0 | Bounded Execution Orchestration | The approved goal becomes a durable task graph executed by bounded specialist roles. |
| v0.6.0 | Plugin and Approval UX | The user installs one package and uses approval, progress, blocker, and completion cards. |
| v0.7.0 | Remote Control and Pilot Hardening | Authenticated remote/mobile control, allowlisted projects, notifications, and pilot evidence. |
| v1.0.0 | Stable Shipping Control Plane | Stable schemas, supported integrations, operations, benchmarks, and production handover. |

---

# v0.4.0 — Auto-Decision Core

## Outcome

A connected agent receives one user outcome, analyzes bounded repository evidence, decides safe defaults, escalates only mandatory risks, and presents one approval brief. The deterministic core validates and locks the approved decision.

## Scope

- `AUTO` default mode plus optional `SAFE` and `INTERVIEW` modes;
- repository evidence pack and decision context;
- structured decision package with decisions, assumptions, confidence, reversibility, risks, and questions;
- risk/escalation policy;
- one-screen approval brief;
- exact-hash approval and contract compilation;
- repository prompt-injection defense;
- no embedded model provider and no arbitrary MCP command field.

## PR plan

### PR-013 — Decision evidence and mode policy

- Add mode schema: `AUTO`, `SAFE`, `INTERVIEW`.
- Extend bounded analysis into a decision evidence pack.
- Include current release history, manifests, scripts, existing docs, changed paths, and detected operational surface without executing project code.
- Mark repository text as untrusted data.
- Add stable evidence references and byte/depth limits.
- **Maps:** REQ-DECISION-001..003, REQ-MODE-001..003.
- **Exit:** fixtures produce deterministic bounded evidence; hostile README instructions cannot alter policy.

### PR-014 — Structured decision proposal and validator

- Add a model-agnostic `shipping_submit_decision` MCP tool or equivalent protocol step.
- Validate scope, exclusions, acceptance, assumptions, confidence, reversibility, and evidence references.
- Reject unrelated features, fabricated repository capabilities, stale Git SHA, unsupported commands, and missing acceptance coverage.
- Compile an accepted decision package into the existing proposal/contract schema.
- Preserve separation between proposer and approver.
- **Maps:** REQ-DECISION-004..008, REQ-POLICY-001..004.
- **Exit:** valid host-agent decisions compile; self-approval and policy bypass fail.

### PR-015 — Risk escalation and approval brief

- Implement mandatory-risk categories.
- Add safe-default logic for reversible low-risk uncertainty.
- Generate at most three exception questions in one batch.
- Build the concise approval brief and detailed inspectable appendix.
- Extend proposal hash to cover mode, assumptions, risks, questions, and evidence.
- **Maps:** REQ-ESCALATE-001..006, REQ-APPROVAL-001..004.
- **Exit:** low-risk fixtures ask zero questions; destructive/cost/external-impact fixtures block for approval.

### PR-016 — MCP workflow, security, and release validation

- Extend `shipping_start` orchestration while keeping the user-facing tool surface small.
- Add decision-specific unit, MCP, integration, and adversarial suites.
- Test prompt injection, false confidence, hidden scope growth, question flooding, stale evidence, self-approval, and mode switching.
- Update beginner documentation and MCP client instructions.
- **Maps:** AC-0401..0412.
- **Exit:** all v0.1–v0.3 regressions pass and v0.4 closes with zero blockers.

## v0.4.0 acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-0401 | `AUTO` is the default when mode is omitted. |
| AC-0402 | A normal repository fixture produces a complete approval brief with zero questions. |
| AC-0403 | Reversible low-confidence choices use a documented safe assumption rather than blocking. |
| AC-0404 | Destructive data, paid service, external impact, credential, privacy/legal/security, and mutually exclusive core-outcome cases escalate. |
| AC-0405 | No proposal contains more than three questions, and all questions are returned in one batch. |
| AC-0406 | Every decision cites repository evidence or is explicitly labeled an assumption. |
| AC-0407 | The submitting model cannot approve its own proposal; exact user confirmation and proposal hash remain mandatory. |
| AC-0408 | Repository prompt-injection text cannot change mode, policy, tools, or approval state. |
| AC-0409 | `SAFE` escalates configured risk classes and `INTERVIEW` remains opt-in. |
| AC-0410 | The approval brief contains outcome, included scope, deferred scope, acceptance, important assumptions, risks, and limits. |
| AC-0411 | Full v0.1–v0.3 regression, security, MCP, and license suites remain green. |
| AC-0412 | v0.4.0 closes with a clean tagged commit, zero blockers, and no unapproved drift. |

## v0.4.0 release gate

```text
npm run release:verify
npm run test:mcp
npm run test:decision
node scripts/mcp-smoke.mjs
shipping-harness verify
shipping-harness close
git status --short == empty after release artifacts are committed
tag v0.4.0
```

---

# v0.5.0 — Bounded Execution Orchestration

## Outcome

The approved contract becomes a durable execution graph. Existing coding agents perform specialist roles, but Shipping Harness controls task state, evidence, budgets, stop conditions, and release closure.

## Selective absorption

- Gajae: durable goal/task ledger and evidence receipts;
- Ouroboros: immutable goal/spec alignment and bounded evaluation;
- OMO: role routing and limited parallel execution;
- Shipping Harness: scope, budgets, blocker triage, human stop, and Finisher authority.

## PR plan

### PR-017 — Durable goal and task graph

- Contract-to-task compiler.
- Stable goal/task IDs, dependencies, status, owner role, evidence, and retry budget.
- Restart-safe ledger and task recovery.
- No task without a requirement and acceptance consumer.

### PR-018 — Bounded role router

- Minimal roles: Planner, Builder, Tester, Reviewer, Finisher.
- Capability-based routing to host agent or configured adapters.
- Maximum depth, parallel workers, turns, tool calls, time, and cost metadata.
- Human stop and release policy override every role.

### PR-019 — Evaluation and Finisher

- Mechanical checks first, semantic review only where required.
- Findings mapped to acceptance/policy IDs.
- BLOCKER/NEXT/IGNORE enforcement.
- Finisher closes when blockers reach zero; it does not optimize indefinitely.

### PR-020 — Orchestration adversarial validation

- Crash/restart, duplicate task, cyclic graph, runaway spawn, reviewer scope creep, stale evidence, and conflicting-agent tests.
- Pilot comparison against direct single-agent execution.

## v0.5.0 acceptance summary

- Every task maps to a locked goal or acceptance criterion.
- No agent may create an unlimited child-agent chain.
- Parallelism remains within contract budget.
- Failed tasks end as BLOCKED with evidence rather than looping forever.
- Optional reviewer findings never reopen completed goals.
- All prior release guarantees remain green.

---

# v0.6.0 — Plugin and Approval UX

## Outcome

A non-developer installs one package, asks for an outcome, approves one card, and monitors only meaningful states.

## PR plan

### PR-021 — Plugin package and skill

- Package MCP server, Shipping Harness skill, agent instructions, and lifecycle hooks.
- One supported install path for ChatGPT/Codex-compatible environments.
- Compatibility and upgrade checks.

### PR-022 — Approval and status cards

- Approval card for the v0.4 decision brief.
- Progress card with `PLANNING`, `RUNNING`, `BLOCKED`, `SHIPPABLE`, and `CLOSED`.
- Blocker card with reason, evidence, recommended action, and remaining budget.
- Completion card with release report and deferred backlog.

### PR-023 — Guided setup and recovery

- Project selection, MCP registration, doctor, and repair flow.
- No CLI knowledge required for normal use.
- Safe uninstall and state preservation.

### PR-024 — Beginner usability validation

- First-run, approval, pause, blocker, recovery, and close tests with non-developer fixtures.
- Accessibility and concise-language checks.

## v0.6.0 acceptance summary

- A first-time user completes setup without editing JSON or running project-specific CLI commands.
- The user sees no more than one normal approval before execution.
- Dangerous actions remain separately approved.
- All detailed evidence remains available without cluttering the default view.

---

# v0.7.0 — Remote Control and Pilot Hardening

## Outcome

The same governed workflow works from web/mobile clients against allowlisted development servers without exposing arbitrary shell access.

## PR plan

### PR-025 — Remote MCP gateway

- Streamable HTTP MCP.
- OAuth/session authentication.
- Explicit project allowlist and per-project permissions.
- TLS and replay protection.

### PR-026 — Remote approval and notifications

- Signed approval receipts.
- Blocker and completion notifications.
- No remote raw-shell endpoint.

### PR-027 — Pilot operations

- Multi-project inventory and basic completion metrics.
- Backup/restore for Shipping Harness state.
- Upgrade and rollback runbooks.

### PR-028 — Security and pilot validation

- Cross-project isolation, authorization bypass, replay, token leakage, request forgery, and denial-of-service tests.
- Real-project pilot with before/after completion measurements.

## v0.7.0 acceptance summary

- Unauthorized users and non-allowlisted projects are inaccessible.
- Remote clients cannot supply arbitrary commands or override local human stop.
- State survives gateway restart.
- Pilot releases produce measurable completion evidence.

---

# v1.0.0 — Stable Shipping Control Plane

## Outcome

Shipping Harness is an operable, documented, model-agnostic product that converts a user outcome into a closed software version with bounded autonomy and auditable evidence.

## PR plan

### PR-029 — Stable schemas and compatibility

- Freeze supported contract, decision, task, evidence, release, MCP, and adapter schemas.
- Define migration and deprecation policy.

### PR-030 — Production operations

- Installation, upgrade, backup, restore, observability, incident, and rollback runbooks.
- Supported environment matrix.

### PR-031 — Completion benchmark

- Publish repeatable direct-agent versus Shipping Harness scenarios.
- Measure ship rate, false-done rate, scope drift, fix cycles, intervention count, and completion cost.

### PR-032 — Release and handover

- Security review, license inventory, support boundaries, release notes, and operator handover.
- Close all 1.0 blockers; move optional improvements to the next roadmap.

## v1.0.0 acceptance summary

- Stable upgrade path from v0.3+.
- No false SHIPPABLE transition in benchmark/adversarial suites.
- Human authority, evidence freshness, scope lock, and bounded execution remain invariant.
- Representative non-developers can start, approve, monitor, and receive a closed release without learning the CLI.
- Production and rollback documentation are complete.

---

# Dependency and stop rules

1. v0.4 must prove decision quality before role orchestration begins.
2. v0.5 must prove bounded orchestration before plugin UI hides operational detail.
3. v0.6 must prove beginner usability before remote execution is exposed.
4. v0.7 must prove isolation and operations before v1.0 stability claims.
5. A version with unresolved blockers cannot be bypassed by starting the next version.
6. Missing external harnesses use fixtures and truthful `unavailable` status; they never become fabricated live integrations.
7. No roadmap item may weaken contract lock, human stop, evidence freshness, or bounded execution.

# Commit strategy

- Commit accepted direction and development planning as the v0.4.0 DRAFT baseline.
- Do not lock v0.4.0 until the user explicitly starts implementation.
- Implement one PR slice at a time and run its closest tests before the next slice.
- Close and tag each version before preparing the next release.
- Push only when a remote exists and the user explicitly requests it.
