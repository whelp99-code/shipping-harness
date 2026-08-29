# Shipping Harness v1 Compatibility

Shipping Harness v1.0.1 is an internal-only control plane. A component is reported as supported only after its exact combination passes the local compatibility checks; discovery of a binary alone is not proof of readiness.

## Supported core environment

| Surface | Supported v1 range | Failure behavior |
|---|---|---|
| Operating system | Linux and macOS | Other platforms report unsupported |
| CPU | x64 and arm64 | Other architectures report unsupported |
| Node.js | 22 or newer; 22.23.2 tested on Ubuntu | Startup or compatibility gate fails |
| Git | 2.30 or newer | Git-bound evidence and locking are unavailable |
| Shipping upgrade source | v0.6.0, v0.7.0, v0.8.0, v0.9.0 | Earlier releases require manual export/reinitialization |
| MCP | `2026-07-28`; compatible initialize clients `2025-11-25` and `2025-03-26` | Unsupported protocol versions fail clearly |
| OMP | `15.10.12`, MCP `2025-03-26` | OMP-style initialize, tool discovery, and `shipping_status` are regression-tested |
| Local MCP transport | STDIO only | No local network listener is opened |
| Internal remote transport | TLS 1.2+ on loopback/private addresses | Public or unspecified listeners are rejected |

## Execution paths

| Path | v1 status | Authority boundary |
|---|---|---|
| Direct host-agent editing | Supported | Shipping verifies current Git evidence before closure |
| Generic/Codex adapter | Supported when its configured command is present | Commands cannot be supplied through MCP or remote input |
| Private OMO runtime | Optional, internal-only, separately pinned | OMO completion is a claim until Shipping verifies it |
| Team/DAG | Disabled by the v0.8 evidence gate | Enabling it requires a new locked contract |

## Private OMO pin

The compatible private runtime is recorded in `config/upstreams/omo-pin.json`. Shipping Core and the private runtime remain independently upgradeable and removable. A changed upstream commit, bridge schema, build digest, or internal patch requires canary and rollback proof before promotion.

## Runtime check

`compatibilityReport()` in `packages/stable-control/compatibility.mjs` reports the observed Node, platform, architecture, and Git version together with stable supported ranges. An unsupported combination cannot be presented as live or healthy.

## Internal-only boundary

This matrix does not authorize public package publication, public SaaS, customer installation, or public redistribution of the integrated OMO runtime. Any such requirement is a direction change and release blocker until licensing and architecture are reviewed.
