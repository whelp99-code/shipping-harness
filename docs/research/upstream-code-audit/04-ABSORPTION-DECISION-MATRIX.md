# Upstream Absorption Decision Matrix

## Decision rule

Shipping Harness absorbs a mechanism only when it strengthens one of these product outcomes:

1. AI can safely decide without interrogating the user.
2. The approved release contract remains immutable.
3. Work state and proof survive sessions.
4. Loops terminate with `CLOSED` or a durable `BLOCKED` reason.
5. Human pause/abort remains absolute.
6. The implementation is small enough to finish and legally safe to distribute.

## Final matrix

| Capability | Gajae evidence | Ouroboros evidence | OMO evidence | Shipping decision | Target |
|---|---|---|---|---|---|
| Repository facts vs product decisions | Deep interview separates research/repo facts from user decisions | Ledger source types distinguish facts, preferences, defaults and inference | Plan gates distinguish real user request from model action | Reimplement provenance classes | v0.4 |
| AI-first reversible defaults | Only fallback after user uncertainty | Automatic driver applies conservative defaults with ambiguity/rollback gates | Model/category routing uses deterministic fallbacks | Use Ouroboros pattern as primary reference | v0.4 |
| Exception-only questions | Interview asks one question at a time by default | Unsafe/conflicting slots remain blocked and require resolution | Plan-gated agents require genuine user action | Ask only for high-risk, irreversible, external or unresolved-core decisions | v0.4 |
| Immutable release definition | Interview/plan outputs feed execution | Frozen Seed and executable contract | Plans and goals are durable sources of truth | Extend Shipping Contract; no second Seed format | v0.4 |
| Decision provenance ledger | Interview state and ambiguity | Source/status/provenance histogram and conflict priority | Model routing provenance | Reimplement in Shipping proposal/contract | v0.4 |
| Proposal critic | Architect/Critic bounded plan review | Ledger completeness and Seed validation | Metis/Momus plan gates | One bounded critic pass; no planning council | v0.4 |
| Goal state | `goals.json` canonical state | Seed/ledger/event store | ULW goals and Boulder checklist | Reimplement minimal Goal/Task state | v0.5 |
| Append-only proof ledger | `ledger.jsonl` | EventStore and decision ledger | Task JSONL/WAL/mailbox receipts | Extend existing Shipping ledger | v0.5 |
| Evidence freshness | Source/cohort receipt freshness | Seed/event authority and evaluation gates | Run epoch and exactly-once terminal notices | Reimplement current-SHA/current-contract proof | v0.5 |
| Continuation cap | Bounded nudge/review/critic ceilings | Generation/time/stagnation caps | Two inspected continuation caps of 8 plus stale-signature suppression | Reimplement shared bounded continuation policy | v0.5 |
| Stagnation/oscillation stop | Planning and critic ceilings | Plateau, stagnation, A/B oscillation and repetitive-feedback detectors | Stale status/signature suppression | Reimplement small deterministic detectors | v0.5 |
| Human pause authority | Human-blocked paths exist but goal execution pushes forward | Watchdog creates durable blocked state | Boulder `paused` can still auto-continue | Shipping policy overrides all upstream behavior | v0.5 |
| Role orchestration | Planner/Architect/Critic roles | Interview/evaluator/evolution roles | Task agents, categories, teams and DAG | Five logical roles only | v0.7 |
| Model routing | Not primary | Model use exists but not target mechanism | Deterministic overrides/category/provider fallback with provenance | Clean-room capability router | v0.7 |
| Concurrency/depth budgets | Worker/iteration caps | Generation and wall-clock budgets | Default/global/provider/model concurrency, depth and residency limits | Explicit bounded policy; never allow unlimited | v0.7 |
| Durable task recovery | Goal state persists | EventStore/watchdog/Ralph state | Suspend/resume, leases, owner checks, exact-once notification | Reimplement only after single-agent pilots | v0.7+ |
| Full deep interview | Strong implementation | Alternate automatic interview | Not central | Optional `INTERVIEW` mode only | Later |
| Full evolutionary runtime | No | Large core capability | No | Exclude from active release; next-version proposal only | Later/adapter |
| Full team/DAG runtime | tmux workers | Workflow/evolution runtime | Large durable team/DAG engine | Adapter or defer; do not duplicate | Later/adapter |
| Upstream source inclusion | MIT permits with notices | MIT permits with notices | Default license restricts commercial redistribution | No source copying from any upstream; clean-room implementation for all | Always |

## Product architecture after audit

```text
User outcome
   -> Decision Composer              (Ouroboros-inspired, v0.4)
   -> One approval brief
   -> Immutable Shipping Contract
   -> Goal/Evidence Runtime          (Gajae-inspired, v0.5)
   -> Beginner Plugin / Approval UI  (v0.6)
   -> Bounded Role Router            (OMO-inspired, v0.7)
   -> Deterministic Verification
   -> Finisher / Release Judge       (Shipping-owned)
   -> CLOSED or BLOCKED
```

## Authority order

```text
1. Human pause / abort
2. Locked Shipping Contract
3. Release budgets and blocker policy
4. Fresh deterministic evidence
5. Finisher closure decision
6. Planner / Builder / Reviewer preferences
7. External harness continuation requests
```

No upstream agent or loop may move above this order.

## Clean-room rule

The implementation team may use the reports and public contracts to design behavior. It must not paste or mechanically translate substantial upstream source. OMO in particular remains an adapter boundary because its repository default license is not a permissive commercial distribution license.
