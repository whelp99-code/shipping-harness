# Gajae Code — Code-Level Audit

## Verdict

Gajae is the strongest reference for a **durable goal/evidence execution substrate**, but not for Shipping Harness's default user experience. Its interview is deliberately user-led; AI auto-answer is a fallback after the user opts out or is uncertain. Shipping should absorb Goal/Ledger and proof-freshness mechanics, while keeping `AI decides, human approves` as its own product policy.

## Actual implementation map

| Concern | Source path | Verified behavior |
|---|---|---|
| Interview contract | `packages/coding-agent/src/defaults/gjc/skills/deep-interview/SKILL.md` | Suitability gate, ambiguity tracking, bounded rounds, explicit exit/confirmation |
| Auto-answer fallback | `.../deep-interview/auto-answer-uncertain.md` | Conservative reversible answer only after user delegates or cannot decide |
| Interview state/runtime | `packages/coding-agent/src/gjc-runtime/deep-interview-state.ts`, `deep-interview-runtime.ts` | Persistent state, merges, recovery, round/ambiguity accounting |
| Ambiguity calculation | `packages/coding-agent/src/gjc-runtime/deep-interview-ambiguity.ts` | Structured ambiguity score rather than free-form confidence text |
| Plan review | `.../skills/ralplan/SKILL.md`, `gjc-runtime/ralplan-runtime.ts` | Planner plus Architect/Critic review, conflict disposition, bounded iterations |
| Goal execution contract | `.../skills/ultragoal/SKILL.md` | Goal state and evidence are authoritative; agent prose is not completion proof |
| Goal runtime | `gjc-runtime/ultragoal-runtime.ts` | Durable goal transitions, checkpoints, review/repair coordination |
| Spawn/continuation guards | `gjc-runtime/ultragoal-guard.ts` | Recursion/spawn safeguards and bounded continuation |
| Evidence | `gjc-runtime/ultragoal-evidence.ts` | Structured proof receipts |
| Freshness | `gjc-runtime/ultragoal-receipt-freshness.ts` | Source/cohort freshness checks prevent stale receipts from proving current work |

## Interview behavior

The code confirms four important facts:

1. Detailed, bounded, low-risk requests may bypass the interview.
2. Normal product decisions are routed to the user; repository and research facts may be inferred automatically.
3. The agent's auto-answer path is activated when the user says they do not know, declines, or asks the agent to decide.
4. Even after auto-answering, Gajae expects a confirmation gate before the interview closes.

The workflow also limits self-answering: repeated automatic answers trigger a forced return to a real user question. This is sensible for a consultancy-style interview, but it is the opposite of Shipping Harness's intended default.

### Shipping decision

- Do **not** copy Gajae's user-question-first default.
- Reuse the distinction between fact, assumption, decision, and unresolved ambiguity.
- Reimplement an inverse policy: AI decides reversible low-risk choices first; only exception decisions become questions.

## Ralplan behavior

`ralplan` is not an open-ended planning conversation. It has explicit reviewers and caps:

- one planner draft;
- Architect and Critic review;
- typed conflict dispositions rather than silent compromise;
- default maximum planning iterations of 5, configurable with a hard upper bound of 20;
- bounded lane review;
- cap exhaustion exits as a stuck planning state instead of pretending execution can begin.

### Shipping decision

Keep the idea of a separate proposal critic, but do not introduce a multi-round planning council in v0.4. A single deterministic critic pass is sufficient until measured failures justify more.

## Ultragoal behavior

The strongest reusable mechanisms are:

- `goals.json` as canonical current goal state;
- `ledger.jsonl` as append-only execution/proof history;
- explicit criteria state, not “done” text;
- evidence receipts tied to the current source cohort;
- stale receipt rejection;
- bounded nudge/review recursion;
- terminal critic ceilings that end in a visible blocked/override state rather than infinite activity.

Observed bounds include a default nudge ceiling of 10, review recursion cap of 3, and a finite terminal-critic non-OK ceiling. Exact defaults remain upstream policy, not values Shipping must copy.

## Absorption decision

| Feature | Decision | Reason |
|---|---|---|
| Deep interview UX | `ADAPT/OPTIONAL` | Useful only as explicit `INTERVIEW` mode |
| AI fallback answers | `REIMPLEMENT` | Reverse the default: low-risk AI choice first, user exception second |
| Structured ambiguity | `REIMPLEMENT` | Needed for exception-question gating |
| Ralplan reviewer separation | `REIMPLEMENT SMALL` | One proposal critic, bounded |
| Goal state file | `REIMPLEMENT` | Core of v0.5 durable execution |
| Append-only evidence ledger | `REIMPLEMENT` | Fits existing Shipping ledger architecture |
| Receipt freshness | `REIMPLEMENT` | Directly prevents false completion |
| Full ultragoal runtime | `ADAPTER/DEFER` | Too broad and duplicates Shipping governance |
| tmux worker orchestration | `EXCLUDE` | Operational complexity without v0.4 value |

## Main risk to avoid

Gajae's goal loop is optimized to keep work moving. Shipping Harness must remain optimized to **close or block a version**. Any imported continuation idea stays subordinate to release budget, human pause, and Finisher authority.
