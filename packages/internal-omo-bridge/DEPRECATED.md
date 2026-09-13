# Deprecated — packages/internal-omo-bridge

**Status: deprecated since 2026-09-13 (ADR: retire the private OMO runtime bridge).**

See `../../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md` for
the full decision record.

## What happened

The pinned private OMO runtime repository (`shipping-harness-omo-runtime`) was archived
as a duplicate development tool. `config/upstreams/omo-pin.json` still points at its old
path, and the archived runtime's sealed manifest, upstream pin, and snapshot receipts
reference that same old absolute path and are digest-sealed, so they cannot be fixed
without rebuilding the runtime. As of v1.9.0 the 5 tests in `test/omo/` that exercise a
live runtime were already skipping with a WARNING in `release:verify`; as of v1.11.1 that
step is removed from the release gates entirely (see `scripts/release-verify.mjs`).

## What is retained and why

This package's code is **not deleted**. It is retained because:

- `schemas/v1/omo-work-order.schema.json` and `schemas/v1/omo-receipt.schema.json` are
  stable v1 authority surfaces (`omoWorkOrder` / `omoReceipt`) pinned by
  `test/stable/surface-freeze.test.mjs`, independent of whether a runtime is installed.
- Historical OMO receipts (for example `docs/internal-runtime/v0.7-pilot.json`) must
  remain readable and verifiable against those schemas.
- `src/adapters/omo.mjs` (the OMO Native adapter, a process/config/event probe unrelated
  to this bridge) and the nine `shipping_*` MCP tools are unaffected by this deprecation.

## What is retired

- `npm run test:omo-bridge` is no longer part of `npm run check`, `npm run release:verify`,
  or any other automated gate. It remains runnable manually, and will fail closed (not
  silently pass) if pointed at a runtime that does not match the pin.
- No new work order should be issued against the archived runtime.

## Reactivation

Reactivating this bridge against a live runtime requires:

1. A new ADR recording why the private OMO runtime is needed again and where it lives.
2. A new Shipping contract that reintroduces `test:omo-bridge` (or an equivalent) into
   `scripts/release-verify.mjs`.
3. A rebuilt/re-pinned runtime whose `runtime-manifest.json`, `config/upstream-pin.json`,
   and evidence files match `config/upstreams/omo-pin.json` at its (possibly updated) path.

Until then, treat this package as historical/reference code only.
