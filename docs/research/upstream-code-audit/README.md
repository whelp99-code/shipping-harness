# Shipping Harness Upstream Code Audit

## Audit status

| Phase | Status |
|---|---|
| Official repositories downloaded locally | COMPLETE |
| Exact revisions pinned | COMPLETE — see `UPSTREAM-PINS.json` |
| Shipping-relevant file/function control-flow audit | COMPLETE |
| License boundary review | COMPLETE for engineering decisions |
| Dependency-free syntax check | COMPLETE for selected Ouroboros Python control paths |
| Full upstream dependency install/build/test suites | NOT RUN — Bun and repository dependencies are not installed |
| Provider-authenticated end-to-end runs | NOT RUN |
| Shipping roadmap correction | COMPLETE as an audit recommendation; implementation remains a separate release |

This is a **code-level control-path audit**, not a claim that every file in all three repositories was reviewed. The reviewed paths cover the features Shipping Harness may absorb: requirement decision, immutable specification, Goal/Ledger persistence, evidence freshness, bounded continuation, role/model routing, concurrency, human stop, recovery, and release authority.

## Local pins

| Repository | Pin | Version observed | License boundary |
|---|---:|---|---|
| Gajae Code | `103659a2ebf6` | 0.15.3 | MIT |
| Q00 Ouroboros | `6db4d70cca2d` | 0.51.16 | MIT |
| Oh My OpenAgent / OMO Native | `43d9c058e08b` | 5.0.0-beta.23 | Sustainable Use License 1.0 by default; selected portions differ |

Full commit hashes and origins are stored in [`UPSTREAM-PINS.json`](UPSTREAM-PINS.json). The clones live only under ignored `.chatgpt2codex/upstreams/`; no upstream source is committed or redistributed by Shipping Harness.

## Reports

1. [`00-SCOPE-PINS-AND-METHOD.md`](00-SCOPE-PINS-AND-METHOD.md)
2. [`01-GAJAE-CODE-AUDIT.md`](01-GAJAE-CODE-AUDIT.md)
3. [`02-OUROBOROS-AUDIT.md`](02-OUROBOROS-AUDIT.md)
4. [`03-OMO-AUDIT.md`](03-OMO-AUDIT.md)
5. [`04-ABSORPTION-DECISION-MATRIX.md`](04-ABSORPTION-DECISION-MATRIX.md)
6. [`05-PROPOSED-PLAN-CORRECTIONS.md`](05-PROPOSED-PLAN-CORRECTIONS.md)
7. [`06-CODE-PATH-INVENTORY.md`](06-CODE-PATH-INVENTORY.md)
8. [`UPSTREAM-PINS.json`](UPSTREAM-PINS.json)

## Main result

```text
v0.4 AI decision contract          <- Ouroboros is the primary code reference
v0.5 durable Goal/Evidence runtime <- Gajae + existing Shipping core
v0.6 beginner plugin and approval  <- prove non-developer usability first
v0.7 bounded role orchestration    <- small clean-room OMO subset
release authority                  <- Shipping Harness only
```

Shipping Harness should **not merge or fork all three runtimes**. It should independently reimplement a small set of verified mechanisms, preserve attribution and license boundaries, and leave the complete upstream runtimes behind adapters.
