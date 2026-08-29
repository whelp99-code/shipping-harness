---
name: shipping-harness
description: Finish a software version through a bounded, evidence-based release process. The user states the outcome, the agent proposes the smallest operable scope, the user approves, and Shipping Harness controls evidence, blockers, pause, and closure.
---

# Shipping Harness

The user is the approver, not the technical interview respondent. Use the nine Shipping MCP tools instead of asking a non-developer to edit `.shipping` files or remember CLI commands.

## Normal flow

1. Call `shipping_status` first. For a new release, call `shipping_start` exactly once from the user's outcome. MCP start is AUTO-only.
2. Use only the canonical proposal state. Never reinterpret `NEEDS_INPUT`, `DIRTY_BASELINE`, or `NEEDS_ACCEPTANCE` as approvable.
3. Treat workspace, version evidence, command/`cwd`, baseline, component graph, work themes, side-effect policy, and acceptance coverage returned by Shipping as canonical evidence. An inferred goal is recommendation-only; the explicit user goal wins.
4. For `DIRTY_BASELINE`, show the exact hash-bound preservation plan and wait for separate user approval. Shipping never commits, stashes, resets, or discards. After a host commit of exactly the approved paths, refine with the plan hash, full commit SHA, `baselineAuthorizedByUser: true`, and `rescan: true`. This does not approve release scope.
5. For a bounded question, tied workspace, or reviewed baseline rescan, call `shipping_refine` with the exact active ID/hash. Meaningful refinement increments the same proposal revision; `changed: false` is not a new revision.
6. If coverage is incomplete, keep `NEEDS_ACCEPTANCE`. Never add stronger completion claims only in prose.
7. Show `oneScreenApproval` by default: goal, recommendation label, included, excluded, exact checks, themes, coverage, and state. Keep detailed evidence expandable.
8. Require explicit user confirmation before `shipping_approve_scope`, and only from `READY_FOR_APPROVAL`.
9. After approval, implement only locked scope. Use `shipping_execute` or host editing, then call `shipping_verify`.
10. Do not weaken isolation or determinism metadata. Shipping runs generated-artifact package/release checks in detached worktrees; external-state and data-state commands remain manual-only.
11. Use `shipping_fix_blockers` only for release blockers within the remaining budget. NEXT work is deferred.
12. Human pause or abort overrides every continuation request. Call `shipping_close` only when the core reports `SHIPPABLE`.

## User-facing language

Prefer: `계획 중`, `기준선 검토`, `승인 대기`, `개발 중`, `일시정지`, `막힘`, `출시 가능`, `완료`, `중단`.

Do not claim completion from agent text, task text, or an upstream harness status. Only Shipping Harness may report `SHIPPABLE` or `CLOSED`.

## Hard boundaries

- No raw shell, command, argv, environment, credential, push, deploy, purchase, or public-listener fields.
- `shipping_refine` accepts only bounded answers, an existing workspace candidate, rescan, explicit user-authorized mode change, or the exact reviewed baseline receipt fields.
- No silent approval, mode change, scope expansion, budget increase, isolated-check downgrade, or closed-version reopen.
- Do not delete or reset repository `.shipping` state during install, repair, upgrade, or uninstall.
