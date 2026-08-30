# Sequential Roadmap and Development Plan — v0.4.0 to v1.6.1

**Status:** ROADMAP LOCKED
**Canonical direction:** [`10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md)

## Delivery rule

Each version must be completed and closed before the next version begins.

```text
DRAFT -> scope approved -> LOCKED -> BUILD -> VERIFY -> blocker-only FIX
      -> SHIPPABLE -> CLOSED -> next version
```

New ideas never enter an active release unless they repair an accepted requirement. They move to the next-version backlog.

## Canonical version plans

The roadmap below defines sequence and dependency. Implementation must use the corresponding version-specific plan as the detailed source of truth.

| Version | Detailed development plan |
|---|---|
| v0.4.0 | [`11-V0.4.0-AUTO-DECISION-DEVELOPMENT-PLAN.md`](11-V0.4.0-AUTO-DECISION-DEVELOPMENT-PLAN.md) |
| v0.5.0 | [`12-V0.5.0-GOAL-EVIDENCE-RUNTIME-DEVELOPMENT-PLAN.md`](12-V0.5.0-GOAL-EVIDENCE-RUNTIME-DEVELOPMENT-PLAN.md) |
| v0.6.0 | [`13-V0.6.0-BEGINNER-PLUGIN-DEVELOPMENT-PLAN.md`](13-V0.6.0-BEGINNER-PLUGIN-DEVELOPMENT-PLAN.md) |
| v0.7.0 | [`14-V0.7.0-INTERNAL-OMO-RUNTIME-DEVELOPMENT-PLAN.md`](14-V0.7.0-INTERNAL-OMO-RUNTIME-DEVELOPMENT-PLAN.md) |
| v0.8.0 | [`15-V0.8.0-BOUNDED-TEAM-DAG-DEVELOPMENT-PLAN.md`](15-V0.8.0-BOUNDED-TEAM-DAG-DEVELOPMENT-PLAN.md) |
| v0.9.0 | [`16-V0.9.0-INTERNAL-REMOTE-OPERATIONS-DEVELOPMENT-PLAN.md`](16-V0.9.0-INTERNAL-REMOTE-OPERATIONS-DEVELOPMENT-PLAN.md) |
| v1.0.0 | [`17-V1.0.0-STABLE-INTERNAL-CONTROL-PLANE-DEVELOPMENT-PLAN.md`](17-V1.0.0-STABLE-INTERNAL-CONTROL-PLANE-DEVELOPMENT-PLAN.md) |
| v1.0.2 | [`18-V1.0.2-PROPOSAL-SAFETY-HARDENING-DEVELOPMENT-PLAN.md`](18-V1.0.2-PROPOSAL-SAFETY-HARDENING-DEVELOPMENT-PLAN.md) |
| v1.1.0 | [`19-V1.1.0-NESTED-WORKSPACE-AND-REFINEMENT-DEVELOPMENT-PLAN.md`](19-V1.1.0-NESTED-WORKSPACE-AND-REFINEMENT-DEVELOPMENT-PLAN.md) |
| v1.1.1 | [`20-V1.1.1-OMP-FIELD-DEPLOYMENT-AND-PILOT-DEVELOPMENT-PLAN.md`](20-V1.1.1-OMP-FIELD-DEPLOYMENT-AND-PILOT-DEVELOPMENT-PLAN.md) |
| v1.1.2 | [`21-V1.1.2-CANONICAL-PROPOSAL-STATE-DEVELOPMENT-PLAN.md`](21-V1.1.2-CANONICAL-PROPOSAL-STATE-DEVELOPMENT-PLAN.md) |
| v1.2.0 | [`22-V1.2.0-SAFE-BASELINE-STEWARD-DEVELOPMENT-PLAN.md`](22-V1.2.0-SAFE-BASELINE-STEWARD-DEVELOPMENT-PLAN.md) |
| v1.3.0 | [`23-V1.3.0-PROJECT-INTELLIGENCE-AND-ACCEPTANCE-COVERAGE-DEVELOPMENT-PLAN.md`](23-V1.3.0-PROJECT-INTELLIGENCE-AND-ACCEPTANCE-COVERAGE-DEVELOPMENT-PLAN.md) |
| v1.3.1 | [`24-V1.3.1-OMP-BOOTSTRAP-TEMPORARY-PACKAGE-RACE-PATCH.md`](24-V1.3.1-OMP-BOOTSTRAP-TEMPORARY-PACKAGE-RACE-PATCH.md) |
| v1.4.0 | [`25-V1.4.0-EVIDENCE-FIRST-PLAIN-BRIEF-DEVELOPMENT-PLAN.md`](25-V1.4.0-EVIDENCE-FIRST-PLAIN-BRIEF-DEVELOPMENT-PLAN.md) |
| v1.5.0 | [`26-V1.5.0-RELEASE-TRAIN-PLANNER-DEVELOPMENT-PLAN.md`](26-V1.5.0-RELEASE-TRAIN-PLANNER-DEVELOPMENT-PLAN.md) |
| v1.6.0 | [`27-V1.6.0-POLICY-AUTHORIZED-AUTOPILOT-DEVELOPMENT-PLAN.md`](27-V1.6.0-POLICY-AUTHORIZED-AUTOPILOT-DEVELOPMENT-PLAN.md) |
| v1.6.1 | [`28-V1.6.1-AUTOPILOT-FIELD-HARDENING-DEVELOPMENT-PLAN.md`](28-V1.6.1-AUTOPILOT-FIELD-HARDENING-DEVELOPMENT-PLAN.md) |

If this summary conflicts with a version-specific plan, the direction document wins first, then the version-specific plan, then this summary.

## Accepted upstream direction

The official Gajae Code, Q00 Ouroboros, and OMO repositories were downloaded at exact pinned revisions and audited at the function/control-path level.

The accepted product boundary is personal and company-internal use only. This changes the OMO strategy:

- OMO is no longer limited to a clean-room conceptual reference;
- actual OMO source may run in a private, separately pinned internal runtime;
- Shipping Core remains independent and owns release authority;
- public/customer distribution remains outside scope;
- upstream notices, modifications, pins, testing, and rollback are mandatory.

Canonical decision: [`10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).

