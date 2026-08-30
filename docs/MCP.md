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

Install the locally verified package once. Use a user-global prefix so the executable links and package land in the same `~/.local` tree:

```bash
npm install --global --prefix "$HOME/.local" /absolute/path/shipping-harness-1.4.0.tgz \
  --ignore-scripts --no-audit --no-fund
```

Use `npm link` only for development checkouts.

### OMP main-harness bootstrap

For OMP, use the release-owned transactional bootstrap instead of manually editing its files:

```bash
cd /home/jm/orca/projects/shipping-harness
node bin/shipping-harness-omp.mjs bootstrap --tag v1.6.0
node bin/shipping-harness-omp.mjs bootstrap --tag v1.6.0 --apply
shipping-harness-omp doctor
```

The first command is read-only. The applied command backs up the previous Shipping package and five managed OMP files, installs the local package offline under `~/.local`, preserves the OMP binary/router/model configuration and unrelated MCP servers, merges the nine-tool approval policy, runs protocol and doctor checks, and records an exact rollback command. Primary field validation uses the active OMP `18.0.10` `omo-balance`/`omp-core` installation. Source-linked OMP `15.10.12` remains a compatibility lane. See [`operations/OMP-MAIN-HARNESS.md`](operations/OMP-MAIN-HARNESS.md).

From v1.3.1, bootstrap explicitly awaits installation, configuration, doctor, receipt, and backup completion before deleting the temporary package directory. The patch changes no MCP methods, schemas, approval semantics, or nine-tool inventory.

From v1.4.0, `shipping_start`, `shipping_refine`, and `shipping_status` expose `plainBrief`, `briefFactGraph`, and `actionEnvelope`. The default text is compiled locally from canonical Shipping data in the fixed order `현재 상태 → 문제점 → 개선안 → 다음 진행 플랜 → 요약 → 지금 할 일`. Exact paths, hashes, commands, and evidence remain in structured details. A host model may add a clearly labeled `AI 참고 의견`, but it cannot rewrite state, readiness, next action, acceptance, blockers, SHIPPABLE, or CLOSED. Brief compilation invokes no model, network, or extra Git process.

From v1.5.0 the same three tools also expose `releaseTrain` and `releaseTrainSummary`. One explicit outcome becomes one to five strictly increasing versions. The current release repeats the exact proposal contract and command/`cwd` authority; later versions are `ADVISORY_REPLAN_REQUIRED`, contain no executable command authority, and must be recalculated after their predecessor closes. Approval atomically stores `.shipping/release-train.json` bound to the proposal hash, contract hash, and baseline SHA. The plain brief adds `전체 개발계획` without changing the nine-tool inventory.

From v1.6.0 `shipping_approve_scope` can bind one explicit `MANUAL` or `LOCAL_REVERSIBLE` policy to the exact proposal, contract, baseline, and train. Existing tools then return deterministic autopilot decisions and durable status. `AUTO`/`NOTIFY` may continue only safe local work; `ASK` waits for a real human consequence decision; `STOP` cannot be overridden by host prose. Automatic local `CLOSED` is allowed only after every value, acceptance, evidence, scope, rollback, blocker, and unknown gate passes. No MCP result can mark the release `RELEASED`.

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
| `shipping_refine` | “Apply my bounded decision to the same proposal.” | Keeps the proposal ID, increments its revision, archives the previous revision, and accepts only structured answers, an existing workspace candidate, rescan, or explicit mode authorization. |
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

It also returns one canonical proposal state:

```text
NEEDS_INPUT | DIRTY_BASELINE | NEEDS_ACCEPTANCE | READY_FOR_APPROVAL
```

Only `READY_FOR_APPROVAL` may be passed to `shipping_approve_scope`. Repeating the same AUTO request reuses the active proposal instead of creating duplicates. MCP `shipping_start` is AUTO-only; a host agent cannot silently switch to SAFE or INTERVIEW. A fallback-only `git diff --check` is supplemental evidence and is not sufficient for a software release.

From v1.1.2, legacy `decision.approvalStatus` and `approvalBrief.status` values are non-authoritative compatibility projections derived from the canonical proposal state. Dirty, unresolved, weak, expired, or superseded proposals never project approval readiness. Each approval check includes its exact `cwd`; a rescan with no authority-bearing change returns `changed: false` and does not create a revision archive.

### Dirty baseline preservation

From v1.2.0, `DIRTY_BASELINE` returns a bounded `baseline` object with categorized entries, exact blocking/non-blocking paths, a suggested host commit message, a file-set hash, and one next action: `REVIEW_BASELINE`. Untracked agent/runtime and generated output remain visible but do not block; tracked or unknown entries fail closed.

Shipping does not stage, commit, stash, reset, or delete files. After the user separately approves the displayed baseline plan, the host agent may commit exactly the included paths. It then calls `shipping_refine` with `rescan: true`, the exact `baselinePlanHash`, current full `baselineCommit`, and `baselineAuthorizedByUser: true`. The commit must directly follow the reviewed Git HEAD and contain exactly the reviewed paths or refinement fails with baseline drift. Baseline preservation approval is not release-scope approval.

### Mixed-stack intelligence and acceptance coverage

