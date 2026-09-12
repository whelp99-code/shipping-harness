# AGENTS.md — shipping-harness

> 리포 간 결정·관례·라우팅 규칙은 [`../dev-wiki`](../dev-wiki/README.md) 를 정본으로 본다. 이 파일은 이 리포 내부 규칙만 담는다.
> `CLAUDE.md` 와 `.cursor/rules` 는 이 파일을 가리키는 한 줄 포인터이며 내용을 갖지 않는다.

## What this repo is

A local-first, dependency-free Node ≥22 ESM (`.mjs`) CLI + STDIO MCP server that decides whether a software version is safe to close. It wraps external coding agents (Codex, Gajae, OMO, Ouroboros, generic process) with a deterministic completion policy: contract lock → agent execution → evidence → release gate → close. It is **not** an agent and never runs a raw shell command from a model.

This repo governs its own releases with itself. `.shipping/` at the root is live runtime state, not fixtures.

## Commands

No `npm install` is needed; `package.json` has zero runtime dependencies and `scripts/security-check.mjs` fails if any are added.

```bash
npm run lint         # node --check + bans tabs and trailing whitespace in src/ bin/ scripts/ test/
npm run typecheck    # resolves relative imports and dynamic-imports every src module (no TypeScript; types are JSDoc)
npm run build        # copies to dist/ and writes BUILD-MANIFEST.json
npm test             # unit + integration + adapter + mcp + adversarial via node:test
npm run check        # lint + typecheck + build + test
npm run release:verify   # everything a version close requires (~20s); this is acceptance AC for closing
```

Run a single suite or file:

```bash
npm run test:unit                 # also: test:integration, test:adapter, test:mcp, test:adversarial
node --test --test-reporter=spec test/unit/contract.test.mjs
node --test --test-reporter=spec --test-name-pattern="lock" test/unit/contract.test.mjs
```

Suites outside `npm test` (plugin, remote, stable, omo, autopilot, goal-*, release-train, omp-main) have their own `test:*` scripts and are pulled in by `release:verify`. `smoke:*` scripts run pilot scenarios against temp repos with `--check`.

`scripts/run-tests.mjs` only discovers `*.test.mjs` under `test/<suite>/`, so new tests must follow that name and location.

## Layout and architecture

- `bin/*.mjs` — thin entrypoints: `shipping-harness` (CLI, alias `shiph`), `shipping-harness-mcp` (STDIO MCP, root fixed by `--root` or `SHIPPING_HARNESS_ROOT`), `-plugin`, `-remote`, `-omp`.
- `src/cli.mjs` — one `main(argv)` with an `if (command === …)` chain; every command resolves the Git root first and talks to `src/core`.
- `src/core/` — the authority engine. Key pieces:
  - `state.mjs`: the release state machine (`DRAFT → LOCKED → RUNNING/VERIFYING → TRIAGE/FIXING → SHIPPABLE → CLOSED`, plus `BLOCKED/PAUSED/ABORTED`). `TRANSITIONS` is the only legal edge list; every transition appends to `.shipping/ledger.jsonl`.
  - `contract.mjs` + `crypto.mjs`: `contract.yaml` is JSON-compatible YAML parsed without a YAML library; `stableStringify` + SHA-256 produce the contract hash that everything else binds to.
  - `evidence.mjs` / `gate.mjs`: acceptance commands from the contract run under budgets; evidence is bound to contract hash **and** Git SHA and goes stale on either change. `verifyRelease`/`closeRelease` are the gate.
  - `decision-*.mjs`, `proposals.mjs`, `plain-brief.mjs`, `release-train.mjs`, `autopilot*.mjs`, `goal-discovery.mjs`, `goal-charter.mjs`, `goals/`: the "AI decides, human approves once" layer. All are deterministic; a model never has authority to approve, close, or mark `RELEASED`.
  - `hooks.mjs`: lifecycle/stop decisions for host agents. CLI exit code `3` means `CONTINUE`, not failure.