## Product sequence

| Version | Outcome | User-visible change |
|---|---|---|
| v0.4.0 | Auto-Decision Core | The AI chooses the smallest operable release and the user approves one brief. |
| v0.5.0 | Durable Goal and Evidence Runtime | Approved work survives sessions and can prove exactly what remains and what passed. |
| v0.6.0 | Beginner Plugin and Local Agent UX | The user installs one package and normally never uses the CLI. |
| v0.7.0 | Internal OMO Runtime Foundation | OMO's real task, routing, continuation, and recovery code executes under Shipping control. |
| v0.8.0 | Bounded Team and DAG Orchestration | Selected OMO team/DAG capabilities handle larger work without unbounded autonomy. |
| v0.9.0 | Internal Remote Control and Operations | Authenticated mobile/web control, allowlists, backup, monitoring, and upgrade rollback. |
| v1.0.0 | Stable Internal Shipping Control Plane | Stable schemas, supported internal runtimes, benchmarks, and operational handover. |
| v1.0.2 | Proposal Safety Hardening | One truthful proposal state; duplicate, dirty, mode-switched, weak-gate approval is impossible. |
| v1.1.0 | Nested Workspace Intelligence | The actual runnable workspace, version, commands, and cwd are detected and one proposal is refined. |
| v1.1.1 | OMP Field Deployment | The nine-tool main harness is installed and proven against a nested-project pilot. |
| v1.1.2 | Canonical Proposal State | One authority state controls every approval projection and no-op refine is idempotent. |
| v1.2.0 | Safe Baseline Steward | Dirty work is classified and safely preserved through an explicit host-side handshake. |
| v1.3.0 | Project Intelligence and Coverage | Mixed-stack work themes and acceptance coverage make the proposed release concrete and provable. |
| v1.3.1 | OMP Bootstrap Race Patch | Temporary package cleanup is ordered after the complete install and proven by real bootstrap apply. |
| v1.4.0 | Evidence-First Plain Brief | Shipping compiles the user-facing problem, improvement, next plan, summary, and one action from mechanical evidence rather than host-model prose. |
| v1.5.0 | Release Train Planner | One final outcome becomes a deterministic rolling sequence of value-bearing versions with entry, exit, rollback, and replan gates. |
| v1.6.0 | Policy-Authorized Autopilot | A pre-authorized policy decides AUTO, NOTIFY, ASK, or STOP and may complete reversible local releases to CLOSED. |
| v1.6.1 | Autopilot Field Hardening | Cross-project, model-variant, crash, replay, and consequence pilots prove zero false or unauthorized authority transitions. |

