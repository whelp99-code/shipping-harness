# Adapter and Lifecycle Protocol

Version: 0.2.0
Owner: `shipping-harness`

## Purpose

Adapters normalize external coding harnesses into a small control-plane contract. They do not reimplement an external harness, infer undocumented command flags, inspect private user configuration, or grant an agent authority to change the Shipping Harness contract.

## Capability receipt

Every probe returns `shipping-harness/adapter-capabilities-v1` with adapter identity, discovered executable, one verification level, an observed version when available, strict boolean capabilities, diagnostics, and uncertainty-preserving metadata.

| Capability | Meaning |
|---|---|
| `execute` | A process can be invoked through an explicit operator or contract command. |
| `resume` | A stable resume protocol was proven. It stays false unless implemented. |
| `cancel` | Shipping Harness can terminate the process it launched. |
| `jsonOutput` | A stable structured-output contract was proven. |
| `hooks` | A normalized lifecycle-event bridge exists. |
| `durableGoals` | Repository evidence proves a durable goal file is present. |
| `durableLedger` | Repository evidence proves a durable ledger file is present. |
| `artifactCollection` | Safe repository-local candidate paths are configured. |
| `costTelemetry` | A stable cost receipt was proven. True for every built-in adapter: `adapter run` always executes through the shared runner, whose run receipt carries `telemetry.durationMs` and `telemetry.exitCode`; `telemetry.toolCalls` stays `null` unless the host reports it. |

Executable presence alone does not prove authentication, provider health, quota, supported model access, or task completion.

## Adapter boundaries

### Generic

The built-in process adapter executes only `--command` or `adapters.generic.command`.

### Codex

Detects `codex` on `PATH` and performs only non-mutating version/help probes. It never inspects OpenAI credentials and does not claim that executable discovery proves authentication.

### Gajae Code

Detects `gjc`. Execution flags remain operator-configured. Optional repository candidates can identify Goal and Ledger files. Durable capabilities become true only when those files actually exist.

### Q00 Ouroboros

Detects `ooo`, then `ouroboros`. Seed and Ledger candidates are collected only when explicitly configured. Evolution and continuation commands are never started implicitly.

### OMO Native

Detects `omo`; `opencode` may be reported only as an observed host. Project `.omo/omo.jsonc` or `.omo/omo.json` can establish configured evidence. The integration is a process/config/event bridge, not a native-plugin claim.

This describes the implemented v0.2 adapter only. The accepted v0.7 direction adds a separately pinned private internal OMO runtime behind a versioned bridge; it does not change this adapter's truthful capability report. The internal runtime may execute selected upstream task/routing/continuation/recovery code, but Shipping remains authoritative for contracts, budgets, human stop, accepted evidence, blockers, SHIPPABLE, and CLOSED. See [`planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).

## Artifact receipt

`adapter collect` enforces:

1. Relative repository paths only.
2. No home, absolute, drive, traversal, or null-byte paths.
3. No `.git`, `.shipping`, `.ssh`, `.aws`, `.gnupg`, `.env`, credential, token, authentication, or private-key targets.
4. Symlinks must resolve inside the repository.
5. Regular files only, maximum 5 MiB each.
6. JSON and JSONL must parse successfully.

Receipts store path, byte count, SHA-256, and a structural summary. Raw third-party artifact content is never copied into the Shipping Harness ledger.

## Lifecycle bridge

Normalized events are `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SessionStart`, and `Custom`. Payloads are limited to 64 KiB, recursively bounded, and secret-redacted before `.shipping/hooks.jsonl` is written.

## Stop decision priority

1. Human pause/abort or terminal `CLOSED`/`ABORTED`: `DENY_CONTINUATION`.
2. Remaining blocker with exhausted budget or `BLOCKED`: `DENY_CONTINUATION`.
3. `SHIPPABLE`: `ALLOW_STOP`.
4. Remaining blocker with budget: `CONTINUE`.
5. Locked/running/verifying/triage/fixing without proof: `CONTINUE` for verification or closure.
6. Any other non-executable state: `DENY_CONTINUATION`.

The receipt includes `allowStop`, `continue`, `reasonCode`, release state, blocker count, and budget counters. CLI exit code `3` represents a valid `CONTINUE` decision.

## Verification

Live probes are used only when a compatible executable is installed. Missing harnesses are covered by isolated executable and repository-artifact fixtures. Fixture success never upgrades the current machine’s runtime report to `live`.