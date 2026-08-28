# OMO Native / Oh My OpenAgent — Code-Level Audit

## Verdict

OMO is the strongest reference for role/model routing, durable child-task orchestration, continuation hooks, concurrency control, and crash recovery. However, `packages/omo-native` is primarily a branded launcher/distribution adapter over a pinned Senpi engine and a staged `omo-senpi` plugin. The real orchestration code is distributed across `omo-senpi`, `senpi-task`, `team-core`, `delegate-core`, `model-core`, and related packages.

Shipping should independently reimplement only a small bounded subset. The repository's default Sustainable Use License also makes source copying or commercial redistribution unsuitable without separate permission.

## Actual implementation layers

| Layer | Source path | Role |
|---|---|---|
| Native distribution | `packages/omo-native/` | Launcher, branding, setup/import, signals, doctor, pinned Senpi startup |
| Senpi adapter | `packages/omo-senpi/` | Component composition, hooks, task/team UI and host integration |
| Task engine | `packages/senpi-task/` | Durable task state machine, store, runners, concurrency, DAG, recovery |
| Team persistence | `packages/team-core/` | Mailboxes, tasklist, locks, reservations, resume |
| Delegation | `packages/delegate-core/` | Harness-neutral delegation contracts |
| Model routing | `packages/model-core/` | Overrides, category defaults, availability, provider fallback, provenance |
| Configuration | `packages/omo-config-core/` | Task/team/DAG bounds and defaults |

## OMO Native launcher

`packages/omo-native/AGENTS.md` confirms that the native package launches an exact-pinned Senpi CLI with the staged OMO plugin. Signal forwarding is asynchronous to avoid orphaning the engine. TERM/HUP use a bounded grace window, while doctor routines avoid broad pattern-killing.

### Shipping decision

Keep process-group termination, bounded grace, and exact-child ownership principles. Do not reproduce the branded launcher or provider import system.

## Continuation hooks

### ulw-execute continuation

`packages/omo-senpi/src/components/ulw-execute-continuation/index.ts`:

- listens on `agent_end`;
- requires same-session owned Boulder work;
- reads checklist/ledger state rather than model memory;
- suppresses stale repeated signatures;
- caps consecutive automatic continuations at 8;
- resets the cap on real user input;
- can continue `active` or `paused` Boulder work.

### ulw-loop continuation

`packages/omo-senpi/src/components/ulw-loop/index.ts`:

- probes a session-scoped goals/ledger run;
- fails closed when session identity is unavailable;
- skips inactive, blocked, superseded, and complete goals;
- suppresses identical stale status;
- caps continuation at 8;
- gives Boulder execution precedence when both loops are present.

### Shipping decision

Adopt stale-signature suppression, ownership checks, and a finite continuation cap. Do **not** treat Shipping's human `PAUSED` state as continuable. Shipping human pause remains stronger than every OMO-style continuation hook.

## Task and role orchestration

`packages/senpi-task` implements:

- seven task statuses and explicit transition audits;
- JSONL persistent records;
- in-process and RPC-process child runners;
- concurrency and depth admission;
- exactly-once completion notification per task/run epoch;
- steering, cancel, interrupt, and resident revival;
- named teams and durable mailboxes;
- DAG compilation, WAL/checkpoint persistence, retry, amend, and recovery;
- seeded adversarial/chaos tests for notification, terminal idempotence, slot leaks, and rejection handling.

The curated agents are `explore`, `librarian`, `metis`, and `momus`. Plan-review agents are protected by `packages/senpi-task/src/agents/invocation-guard.ts`, which requires a genuine user request and a real plan artifact, and rejects attempts after execution has begun.

### Shipping decision

Shipping v0.6 should start with only five logical roles:

```text
Planner -> Builder -> Tester -> Reviewer -> Finisher
```

This is a policy graph, not a permanent multi-process team. Parallel workers are created only when expected benefit exceeds coordination cost and all work maps to the locked release contract.

## Model routing

`packages/model-core/src/model-resolution-pipeline.ts` preserves routing provenance and follows a deterministic order:

1. UI/user override;
2. category default when available;
3. user fallback models;
4. provider fallback chain;
5. system default.

Availability and connected-provider checks prevent claiming an unavailable model as a valid route.

### Shipping decision

Reimplement a simpler capability router in v0.6. Shipping must route by task requirement and observed availability, while recording why a model/agent was selected. It should not copy OMO's provider tables.

## Bounded defaults

`packages/omo-config-core/src/schema/task.ts` includes explicit defaults and caps:

- task default concurrency 5;
- global concurrency dynamically at least 8;
- default depth 1;
- resident child cap dynamically at least 8;
- team maximum 8 members, 4 parallel members, 120-minute wall clock;
- DAG maximum 64 nodes per run and 16 runs per session;
- continuation cap 8 in the inspected hooks.

A value of 0 can mean unlimited for some task caps. Shipping must not inherit that spelling: Shipping production policy should forbid unlimited execution.

## Recovery and delivery

The task engine suspends children on session shutdown, uses owner/lease checks, revives only the resumed session's children, avoids replaying terminal work, and preserves exactly-once completion delivery. Admission overflow remains suspended instead of being lost. Retryable recovery failure rolls back; unrecoverable nonterminal work becomes lost.

These are valuable patterns for a later durable orchestration layer, but too large for v0.4.

## License boundary

The repository default is Sustainable Use License 1.0, limiting use/modification mainly to internal business or non-commercial/personal purposes and limiting distribution. Selected files or incorporated third-party components may carry separate licenses; for example, the staged Senpi plugin license covers only specific LSP adapter portions under MIT.

Therefore:

- no OMO source is copied into Shipping Harness;
- no substantial OMO runtime is vendored;
- design behavior is independently reimplemented from observed contracts;
- any future direct dependency or distribution requires a new legal review.

## Absorption decision

| Feature | Decision | Reason |
|---|---|---|
| Native launcher/branding/import | `EXCLUDE` | Not a Shipping product need |
| Continuation cap and stale signature | `REIMPLEMENT v0.5` | Prevents repeated empty turns |
| Same-session ownership checks | `REIMPLEMENT v0.5` | Prevents cross-session continuation |
| Human-pause behavior | `OVERRIDE` | Shipping pause must always win |
| Durable task state machine | `REIMPLEMENT SMALL v0.6` | Useful, but full engine is too large |
| Role/category routing | `REIMPLEMENT SMALL v0.6` | Five roles and capability-based routing only |
| Model fallback provenance | `REIMPLEMENT SMALL v0.6` | Record why a route was chosen |
| Team runtime | `DEFER` | No need before single-release pilots |
| DAG engine | `DEFER/ADAPT` | Existing coding hosts can execute graphs |
| Exactly-once completion ideas | `REIMPLEMENT v0.6+` | Important for durable background work |
| Full OMO source/runtime | `ADAPTER ONLY` | License and complexity boundary |

## Main risk to avoid

OMO optimizes for keeping an active plan moving. Shipping Harness optimizes for a bounded release decision. OMO-style continuation is subordinate to Shipping budgets, blocker policy, human stop, and Finisher closure.
