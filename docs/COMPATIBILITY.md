# Shipping Harness v1 Compatibility

Shipping Harness v1.2.0 is an internal-only control plane. A component is supported only after its exact combination passes local compatibility checks; discovery of a binary alone is not readiness proof.

The v1.0.2 proposal surface exposes one canonical state. `NEEDS_INPUT`, `DIRTY_BASELINE`, and `NEEDS_ACCEPTANCE` are fail-closed states and can never be interpreted as approval readiness by a host agent.

The v1.1.0 surface adds bounded Git-tracked nested-workspace selection, command-and-`cwd` authority binding, mechanical version evidence, and the ninth tool `shipping_refine`.

The v1.1.1 deployment surface adds local package backup, atomic OMP configuration merge, actual-host smoke testing, exact nine-tool protocol verification, install receipts, doctor, and digest-checked rollback. It does not modify OMP itself.

The v1.1.2 proposal surface projects one canonical state into every compatibility field, retains old proposal bytes and hashes on read, includes exact command working directories in approval briefs, and makes evidence-identical refinement idempotent.

The v1.2.0 baseline surface classifies dirty paths with tracked-state evidence, excludes only proven non-product runtime/generated entries from approval blocking, and verifies a separately user-approved direct baseline commit against an exact plan hash and path set. Shipping itself exposes no Git mutation.

## Supported core environment

| Surface | Supported v1 range | Failure behavior |
|---|---|---|
| Operating system | Linux and macOS | Other platforms report unsupported |
| CPU | x64 and arm64 | Other architectures report unsupported |
| Node.js | 22 or newer; 22.23.2 tested on Ubuntu | Startup or compatibility gate fails |
| Git | 2.30 or newer | Git-bound evidence and locking are unavailable |
| Shipping package upgrade | v0.6.0 through v1.1.0 | Earlier releases require manual export/reinitialization |
| MCP | current `2026-07-28`; compatible initialize clients `2025-11-25` and `2025-03-26` | Unsupported versions fail clearly |
| OMP primary host | `18.0.10`, `omo-balance` wrapper + standalone `omp-core`, MCP `2025-03-26` | Version, worker smoke, nine-tool inventory, and status call must pass |
| OMP compatibility host | source-linked `15.10.12`, MCP `2025-03-26` | Same protocol and nine-tool checks apply |
| Local MCP transport | STDIO only | No local network listener is opened |
| Internal remote transport | TLS 1.2+ on loopback/private addresses | Public or unspecified listeners are rejected |

## OMP deployment boundary

The supported OMP integration manages only the user-global Shipping package and five Shipping-owned OMP files or file sections. It preserves:

- the installed OMP executable and router;
- provider credentials and model routing;
- unrelated MCP servers;
- non-Shipping approval policies;
- existing AGENTS content outside the managed block;
- target-project source and `.shipping` state.

A successful installation must report the same actual OMP version before and after deployment.

## Execution paths

| Path | v1 status | Authority boundary |
|---|---|---|
| Direct host-agent editing | Supported | Shipping verifies current Git evidence before closure |
| Generic/Codex adapter | Supported when its configured command is present | Commands cannot be supplied through MCP or remote input |
| OMP main harness | Supported on the exact hosts above | OMP implements; Shipping owns scope, pause, evidence, and close |
| Private OMO runtime | Optional, internal-only, separately pinned | Runtime completion is a claim until Shipping verifies it |
| Team/DAG | Disabled by the v0.8 evidence gate | Enabling it requires a new locked contract |

## Private OMO pin

The compatible private runtime is recorded in `config/upstreams/omo-pin.json`. Shipping Core and the private runtime remain independently upgradeable and removable. A changed upstream commit, bridge schema, build digest, or internal patch requires canary and rollback proof before promotion.

## Runtime checks

`compatibilityReport()` in `packages/stable-control/compatibility.mjs` reports observed Node, platform, architecture, and Git together with stable ranges.

`shipping-harness-omp doctor` additionally verifies the installed Shipping package, actual OMP version and smoke, MCP entry, approval policy, AGENTS block, Skill, exact nine-tool protocol surface, and install receipt.

## Internal-only boundary

This matrix does not authorize public package publication, public SaaS, customer installation, or public redistribution of the integrated OMO runtime. Any such requirement is a direction change and release blocker until licensing and architecture are reviewed.
