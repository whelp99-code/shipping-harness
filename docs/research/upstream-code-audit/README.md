# Shipping Harness Upstream Code Audit

## Audit status

| Phase | Status |
|---|---|
| Official repositories downloaded at pinned revisions | COMPLETE |
| Static source audit | COMPLETE for Shipping-relevant paths |
| File/function control-flow mapping | COMPLETE for decision, Goal/Ledger, task, routing, continuation, recovery, and stop paths |
| License review | COMPLETE for the accepted engineering direction; not legal advice |
| Selected source syntax/path validation | COMPLETE |
| Full Gajae and OMO dependency install/test suites | NOT RUN — Bun/dependencies were not installed |
| Provider-authenticated end-to-end runs | NOT RUN |
| Shipping roadmap correction | ACCEPTED on 2026-08-28 |

## Audited pins

| Upstream | Commit | Version observed | License boundary |
|---|---|---|---|
| Gajae Code | `103659a2ebf6` | 0.15.3 | MIT |
| Q00 Ouroboros | `6db4d70cca2d` | 0.51.16 | MIT |
| Oh My OpenAgent / OMO Native | `43d9c058e08b` | 5.0.0-beta.23 | Sustainable Use License 1.0 by default; selected portions differ |

Exact metadata is in [`UPSTREAM-PINS.json`](UPSTREAM-PINS.json).

## Reports

1. [`00-SCOPE-PINS-AND-METHOD.md`](00-SCOPE-PINS-AND-METHOD.md)
2. [`01-GAJAE-CODE-AUDIT.md`](01-GAJAE-CODE-AUDIT.md)
3. [`02-OUROBOROS-AUDIT.md`](02-OUROBOROS-AUDIT.md)
4. [`03-OMO-AUDIT.md`](03-OMO-AUDIT.md)
5. [`04-ABSORPTION-DECISION-MATRIX.md`](04-ABSORPTION-DECISION-MATRIX.md)
6. [`05-PROPOSED-PLAN-CORRECTIONS.md`](05-PROPOSED-PLAN-CORRECTIONS.md)
7. [`06-CODE-PATH-INVENTORY.md`](06-CODE-PATH-INVENTORY.md)

## Accepted result

```text
v0.4 automatic product decision      <- Ouroboros-derived mechanisms
v0.5 durable Goal/Evidence runtime    <- selected Gajae + Ouroboros mechanisms
v0.6 beginner plugin/local MCP        <- Shipping-owned UX
v0.7 internal OMO runtime foundation  <- actual private pinned OMO source
v0.8 bounded Team/DAG                 <- selected actual OMO capabilities after pilot proof
v0.9 internal remote/mobile ops       <- authenticated and allowlisted
final release authority               <- Shipping Harness only
```

The product is accepted for the owner's personal use and future private company-internal use. Under this boundary, actual OMO source may be used in a separate private runtime with preserved notices, modification records, exact pins, tests, and rollback. It is not mixed into Shipping Core and is not planned for public/customer distribution.

Canonical direction:

- [`../../planning/09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md`](../../planning/09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md)
- [`../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md)
