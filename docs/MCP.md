# Shipping Harness MCP

## What it changes for the user

The CLI remains the deterministic engine, but the user no longer needs to remember its commands. An MCP-connected coding agent can discover Shipping Harness tools, propose a small release, ask for scope approval, verify the resulting code, and close the version.

The expected user request is:

```text
Use Shipping Harness to finish this project as version 0.1.0.
Show me the smallest useful scope before you start.
```

## Local installation

Requirements: Node.js 22 or newer, a Git repository with at least one commit, and an MCP client that can start a local STDIO server.

Install the locally verified package once:

```bash
npm install --global --prefix "$HOME/.local" /absolute/path/shipping-harness-1.9.0.tgz \
  --ignore-scripts --no-audit --no-fund
```

See [`operations/INSTALL-UPGRADE-ROLLBACK.md`](operations/INSTALL-UPGRADE-ROLLBACK.md) for upgrade and rollback, and [`operations/OMP-MAIN-HARNESS.md`](operations/OMP-MAIN-HARNESS.md) for the OMP-specific transactional bootstrap.

The MCP client launches this command, waits for JSON-RPC messages on STDIO, and is normally the one to start it rather than a person:

```bash
shipping-harness-mcp --root /absolute/path/to/project
```

## Codex and ChatGPT desktop configuration

CLI registration:

```bash
codex mcp add shipping-harness -- \
  shipping-harness-mcp --root /absolute/path/to/project
```

Equivalent project-scoped `.codex/config.toml`:

```toml
[mcp_servers.shipping-harness]
command = "shipping-harness-mcp"
args = ["--root", "/absolute/path/to/project"]
```

Use one server entry per target repository. The server root is fixed at process start; models cannot switch it through a tool argument.

## Generic local MCP configuration

Clients that use JSON-style configuration can launch:

```json
{
  "mcpServers": {
    "shipping-harness": {
      "command": "shipping-harness-mcp",
      "args": ["--root", "/absolute/path/to/project"]
    }
  }
}
```

The exact outer configuration key is client-specific. The command and arguments are the portable part.

## The nine tools

This table is derived directly from `SHIPPING_TOOLS` in `src/mcp/tools.mjs`. "Required input" lists only the schema's `required` fields; every tool also rejects any property not in its `inputSchema` (`additionalProperties: false`), and no tool accepts `command`, `shell`, `args`, `argv`, or an environment map.

| Tool | Purpose | Required input | Precondition state | Result |
|---|---|---|---|---|
| `shipping_start` | Analyze the current Git repository without executing project code, then propose the smallest release scope, acceptance checks, and short plan. Does not approve or lock the release. | `goal` | No active proposal, or an identical AUTO request reuses the active one. | A canonical proposal (`NEEDS_INPUT`, `DIRTY_BASELINE`, `NEEDS_ACCEPTANCE`, or `READY_FOR_APPROVAL`) with ID, SHA-256 hash, scope, exclusions, acceptance checks, and plain-language brief. |
| `shipping_refine` | Revise the active proposal identity using bounded structured answers, an existing workspace candidate, a rescan, an explicit user-authorized mode change, or a reviewed baseline-commit receipt. Never executes Git mutation or accepts commands, free-form paths, or credentials. | `proposalId`, `proposalHash` | An active proposal matching the given ID/hash. | The same proposal identity with an incremented revision, updated canonical state, and archived prior revision. |
| `shipping_approve_scope` | Approve exactly one Git-bound proposal and lock the contract. | `proposalId`, `proposalHash`, `confirm` | Proposal state is `READY_FOR_APPROVAL`; Git HEAD and source tree unchanged since the proposal was built. | `LOCKED` release state, persisted contract, and (optionally) a bound autopilot policy. |
| `shipping_execute` | Run only an adapter command already stored in the locked contract. With no configured adapter, returns a work order to the MCP host agent instead of exposing a shell command field. | none | A `LOCKED` contract exists. | Either adapter execution evidence or a structured work order; release state may advance to `RUNNING`. |
| `shipping_status` | Read-only: current Shipping Harness state, blockers, evidence freshness, Git state, state integrity, and next action. | none | Any state, including uninitialized. | A user status view with state, blockers, freshness, and next action, plus an `integrity` object (`ok`, `level` = `VERIFIED`/`UNVERIFIED_LEGACY`/`TAMPERED`, `reason`, `expected`, `observed`, `ledgerState`). When the level is `TAMPERED` the reported state is `ledgerState`, the last state the ledger proves, and a derived `false-user-state` BLOCKER is listed. |
| `shipping_verify` | Run the locked acceptance contract and classify findings as `BLOCKER`, `NEXT`, `IGNORE`, or `UNKNOWN`. | none | A `LOCKED` contract exists. | Git-SHA-bound evidence, issue classification, and an updated state (`VERIFYING` → `SHIPPABLE`/`BLOCKED`/`TRIAGE`). |
| `shipping_fix_blockers` | Start one bounded fix cycle. By default the MCP host agent receives a blocker-only work order; a configured adapter may run instead without accepting a raw command. | none | Release has outstanding blockers and remaining fix budget (not already `BLOCKED` from exhaustion). | Either a blocker-only work order or adapter fix-cycle evidence, plus updated state. |
| `shipping_pause` | Exercise human authority over automation. Pause and abort outrank every agent continuation request. | none (`action` defaults to `pause`) | An active release (any non-terminal state). | Updated state reflecting `PAUSED`, resumed, or `ABORTED`. |
| `shipping_close` | Close only a `SHIPPABLE` release with fresh evidence and zero blockers, generating a release receipt, report, and backlog. | none | Release state is `SHIPPABLE` with fresh, unstale evidence. | `CLOSED` state, release receipt, report, and backlog entries. `CLOSED` never means `RELEASED`. |

