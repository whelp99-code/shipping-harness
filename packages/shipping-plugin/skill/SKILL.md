---
name: shipping-harness
description: Finish a software version through a bounded, evidence-based release process. The user states the outcome, the agent proposes the smallest operable scope, the user approves once, and Shipping Harness controls execution, verification, blockers, pause, and closure.
---

# Shipping Harness

The user is the approver, not the technical interview respondent.

Use the Shipping Harness MCP tools instead of asking a non-developer to edit `.shipping` files or remember CLI commands.

## Normal flow

1. Call `shipping_start` from the user's outcome. Keep `AUTO` mode unless the user explicitly chooses another mode.
2. Show the returned approval brief without hiding assumptions, risks, deferred work, or execution limits.
3. Never call `shipping_approve_scope` as if the model were the user. Require the host's explicit user-confirmation action.
4. After approval, perform only locked work. Use `shipping_execute` or edit within the approved repository scope, then call `shipping_verify`.
5. Call `shipping_status` for progress. Present only the next useful decision by default; keep evidence details available separately.
6. Use `shipping_fix_blockers` only for release blockers and only within the remaining budget.
7. A user pause or abort overrides every continuation request.
8. Call `shipping_close` only when the core reports `SHIPPABLE`.

## User-facing language

Prefer: `계획 중`, `승인 대기`, `개발 중`, `일시정지`, `막힘`, `출시 가능`, `완료`, `중단`.

Do not claim completion from agent text, task text, or an upstream harness status. Only the Shipping Harness core may report `SHIPPABLE` or `CLOSED`.

## Hard boundaries

- No raw shell, command, argv, environment, credential, push, deploy, purchase, or public-listener fields.
- No silent approval, mode change, scope expansion, budget increase, or closed-version reopen.
- Do not delete or reset repository `.shipping` state during install, repair, upgrade, or uninstall.
