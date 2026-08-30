# Shipping Harness stable schemas v1

These schemas freeze the internal v1 authority surfaces. Every root rejects unknown fields, records its migration owner, uses bounded values, and has a validated example. Public or customer distribution is out of scope.

| Surface | Schema ID | Schema | Example | Unknown fields |
|---|---|---|---|---|
| contract | `shipping-harness/v1` | [contract.schema.json](./contract.schema.json) | [contract.example.json](./examples/contract.example.json) | reject |
| lock | `shipping-harness/lock-v1` | [lock.schema.json](./lock.schema.json) | [lock.example.json](./examples/lock.example.json) | reject |
| state | `shipping-harness/state-v1` | [state.schema.json](./state.schema.json) | [state.example.json](./examples/state.example.json) | reject |
| decision | `shipping-harness/decision-v1` | [decision.schema.json](./decision.schema.json) | [decision.example.json](./examples/decision.example.json) | reject |
| goalGraph | `shipping-harness/goals-v1` | [goals.schema.json](./goals.schema.json) | [goals.example.json](./examples/goals.example.json) | reject |
| evidence | `shipping-harness/evidence-v1` | [evidence.schema.json](./evidence.schema.json) | [evidence.example.json](./examples/evidence.example.json) | reject |
| release | `shipping-harness/release-v1` | [release.schema.json](./release.schema.json) | [release.example.json](./examples/release.example.json) | reject |
| userView | `shipping-harness/user-view-v1` | [user-view.schema.json](./user-view.schema.json) | [user-view.example.json](./examples/user-view.example.json) | reject |
| pluginManifest | `shipping-harness/plugin-v1` | [plugin.schema.json](./plugin.schema.json) | [plugin.example.json](./examples/plugin.example.json) | reject |
| mcpSurface | `shipping-harness/mcp-surface-v1` | [mcp-surface.schema.json](./mcp-surface.schema.json) | [mcp-surface.example.json](./examples/mcp-surface.example.json) | reject |
| omoWorkOrder | `shipping-omo/v1` | [omo-work-order.schema.json](./omo-work-order.schema.json) | [omo-work-order.example.json](./examples/omo-work-order.example.json) | reject |
| omoReceipt | `shipping-omo-receipt/v1` | [omo-receipt.schema.json](./omo-receipt.schema.json) | [omo-receipt.example.json](./examples/omo-receipt.example.json) | reject |
| remoteRequest | `shipping-remote/request-v1` | [remote-request.schema.json](./remote-request.schema.json) | [remote-request.example.json](./examples/remote-request.example.json) | reject |
| remoteResponse | `shipping-remote/response-v1` | [remote-response.schema.json](./remote-response.schema.json) | [remote-response.example.json](./examples/remote-response.example.json) | reject |
| approvalReceipt | `shipping-remote-approval/v1` | [approval-receipt.schema.json](./approval-receipt.schema.json) | [approval-receipt.example.json](./examples/approval-receipt.example.json) | reject |
| notification | `shipping-remote/notification-v1` | [notification.schema.json](./notification.schema.json) | [notification.example.json](./examples/notification.example.json) | reject |
| backup | `shipping-harness/backup-v1` | [backup.schema.json](./backup.schema.json) | [backup.example.json](./examples/backup.example.json) | reject |
| migrationReceipt | `shipping-harness/stable-v1` | [migration-receipt.schema.json](./migration-receipt.schema.json) | [migration-receipt.example.json](./examples/migration-receipt.example.json) | reject |
| stableEvent | `shipping-harness/stable-v1` | [stable-event.schema.json](./stable-event.schema.json) | [stable-event.example.json](./examples/stable-event.example.json) | reject |
| health | `shipping-harness/health-v1` | [health.schema.json](./health.schema.json) | [health.example.json](./examples/health.example.json) | reject |
| compatibility | `shipping-harness/stable-v1` | [compatibility.schema.json](./compatibility.schema.json) | [compatibility.example.json](./examples/compatibility.example.json) | reject |

- `release-train.schema.json` — deterministic one-to-five-version rolling plan; only the first release may bind current contract authority.
