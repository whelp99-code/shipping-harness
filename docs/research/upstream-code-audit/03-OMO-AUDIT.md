# OMO Native / Oh My OpenAgent — Code-Level Audit

## Updated verdict

OMO is the strongest source for role/model routing, durable child-task orchestration, continuation hooks, concurrency control, and crash recovery.

The code audit showed that `packages/omo-native` is mainly a branded launcher/distribution adapter over a pinned Senpi engine and staged plugin. The execution behavior is spread across:

- `packages/omo-senpi/`;
- `packages/senpi-task/`;
- `packages/team-core/`;
- `packages/delegate-core/`;
- `packages/model-core/`;
- `packages/omo-config-core/`.

The owner's accepted product boundary is personal and future company-internal use only. Therefore the recommended direction is no longer to rebuild every useful OMO mechanism from scratch. Actual OMO source may run in a separately pinned private internal runtime, while Shipping Core remains independent and authoritative for release governance.

## Actual implementation layers

| Layer | Source path | Role | Shipping use |
|---|---|---|---|
| Native distribution | `packages/omo-native/` | Launcher, branding, setup/import, signals, doctor, pinned Senpi startup | Use only the runtime/termination patterns needed for the private launcher; exclude branding/import UX |
| Senpi adapter | `packages/omo-senpi/` | Component composition, hooks, task/team UI and host integration | Use selected task, continuation, and lifecycle integration paths |
| Task engine | `packages/senpi-task/` | Durable task state, store, runners, concurrency, DAG, recovery | Primary internal runtime source from v0.7 |
| Team persistence | `packages/team-core/` | Mailboxes, tasklist, locks, reservations, resume | Defer to v0.8 after a v0.7 pilot |
| Delegation | `packages/delegate-core/` | Harness-neutral delegation contracts | Use as required by selected task runtime paths |
| Model routing | `packages/model-core/` | Overrides, category defaults, availability, provider fallback, provenance | Use selected routing paths behind Shipping policy |
| Configuration | `packages/omo-config-core/` | Task/team/DAG bounds and defaults | Use schema/validation while overriding broad or unlimited defaults |

## OMO Native launcher

`packages/omo-native/AGENTS.md` confirms that the native package launches an exact-pinned Senpi CLI with the staged OMO plugin. Signal forwarding is asynchronous to avoid orphaning the engine. TERM/HUP use a bounded grace window, while doctor routines avoid broad pattern-killing.

### Shipping decision

The private runtime may preserve exact-child ownership, asynchronous signal forwarding, bounded grace, and stale-process diagnostics. It does not need OMO branding, public publishing, provider import UX, or automatic self-update.

## Continuation hooks

### ulw-execute continuation

`packages/omo-senpi/src/components/ulw-execute-continuation/index.ts`:

- listens on `agent_end`;
- requires same-session Boulder work;
- reads checklist/ledger state rather than model memory;
- suppresses stale repeated signatures;
- caps consecutive automatic continuations at 8;
- resets the cap on real user input;
- considers both `active` and `paused` Boulder work continuable.

### ulw-loop continuation

`packages/omo-senpi/src/components/ulw-loop/index.ts`:

- probes a session-scoped goals/ledger run;
- fails closed when session identity is unavailable;
- skips inactive, blocked, superseded, and complete goals;
- suppresses identical stale status;
- caps continuation at 8;
- gives Boulder execution precedence when both loops are present.

### Shipping decision

Use the actual continuation runtime where useful, but apply stricter Shipping policy:

```text
human pause/abort = no continuation
closed/blocked/out-of-budget = no continuation
session ownership unavailable = no continuation
initial Shipping continuation cap = 3
stale signature/status = no continuation
```

Shipping `PAUSED` is never treated as OMO-continuable work.

## Task and role orchestration

`packages/senpi-task` implements:

- seven task statuses and audited transitions;
- JSONL persistent records;
- in-process and RPC-process child runners;
- concurrency and depth admission;
- exactly-once completion notification per task/run epoch;
- steering, cancel, interrupt, and resident revival;
- named teams and durable mailboxes;
- DAG compilation, WAL/checkpoint persistence, retry, amend, and recovery;
- seeded adversarial/chaos tests for notification, terminal idempotence, slot leaks, and rejection handling.

### Shipping decision

v0.7 uses only the foundation:

