---
name: shipping-harness
description: Finish a software version through a bounded, evidence-based release process. The user states the outcome, the agent proposes the smallest operable scope, the user approves, and Shipping Harness controls evidence, blockers, pause, and closure.
---

# Shipping Harness

The user is the approver, not the technical interview respondent. Use the nine Shipping MCP tools instead of asking a non-developer to edit `.shipping` files or remember CLI commands.

## Normal flow

0. If the project already has a plan (`docs/planning/`, `STATUS.json`, a roadmap), and `docs/shipping-plan.json` does not yet exist, offer to read it and write `docs/shipping-plan.json` (schema `shipping-harness/plan-v1`, see `docs/SHIPPING-PLAN.md`) — never any `command`/`shell`/`args`/`argv`/`env`/`environment` key, only stage `acceptanceRefs` from `shipping-harness plan check --json`. Set `revision: 1` and `sources[].sha256`. This is a normal file the user reviews and commits; Shipping Harness never writes or executes it. If `docs/shipping-plan.json` already exists, this is an **update**, not a rewrite: run `shipping-harness plan check --json` first, never change a `protectedStageIds` entry's id/title/outcome/scope/acceptanceRefs/size/dependsOn or delete it, reflect roadmap changes only by editing an unstarted stage or adding one, bump `revision` by one, and recompute `sources[].sha256`. See "Updating an existing plan" in `docs/SHIPPING-PLAN.md`.
1. Call `shipping_status` first. For a new final outcome, call `shipping_start` exactly once. MCP start is AUTO-only.
2. Treat `intentGate` as canonical. For a terse or ambiguous analysis request, show the completed read-only analysis and the single `Q-INTENT-001` choice. Default to `ANALYZE_ONLY`; do not create or describe a Goal Charter, authoritative Release Train, implementation, baseline mutation, verification execution, or closure before intent confirmation.
3. `ANALYZE_ONLY` stops at `ANALYSIS_COMPLETE`. `PLAN_ONLY` may reach `PLAN_COMPLETE` but cannot be approved or executed. Only explicitly confirmed `IMPLEMENT` or `AUTOPILOT` may reach `READY_FOR_APPROVAL`. Record the workflow choice through the existing `shipping_refine` tool; never add a tenth tool or infer a choice from host-model prose.
4. Use only the canonical proposal state. Never reinterpret `INTENT_CONFIRMATION_REQUIRED`, `ANALYSIS_COMPLETE`, `PLAN_COMPLETE`, `NEEDS_INPUT`, `DIRTY_BASELINE`, or `NEEDS_ACCEPTANCE` as approvable.
5. Treat workspace, version evidence, command/`cwd`, baseline, component graph, work themes, side-effect policy, acceptance coverage, `goalDiscovery`, `decisionLedger`, and `releaseTrain` returned by Shipping as canonical evidence. An inferred goal is recommendation-only; the explicit user goal wins.
6. If `goalDiscovery.status` is `NEEDS_INPUT`, show only Shipping-generated product questions and their safe defaults. Never invent technical questions. Record explicit answers or the delegated recommended default through the same `shipping_refine` proposal. Two unresolved rounds end in `STOP`.
7. A ready direction may seed planning only. It has no command, approval, closure, deployment, model, or `RELEASED` authority. Do not rewrite its candidate, critic, charter, evidence, or ledger hashes.
8. The first `releaseTrain` release is the only current contract candidate. Every future release must remain `ADVISORY_REPLAN_REQUIRED`, has no executable command authority, and must be replanned after its predecessor is CLOSED.
9. `shipping_start` commits the user's working tree first, as one local undoable commit, and returns `baselineCommit` (`{sha, filesCommitted, untrackedIncluded, undo}`) or `null`. Show that line before anything else and keep the exact undo command (`git reset --soft HEAD~1`) visible. Never describe it as a push, tag, or anything irreversible. If it fails with `ERR_BASELINE_UNSAFE_UNTRACKED`, report the named file and stop: nothing was staged or committed, and the user handles that file. Pass `commitBaseline: false` only when the user asks to keep their tree uncommitted. If the proposal carries `BASELINE_ALREADY_PASSING`, say plainly that every required check already passes on the committed baseline so this release would prove nothing, and let the user decide.
10. For `DIRTY_BASELINE` (only reachable with `commitBaseline: false`), show the exact hash-bound preservation plan and wait for separate user approval. Shipping never commits, stashes, resets, or discards. After a host commit of exactly the approved paths, refine with the plan hash, full commit SHA, `baselineAuthorizedByUser: true`, and `rescan: true`. This does not approve release scope.
11. For a bounded question, tied workspace, or reviewed baseline rescan, call `shipping_refine` with the exact active ID/hash. Meaningful refinement increments the same proposal revision; `changed: false` is not a new revision.
12. If the proposal's `diagnostics` carry `GOAL_PATH_ADDED: …`, show the widened path with the goal words that caused it — the goal sentence is the only thing that can widen an approved scope. `GOAL_PATH_REFUSED: …` means a path named in the goal was not added; report it rather than retrying with a different spelling.
13. If coverage is incomplete, keep `NEEDS_ACCEPTANCE`. Never add stronger completion claims only in prose.
14. Render Shipping-generated `plainBriefText` first and verbatim, including `전체 개발계획` and, when a plan is bound, the `## 전체 목표` / `## 이번 릴리즈` / `## 작은 수정` blocks. `## 전체 목표` (PROGRAM) has no execution or approval authority — only the proposal named under `## 이번 릴리즈` (MILESTONE or PATCH) is approvable. Do not let host-model prose rewrite train order, state, readiness, acceptance, or next action. Keep exact technical evidence expandable.
15. Require explicit user confirmation before the first `shipping_approve_scope`. If the user selects `LOCAL_REVERSIBLE`, bind that one-time policy only with `confirmAutopilot: true`; otherwise use `MANUAL`.
16. When Shipping returns an autopilot decision, obey it exactly. `AUTO` and `NOTIFY` may continue only the locked reversible local work. `ASK` waits for the real consequence decision. `STOP` cannot be overridden by model prose.
17. After approval, implement only the locked current release. Use `shipping_execute` or host editing, then call `shipping_verify`.
18. Do not weaken isolation or determinism metadata. Shipping runs generated-artifact package/release checks in detached worktrees; external-state and data-state commands remain manual-only.
19. Use `shipping_fix_blockers` only for release blockers within the remaining budget. NEXT work is deferred.
20. A closed receipt's `postLockCommits` and status's `commitsSinceLock` are evidence, not a verdict. Show commits that entered the release after approval; never claim they are approved work and never treat them as a blocker.
21. Human pause or abort overrides every continuation request. Under `LOCAL_REVERSIBLE`, Shipping may close a fully proven local version automatically; under `MANUAL`, call `shipping_close` only after the core reports `SHIPPABLE` and the user confirms.
22. `CLOSED` is a development boundary, never `RELEASED`. Never infer deployment, publication, customer delivery, cost, data, auth/security, or license authority from an autopilot decision.

## User-facing language

Prefer: `계획 중`, `기준선 검토`, `승인 대기`, `개발 중`, `일시정지`, `막힘`, `출시 가능`, `완료`, `중단`.

Do not claim completion from agent text, task text, or an upstream harness status. Only Shipping Harness may report `SHIPPABLE` or `CLOSED`.

## Hard boundaries

- No raw shell, command, argv, environment, credential, push, deploy, purchase, or public-listener fields.
- `shipping_refine` accepts only bounded answers, an existing workspace candidate, rescan, explicit user-authorized mode change, or the exact reviewed baseline receipt fields.
- No silent approval, mode change, scope expansion, budget increase, isolated-check downgrade, or closed-version reopen.
- Do not delete or reset repository `.shipping` state during install, repair, upgrade, or uninstall.

## v1.8.1 field rule

Treat `goalDirectionField` and its report as evidence only. Render Shipping-generated questions, direction, Goal Charter, train, and next action without host-model rewriting. A model cannot turn field PASS into approval, execution, CLOSED, deployment, or RELEASED authority.