## Approval flow

`shipping_start` returns detected project type and manifest files, proposed release version and goal, included behavior and explicit exclusions, allowed and denied paths, existing build/test/lint commands selected as acceptance criteria, short execution steps, and a proposal ID and SHA-256 hash. It also returns one canonical proposal state:

```text
INTENT_CONFIRMATION_REQUIRED | ANALYSIS_COMPLETE | PLAN_COMPLETE
NEEDS_INPUT | DIRTY_BASELINE | NEEDS_ACCEPTANCE | READY_FOR_APPROVAL
```

Only `READY_FOR_APPROVAL` may be passed to `shipping_approve_scope`. Repeating the same AUTO request reuses the active proposal instead of creating duplicates. MCP `shipping_start` is AUTO-only; a host agent cannot silently switch to SAFE or INTERVIEW. Legacy `decision.approvalStatus` and `approvalBrief.status` values are non-authoritative compatibility projections derived from the canonical proposal state; dirty, unresolved, weak, expired, or superseded proposals never project approval readiness.

`confirm: true` proves that the caller submitted an explicit approval operation; a raw MCP server cannot cryptographically distinguish a human click from a model-generated call. Configure the MCP client to require user confirmation for `shipping_refine`, `shipping_approve_scope`, `shipping_execute`, `shipping_fix_blockers`, `shipping_pause`, and `shipping_close`. The tool annotations mark these operations as mutating or destructive hints, but client-side approval policy remains the enforcement point until a dedicated plugin UI is delivered.

### Dirty baseline preservation

`DIRTY_BASELINE` returns a bounded `baseline` object with categorized entries, exact blocking/non-blocking paths, a suggested host commit message, a file-set hash, and one next action: `REVIEW_BASELINE`. Shipping does not stage, commit, stash, reset, or delete files. After the user separately approves the displayed plan, the host agent may commit exactly the included paths, then call `shipping_refine` with `rescan: true`, the exact `baselinePlanHash`, current full `baselineCommit`, and `baselineAuthorizedByUser: true`. Baseline preservation approval is not release-scope approval.

### Intent gate and analysis mode

`shipping_start` always completes bounded read-only analysis before deciding what workflow is allowed. A terse or ambiguous analysis request returns `intentGate.status=CONFIRMATION_REQUIRED`, exactly one `Q-INTENT-001` question, and the default `ANALYZE_ONLY`. The four stable choices are `ANALYZE_ONLY`, `PLAN_ONLY`, `IMPLEMENT`, and `AUTOPILOT`; the answer is recorded through the existing `shipping_refine` tool, so the MCP surface remains exactly nine tools.

