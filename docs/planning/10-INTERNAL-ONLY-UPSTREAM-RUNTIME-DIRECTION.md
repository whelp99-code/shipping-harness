# Internal-Only Upstream Runtime Direction

**Status:** DIRECTION LOCKED
**Decision date:** 2026-08-28
**Applies from:** roadmap planning after v0.4.0
**Canonical rule:** Shipping Harness is for the owner's personal use and, later, private use inside the owner's company. It is not planned for customer delivery, resale, public SaaS, or public binary/container distribution.

**Use boundary:** personal and company-internal use only.

## Direction lock

This direction is the source of truth for v0.4.0 through v1.0.0. Version plans may add implementation detail, but they may not change the following without a new explicit direction decision:

1. the user states the outcome and approves one brief rather than answering a technical interview;
2. Shipping Core owns contract, scope, budgets, human stop, evidence acceptance, Finisher, SHIPPABLE, and CLOSED;
3. Gajae and Ouroboros mechanisms are absorbed only where they fit Shipping schemas and bounded release behavior;
4. actual OMO source runs only in a separately pinned private internal runtime;
5. OMO task/runtime state never becomes release authority;
6. Team/DAG is conditional on measured need and remains bounded;
7. external/customer/public distribution is outside scope and triggers a new review;
8. every version must close before the next version starts.

Canonical version-specific development plans are listed in [`09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md`](09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md).

## 1. Decision

Shipping Harness will keep its release-governance core independent, while using proven upstream code more directly when that is faster and safer for an internal-only product.

The integration strategy is:

```text
Ouroboros decision mechanisms
  -> selected behavior is ported into Shipping decision core

Gajae Goal/Ledger mechanisms
  -> selected MIT code or algorithms may be adapted into a small Shipping-owned runtime

OMO execution mechanisms
  -> actual upstream code runs in a separately pinned private internal runtime
  -> Shipping communicates through a narrow bridge
  -> OMO never owns release approval or closure
```

This supersedes the earlier blanket clean-room-only recommendation. It does not authorize mixing large upstream source trees into Shipping Core.

## 2. Product boundary

### Allowed

- personal use by the owner;
- private use by employees of the owner's company;
- private internal forks and modifications;
- private infrastructure, source repositories, packages, and containers;
- internal automation that never exposes the upstream code or runtime as a customer product.

### Outside the accepted boundary

- selling or licensing Shipping Harness to customers;
- installing the integrated OMO runtime at a customer site;
- public npm, package, binary, source, or container publication;
- exposing the integrated runtime as a public or customer-facing SaaS;
- giving the integrated source to unrelated companies, contractors, or partners without a new review.

If any external-distribution requirement appears, OMO integration work stops until the licensing and product architecture are reviewed again.

## 3. Why the runtime stays separate

OMO is useful because its actual execution behavior is spread across multiple packages, including task state, model routing, continuation, teams, DAGs, and recovery. Copying isolated snippets into Shipping Core would lose the tested interactions and make upstream updates difficult.

The selected architecture is therefore:

```text
User / ChatGPT / Codex / Orca
              |
              v
Shipping Plugin and MCP
              |
              v
+--------------------------------------+
| Shipping Governance Core             |
| - outcome and scope decision          |
| - approval and contract lock          |
| - acceptance criteria                 |
| - human pause/abort                    |
| - evidence validation                 |
| - blocker triage                      |
| - Finisher and version close          |
+------------------+-------------------+
                   |
          hashed work order / events
                   |
                   v
+--------------------------------------+
| Internal OMO Runtime                  |
| - pinned private upstream fork        |
| - task/subagent execution             |
| - model/category routing              |
| - bounded continuation                |
| - process/session recovery            |
| - later: team and DAG execution       |
+------------------+-------------------+
                   |
                   v
             Coding agents
                   |
                   v
              Repository
```

The two runtimes may be updated and rolled back independently.

## 4. Source and repository layout

The recommended implementation uses two private repositories or workspaces.

```text
shipping-harness/
  packages/internal-omo-bridge/
  config/upstreams/omo-pin.json
  docs/internal-runtime/

shipping-harness-omo-runtime/
  upstream/oh-my-openagent/      # private fork or pinned checkout
  patches/shipping-internal/
  MODIFICATIONS.md
  LICENSE.md                     # preserved upstream license
  NOTICE/
  scripts/build-and-verify/
```

Rules:

1. The research clones under `.chatgpt2codex/upstreams/` are not production dependencies.
2. The OMO runtime source is kept out of Shipping Core's module graph.
3. Shipping stores the exact upstream commit, internal patch commit, build digest, and compatibility version.
4. License and copyright notices remain intact.
5. Internal modifications are recorded in `MODIFICATIONS.md`.
6. No public package or image publishing configuration is enabled.

## 5. Authority and state ownership

### Shipping owns

- user outcome and approved release brief;
- `.shipping/contract.yaml` and lock;
- scope and non-goals;
- acceptance criteria;
- agent/fix/time/cost budgets;
- human pause and abort;
- accepted evidence and Git SHA freshness;
- `BLOCKER / NEXT / IGNORE / UNKNOWN` classification;
- `SHIPPABLE`, `BLOCKED`, and `CLOSED` decisions.

### OMO owns

- child task and process lifecycle;
- model/category selection inside allowed policy;
- task queueing, execution, steering, and cancellation;
- internal session recovery;
- OMO-local task records, mailboxes, and later DAG state.

