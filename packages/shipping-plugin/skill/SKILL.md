---
name: shipping-harness
description: Finish a software version through a bounded, evidence-based release process. The user states the outcome, the agent proposes the smallest operable scope, the user approves, and Shipping Harness controls evidence, blockers, pause, and closure.
---

# Shipping Harness

The user is the approver, not the technical interview respondent. Use the nine Shipping MCP tools instead of asking a non-developer to edit `.shipping` files or remember CLI commands.

## Normal flow

1. Call `shipping_status` first. For a new final outcome, call `shipping_start` exactly once. MCP start is AUTO-only.
2. Treat `intentGate` as canonical. For a terse or ambiguous analysis request, show the completed read-only analysis and the single `Q-INTENT-001` choice. Default to `ANALYZE_ONLY`; do not create or describe a Goal Charter, authoritative Release Train, implementation, baseline mutation, verification execution, or closure before intent confirmation.
3. `ANALYZE_ONLY` stops at `ANALYSIS_COMPLETE`. `PLAN_ONLY` may reach `PLAN_COMPLETE` but cannot be approved or executed. Only explicitly confirmed `IMPLEMENT` or `AUTOPILOT` may reach `READY_FOR_APPROVAL`. Record the workflow choice through the existing `shipping_refine` tool; never add a tenth tool or infer a choice from host-model prose.
4. Use only the canonical proposal state. Never reinterpret `INTENT_CONFIRMATION_REQUIRED`, `ANALYSIS_COMPLETE`, `PLAN_COMPLETE`, `NEEDS_INPUT`, `DIRTY_BASELINE`, or `NEEDS_ACCEPTANCE` as approvable.
5. Treat workspace, version evidence, command/`cwd`, baseline, component graph, work themes, side-effect policy, acceptance coverage, `goalDiscovery`, `decisionLedger`, and `releaseTrain` returned by Shipping as canonical evidence. An inferred goal is recommendation-only; the explicit user goal wins.
6. If `goalDiscovery.status` is `NEEDS_INPUT`, show only Shipping-generated product questions and their safe defaults. Never invent technical questions. Record explicit answers or the delegated recommended default through the same `shipping_refine` proposal. Two unresolved rounds end in `STOP`.
7. A ready direction may seed planning only. It has no command, approval, closure, deployment, model, or `RELEASED` authority. Do not rewrite its candidate, critic, charter, evidence, or ledger hashes.
6. The first `releaseTrain` release is the only current contract candidate. Every future release must remain `ADVISORY_REPLAN_REQUIRED`, has no executable command authority, and must be replanned after its predecessor is CLOSED.
7. For `DIRTY_BASELINE`, show the exact hash-bound preservation plan and wait for separate user approval. Shipping never commits, stashes, resets, or discards. After a host commit of exactly the approved paths, refine with the plan hash, full commit SHA, `baselineAuthorizedByUser: true`, and `rescan: true`. This does not approve release scope.
8. For a bounded question, tied workspace, or reviewed baseline rescan, call `shipping_refine` with the exact active ID/hash. Meaningful refinement increments the same proposal revision; `changed: false` is not a new revision.
9. If coverage is incomplete, keep `NEEDS_ACCEPTANCE`. Never add stronger completion claims only in prose.
10. Render Shipping-generated `plainBriefText` first and verbatim, including `전체 개발계획`. Do not let host-model prose rewrite train order, state, readiness, acceptance, or next action. Keep exact technical evidence expandable.
11. Require explicit user confirmation before the first `shipping_approve_scope`. If the user selects `LOCAL_REVERSIBLE`, bind that one-time policy only with `confirmAutopilot: true`; otherwise use `MANUAL`.
12. When Shipping returns an autopilot decision, obey it exactly. `AUTO` and `NOTIFY` may continue only the locked reversible local work. `ASK` waits for the real consequence decision. `STOP` cannot be overridden by model prose.
13. After approval, implement only the locked current release. Use `shipping_execute` or host editing, then call `shipping_verify`.
14. Do not weaken isolation or determinism metadata. Shipping runs generated-artifact package/release checks in detached worktrees; external-state and data-state commands remain manual-only.
15. Use `shipping_fix_blockers` only for release blockers within the remaining budget. NEXT work is deferred.
16. Human pause or abort overrides every continuation request. Under `LOCAL_REVERSIBLE`, Shipping may close a fully proven local version automatically; under `MANUAL`, call `shipping_close` only after the core reports `SHIPPABLE` and the user confirms.
17. `CLOSED` is a development boundary, never `RELEASED`. Never infer deployment, publication, customer delivery, cost, data, auth/security, or license authority from an autopilot decision.

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