Before intent confirmation, `goalDiscovery`, `goalCharter`, and `releaseTrain` are null, `readyForApproval` is false, and approval, execution, verification commands, baseline mutation, and close remain forbidden. `ANALYSIS_COMPLETE` is a read-only terminal proposal state. `PLAN_COMPLETE` may expose a proposed Goal Charter and bounded Release Train but cannot be passed to `shipping_approve_scope`. Only a confirmed `IMPLEMENT` or `AUTOPILOT` intent can reach `READY_FOR_APPROVAL`.

Intent confirmation precedes `DIRTY_BASELINE` in the proposal projection, so a dirty repository cannot hide the user's workflow choice; the dirty baseline remains visible evidence and still blocks implementation after intent and product direction are resolved. The classifier is deterministic local code with no model or network call, no raw command field, and no additional MCP tool.

### Goal discovery, charter, train, and autopilot

`shipping_start`/`shipping_refine` also expose bounded goal discovery (zero to three product-outcome questions, each with a conservative reversible `recommendedChoice`), deterministic direction candidates and critic findings, an immutable Goal Charter once accepted, a deterministic Release Train (one to five versions), and — after `shipping_approve_scope` binds an `autopilotProfile` — deterministic `AUTO`/`NOTIFY`/`ASK`/`STOP` policy decisions. None of these projections can grant command, approval, closure, deployment, or `RELEASED` authority on their own; see `CHANGELOG.md` for what each version added.

## How code is actually written

Shipping Harness is not a replacement coding model.

1. The connected host agent can edit the repository directly after scope approval, then call `shipping_verify`.
2. A locked contract may contain a preconfigured Codex, Gajae, Ouroboros, OMO, or Generic adapter command. In that case `shipping_execute` can invoke it within existing time, output, stop, and run budgets.

## Protocol compatibility

The server implements newline-delimited JSON-RPC 2.0 over STDIO. It supports stateless discovery and tool requests for MCP `2026-07-28`, while retaining the `initialize` and `notifications/initialized` flow for clients using MCP `2025-11-25`, `2025-06-18` (Claude Code), and `2025-03-26`. Any other `initialize` revision fails closed with the supported list, so a client never runs against a lane that was not verified. OMP `18.0.10` and the source-linked `15.10.12` compatibility lane use `2025-03-26`; Shipping returns the negotiated version and accepts subsequent standard requests without proprietary metadata.

Supported RPC methods:

```text
server/discover
initialize
notifications/initialized
ping
tools/list
tools/call
notifications/cancelled
```

Every protocol message occupies one stdout line. Logs and startup errors use stderr only.

## Boundaries

- Local agent integration uses project-root-fixed STDIO. The separate optional internal remote gateway does not change the local MCP root.
- One fixed Git repository per MCP server process.
- No web or mobile dashboard.
- No unbounded consultancy-style or technical implementation interview; only bounded product-outcome discovery.
- No OMO multi-agent team or automatic model routing, and no Ouroboros evolutionary generation loop.
- No automatic Git push or deployment.
- The remote gateway (`docs/internal-remote/README.md`) is a separate TLS-only internal JSON surface mapping authenticated requests back to the same `callShippingTool` functions; it accepts no raw shell command and does not replace the MCP server. A local human stop prevents remote execution or resume.

Public or customer surfaces, automatic deployment, and speculative Team/DAG remain outside v1 and require a new version contract.

## Troubleshooting

Check the binaries and protocol:

```bash
shipping-harness version
node /path/to/shipping-harness/scripts/mcp-smoke.mjs
```

Check Codex registration:

```bash
codex mcp list
```

When a tool reports `ERR_ADAPTER_COMMAND_REQUIRED`, the contract has no approved external-agent command. This is not a request to supply a shell command through MCP. Let the connected host agent edit the code directly, or configure the adapter command in the contract before it is approved and locked.

The MCP root is fixed at process start. Use one MCP process per repository, or configure the host to start the same binary from the active Git project without exposing a root-switching tool argument.
