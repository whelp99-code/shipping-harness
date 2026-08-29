---
name: shipping-harness
description: Finish a software version through a bounded, evidence-based release process. The user states the outcome, the agent proposes the smallest operable scope, the user approves once, and Shipping Harness controls execution, verification, blockers, pause, and closure.
---

# Shipping Harness

The user is the approver, not the technical interview respondent.

Use the Shipping Harness MCP tools instead of asking a non-developer to edit `.shipping` files or remember CLI commands.

## Normal flow

1. Call `shipping_start` once from the user's outcome. MCP start is `AUTO` only; never switch modes or create replacement proposals to improve the answer.
2. Use only the canonical proposal state returned by Shipping. Repeated identical starts must reuse the active proposal; do not reinterpret `NEEDS_INPUT`, `DIRTY_BASELINE`, or `NEEDS_ACCEPTANCE` as approvable.
3. Treat the returned workspace, version evidence, acceptance commands, and each command's `cwd` as canonical. Never invent stronger acceptance in prose.
4. When state is `DIRTY_BASELINE`, show the exact baseline plan and wait for separate user approval. Shipping never commits, stashes, resets, or discards. After a host-side commit of exactly the approved paths, refine with the plan hash, full commit SHA, `baselineAuthorizedByUser: true`, and `rescan: true`. This does not approve the release scope.
4. When Shipping returns a bounded question or tied workspace, call `shipping_refine` only with the exact active proposal ID/hash and the user's structured choice. Meaningful refinement keeps the proposal ID and increments its revision; an evidence-identical rescan returns `changed: false` and must not be described as a new revision.
5. Show the returned approval brief without hiding assumptions, risks, deferred work, acceptance strength, dirty paths, or execution limits.
6. Never call `shipping_approve_scope` as if the model were the user. Require the host's explicit user-confirmation action and only when state is `READY_FOR_APPROVAL`.
7. After approval, perform only locked work. Use `shipping_execute` or edit within the approved repository scope, then call `shipping_verify`.
8. Call `shipping_status` for progress. Present only the next useful decision by default; keep evidence details available separately.
9. Use `shipping_fix_blockers` only for release blockers and only within the remaining budget.
10. A user pause or abort overrides every continuation request.
11. Call `shipping_close` only when the core reports `SHIPPABLE`.

## User-facing language

Prefer: `계획 중`, `승인 대기`, `개발 중`, `일시정지`, `막힘`, `출시 가능`, `완료`, `중단`.

Do not claim completion from agent text, task text, or an upstream harness status. Only the Shipping Harness core may report `SHIPPABLE` or `CLOSED`.

## Hard boundaries

- No raw shell, command, argv, environment, credential, push, deploy, purchase, or public-listener fields.
- `shipping_refine` may receive only bounded answers, an existing workspace candidate, rescan, or an explicitly user-authorized mode change.
- No silent approval, mode change, scope expansion, budget increase, or closed-version reopen.
- Do not delete or reset repository `.shipping` state during install, repair, upgrade, or uninstall.
