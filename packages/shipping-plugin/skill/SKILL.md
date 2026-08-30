---
name: shipping-harness
description: Finish a software version through a bounded, evidence-based release process. The user states the outcome, the agent proposes the smallest operable scope, the user approves, and Shipping Harness controls evidence, blockers, pause, and closure.
---

# Shipping Harness

The user is the approver, not the technical interview respondent. Use the nine Shipping MCP tools instead of asking a non-developer to edit `.shipping` files or remember CLI commands.

## Normal flow

1. Call `shipping_status` first. For a new final outcome, call `shipping_start` exactly once. MCP start is AUTO-only.
2. Use only the canonical proposal state. Never reinterpret `NEEDS_INPUT`, `DIRTY_BASELINE`, or `NEEDS_ACCEPTANCE` as approvable.
3. Treat workspace, version evidence, command/`cwd`, baseline, component graph, work themes, side-effect policy, acceptance coverage, and `releaseTrain` returned by Shipping as canonical evidence. An inferred goal is recommendation-only; the explicit user goal wins.
4. The first `releaseTrain` release is the only current contract candidate. Every future release must remain `ADVISORY_REPLAN_REQUIRED`, has no executable command authority, and must be replanned after its predecessor is CLOSED.
5. For `DIRTY_BASELINE`, show the exact hash-bound preservation plan and wait for separate user approval. Shipping never commits, stashes, resets, or discards. After a host commit of exactly the approved paths, refine with the plan hash, full commit SHA, `baselineAuthorizedByUser: true`, and `rescan: true`. This does not approve release scope.
6. For a bounded question, tied workspace, or reviewed baseline rescan, call `shipping_refine` with the exact active ID/hash. Meaningful refinement increments the same proposal revision; `changed: false` is not a new revision.
7. If coverage is incomplete, keep `NEEDS_ACCEPTANCE`. Never add stronger completion claims only in prose.
8. Render Shipping-generated `plainBriefText` first and verbatim, including `전체 개발계획`. Do not let host-model prose rewrite train order, state, readiness, acceptance, or next action. Keep exact technical evidence expandable.
9. Require explicit user confirmation before the first `shipping_approve_scope`. If the user selects `LOCAL_REVERSIBLE`, bind that one-time policy only with `confirmAutopilot: true`; otherwise use `MANUAL`.
10. When Shipping returns an autopilot decision, obey it exactly. `AUTO` and `NOTIFY` may continue only the locked reversible local work. `ASK` waits for the real consequence decision. `STOP` cannot be overridden by model prose.
11. After approval, implement only the locked current release. Use `shipping_execute` or host editing, then call `shipping_verify`.
12. Do not weaken isolation or determinism metadata. Shipping runs generated-artifact package/release checks in detached worktrees; external-state and data-state commands remain manual-only.
13. Use `shipping_fix_blockers` only for release blockers within the remaining budget. NEXT work is deferred.
14. Human pause or abort overrides every continuation request. Under `LOCAL_REVERSIBLE`, Shipping may close a fully proven local version automatically; under `MANUAL`, call `shipping_close` only after the core reports `SHIPPABLE` and the user confirms.
15. `CLOSED` is a development boundary, never `RELEASED`. Never infer deployment, publication, customer delivery, cost, data, auth/security, or license authority from an autopilot decision.

## User-facing language

Prefer: `계획 중`, `기준선 검토`, `승인 대기`, `개발 중`, `일시정지`, `막힘`, `출시 가능`, `완료`, `중단`.

Do not claim completion from agent text, task text, or an upstream harness status. Only Shipping Harness may report `SHIPPABLE` or `CLOSED`.

## Hard boundaries

- No raw shell, command, argv, environment, credential, push, deploy, purchase, or public-listener fields.
- `shipping_refine` accepts only bounded answers, an existing workspace candidate, rescan, explicit user-authorized mode change, or the exact reviewed baseline receipt fields.
- No silent approval, mode change, scope expansion, budget increase, isolated-check downgrade, or closed-version reopen.
- Do not delete or reset repository `.shipping` state during install, repair, upgrade, or uninstall.
