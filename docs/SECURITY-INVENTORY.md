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

## v1.6.1 field-hardening evidence

- Model prose variants cannot change policy decision hashes or release authority.
- Dangerous production, public, customer, cost, destructive data, credential, auth, security, license, core-value-reduction, and unknown lanes remain `ASK` or `STOP`.
- Disposable mutation lanes and read-only real-project fingerprints prevent unapproved target changes.
- Autopilot decision p95, ledger event/byte retention, mutation receipt retention, and output are bounded.
- The field report requires all false-authority, false-close, false-release, next-release, external-impact, target-mutation, and model-leak counters to be zero.
- OMP and `omp-core` path/hash preservation, exact nine tools, doctor, rollback preview, and `released=false` remain deployment gates.
