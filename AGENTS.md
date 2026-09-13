# AGENTS.md — shipping-harness

> 리포 간 결정·관례·라우팅 규칙은 [`../dev-wiki`](../dev-wiki/README.md) 를 정본으로 본다. 이 파일은 이 리포 내부 규칙만 담는다.
> `CLAUDE.md` 와 `.cursor/rules` 는 이 파일을 가리키는 한 줄 포인터이며 내용을 갖지 않는다.

## What this repo is

A local-first, dependency-free Node ≥22 ESM (`.mjs`) CLI + STDIO MCP server that decides whether a software version is safe to close. It wraps external coding agents (Codex, Gajae, OMO, Ouroboros, generic process) with a deterministic completion policy: contract lock → agent execution → evidence → release gate → close. It is **not** an agent and never runs a raw shell command from a model.

This repo governs its own releases with itself. `.shipping/` at the root is live runtime state, not fixtures.

## Commands

`package.json` has zero runtime dependencies and `scripts/security-check.mjs` fails if any are added. Dev tools (ESLint, TypeScript) are devDependencies: run `npm ci --ignore-scripts` once before `lint:eslint`, `typecheck:tsc`, or `check`.

```bash
npm run lint         # scripts/lint.mjs (syntax, tabs, trailing whitespace, 80-line function limit) + eslint
npm run typecheck    # scripts/typecheck.mjs (import resolution) + tsc --checkJs with strictNullChecks (types are JSDoc)
npm run test:coverage    # npm test with a line-coverage threshold (see scripts/run-tests.mjs)
npm run build        # copies to dist/ and writes BUILD-MANIFEST.json
npm test             # unit + integration + adapter + mcp + adversarial via node:test
npm run check        # lint + typecheck + build + test
npm run release:verify   # scripts/release-verify.mjs runs every release gate in parallel; --list shows the steps. Skipped tests are printed as a WARNING
```

Run a single suite or file:

```bash
npm run test:unit                 # also: test:integration, test:adapter, test:mcp, test:adversarial
node --test --test-reporter=spec test/unit/contract.test.mjs
node --test --test-reporter=spec --test-name-pattern="lock" test/unit/contract.test.mjs
```

Suites outside `npm test` (plugin, remote, stable, autopilot, goal-*, release-train, omp-main) have their own `test:*` scripts and are pulled in by `release:verify`. `smoke:*` scripts run pilot scenarios against temp repos with `--check`. `omo` (`test:omo-bridge`) is deprecated as of v1.11.1 and is a manual-only script, not pulled into `release:verify` — see `packages/internal-omo-bridge/DEPRECATED.md`.

`scripts/run-tests.mjs` only discovers `*.test.mjs` under `test/<suite>/`, so new tests must follow that name and location.

## Layout and architecture

- `bin/*.mjs` — thin entrypoints: `shipping-harness` (CLI, alias `shiph`), `shipping-harness-mcp` (STDIO MCP, root fixed by `--root` or `SHIPPING_HARNESS_ROOT`), `-plugin`, `-remote`, `-omp`.
- `src/cli.mjs` — `main(argv)` dispatches through a command-to-handler table; every command resolves the Git root first and talks to `src/core`.
- `src/core/` — the authority engine. Key pieces:
  - `state.mjs`: the release state machine (`DRAFT → LOCKED → RUNNING/VERIFYING → TRIAGE/FIXING → SHIPPABLE → CLOSED`, plus `BLOCKED/PAUSED/ABORTED`). `TRANSITIONS` is the only legal edge list; every transition appends to `.shipping/ledger.jsonl`.
  - `contract.mjs` + `crypto.mjs`: `contract.yaml` is JSON-compatible YAML parsed without a YAML library; `stableStringify` + SHA-256 produce the contract hash that everything else binds to.
  - `evidence.mjs` / `gate.mjs`: acceptance commands from the contract run under budgets; evidence is bound to contract hash **and** Git SHA and goes stale on either change. `verifyRelease`/`closeRelease` are the gate.
  - `decision-*.mjs`, `proposals.mjs`, `plain-brief.mjs`, `release-train.mjs`, `autopilot*.mjs`, `goal-discovery.mjs`, `goal-charter.mjs`, `goals/`: the "AI decides, human approves once" layer. All are deterministic; a model never has authority to approve, close, or mark `RELEASED`.
  - `hooks.mjs`: lifecycle/stop decisions for host agents. CLI exit code `3` means `CONTINUE`, not failure.
- `src/adapters/` — one module per external harness plus `registry.mjs`/`runner.mjs`. Adapters only probe with non-mutating commands and only execute commands stored in the contract or passed by the operator. See `docs/ADAPTERS.md`.
- `src/mcp/` — `tools.mjs` defines exactly nine `shipping_*` tools and `handlers.mjs` holds one handler per tool; `test/stable/surface-freeze.test.mjs` pins the tool JSON, `renderHelp()`, and `schemas/v1` to their v1.8.2 hashes; `protocol.mjs` is JSON-RPC; `stdio.mjs` is newline-delimited with bounded queue/in-flight; `resources.mjs` exposes `shipping://current/*`. The security check rejects any tool input property named `command`, `shell`, `args`, `argv`, `env`, `environment`, and requires `additionalProperties: false`.
- `packages/` — `stable-control` (frozen v1 schemas, compatibility, migration, health, events), `internal-remote` (TLS gateway, signed requests, replay store), `internal-omo-bridge` (signed work orders/receipts to the private OMO runtime; **deprecated as of v1.11.1**, see `packages/internal-omo-bridge/DEPRECATED.md`), `omp-main-harness` (OMP install/doctor/bootstrap), `shipping-plugin`.
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
- `scripts/v1-doc-audit.mjs` scans `docs/planning` (numbering must be gap-free), `schemas/v1` (every schema needs an example), and `docs/reports`, and checks that README, HANDOVER, and the top CHANGELOG entry carry the `package.json` version. A short core-document list stays hard-coded.
- `docs/reports/*.json` are field-evidence records; they are excluded from `dist/` and must not be regenerated casually.
- Backlog items in `BACKLOG.md` are deliberately not blockers; do not pull them into a locked scope.

