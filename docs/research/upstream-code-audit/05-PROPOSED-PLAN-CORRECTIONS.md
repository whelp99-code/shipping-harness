# Accepted Plan Corrections After Upstream Audit

**Status:** Accepted on 2026-08-28
**Supersedes:** the pre-audit v0.5–v0.7 sequence and the blanket clean-room-only OMO recommendation

## Why the plan changed

The code audit established three different realities:

1. Ouroboros has the strongest automatic-decision implementation for v0.4.
2. Gajae has compact, useful Goal/Ledger and repeated-failure mechanisms for v0.5.
3. OMO's useful execution behavior is a large, tested multi-package runtime rather than one small hook.

The owner also fixed the product boundary as personal and future company-internal use only. Under that boundary, direct internal OMO use is acceptable as an engineering direction, provided notices and internal-use restrictions are preserved.

Therefore:

```text
Do not rebuild all OMO behavior inside Shipping Core.
Do not mix the OMO monorepo into Shipping Core.
Use actual OMO code in a separately pinned private internal runtime.
Keep Shipping governance and Finisher independent.
```

## Accepted version sequence

### v0.4.0 — AI Decides, Human Approves

Primary source influence: Ouroboros.

Deliver:

- decision provenance;
- safe reversible defaults;
- conflict/ambiguity detection;
- mandatory-risk escalation;
- one approval brief;
- rollback to durable BLOCKED;
- no Goal runtime, OMO runtime, team, or DAG.

### v0.5.0 — Durable Goal and Evidence Runtime

Primary source influence: Gajae plus selected Ouroboros authority rules.

Deliver:

- contract-to-Goal/Task compiler;
- stable IDs and dependencies;
- append-only Goal/Task/Evidence ledger;
- restart recovery;
- current-contract/current-SHA proof;
- repeated-failure fingerprints;
- durable planning-stuck and blocked outcomes;
- single coding-agent pilot.

Do not add OMO, team, or general DAG in this version.

### v0.6.0 — Beginner Plugin and Local Agent UX

Deliver:

- local plugin + MCP + skill bundle;
- one install path;
- one approval surface;
- simple progress/blocker/completion surfaces;
- guided project selection and doctor;
- normal use without CLI or JSON editing.

This version proves usability before OMO complexity is introduced.

### v0.7.0 — Internal OMO Runtime Foundation

Use actual OMO source from a private pinned runtime/fork.

First capability set:

- task state machine;
- child runners;
- category/agent/model routing and provenance;
- bounded concurrency/depth;
- same-session ownership;
- stale-state suppression;
- continuation limit;
- session suspend/resume;
- exactly-once terminal notification;
- cancel/interrupt/steer;
- update and previous-pin rollback.

Initial Shipping limits:

```text
parallel workers = 2
agent depth = 1
continuations = 3
fix cycles = 2
Team Mode = OFF
DAG Mode = OFF
unlimited values = forbidden
```

### v0.8.0 — Bounded Team and DAG

Entry requires a successful v0.7 pilot and evidence that larger coordination solves a real bottleneck.

Deliver selected actual OMO capabilities:

- Planner/Builder/Tester/Reviewer roles;
- Finisher outside the team;
- Shipping-generated task graph;
- explicit dependency and scope mapping;
- node-scoped retry/amend;
- maximum team 4 and parallel 2 by default;
- no-progress and role ping-pong detection;
- measurable comparison against v0.7 and direct-agent execution.

Team/DAG stays disabled by default if the benchmark shows no completion benefit.

### v0.9.0 — Internal Remote Control and Operations

Deliver:

- authenticated internal remote MCP/gateway;
- project allowlists;
- signed approval receipts;
- blocker/completion notifications;
- mobile/web control;
- backup/restore;
- runtime pin upgrade and rollback runbooks;
- security and cross-project isolation tests.

### v1.0.0 — Stable Internal Shipping Control Plane

Deliver:

- stable schemas and compatibility matrix;
- Shipping and OMO runtime support matrix;
- repeatable completion benchmark;
- incident/backup/restore/rollback operations;
- complete upstream license and modification inventory;
- non-developer end-to-end internal pilot.

## OMO repository rule

The production OMO source does not live in `.chatgpt2codex/upstreams/`; that directory remains research-only.

Recommended structure:

```text
shipping-harness/
  packages/internal-omo-bridge/
  config/upstreams/omo-pin.json

shipping-harness-omo-runtime/
  upstream/oh-my-openagent/
  patches/shipping-internal/
  MODIFICATIONS.md
  LICENSE.md
  NOTICE/
```

The runtime repository is private and has no public publish workflow.

## Non-negotiable authority

```text
Human stop
  > Shipping contract and budgets
  > Shipping evidence and blocker policy
  > Shipping Finisher
  > OMO runtime state
  > individual agents
```

OMO task completion is never release completion.

## Reconsideration trigger

Stop and review the direction before:

- customer delivery;
- public source/package/image publication;
- public or paid SaaS;
- transfer to an unrelated legal entity;
- removal of upstream notices;
- any attempt to make OMO the owner of Shipping contracts or closure.

## Canonical planning documents

- [`../../planning/09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md`](../../planning/09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md)
- [`../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md)
