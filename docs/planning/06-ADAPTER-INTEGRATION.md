# External Harness Adapter Integration

## Integration policy

Shipping Harness uses documented CLI, controller, config, hook, and artifact surfaces. It does not scrape interactive terminal scrollback, copy external source, read credential stores, or depend on private APIs.

## Common capability model

```json
{
  "installed": false,
  "executable": null,
  "verificationLevel": "unavailable",
  "capabilities": {
    "execute": false,
    "resume": false,
    "cancel": false,
    "jsonOutput": false,
    "hooks": false,
    "durableGoals": false,
    "durableLedger": false,
    "artifactCollection": false,
    "costTelemetry": false
  },
  "diagnostics": []
}
```

Verification levels:

- `live`: installed executable was safely probed.
- `configured`: a command/config exists but was not invoked.
- `fixture`: repository fixture verified adapter parsing/behavior.
- `unavailable`: neither executable nor configuration found.

## Generic adapter

- Executes an operator-supplied command.
- Supports cancellation through process termination.
- Produces process evidence.
- Makes no claims about resume, hooks, or internal agent state.

## Codex adapter

- Detects `codex` on PATH.
- Uses non-mutating `--version`/`--help` probes.
- Execution is an operator-configured Codex command rather than hardcoded unstable flags.
- Capability report distinguishes CLI presence from authenticated model availability.

## Gajae Code adapter

- Detects `gjc`.
- Prefers documented external-controller/JSON surfaces when configured.
- Searches only repository-local configured artifact candidates for goals and ledger evidence.
- Never scrapes terminal scrollback or reads `.gjc/state/sdk` credentials/endpoints.
- Fixture verifies `goals.json`, `ledger.jsonl`, and JSON command output normalization.

## Q00 Ouroboros adapter

- Detects `ooo` first and `ouroboros` as compatibility candidate.
- Probes help/version and records available commands without assuming a runtime backend is authenticated.
- Collects configured repository-local Seed, Ledger, and artifact paths.
- Does not invoke unbounded evolve workflows automatically.
- Fixture verifies Seed-bound and ledger evidence normalization.

## OMO Native adapter

- Detects `omo`; optionally reports OpenCode/Codex OMO host presence.
- Detects unified project config at `.omo/omo.jsonc` or `.omo/omo.json`.
- Does not alter user-level `~/.omo` configuration.
- Exposes normalized event ingestion for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and custom events.
- A native OMO plugin is not claimed unless independently installed and exercised; the v0.2.0 integration is a process/config/evidence bridge.

### Planned v0.7 internal runtime

The current adapter remains a truthful lightweight bridge. It is not silently upgraded into the future runtime.

From v0.7, a separate private pinned OMO runtime may use actual upstream task/routing/continuation/recovery code through the versioned `shipping-omo/v1` work-order and receipt protocol. That runtime remains independently upgradeable and removable, preserves upstream notices and modification records, and cannot mutate Shipping contracts, budgets, human stop, blocker policy, or release closure. Team/DAG capabilities remain disabled until the v0.8 entry gate passes.

Canonical direction: [`10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).

## Stop decision protocol

Input:

```json
{
  "adapter": "omo",
  "event": "Stop",
  "runId": "...",
  "payload": {}
}
```

Output:

```json
{
  "decision": "allow-stop | continue | deny-continuation",
  "reason": "policy-id",
  "state": "VERIFYING"
}
```

Priority:

1. ABORTED/CLOSED/human pause → `deny-continuation`
2. Budget exhausted → `deny-continuation`
3. Required blockers remain and budget allows → `continue`
4. Verification needed → `continue`
5. SHIPPABLE → `allow-stop`

## Licensing boundary

Adapters are original interoperability code. External projects are referenced by name and documented public surface only. No source is vendored. See `THIRD_PARTY.md` for integration references and verification status.