---

# v0.4.0 — Auto-Decision Core

## Outcome

A connected agent receives one user outcome, analyzes bounded repository evidence, decides safe defaults, escalates only mandatory risks, and presents one approval brief. The deterministic core validates and locks the approved decision.

## Primary upstream influence

Q00 Ouroboros:

- decision provenance;
- evidence-backed vs inferred decisions;
- conservative defaults;
- conflict/ambiguity gates;
- rollback to a durable blocked state;
- outcome-first stop conditions.

The Python runtime is not embedded. Small mechanisms are ported into the Node core with attribution and tests.

## Included

- `AUTO` default mode plus optional `SAFE` and `INTERVIEW` modes;
- repository evidence pack and decision context;
- structured decisions, assumptions, confidence, reversibility, risks, and questions;
- risk/escalation policy;
- one-screen approval brief;
- exact-hash approval and contract compilation;
- repository prompt-injection defense;
- no embedded model provider and no arbitrary MCP command field.

## Excluded

- durable Goal/Task execution runtime;
- OMO runtime integration;
- Team Mode or DAG execution;
- plugin card UI;
- remote MCP;
- current-release evolution.

## PR plan

### PR-013 — Decision evidence and mode policy

- Add mode schema: `AUTO`, `SAFE`, `INTERVIEW`.
- Extend bounded analysis into a decision evidence pack.
- Include release history, manifests, scripts, existing docs, changed paths, and detected operational surface without executing project code.
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

## Acceptance summary

- Normal repositories reach one approval brief with zero technical questions.
- Every decision is grounded or explicitly labeled as an assumption.
- Mandatory-risk decisions are escalated.
- The decision agent cannot approve its own proposal.
- Existing release-governance invariants remain green.

---

# v0.5.0 — Durable Goal and Evidence Runtime

## Outcome

The approved contract becomes a restart-safe Goal and Task ledger. Work progress, blockers, attempts, and proof are independent of the chat transcript.

## Primary upstream influence

Gajae Code plus selected Ouroboros mechanisms:

- Gajae `goals.json` and append-only ledger patterns;
- plan/goal receipts independent of assistant prose;
- repeated-failure fingerprints and bounded planning-stuck outcomes;
- Ouroboros source/provenance classes and current-outcome authority;
- Shipping's existing contract/Git-SHA-bound evidence.

MIT-licensed source may be adapted when it is smaller and safer than reimplementation. Adapted code must use Shipping schemas and retain required notices.

## Included

- contract-to-Goal compiler;
- stable Goal and Task IDs;
- dependencies, owner role, status, attempts, and retry budget;
- append-only Goal/Task/Evidence ledger;
- crash/restart recovery;
- repeated-failure and stale-evidence detection;
- mechanical evaluation per acceptance criterion;
- durable `PLANNING_STUCK`, `BLOCKED`, `DONE`, and `SUPERSEDED` states;
- blocker-only repair planning.

## Excluded

- multi-agent teams;
- general DAG runtime;
- model routing across multiple agents;
- OMO process/session runtime;
- remote execution;
- plugin card UI beyond current MCP results.

## PR plan

### PR-017 — Goal and Task schema

- Compile locked requirements and acceptance criteria into stable Goals/Tasks.
- Require every task to map to a Goal, requirement, or acceptance consumer.
- Add state transitions, dependency validation, and cycle rejection.
- **Exit:** no orphan task or cyclic dependency can be accepted.

### PR-018 — Durable ledger and recovery

- Add append-only Goal/Task/Evidence records.
- Rebuild current state from checkpoints and ledger.
- Add atomic writes, corruption detection, and last-known-good recovery.
- **Exit:** process restart preserves state without replaying completed work.

### PR-019 — Freshness and repeated-failure guards

