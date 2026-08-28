# Security Inventory

Shipping Harness v1 is an internal-only governance control plane.

## Authority

- Human pause and abort outrank automatic continuation, remote requests, recovery, and private OMO state.
- Only the Shipping Finisher can declare `SHIPPABLE` or `CLOSED`.
- Agent text and runtime completion receipts are never release evidence by themselves.
- Evidence must bind the current contract hash and Git SHA.
- Closed releases cannot be reopened through migration, restore, or convenience commands.

## Execution and access

- Local MCP exposes high-level Shipping tools over project-root-fixed STDIO; it has no network listener or root-switching argument.
- Internal remote control requires TLS, private or loopback listening, actor signatures, timestamps, replay protection, project allowlists, and per-action permissions.
- Raw execution, environment, deployment, push, and policy-override inputs are rejected.
- All workers, retries, continuations, command duration, output, tool calls, and graph values are finite.
- Team/DAG is disabled by the v0.8 evidence gate.

## Data and recovery

- Backup manifests are signed, hashed, bounded, and exclude authentication material.
- Restored non-terminal work is forced to `PAUSED`; terminal work is not replayed.
- Logs and receipts redact authorization and authentication values.
- Package reports and operational evidence are excluded from the installable tarball.

## Private OMO

The private OMO runtime is separately pinned and licensed for personal or company-internal use. Its notices and modifications are preserved outside Shipping Core. Signed receipts remain subordinate to independent Shipping verification, and no public OMO source, binary, image, or service is produced.

The machine-readable inventory and critical-file digests are stored in `docs/reports/v1-security-inventory.json`.
