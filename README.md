# Shipping Harness

**Worker name:** `shipping-harness`  
**Current target:** `v0.3.0`
**Product category:** Shipping Governance / Completion Control Plane

Coding agents already know how to write code. Shipping Harness decides whether the current software version is actually safe to close.

> **Your coding agent writes code. Shipping Harness closes the version.**

## Why

Vibe coding often stalls at 80–90% because planning, implementation, review, and improvement happen without a binding release contract. Reviewers keep finding optional improvements, agents keep resuming, scope grows, and the project never reaches a durable version boundary.

Shipping Harness adds an independent governance layer:

```text
Contract Lock → Agent Execution → Evidence → Release Gate
              → BLOCKER / NEXT / IGNORE → Bounded Fix → Version Close
```

It is not a coding model, another autonomous agent, or a replacement for Codex, Gajae Code, Ouroboros, or OMO Native. It wraps those tools with deterministic completion policy.

## Core guarantees

- Completion is proven by evidence, not by an agent saying “done”.
- Evidence is bound to both the contract hash and current Git SHA.
- A release blocker must cite an acceptance criterion or policy rule.
- Optional improvements move to the next-version backlog.
- Fix loops, agent runs, command duration, and output size are bounded.
- A human pause or abort always wins over automatic continuation.
- A closed version cannot silently reopen; further changes require a new release contract.

## Quick start

```bash
node ./bin/shipping-harness.mjs init
# Edit .shipping/contract.yaml, commit the baseline, then:
node ./bin/shipping-harness.mjs contract check
node ./bin/shipping-harness.mjs lock
node ./bin/shipping-harness.mjs verify
node ./bin/shipping-harness.mjs status
node ./bin/shipping-harness.mjs close
```

The generated `contract.yaml` is JSON-compatible YAML 1.2, allowing a dependency-free and deterministic parser.

## Beginner use: connect it as an MCP server

Install the local package once:

```bash
cd /path/to/shipping-harness
npm link
```

Connect one target repository to Codex:

```bash
codex mcp add shipping-harness -- \
  shipping-harness-mcp --root /absolute/path/to/target-project
```

Restart the MCP client, then ask in ordinary language:

```text
Use Shipping Harness to finish this project as version 0.1.0.
Keep only the smallest useful scope and show me the scope before approving it.
```

The agent calls `shipping_start`, presents detected project facts, scope, exclusions, acceptance checks, and a four-step plan. It may call `shipping_approve_scope` only after explicit user approval with the exact proposal hash. After approval, the host agent implements the locked goal and uses `shipping_verify`, `shipping_fix_blockers`, and `shipping_close`.

The local MCP server validates the explicit confirmation field and proposal hash, but the MCP client must be configured to ask the user before mutating tools are invoked. A dedicated approval-card plugin UI remains outside v0.3.0.

No MCP tool accepts a raw shell command. When no approved adapter command exists, `shipping_execute` returns a work order to the connected host agent instead of inventing CLI flags.

See [`docs/MCP.md`](docs/MCP.md) for installation, tool behavior, compatibility, and limitations.

## Adapter control plane

Shipping Harness v0.2.0 exposes one stable capability model across five adapters:

```bash
node ./bin/shipping-harness.mjs adapter list
node ./bin/shipping-harness.mjs adapter probe --all --json
node ./bin/shipping-harness.mjs adapter collect gajae --json
node ./bin/shipping-harness.mjs doctor --json
```

Capability reports use only four evidence levels:

- `live` — a non-mutating executable probe succeeded.
- `configured` — a repository command or repository-local integration artifact exists, but a live executable proof is incomplete.
- `fixture` — behavior was verified only against an isolated test fixture.
- `unavailable` — neither a live probe nor repository-owned configuration is present.

Executable discovery never proves authentication, provider access, model quota, or successful autonomous execution. Shipping Harness invokes only an operator-supplied command or a command explicitly stored in the locked contract.

## Lifecycle and stop governance

OMO and other hosts can forward lifecycle events through a repository-local bridge:

```bash
node ./bin/shipping-harness.mjs hook ingest \
  --adapter omo \
  --event Stop \
  --payload-file .shipping/tmp/stop-event.json \
  --json

node ./bin/shipping-harness.mjs hook decision --adapter omo --event Stop --json
```

Stop decisions are deterministic. Human pause/abort and terminal release states outrank automatic continuation; exhausted budgets stop the loop; remaining blockers or missing verification request continuation; a `SHIPPABLE` release allows the host to stop. Exit code `3` means `CONTINUE`, not a command failure.

## Prepare the next version

A closed release cannot be edited in place. After committing its receipt, create a greater draft version:

```bash
node ./bin/shipping-harness.mjs release prepare \
  --version 0.4.0 \
  --goal "Describe the next shippable outcome"
```

The command archives the closed contract and lock, rejects uncommitted source drift, resets bounded counters, and creates a new `DRAFT`. Edit and commit that contract before running `lock` again.

## Version boundaries

### v0.1.0 — Finish One Version

Local Git repository support, contract lock, state/ledger persistence, command acceptance gates, Git-SHA-bound evidence, scope drift detection, issue classification, bounded fix policy, pause/abort precedence, backlog generation, and version closure.

### v0.2.0 — Harness Adapter Layer

Capability-negotiated adapters for Generic shell execution, Codex CLI, Gajae Code, Q00 Ouroboros, and OMO Native; external artifact collection; hook event ingestion; live capability probes; and fixture-based integration verification when a harness is not installed.

### v0.3.0 — Beginner MCP Control Surface

A local STDIO MCP server, natural-language goal intake, repository analysis, minimal scope and acceptance proposal, explicit Git-bound approval, safe host-agent work orders, configured-adapter execution without raw command inputs, and deterministic verification/closure tools.

## Documentation

- [`docs/planning/00-INTAKE.md`](docs/planning/00-INTAKE.md)
- [`docs/planning/01-CHARTER-AND-SCOPE.md`](docs/planning/01-CHARTER-AND-SCOPE.md)
- [`docs/planning/02-REQUIREMENTS.md`](docs/planning/02-REQUIREMENTS.md)
- [`docs/planning/03-SYSTEM-ARCHITECTURE.md`](docs/planning/03-SYSTEM-ARCHITECTURE.md)
- [`docs/planning/04-DEVELOPMENT-PLAN.md`](docs/planning/04-DEVELOPMENT-PLAN.md)
- [`docs/planning/05-TEST-AND-RELEASE-GATE.md`](docs/planning/05-TEST-AND-RELEASE-GATE.md)
- [`docs/planning/06-ADAPTER-INTEGRATION.md`](docs/planning/06-ADAPTER-INTEGRATION.md)
- [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md)
- [`docs/MCP.md`](docs/MCP.md)

## Safety boundary

See [`docs/ADAPTERS.md`](docs/ADAPTERS.md) for the capability, artifact, and lifecycle protocols.

Shipping Harness runs only commands explicitly stored in a repository-owned contract or supplied by the operator. Artifact collection accepts only validated repository-relative paths, stores metadata and hashes rather than raw third-party content, and rejects home directories, credential-like files, protected runtime paths, and symlink escapes. It does not auto-push, auto-deploy, mutate provider credentials, install external harnesses, or bypass a human stop.