- Bind task evidence to contract hash and Git SHA.
- Fingerprint repeated failures on unchanged source/state.
- Stop identical no-progress retries with a durable reason.
- **Exit:** stale proof and repeated identical failures cannot create activity loops.

### PR-020 — Goal runtime adversarial validation

- Test crash/restart, ledger truncation, duplicate task, cycle, stale evidence, task self-completion, budget exhaustion, and human pause.
- Run one real internal project pilot with a single coding agent.
- **Exit:** Goal state remains auditable and bounded.

## Acceptance summary

- Conversation loss does not lose work state.
- Agent text cannot complete a Goal without current evidence.
- Completed tasks are never replayed after restart.
- Identical failure without code/state progress terminates safely.
- Shipping remains the only release Finisher.

---

# v0.6.0 — Beginner Plugin and Local Agent UX

## Outcome

A non-developer installs one local package, says the desired outcome, approves one brief, and sees only meaningful progress, blocker, and completion states.

## Included

- local Shipping plugin package;
- Shipping MCP server and skill bundle;
- supported ChatGPT/Codex/agent registration path;
- approval, progress, blocker, and completion cards or equivalent structured results;
- guided project selection and doctor;
- no CLI knowledge for normal use;
- safe uninstall and state preservation.

## Excluded

- remote/public HTTP endpoint;
- company RBAC;
- OMO internal runtime;
- multi-agent teams;
- automatic public packaging.

## PR plan

### PR-021 — Plugin package and skill

- Package MCP server, Shipping skill, agent instructions, and lifecycle rules.
- Provide one supported local install path.
- Add compatibility and upgrade checks.

### PR-022 — Approval and status surfaces

- Approval brief surface.
- `PLANNING`, `RUNNING`, `BLOCKED`, `SHIPPABLE`, and `CLOSED` progress surface.
- Blocker surface with evidence and recommended action.
- Completion surface with release report and deferred backlog.

### PR-023 — Guided setup and recovery

- Project selection, MCP registration, doctor, repair, and uninstall.
- Preserve existing `.shipping` state during reinstall.

### PR-024 — Beginner usability validation

- First-run, approval, pause, blocker, restart, and close scenarios.
- Concise-language and accessibility checks.
- Pilot with a user who does not edit JSON or run project-specific CLI commands.

## Acceptance summary

- Normal use begins with a natural-language outcome.
- No manual contract file editing is required.
- The user normally approves once.
- Detailed evidence remains available without cluttering the default experience.

---

# v0.7.0 — Internal OMO Runtime Foundation

## Outcome

Shipping Harness uses actual OMO execution code through a private, separately pinned internal runtime while preserving Shipping's independent governance and closure authority.

## Internal runtime boundary

```text
Shipping Core
  -> signed/hashed work order
  -> internal OMO bridge
  -> private pinned OMO runtime
  -> normalized task/event/evidence receipts
  -> Shipping verification and Finisher
```

OMO source is not mixed into Shipping Core. The private runtime preserves license notices and modification records and is not publicly distributed.

## First enabled OMO capabilities

- durable task state machine;
- in-process or process child runner selected by policy;
- category/agent/model routing with provenance;
- bounded concurrency and depth;
- same-session ownership checks;
- stale-state suppression;
- continuation cap;
- session suspend/resume;
- exactly-once terminal notification;
- task cancel/interrupt/steer;
- truthful unavailable/fallback behavior.

## Default Shipping profile

```yaml
parallel_workers: 2
agent_depth: 1
continuation_limit: 3
fix_cycles: 2
team_mode: false
dag_mode: false
unlimited_values_allowed: false
human_stop_wins: true
shipping_finisher_only: true
```

## Excluded

- OMO branding and marketplace;
- public packages or images;
- customer distribution;
- Team Mode;
- general DAG runtime;
- OMO memory/reflection subsystem;
- OMO telemetry unless explicitly disabled and reviewed;
- unrestricted provider/model tables;
- unlimited cap values.

## PR plan

### PR-025 — Private runtime repository and pin contract

- Create private `shipping-harness-omo-runtime` workspace/repository.
- Pin upstream commit and internal patch commit.
- Preserve license/notices and add `MODIFICATIONS.md`.
- Disable public publish paths.
- Define build artifact digest and compatibility metadata.
- **Exit:** runtime can be reproduced and identified from pins.

