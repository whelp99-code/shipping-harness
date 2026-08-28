# Private OMO Runtime Boundary

Shipping Harness uses OMO only as a separate personal/company-internal runtime. OMO source is not copied into Shipping Core and is never publicly published by this project.

Authority order:

1. human pause/abort;
2. Shipping contract, scope and budgets;
3. Shipping evidence and Release Judge;
4. private OMO task execution and receipts.

The runtime accepts signed `shipping-omo/v1` work orders over local JSON-STDIO. It exposes no public listener and no raw shell field. Every receipt is cryptographically bound to the work order and explicitly marked `requiresShippingVerification: true`. A completed OMO task therefore cannot close a Shipping release.

Default limits: two workers, depth one, three continuations, two fix cycles, 3,600 seconds and 200 tool calls. Team and DAG modes remain disabled in v0.7.

When the private runtime is unavailable, Shipping may use only a fallback already present in the locked contract. Otherwise the release becomes durably BLOCKED. Updates are pinned, tested in isolation, canaried, and rollback retains the prior tag/commit.