- task state and child runners;
- task cancel/interrupt/steer;
- bounded concurrency and depth;
- session suspend/resume;
- exactly-once terminal notification;
- routing provenance.

Team and general DAG capabilities remain disabled until v0.8 entry criteria are met.

Logical Shipping roles are:

```text
Planner -> Builder -> Tester -> Reviewer
                    |
                    v
          independent Shipping Finisher
```

Finisher is not an OMO team member.

## Model routing

`packages/model-core/src/model-resolution-pipeline.ts` preserves routing provenance and follows a deterministic order:

1. UI/user override;
2. category default when available;
3. user fallback models;
4. provider fallback chain;
5. system default.

Availability and connected-provider checks prevent claiming an unavailable model as a valid route.

### Shipping decision

Use selected actual routing code inside the internal runtime, but constrain it with the Shipping work order:

- only approved roles/categories;
- only observed available models/providers;
- recorded route and reason;
- no route may expand scope or budget;
- fallback failure becomes truthful unavailable/BLOCKED.

Shipping does not need to copy provider tables into Core.

## Bounded defaults

`packages/omo-config-core/src/schema/task.ts` includes defaults such as task concurrency 5, global concurrency at least 8, depth 1, resident child caps, team maximum 8, parallel team maximum 4, 120-minute team wall clock, and DAG limits. Some zero values mean unlimited.

The first Shipping profile deliberately narrows them:

```yaml
parallel_workers: 2
agent_depth: 1
continuation_limit: 3
fix_cycles: 2
team_mode: false
dag_mode: false
unlimited_values_allowed: false
```

## Recovery and delivery

The task engine suspends children on session shutdown, uses owner/lease checks, revives only the resumed session's children, avoids replaying terminal work, and preserves exactly-once completion delivery. Admission overflow remains suspended instead of being lost. Retryable recovery failure rolls back; unrecoverable nonterminal work becomes lost.

### Shipping decision

Use selected recovery paths from v0.7, but require:

- same Shipping release/work-order identity;
- current contract hash and allowed Git state;
- no revival after pause/abort/close/budget exhaustion;
- terminal OMO state is not sufficient for Shipping completion;
- fallback or durable BLOCKED when recovery cannot be proven safe.

## License and internal-use boundary

The repository default is Sustainable Use License 1.0. It allows the accepted personal/company-internal direction, subject to its terms, but constrains distribution. Selected files or incorporated third-party components may carry separate licenses.

Accepted engineering policy:

- actual OMO source may run in a private internal runtime/fork;
- license and copyright notices remain intact;
- internal modifications are recorded;
- exact upstream and internal patch commits are pinned;
- public package/image/source publishing is disabled;
- customer installation, resale, public SaaS, or unrelated-company distribution is outside scope;
- any external-distribution requirement triggers a new review before work continues.

This is an engineering interpretation, not legal advice.

## Final absorption decision

| Feature | Decision | Target |
|---|---|---|
| Native branding/onboarding/provider import | EXCLUDE | — |
| Exact-child launcher and signal handling | SELECTIVE INTERNAL USE | v0.7 |
| Task state machine and child runners | ACTUAL PRIVATE RUNTIME | v0.7 |
| Model/category routing provenance | ACTUAL PRIVATE RUNTIME | v0.7 |
| Continuation ownership/stale suppression | ACTUAL PRIVATE RUNTIME + SHIPPING OVERRIDE | v0.7 |
| Session recovery/exactly-once completion | ACTUAL PRIVATE RUNTIME | v0.7 |
| Human pause and release closure | SHIPPING ONLY | Always |
| Team runtime | SELECTIVE ACTUAL RUNTIME AFTER PILOT | v0.8 |
| DAG runtime | SELECTIVE ACTUAL RUNTIME AFTER PILOT | v0.8 |
| Memory/reflection/telemetry/marketplace | DEFER OR EXCLUDE | Post-v1.0 or never |
| Full OMO source inside Shipping Core | EXCLUDE | Always |
| Private separately pinned OMO runtime | ACCEPT | v0.7 |

## Main risk to avoid

OMO optimizes for keeping active work moving. Shipping Harness optimizes for a bounded, evidence-backed release decision.

```text
Human stop
  > Shipping contract/budget/evidence
  > Shipping Finisher
  > OMO runtime state
  > individual agent continuation
```

Canonical direction: [`../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).