### PR-026 — Shipping/OMO bridge protocol

- Define `shipping-omo/v1` work orders and receipts.
- Bind release, contract hash, Git SHA, Goal/Task IDs, scope paths, acceptance IDs, and budgets.
- Reject unknown fields, stale work orders, path escape, and budget expansion.
- **Exit:** OMO cannot alter Shipping-owned policy or state.

### PR-027 — Task, routing, and evidence integration

- Connect selected task manager and child-runner surfaces.
- Add agent/model routing provenance.
- Normalize changed paths, task result, usage, and evidence references.
- Require Shipping to re-run acceptance checks.
- **Exit:** OMO task completion remains a claim until Shipping verifies it.

### PR-028 — Continuation and recovery integration

- Enforce human stop before every continuation/revival.
- Add same-session ownership, stale signature, continuation cap, and bounded recovery.
- Verify terminal work is not replayed.
- **Exit:** pause/abort and closed versions never auto-resume.

### PR-029 — Internal runtime pilot and rollback

- Run selected upstream package tests.
- Run Shipping integration/adversarial tests.
- Run a disposable canary and one real internal project.
- Prove fallback to approved Codex/Generic adapter or durable BLOCKED.
- Prove rollback to the previous runtime pin.
- **Exit:** one release closes through OMO with zero false-completion paths.

## Acceptance summary

- OMO cannot edit/approve the Shipping contract.
- OMO cannot increase budgets or continue after pause/abort.
- OMO task completion alone cannot make a release SHIPPABLE.
- Runtime pins and modifications are auditable.
- Previous runtime artifact can be restored without reopening the release contract.
- No external/public distribution is produced.

---

# v0.8.0 — Bounded Team and DAG Orchestration

## Entry gate

v0.8 starts only if v0.7 evidence shows that a single OMO runtime with at most two workers closes real releases reliably and that additional coordination would solve an observed bottleneck.

## Outcome

Selected OMO Team and DAG capabilities execute larger projects, but only inside a Shipping-generated graph with explicit dependency, ownership, concurrency, and release budgets.

## Included

- logical roles: Planner, Builder, Tester, Reviewer;
- Finisher remains outside the OMO team;
- team maximum 4, parallel maximum 2 by default;
- task dependency graph generated from locked Goals;
- node retry/amend only for failed or changed nodes;
- durable mail/task receipts;
- graph fingerprint and replay protection;
- role/model routing receipts;
- no-progress, oscillation, and repeated-review stop signals.

## Excluded

- unlimited Team/DAG values;
- agent-created top-level scope;
- current-release evolution;
- autonomous deployment/push;
- more than one nested delegation level by default;
- enabling every OMO built-in component.

## PR plan

### PR-030 — Shipping Goal to OMO DAG compiler

- Compile only approved Goals/Tasks.
- Validate dependency cycles, scope, acceptance consumers, and graph size.
- Persist graph fingerprint with contract hash and Git SHA.

### PR-031 — Bounded team and role policy

- Map Planner/Builder/Tester/Reviewer to approved task categories.
- Cap members, parallelism, depth, time, turns, and tool calls.
- Keep Finisher independent.

### PR-032 — Recovery, retry, and no-progress controls

- Use node-scoped retry/amend.
- Add stale/repeated finding suppression.
- Stop evaluation plateau and role ping-pong.

### PR-033 — Team/DAG pilot validation

- Compare direct agent, v0.7 runtime, and v0.8 team/DAG execution.
- Measure completion, cost, interventions, false-done, and coordination overhead.
- Disable Team/DAG by default if it does not improve real completion.

## Acceptance summary

- Every DAG node maps to a locked Goal or acceptance criterion.
- Finisher is never a team member.
- Parallelism and depth cannot exceed Shipping policy.
- Failed nodes do not cause unrelated successful nodes to rerun.
- Team/DAG can be disabled without losing the release contract or ledger.

---

# v0.9.0 — Internal Remote Control and Operations

## Outcome

The governed workflow can be controlled from the owner's web/mobile clients and future company accounts against allowlisted internal development servers without exposing arbitrary shell access.

