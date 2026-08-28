# Security Inventory

- Human pause and abort outrank every automatic continuation.
- Only the Shipping Finisher can declare SHIPPABLE or CLOSED.
- MCP and internal remote tools expose high-level Shipping operations; raw shell/argv/environment input is rejected.
- The private OMO runtime is separately pinned and internal-only. Receipts require independent Shipping verification.
- Remote control requires TLS, a private listener, actor signatures, timestamp and nonce replay protection, project allowlists and permissions.
- Backup manifests are signed and hashed and exclude credential-like files.
- All execution budgets are finite. Team and DAG modes are disabled.

The exact machine inventory and critical-file digests are in `docs/reports/v1-security-inventory.json`.
