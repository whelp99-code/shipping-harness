# Shipping Harness MCP

## What it changes for the user

The CLI remains the deterministic engine, but the user no longer needs to remember its commands. An MCP-connected coding agent can discover Shipping Harness tools, propose a small release, ask for scope approval, verify the resulting code, and close the version.

The expected user request is:

```text
Use Shipping Harness to finish this project as version 0.1.0.
Show me the smallest useful scope before you start.
```

## Local installation

Requirements:

- Node.js 22 or newer
- Git repository with at least one commit
- An MCP client that can start a local STDIO server

Link the package once:

```bash
cd /path/to/shipping-harness
npm link
```

The MCP client launches this command:

```bash
shipping-harness-mcp --root /absolute/path/to/project
```

The process waits for JSON-RPC messages. It is normally launched by the MCP client rather than by a person.

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

## User-oriented tools

| Tool | User meaning | Important boundary |
|---|---|---|
| `shipping_start` | “Look at this repository and propose the smallest releasable version.” | Reads bounded metadata and writes only a proposal receipt. It does not run project code or approve scope. |
| `shipping_approve_scope` | “I reviewed this exact proposal. Lock it.” | Requires `confirm: true`, exact proposal ID/hash, unchanged Git SHA, and clean source. |
| `shipping_execute` | “Start the approved work.” | Runs only a command already stored in the locked contract. Otherwise it returns a work order to the host agent. |
| `shipping_status` | “Tell me whether this is running, blocked, shippable, or closed.” | Read-only. |
| `shipping_verify` | “Prove whether the current revision meets the locked contract.” | Produces Git-bound evidence and issue classification. |
| `shipping_fix_blockers` | “Use one of the limited fix attempts on release blockers only.” | Cannot start from arbitrary state and cannot exceed the fix budget. |
| `shipping_pause` | “Pause, resume, or abort.” | Human pause/abort outranks agent continuation. |
| `shipping_close` | “Close the version now.” | Allowed only from SHIPPABLE with fresh evidence and zero blockers. |

## Approval flow

`shipping_start` returns:

- detected project type and manifest files
- proposed release version and goal
- included behavior and explicit exclusions
- allowed and denied paths
- existing build/test/lint commands selected as acceptance criteria
- four short execution steps
- proposal ID and SHA-256 hash

The proposal is not a release contract yet. The user or trusted client must call `shipping_approve_scope` with the exact ID, hash, and `confirm: true`. Approval fails when source files are dirty, Git HEAD changed, the proposal expired, the proposal was edited, or another release is active.

`confirm: true` proves that the caller submitted an explicit approval operation; a raw MCP server cannot cryptographically distinguish a human click from a model-generated call. Configure the MCP client to require user confirmation for `shipping_approve_scope`, `shipping_execute`, `shipping_fix_blockers`, `shipping_pause`, and `shipping_close`. The tool annotations mark these operations as mutating or destructive hints, but client-side approval policy remains the enforcement point until a dedicated plugin UI is delivered.

## How code is actually written

Shipping Harness is not a replacement coding model.

1. The connected host agent can edit the repository directly after scope approval, then call `shipping_verify`.
2. A locked contract may contain a preconfigured Codex, Gajae, Ouroboros, OMO, or Generic adapter command. In that case `shipping_execute` can invoke it within existing time, output, stop, and run budgets.

The MCP tool schema never exposes `command`, `shell`, `args`, `argv`, or environment-map fields.

## Protocol compatibility

The server implements newline-delimited JSON-RPC 2.0 over STDIO. It supports stateless discovery and tool requests for MCP `2026-07-28`, while retaining the `initialize` and `notifications/initialized` flow for clients using MCP `2025-11-25`.

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

## v0.3.0 limitations

- Local STDIO only; no remote HTTP endpoint or OAuth.
- One fixed Git repository per MCP server process.
- No web or mobile dashboard.
- No full Gajae deep interview.
- No OMO multi-agent team or automatic model routing.
- No Ouroboros evolutionary generation loop.
- No automatic Git push or deployment.

Those capabilities require separate version contracts and remain in `BACKLOG.md`.

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