## Included

- authenticated Streamable HTTP MCP or equivalent internal gateway;
- owner/company identity and project allowlist;
- per-project permissions;
- signed approval receipts;
- blocker and completion notifications;
- backup/restore for Shipping and OMO runtime state;
- versioned upgrade/rollback runbooks;
- runtime health and completion metrics;
- internal-only network and deployment policy.

## Excluded

- public anonymous endpoint;
- customer tenancy;
- customer billing;
- arbitrary command execution;
- public SaaS support commitments.

## PR plan

### PR-034 — Internal remote gateway

- Authentication, TLS, replay protection, and project allowlists.
- No remote raw shell or contract-command injection.

### PR-035 — Remote approval and notification

- Signed proposal/approval receipts.
- Pause, blocker, and completion notifications.

### PR-036 — Backup, restore, upgrade, and rollback

- Back up Shipping contract/ledger/evidence and required OMO runtime state.
- Test runtime pin rollback and schema migration rollback.

### PR-037 — Security and operational pilot

- Cross-project isolation, authorization bypass, replay, token leakage, request forgery, and denial-of-service tests.
- Mobile/web pilot against the Ubuntu server.

## Acceptance summary

- Unauthorized users and non-allowlisted projects are inaccessible.
- Remote clients cannot override local human stop or submit arbitrary commands.
- State survives gateway and runtime restart.
- Backup restoration preserves release authority and evidence links.

---

# v1.0.0 — Stable Internal Shipping Control Plane

## Outcome

Shipping Harness is an operable, documented internal system that converts a user outcome into a closed software version with bounded autonomy, actual OMO-backed execution when selected, and auditable evidence.

## PR plan

### PR-038 — Stable schemas and compatibility

- Freeze supported contract, decision, Goal/Task, evidence, release, MCP, adapter, work-order, and runtime-receipt schemas.
- Define migration and deprecation policy.

### PR-039 — Internal production operations

- Installation, upgrade, backup, restore, observability, incident, and rollback runbooks.
- Supported Shipping and OMO runtime version matrix.
- Internal-use and redistribution-change checklist.

### PR-040 — Completion benchmark

- Repeatable direct-agent, Shipping-only, OMO-runtime, and bounded-team scenarios.
- Measure ship rate, false-done rate, scope drift, fix cycles, intervention count, elapsed time, and completion cost.

### PR-041 — Release and handover

- Security review, license inventory, modification inventory, support boundaries, release notes, and operator handover.
- Close all 1.0 blockers and move optional improvements to the next roadmap.

## Acceptance summary

- Stable upgrade path from v0.3+.
- No false SHIPPABLE transition in benchmark/adversarial suites.
- Human authority, evidence freshness, scope lock, and bounded execution remain invariant across every runtime.
- Representative non-developers can start, approve, monitor, and receive a closed release without learning the CLI.
- OMO runtime pins, modifications, tests, and rollback are complete and internal-only.
- Operations and recovery documentation are complete.

---

# Dependency and stop rules

1. v0.4 must prove decision quality before execution-state expansion.
2. v0.5 must prove durable Goal/Evidence behavior with one coding agent.
3. v0.6 must prove beginner usability before OMO complexity is introduced.
4. v0.7 must prove private OMO runtime boundaries, stop authority, and rollback before Team/DAG work.
5. v0.8 starts only from measured need; OMO feature availability alone is not justification.
6. v0.9 exposes only internal authenticated control after local runtime stability.
7. A version with unresolved blockers cannot be bypassed by starting the next version.
8. No roadmap item may weaken contract lock, human stop, evidence freshness, bounded execution, or Finisher authority.
9. External/customer distribution immediately triggers a direction and license review.
10. Missing or unhealthy OMO runtime produces truthful fallback or durable BLOCKED, never fabricated success.

# Commit strategy

- Keep v0.4.0 as the active DRAFT until implementation is explicitly started.
- Implement one PR slice at a time and run its closest tests before the next slice.
- Close and tag each version before preparing the next release.
- Store OMO source in a separate private runtime repository/workspace, not inside Shipping Core.
- Record every upstream pin and internal modification.
- Push only when a remote exists and the user explicitly requests it.