## Version cycle walkthrough

The exact command sequence for closing one version end to end, in order, with the file to inspect after each step:

1. `node bin/shipping-harness.mjs release prepare --version X.Y.Z --goal "…"` → inspect `.shipping/state.json` (now `DRAFT`, release `X.Y.Z`) and `.shipping/releases/<previous>.json` (the archived closed contract).
2. Add `docs/planning/NN-VX.Y.Z-….md` (next sequential number) → inspect that it exists and that `npm run verify:docs` still passes (planning numbering must stay gap-free).
3. Bump `package.json` `version` to `X.Y.Z` → inspect `src/version.mjs` reads it (`node bin/shipping-harness.mjs version`).
4. Edit `.shipping/contract.yaml` acceptance criteria (`AC-<version digits><nn>`) → inspect `.shipping/contract.yaml` diff matches the plan doc's acceptance list.
5. Commit the draft (`docs: prepare shipping-harness X.Y.Z …`) → inspect `git log -1` and `git status` clean.
6. `shipping-harness lock` → inspect `.shipping/contract.lock` (hash) and `.shipping/state.json` (now `LOCKED`).
7. Implement the scope → inspect the acceptance commands from the contract pass locally.
8. `shipping-harness verify` → inspect `.shipping/evidence/` output and `.shipping/state.json` (`SHIPPABLE`, or `BLOCKED`/`TRIAGE` with cited blockers).
9. Fix any blockers and re-run `shipping-harness verify` until `SHIPPABLE` → inspect `.shipping/ledger.jsonl` for the transition history.
10. `shipping-harness close` → inspect `.shipping/state.json` (`CLOSED`) and the generated release receipt/report/backlog under `.shipping/releases/` and `BACKLOG.md`.
11. Commit the receipt (`chore: close shipping-harness X.Y.Z`) → inspect `git status` clean.
12. `git tag -a vX.Y.Z -m "…"` → inspect `git tag -l vX.Y.Z` and that it points at the close commit.

### Gotcha: `release prepare` vs. post-close commits

`release prepare` diffs the current working tree against `state.closedGitSha` for everything **outside** `.shipping/` and refuses to run if that tree has drifted (`ERR_RELEASE_DRIFT`). A commit made *after* `close` that touches non-`.shipping/` files (for example, a docs cleanup commit landed after `chore: close …`) therefore blocks the next `release prepare` even though it is unrelated to the closed release's scope.

Workaround used in this session: check out the close commit into a detached worktree, run `release prepare` there (where the tree exactly matches `closedGitSha`), then copy the resulting `.shipping/` directory back onto the branch tip before committing.

```bash
git worktree add /tmp/prepare-at-close <close-commit-sha>
cd /tmp/prepare-at-close && node bin/shipping-harness.mjs release prepare --version X.Y.Z --goal "…"
cp -r .shipping /path/to/main/checkout/.shipping
cd /path/to/main/checkout && git worktree remove /tmp/prepare-at-close
```

Prefer running `release prepare` immediately after the close commit, before any further commit touches non-`.shipping/` files, so this workaround is not needed.

## Language rule

- Code comments, JSON Schemas, and CLI/MCP output text: English.
- `docs/planning/`: Korean (matches how this repo's planning has always been written).
- `README.md`, `docs/MCP.md`, `docs/HANDOVER.md`: English. `docs/BEGINNER-QUICKSTART-KO.md` is the Korean-language entry point for non-developer users; it is not a translation target for the other documents above.

## Code conventions enforced by scripts

- ESM only, `node:` prefixed builtins, JSDoc `@param`/`@returns` on every export (tsc reads them; avoid `{*}` when a real type is known). Functions over 80 lines fail lint unless allow-listed with a reason in `scripts/lint.mjs`.
- No `eval`, `new Function`, `homedir()`, or `process.env.HOME/USERPROFILE` in `src/` or `packages/internal-remote` (security check). Paths must go through `assertContainedPath` in `src/core/fs.mjs`.
- Errors are `ShippingError('ERR_…', message)` from `src/core/errors.mjs`; the CLI maps them to exit codes.
- Output is bounded everywhere (evidence size, MCP message bytes, plain brief ≤ 8 KiB). When adding a surface, add a budget and an adversarial test under `test/adversarial/`.
- New user-facing state must be truthful: never report `SHIPPABLE`, `CLOSED`, or `RELEASED` unless the engine set it. Blockers must cite an acceptance criterion or a `blockerPolicy` rule from the contract.

## Safety boundary (do not relax)

Internal-only tool. No public SaaS, auto-push, auto-deploy, raw shell over MCP/remote, public listeners, model self-approval, or reopening a closed release. Human pause/abort outranks everything. See `docs/HANDOVER.md` for the authority order and `README.md` "Safety boundary".
