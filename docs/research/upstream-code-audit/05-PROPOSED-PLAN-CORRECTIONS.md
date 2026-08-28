# Proposed Shipping Harness Plan Corrections After Upstream Audit

## Status

This document is an audit recommendation. It does not silently change a locked release contract. v0.4 remains the active DRAFT and keeps the already approved product direction: **AI decides, human approves**.

## What the code audit changed

The previous roadmap grouped too many upstream ideas into v0.5. The source audit showed that:

- Gajae Goal/Ledger and freshness mechanisms are separable and small enough for one release.
- Ouroboros decision provenance and safe-default recovery belong in v0.4, before execution orchestration.
- OMO's real orchestration is a large multi-package task/team/DAG/recovery runtime, not one small hook.
- A general-user plugin should be delivered before adding a large multi-agent runtime.

Therefore OMO-style role orchestration should move later rather than being bundled into the first durable-execution release.

## Recommended sequence

### v0.4.0 — AI Decides, Human Approves

Keep the current goal, but implement it with the audited Ouroboros mechanisms:

- decision source/provenance classes;
- repository facts, existing conventions, user goals, conservative defaults, assumptions, conflicts;
- deterministic source priority;
- ambiguity/completeness gate;
- reversible safe defaults;
- rollback to `NEEDS_USER_INPUT` or durable `BLOCKED` when inference is unsafe;
- one approval brief;
- at most one bounded proposal-critic pass.

Explicitly exclude Goal runtime, subagents, teams, model routing, evolution generations, and plugin UI.

### v0.5.0 — Durable Goal and Evidence Runtime

Use the audited Gajae mechanisms plus the existing Shipping core:

- minimal `goals.json`-equivalent state, preferably integrated into `.shipping` schemas;
- append-only goal/evidence ledger;
- acceptance-criterion mapping;
- evidence bound to current contract and Git SHA;
- stale-receipt rejection;
- bounded continuation with progress signature;
- stagnation/oscillation detection;
- terminal `CLOSED` or `BLOCKED` outcome.

No permanent multi-agent team and no model router in this release.

### v0.6.0 — Beginner Plugin and Approval UI

Keep the usability priority:

- package the MCP, skill, and policies as a plugin;
- scope approval card;
- simple `RUNNING / BLOCKED / CLOSED` status;
- blocker explanation and next-version backlog;
- hide CLI details from the user;
- require client-side confirmation for mutations.

This release proves that a non-developer can use the decision and completion runtime before orchestration complexity is added.

### v0.7.0 — Bounded Role Orchestration

Reimplement only a small clean-room OMO subset:

- logical roles: Planner, Builder, Tester, Reviewer, Finisher;
- capability-based route selection with provenance;
- default depth 1;
- small explicit concurrency cap;
- same-release ownership checks;
- exactly-once terminal result ingestion;
- bounded restart/recovery;
- Shipping human pause and budget authority above all continuations.

Do not implement OMO Team Mode or a general DAG platform unless pilot evidence proves it necessary.

### v0.8.0 — Remote Control and Real-Project Pilot

- authenticated remote MCP;
- project allowlist;
- mobile/ChatGPT control;
- GitHub release integration behind approval;
- before/after completion-rate benchmark on real unfinished projects;
- failure taxonomy and operational runbook.

### v1.0.0 — Stable Shipping Control Plane

- stable contract, decision, evidence, and adapter schemas;
- supported local and remote integrations;
- migration and rollback policy;
- security/operations handover;
- published completion benchmark;
- compatibility and license inventory.

## v0.4 implementation slices after audit

| Slice | Content | Exit condition |
|---|---|---|
| PR-013 | Decision source/status/provenance schema | Deterministic validation and serialization tests pass |
| PR-014 | Repository-evidence decision composer | Low-risk choices produce recorded defaults without questions |
| PR-015 | Conflict, ambiguity and exception-question gate | Unsafe/conflicting core decisions produce no more than three questions |
| PR-016 | One-page approval brief and proposal critic | Brief is concise, Git-bound and has one critic receipt |
| PR-017 | Approval, rollback and MCP integration | AI cannot self-approve; stale proposal and failed inference roll back safely |
| PR-018 | Adversarial validation and self-release | AC-0401..0412 pass; v0.4 closes with zero blockers |

## Required v0.4 adversarial cases

1. Repository fact conflicts with user goal.
2. Two equal-priority sources disagree.
3. AI proposes a paid external service without approval.
4. AI proposes data deletion or migration.
5. Confidence is high but evidence is absent.
6. A safe default later fails validation.
7. More than three questions are generated.
8. The model tries to approve its own proposal.
9. Git changes after the approval brief is generated.
10. A reviewer asks for an optional refactor after all release gates pass.

## Decision gate before v0.7

Bounded role orchestration must not begin until real v0.4-v0.6 pilots show at least one of these:

- single-agent execution is a measurable completion bottleneck;
- independent reviewer separation significantly lowers false-done rate;
- parallelism lowers completion cost or time without increasing scope drift;
- recovery of background work is required by actual users.

Without that evidence, OMO remains an adapter rather than a feature source.
