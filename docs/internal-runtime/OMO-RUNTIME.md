# Private OMO Runtime Boundary

> **Deprecated as of v1.11.1.** The pinned private OMO runtime repository was archived and `packages/internal-omo-bridge` is retired from the release gates; `npm run test:omo-bridge` runs manually only. Code, schemas, and historical receipts are retained. See `packages/internal-omo-bridge/DEPRECATED.md` and `../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md`. Reactivation requires a new ADR and contract.

Shipping Harness uses OMO only as a separate personal or company-internal runtime. OMO source is not copied into Shipping Core and is never publicly published by this project.

## Authority order

1. human pause or abort;
2. Shipping contract, approved scope, and budgets;
3. Shipping evidence and Release Judge;
4. Shipping Finisher and release receipt;
5. private OMO task execution and receipts.

The runtime accepts signed `shipping-omo/v1` work orders over local JSON-STDIO. It exposes no public listener and no unrestricted execution input. Every receipt is cryptographically bound to work order, release, contract, Git SHA, session, Goal/Task, acceptance, scope, and budgets. A completed OMO task therefore remains an execution claim until Shipping verifies the current repository.

## Current internal pin

The exact promoted upstream, internal patch, release commit, tag, build digest, package artifact, license, notice, modifications, isolated-install proof, and rollback proof are recorded in `config/upstreams/omo-pin.json` and the referenced private-runtime evidence files. The current promotion may be newer than the historical v0.7 pilot; the v1 gate validates the current pin directly rather than rewriting old pilot evidence.

## Bounded profile

- parallel workers: 2;
- agent depth: 1;
- continuations: 3;
- fix cycles: 2;
- wall clock: 3,600 seconds;
- tool calls: 200;
- turns: 50;
- Team Mode: disabled;
- DAG Mode: disabled;
- unlimited values: forbidden;
- Shipping Finisher only: required.

When the runtime is unavailable, Shipping may use only a fallback already present in the locked contract. Otherwise the release becomes durably `BLOCKED`. Updates are pinned, tested in isolation, canaried, and rollback retains the previous verified tag and commit without reopening the Shipping release.