- `src/adapters/` — one module per external harness plus `registry.mjs`/`runner.mjs`. Adapters only probe with non-mutating commands and only execute commands stored in the contract or passed by the operator. See `docs/ADAPTERS.md`.
- `src/mcp/` — `tools.mjs` defines exactly nine `shipping_*` tools; `protocol.mjs` is JSON-RPC; `stdio.mjs` is newline-delimited with bounded queue/in-flight; `resources.mjs` exposes `shipping://current/*`. The security check rejects any tool input property named `command`, `shell`, `args`, `argv`, `env`, `environment`, and requires `additionalProperties: false`.
- `packages/` — `stable-control` (frozen v1 schemas, compatibility, migration, health, events), `internal-remote` (TLS gateway, signed requests, replay store), `internal-omo-bridge` (signed work orders/receipts to the private OMO runtime), `omp-main-harness` (OMP install/doctor/bootstrap), `shipping-plugin`.
- `schemas/v1/` — every authority surface has a JSON Schema with `additionalProperties: false` and a validated example under `examples/`. `verify:docs` validates all examples; add a schema + example together.
- `test/helpers/repo.mjs` — `createFixtureRepo()` builds a real temp Git repo with an initialized contract; `test/helpers/cli.mjs` — `runCli(root, args)` spawns the real binary. Prefer these over mocking; tests exercise real files and `git`.

## Release cycle of this repo (dogfooding)

Every version follows the same commit sequence (see `git log`): `docs: prepare vX.Y.Z …` → `chore: lock` → implementation commits → `chore: close` → annotated tag `vX.Y.Z`. Concretely:

1. `node bin/shipping-harness.mjs release prepare --version X.Y.Z --goal "…"` archives the closed contract into `.shipping/releases/` and creates a new `DRAFT`. It refuses uncommitted drift.
2. Add `docs/planning/NN-VX.Y.Z-….md` (sequentially numbered), bump `package.json` version (`src/version.mjs` reads it), edit `.shipping/contract.yaml` acceptance criteria (`AC-<version digits><nn>`), commit.
3. `shipping-harness lock`, implement, `shipping-harness verify`, `shipping-harness close`, commit the receipt, tag.

Rules that follow from this:

- A `CLOSED` release cannot be edited; new work needs a new contract. Do not hand-edit `.shipping/state.json`, `ledger.jsonl`, `decision-ledger.jsonl`, `contract.lock`, or anything under `.shipping/releases/` or `.shipping/amendments/`. Contract changes after lock are recorded as `AMEND-<version>-<nnn>` entries under `.shipping/amendments/` with before-snapshots; past amendments were done by dedicated scripts (`scripts/*amend*.mjs`), there is no CLI subcommand.
- `.shipping/evidence/` and `.shipping/tmp/` are gitignored runtime output.
- `scripts/v1-doc-audit.mjs` has a hard-coded `required` file list; when a version adds a plan/report/schema that must persist, add it there, or `release:verify` fails.
- `docs/reports/*.json` are field-evidence records; they are excluded from `dist/` and must not be regenerated casually.
- Backlog items in `BACKLOG.md` are deliberately not blockers; do not pull them into a locked scope.

## Code conventions enforced by scripts

- ESM only, `node:` prefixed builtins, JSDoc `@param` types (typecheck relies on import resolution, not tsc).
- No `eval`, `new Function`, `homedir()`, or `process.env.HOME/USERPROFILE` in `src/` or `packages/internal-remote` (security check). Paths must go through `assertContainedPath` in `src/core/fs.mjs`.
- Errors are `ShippingError('ERR_…', message)` from `src/core/errors.mjs`; the CLI maps them to exit codes.
- Output is bounded everywhere (evidence size, MCP message bytes, plain brief ≤ 8 KiB). When adding a surface, add a budget and an adversarial test under `test/adversarial/`.
- New user-facing state must be truthful: never report `SHIPPABLE`, `CLOSED`, or `RELEASED` unless the engine set it. Blockers must cite an acceptance criterion or a `blockerPolicy` rule from the contract.

## Safety boundary (do not relax)

Internal-only tool. No public SaaS, auto-push, auto-deploy, raw shell over MCP/remote, public listeners, model self-approval, or reopening a closed release. Human pause/abort outranks everything. See `docs/HANDOVER.md` for the authority order and `README.md` "Safety boundary".
