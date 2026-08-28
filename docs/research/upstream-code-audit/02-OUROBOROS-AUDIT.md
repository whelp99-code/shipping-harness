# Q00 Ouroboros — Code-Level Audit

## Verdict

Ouroboros is the primary code reference for Shipping Harness v0.4. It implements the difficult middle ground between “ask the user everything” and “silently guess”: immutable specification, provenance-classed decisions, deterministic conflict handling, conservative defaults, ambiguity thresholds, rollback, and durable BLOCKED outcomes.

## Actual implementation map

| Concern | Source path | Verified behavior |
|---|---|---|
| Interactive interview | `src/ouroboros/bigbang/interview.py` | Structured interview and ledger population |
| Automatic interview driver | `src/ouroboros/auto/interview_driver.py` | Bounded rounds, answer refinement, closure gate, safe-default recovery |
| Decision ledger | `src/ouroboros/auto/ledger.py` | Source/status/provenance, conflict priority, completeness |
| Immutable Seed | `src/ouroboros/core/seed.py` | Frozen Pydantic model containing goal, constraints, ACs, non-goals, exit conditions |
| Seed contract validation | `src/ouroboros/core/seed_contract.py` | Executability and contract checks |
| Event persistence | `src/ouroboros/persistence/event_store.py` | Durable event stream/replay substrate |
| Evolution loop | `src/ouroboros/evolution/loop.py` | Generation execution and evaluation |
| Convergence | `src/ouroboros/evolution/convergence.py` | Success, stagnation, plateau, oscillation, repetitive-feedback and max-generation stops |
| Runtime controls | `src/ouroboros/runtime/controls.py` | Session wall-clock control |
| Watchdog | `src/ouroboros/runtime/watchdog.py` | Durable cancellation and BLOCKED transition |
| Ralph loop | `src/ouroboros/ralph_loop.py` | Cross-generation bounded execution and authoritative timeout outcome |

## Immutable Seed

`Seed` is a frozen specification object, not merely a generated markdown document. It includes goal, actors, constraints, non-goals, acceptance criteria, principles, exit conditions, task type, and brownfield context. `SeedMetadata` carries ambiguity, degraded state, unresolved slots, recovery reason, and decision provenance counts.

### Shipping decision

Do not add a second Seed format. Extend the existing Shipping Contract with a `decisionManifest` and immutable proposal hash. The Shipping contract remains the one source of truth.

## Decision provenance and conflict handling

The ledger distinguishes sources such as user goal, repository fact, existing convention, user preference, conservative default, assumption, non-goal, inference, auto-fill inference, and blocker. Statuses distinguish missing, weak, defaulted, inferred, confirmed, conflicting, and blocked.

Conflict resolution is deterministic. Higher-priority facts win; equal-priority contradictions remain `CONFLICTING`. The system does not invent a compromise to hide disagreement.

This directly supports the chosen Shipping principle:

```text
AI makes the reversible decision.
The system records why.
A real conflict or unsafe decision becomes one concise question.
```

## Automatic interview driver

The automatic driver is bounded. At the pinned revision it has finite round and timeout defaults and closes only when the ledger is complete and ambiguity is below threshold. When round limits are reached:

- local, reversible, audited gaps may receive conservative defaults;
- defaults must be persisted through the same ledger path;
- ambiguity must become acceptable;
- failed default synthesis is rolled back;
- unsafe unresolved gaps become durable `BLOCKED`, not fabricated completion.

The inspected defaults include a 60-second answer deadline, 12-round ceiling, and 0.20 closure ambiguity threshold. Shipping should treat these as reference values rather than copy them blindly.

## Evolution and stopping

Ouroboros is not literally “run forever.” The convergence code stops on:

- verified outcome success;
- acceptance regressions or missing validation;
- stagnation;
- score plateau;
- A/B oscillation;
- repetitive feedback;
- wall-clock or generation limits.

A verified first generation may stop immediately even when a nominal minimum generation count exists. The Ralph loop also ensures a timeout becomes the authoritative final outcome instead of leaking an earlier success.

### Shipping decision

Absorb the stop detectors as ideas, not the generation engine. Shipping needs at most a small “next-version evolution proposal” after closure; it must never evolve the active release contract automatically.

## Watchdog and recovery

The watchdog records cancellation durably and transitions the expected state to `BLOCKED`. Runtime controls include an overall session wall clock; the inspected default is four hours, with zero disabling the watchdog. Shipping should not permit an unlimited production default.

## Absorption decision

| Feature | Decision | Reason |
|---|---|---|
| Provenance-classed decision ledger | `REIMPLEMENT v0.4` | Core of AI-first, auditable decisions |
| Deterministic conflict detection | `REIMPLEMENT v0.4` | Prevents silent bad assumptions |
| Conservative reversible defaults | `REIMPLEMENT v0.4` | Replaces user-heavy interviews |
| Ambiguity/completeness closure gate | `REIMPLEMENT v0.4` | Defines when one approval brief is ready |
| Immutable Seed | `MERGE INTO CONTRACT` | Avoid duplicate specification formats |
| Rollback to BLOCKED | `REIMPLEMENT v0.4` | Fail closed when inference is unsafe |
| EventStore concepts | `ADAPT v0.5` | Existing Shipping ledger can cover most needs |
| Convergence detectors | `REIMPLEMENT SMALL v0.5+` | Useful for bounded repair/evaluation |
| Full generation/evolution engine | `EXCLUDE FROM ACTIVE RELEASE` | Conflicts with version closure and scope lock |
| Ralph long-running loop | `ADAPTER/DEFER` | Useful externally, not core Shipping ownership |

## Main risk to avoid

“Evolution” must never mutate an approved current-version contract. Shipping may propose a new version after closure, but the active release stays immutable.