### OMO may not

- edit or approve the Shipping contract;
- increase Shipping budgets;
- treat its own task completion as release completion;
- reopen a closed Shipping version;
- continue after Shipping pause/abort;
- accept stale evidence from an older contract or Git SHA;
- create work unrelated to the locked scope.

## 6. Bridge contract

Shipping sends a read-only work order:

```json
{
  "work_order_version": "shipping-omo/v1",
  "release_id": "project@0.7.0",
  "contract_hash": "sha256:...",
  "git_sha": "...",
  "goal_ids": ["GOAL-001"],
  "task_ids": ["TASK-001"],
  "allowed_paths": ["src/**", "test/**"],
  "forbidden_paths": [".shipping/**", ".git/**"],
  "acceptance_ids": ["AC-001"],
  "budgets": {
    "parallel_workers": 2,
    "agent_depth": 1,
    "continuations": 3,
    "fix_cycles": 2,
    "wall_clock_seconds": 3600
  }
}
```

OMO returns normalized receipts:

```json
{
  "work_order_id": "...",
  "omo_task_id": "...",
  "shipping_task_id": "TASK-001",
  "status": "completed",
  "selected_agent": "builder",
  "selected_model": "provider/model",
  "routing_reason": "category-default",
  "git_sha": "...",
  "changed_paths": ["src/example.ts"],
  "evidence_refs": ["..."],
  "usage": {
    "turns": 4,
    "tool_calls": 12
  }
}
```

Receipts are claims until Shipping verifies them against the current repository and acceptance contract.

## 7. Default internal OMO profile

The first production profile is intentionally smaller than OMO's broad defaults.

```yaml
execution_engine: omo-internal
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

Team Mode, general DAG execution, and larger parallelism are not enabled merely because OMO supports them.

## 8. Upstream-specific decisions

### Ouroboros

Use as the main v0.4 source for:

- decision provenance;
- evidence-backed vs inferred decisions;
- conservative defaults;
- conflict and ambiguity handling;
- rollback to a durable blocked state;
- outcome-first stop conditions.

Because Shipping Core is Node-based and Ouroboros is Python-based, small mechanisms are ported with attribution and tests rather than introducing the full Python runtime into the core.

### Gajae Code

Use in v0.5 for:

- durable Goal and Task status;
- append-only evidence/checkpoint ledger;
- plan and goal receipts independent of chat transcript;
- repeated-failure fingerprinting;
- bounded review and planning-stuck outcomes.

MIT-licensed source may be adapted where it is smaller than reimplementation, but the result must fit Shipping's state and evidence schemas.

### OMO

Use actual source in the private internal runtime for:

- task state machine and child runners;
- category/agent/model routing;
- continuation ownership and stale-state suppression;
- bounded concurrency and depth;
- session suspend/resume and exactly-once completion delivery;
- later, selected Team and DAG capabilities.

Shipping does not fork OMO branding, onboarding, telemetry, memory, marketplace, or unrelated UX unless a concrete internal requirement appears.

## 9. Update and rollback policy

OMO updates are never automatic.

```text
fetch upstream
  -> review license or package-boundary changes
  -> update private fork
  -> reapply internal patch series
  -> run selected upstream package tests
  -> run Shipping bridge and adversarial tests
  -> run one disposable repository canary
  -> record new pin and build digest
  -> promote internally
```

Every promotion retains:

- previous working pin;
- previous internal patch commit;
- previous runtime artifact;
- database/state migration notes;
- rollback command and compatibility note.

A failed update returns to the previous pin without changing the active Shipping contract.

## 10. Failure and fallback policy

If the internal OMO runtime is absent, unhealthy, incompatible, or blocked:

1. Shipping reports the runtime as unavailable;
2. it does not fabricate task completion;
3. it may use an approved Codex/Generic adapter fallback when the contract permits it;
4. otherwise it stops in a durable `BLOCKED` state with the exact reason.

## 11. Version sequence

| Version | Main result |
|---|---|
| v0.4.0 | AI decides ordinary product choices; user approves one brief. |
| v0.5.0 | Durable Goal, Task, and Evidence runtime using Gajae/Ouroboros mechanisms. |
| v0.6.0 | Beginner plugin and local MCP experience; normal use requires no CLI. |
| v0.7.0 | Private internal OMO runtime foundation with task, routing, continuation, and recovery. |
| v0.8.0 | Bounded Team/DAG orchestration only after the v0.7 single-runtime pilot succeeds. |
| v0.9.0 | Authenticated internal remote/mobile control and operational hardening. |
| v1.0.0 | Stable internal Shipping Control Plane. |

## 12. Non-goals

- public/commercial distribution;
- replacing Shipping Core with OMO;
- enabling every OMO feature;
- unlimited agents, depth, continuation, time, or cost;
- allowing agent-generated changes to policy or contract;
- using OMO task completion as proof of a releasable version;
- combining v0.4 through v0.8 into one implementation release.

## 13. Reconsideration trigger

This direction must be reviewed before any of the following:

- external customer use;
- public source or package release;
- paid SaaS or managed service;
- transfer to another legal entity;
- removal of upstream notices;
- replacement of the private internal runtime with a redistributed bundle.

Until such a trigger occurs, internal direct use of the pinned OMO runtime is the accepted implementation direction.