From v1.3.0, proposals include a bounded component graph, a primary stack plus supporting stacks, one to three path-cited work themes, a recommendation-only concrete goal, and an acceptance coverage matrix. The user's stated outcome remains authoritative. If any blocking product or release-evidence path has no non-supplemental acceptance command with the correct `cwd`, the proposal becomes `NEEDS_ACCEPTANCE` even after its dirty baseline is preserved.

Every acceptance command carries a side-effect class. Package/release commands are mechanically marked `generated-artifacts`, require isolated execution, and require deterministic artifact output. Shipping runs them in disposable detached Git worktrees, repeats deterministic checks, compares artifact digests, fingerprints the source worktree before and after, and fails closed on nondeterminism or source mutation. External-state and data-state commands are not automatically runnable.

The technical approval projection remains `oneScreenApproval`: release, canonical state, explicit goal, recommendation label, included/excluded scope, exact command/`cwd`, work themes, and coverage summary. The default beginner projection is `plainBrief`, which adds deterministic problems, improvements, next plan, summary, one action envelope, and one safe user phrase. Detailed evidence remains available separately and cannot be replaced by agent prose.

For repositories containing one real product below a wrapper root, Shipping scans only bounded Git-tracked manifest paths, selects the strongest runnable workspace, and binds every proposed command to its exact workspace-relative `cwd`. If candidates remain materially tied, `shipping_refine` may select one existing candidate without accepting a free-form path or command.

The proposal is not a release contract yet. The user or trusted client must call `shipping_approve_scope` with the exact ID, hash, and `confirm: true`. Approval fails when the canonical state is not `READY_FOR_APPROVAL`, source files are dirty, Git HEAD changed, the proposal expired, the proposal was edited, or another release is active. `shipping_status` reports an active pending proposal even before a release state exists.

`confirm: true` proves that the caller submitted an explicit approval operation; a raw MCP server cannot cryptographically distinguish a human click from a model-generated call. Configure the MCP client to require user confirmation for `shipping_refine`, `shipping_approve_scope`, `shipping_execute`, `shipping_fix_blockers`, `shipping_pause`, and `shipping_close`. The tool annotations mark these operations as mutating or destructive hints, but client-side approval policy remains the enforcement point until a dedicated plugin UI is delivered.

## How code is actually written

Shipping Harness is not a replacement coding model.

1. The connected host agent can edit the repository directly after scope approval, then call `shipping_verify`.
2. A locked contract may contain a preconfigured Codex, Gajae, Ouroboros, OMO, or Generic adapter command. In that case `shipping_execute` can invoke it within existing time, output, stop, and run budgets.

The MCP tool schema never exposes `command`, `shell`, `args`, `argv`, or environment-map fields.

## Protocol compatibility

The server implements newline-delimited JSON-RPC 2.0 over STDIO. It supports stateless discovery and tool requests for MCP `2026-07-28`, while retaining the `initialize` and `notifications/initialized` flow for clients using MCP `2025-11-25` and `2025-03-26`. OMP `18.0.10` and the source-linked `15.10.12` compatibility lane use `2025-03-26`; Shipping returns the negotiated version and accepts subsequent standard requests without proprietary metadata.

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

## Stable local MCP boundaries

- Local agent integration uses project-root-fixed STDIO. The separate optional internal gateway does not change the local MCP root.
- One fixed Git repository per MCP server process.
- No web or mobile dashboard.
- No full Gajae deep interview.
- No OMO multi-agent team or automatic model routing.
- No Ouroboros evolutionary generation loop.
- No automatic Git push or deployment.

Public or customer surfaces, automatic deployment, and speculative Team/DAG remain outside v1 and require a new version contract.

## Planned internal runtime path

The accepted roadmap keeps these v0.3 limitations intact. v0.6 packages the local beginner experience; v0.7 later adds a separately pinned private OMO runtime through a versioned work-order/receipt bridge. No raw OMO command or unrestricted task/team surface is exposed directly to the user-facing MCP. Shipping continues to enforce approval, scope, budgets, human stop, evidence freshness, blockers, and version closure. See [`planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).

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

## v1 verification

The v1 release drill installs the packed artifact into an isolated prefix and drives the installed MCP through discovery, natural-language scope proposal, exact approval, host-agent work order, human pause and resume, deterministic verification, and `CLOSED`. The same drill proves v0.6-to-v1 package upgrade, plugin rollback and re-upgrade, state preservation, current private OMO promotion, and internal remote recovery.

The MCP root is fixed at process start. Use one MCP process per repository, or configure the host to start the same binary from the active Git project without exposing a root-switching tool argument.
## v0.9 internal remote gateway

The remote gateway is not a public MCP endpoint. It is a separate TLS-only internal JSON control surface that maps authenticated requests back to the same fixed `callShippingTool` functions used by the local MCP server. No remote request accepts a raw shell command or replaces the MCP server.

Local MCP and CLI remain the recovery and higher-authority control paths. In particular, a local human stop prevents remote execution or resume. The gateway exposes only fixed project, status, proposal, approval, control, verification, close, notification, backup, restore, and health operations.

See `docs/internal-remote/README.md` for request signing, one-time approval receipts, private-listener restrictions, and backup rules.

