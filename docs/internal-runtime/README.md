# Private OMO Runtime Integration — v0.7.0

Shipping Harness v0.7 delegates bounded internal execution to a **separate private repository** at `shipping-harness-omo-runtime`. OMO source is not copied into Shipping Core or its package.

## Authority

Shipping owns outcome, scope, approval, budgets, human pause/abort, evidence acceptance, blocker classification, SHIPPABLE, and CLOSED. The private runtime owns only its child process and returns a signed receipt. Even a `completed` receipt contains:

```json
{
  "requires_shipping_verification": true,
  "shipping_finisher_authority": true,
  "terminal_replay_allowed": false
}
```

## Promoted runtime

The exact upstream commit, internal patch commit, release commit, package digest, build digest, OMO/Senpi versions, evidence paths, and bounded policy are recorded in [`config/upstreams/omo-pin.json`](../../config/upstreams/omo-pin.json).

The promoted profile is fixed to:

- at most two workers;
- delegation depth one;
- at most three continuations;
- at most two fix cycles;
- Team Mode disabled;
- DAG Mode disabled;
- unlimited values forbidden;
- public publishing disabled;
- human stop and Shipping Finisher authority mandatory.

## Validation

```bash
npm run test:omo-bridge
node scripts/omo-pilot.mjs
node scripts/omo-pilot.mjs --verify-only
```

The pilot report is [`v0.7-pilot.json`](v0.7-pilot.json). It proves an actual installed OMO receipt followed by independent Shipping verification and CLOSED. The same report records the v0.8 Team/DAG entry-gate decision.

## Failure behavior

If the private runtime is missing or incompatible, Shipping uses an explicitly approved Codex/Generic adapter when one exists. Otherwise it records a durable BLOCKED issue. It never fabricates OMO success or silently changes the contract.

## License boundary

OMO remains under its upstream Sustainable Use License. This integration is limited to the owner's personal use and future internal business use inside the owner's company. No customer delivery, public package, public source bundle, public image, or public SaaS path is provided.
