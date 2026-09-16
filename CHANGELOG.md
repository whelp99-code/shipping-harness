# Changelog

All notable changes to Shipping Harness are documented in this file, most recent version first, in a format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.12.0] - Unreleased

In progress: plan-aware proposals. See `docs/planning/36-V1.12.0-PLAN-AWARE-PROPOSALS-DEVELOPMENT-PLAN.md`.

### Added

- A repository-owned, reviewable plan file (`docs/shipping-plan.json` by default, schema `shipping-harness/plan-v1`; see `docs/SHIPPING-PLAN.md`) that a host model may draft but never executes. It can never carry a `command`/`shell`/`args`/`argv`/`env`/`environment` key; stage acceptance only references analyzer-detected candidate command IDs. Deterministic progress (`DONE`/`ACTIVE`/`READY`/`BLOCKED_BY_DEPENDENCY`/`BLOCKED_BY_UNRESOLVED`) comes only from closed release receipts, never the file's own claims.
- `shipping_start`/`shipping_refine` gain optional `planPath`/`stageId` input and a `tier` (`PATCH`/`MILESTONE`) plus `shippingPlan` output projection (`program`/`milestone`/`patch`), additive and `null` when no plan is bound. Only `milestone`/`patch` is ever approvable; approving the `program` projection is rejected with `ERR_PLAN_PROGRAM_NOT_APPROVABLE`. Existing MCP output is byte-identical when no plan file is present.
- CLI `plan status [--plan PATH] [--json]` (a progress table: stage id, title, status, next) and `plan check [--plan PATH] [--json]` (validates the plan file only, prints resolvable candidate command IDs, exits 1 with the plan error code when invalid). Both default `--plan` to `docs/shipping-plan.json` and never write to `.shipping/` or the plan file.
- The plain brief gains one bounded `PLAN_PROGRESS` fact ("N/M 단계 완료, 다음: <제목>") when a plan is bound, and `shipping_start`/`shipping_refine` text renders three fixed blocks (`## 전체 목표`, `## 이번 릴리즈`, `## 작은 수정` when a separate patch candidate exists) at the top when a plan is bound; the 8 KiB plain-brief budget is unchanged and output without a plan is byte-identical to v1.11.3.
- `docs/SHIPPING-PLAN.md`: file format, a worked example, how to discover stage acceptance reference IDs, and a copy-pasteable prompt for a host model to draft the plan file.

### Changed

- CLI `help` surface hash updated (new `plan status`/`plan check` lines); `tools` and `schemas/v1` hashes carried over from Phase A unchanged in Phase B. Recorded in section 6 of `docs/planning/36-V1.12.0-PLAN-AWARE-PROPOSALS-DEVELOPMENT-PLAN.md`.

## [1.11.3] - 2026-09-16

In progress: `requestProtocol` only enters the vendor-version branch when `_meta` actually carries `io.modelcontextprotocol/protocolVersion`. Claude Code attaches `_meta.progressToken` to every tool call, which previously hit that branch with `requested: missing` and made every call fail after a successful `initialize`. Found and fixed by the first Claude Code session to use the server; v1.11.2 had only fixed the handshake.

## [1.11.2] - 2026-09-16

In progress: MCP `initialize` accepts protocol version `2025-06-18` (what Claude Code 2.1.x sends) and, per the MCP specification, answers an unknown requested version with the newest version the server supports instead of an error. Found when the first Claude Code session called `shipping_status` and received `Unsupported protocol version`.

## [1.11.1] - 2026-09-13

Retires the private OMO runtime bridge (`packages/internal-omo-bridge`, `config/upstreams/omo-pin.json`) from the release gates and marks it deprecated (ADR 2026-09-13, `../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md`). The pinned runtime repository was archived; its sealed manifest references the old path, so the bridge's 5 runtime-dependent tests could no longer run and are excluded from `npm run release:verify` and `npm run check` (they remain runnable manually via `npm run test:omo-bridge`). Code, schemas, and historical receipts are retained; reactivation requires a new ADR and contract. The OMO Native adapter (`src/adapters/omo.mjs`) and the nine MCP tools are unchanged.

## [1.11.0] - 2026-09-13

In progress: integrates the v1.8.3 intent-gate and analysis-mode snapshot from origin/main into the v1.10.0 line (nine tools unchanged, `shipping_start` title/description reworded, `intent-gate.schema.json` added) and fixes the refine user view schema id that had been the literal `[REDACTED]` since v1.8.2.

## [1.10.0] - 2026-09-13

In progress. See `docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md`: state integrity digest, hash-chained ledger, receipt cross-check, tamper reporting, contract-defect signalling, verify-run budget.

## [1.9.0] - 2026-09-12

Engineering infrastructure and maintainability. Behavior (permission policy, the nine MCP tools, schemas, state machine, output formats) is unchanged; only tooling, code structure, documentation, and CI change. Status: in progress — a `DRAFT` contract on `.shipping/`, not yet locked or closed. See `docs/planning/33-V1.9.0-ENGINEERING-INFRASTRUCTURE-DEVELOPMENT-PLAN.md` for the full plan and execution record.

### Added

- ESLint flat config (`eslint.config.mjs`) and `npm run lint:eslint`, run alongside the existing custom tab/trailing-whitespace lint.
- `tsconfig.json` (`allowJs`+`checkJs`+`noEmit`, `strictNullChecks: true`) and `npm run typecheck:tsc`, run alongside the existing import-resolution typecheck.
- `npm run test:coverage` (`node --test --experimental-test-coverage`) with an enforced line-coverage floor.
- `.nvmrc` (`22`) and `.editorconfig` (LF, 2 spaces, final newline, no trailing whitespace; Markdown exempt from the trailing-whitespace rule).
- A `scripts/security-check.mjs` rule rejecting any `devDependencies` import from `bin/`, `src/`, or `packages/`.
- `test/stable/surface-freeze.test.mjs`, hashing `SHIPPING_TOOLS`, `renderHelp()` output, and all of `schemas/v1/**` against their v1.8.2 values so refactors cannot silently change the authority surface.
- `scripts/function-length.mjs`, enforced by `npm run lint`, failing any `src/`/`packages/` function over 80 lines outside a documented allow-list.
- `scripts/release-verify.mjs`, replacing a 21-entry `npm run` chain with one script that runs independent steps in a CPU-sized worker pool, prints a name/duration/result summary, surfaces skipped-test warnings, and supports `--list`.
- `scripts/archive/` for scripts used by exactly one past version and referenced by no current npm script, test, or doc audit rule, with `scripts/archive/README.md` recording each file's version and reason.
- `docs/planning/*.md` numbering-gap and `schemas/v1/*.schema.json` ↔ `examples/*.example.json` pairing checks in `scripts/v1-doc-audit.mjs`, replacing part of its hardcoded required-file list.
- A doc-audit rule that the README version line, `docs/HANDOVER.md` current-version line, and the topmost CHANGELOG version all equal `package.json` version.
- `CHANGELOG.md` (this file).
- `docs/operations/INSTALL-UPGRADE-ROLLBACK.md` as the single install/upgrade/rollback reference for README and `docs/MCP.md`.
- An "execute one release cycle" walkthrough section in `AGENTS.md`, including the `release prepare`-vs-post-close-commit ordering gotcha (`ERR_RELEASE_DRIFT`) and its detached-checkout workaround.
- A Korean/English language rule in `AGENTS.md`: code comments, schemas, and CLI output stay English; `docs/planning/` stays Korean; README/MCP/HANDOVER stay English with `docs/BEGINNER-QUICKSTART-KO.md` as the Korean entry point.
- `.github/workflows/ci.yml` and `.github/workflows/release-verify.yml`.

### Changed

- `src/mcp/tools.mjs`'s 487-line `callShippingTool` decomposed into a name→handler map (`src/mcp/handlers.mjs`, `src/mcp/validation.mjs`, `src/mcp/constants.mjs`); `SHIPPING_TOOLS` itself is unchanged.
- `src/cli.mjs`'s 302-line `if` chain decomposed into a `command → handler` table; `main(argv)` signature, `handleCliError`, exit codes, and `renderHelp()` output are unchanged.
- `src/core/proposals.mjs`'s `createScopeProposal`, `refineScopeProposal`, and `approveScopeProposal` decomposed into validate/build/compose/persist stages.
- All 24 parameterless `catch {}` blocks reviewed: each is now either commented as an intentional ignore or converted to a `ShippingError`/diagnostic field.
- `scripts/v1-doc-audit.mjs`'s hardcoded `required` list split into (a) a short always-required core-document list and (b) directory scans for `docs/planning/`, `schemas/v1/`.
- `docs/MCP.md` rewritten as a current-behavior document; its accumulated per-version sections moved to this file.
- README rewritten to 120 lines or fewer with one version mention (`**Version:** 1.9.0`); its 23 accumulated version sections moved to this file.
- 116 previously undocumented exported functions gained `@param`/`@returns` JSDoc, used by `tsc` as their types.

### Fixed

- ESLint found and fixed 31 issues (mostly unused imports/variables, redundant reassigned initializers, unexplained empty catches, unnecessary regex escapes) with no behavior change.
- `tsc` found and fixed 237 type errors, almost entirely missing/inaccurate JSDoc annotations (most from `invariant()` helpers lacking `@returns {asserts condition}`), with one reverted logic change (`packages/shipping-plugin/installer/cli.mjs` `--host` handling kept its original `ERR_PLUGIN_HOST` rejection instead of silently coercing to `'generic'`).

## [1.8.3] - 2026-09-12 — Intent Gate and Analysis Mode (snapshot, not released)

Snapshot, not released: v1.8.3 was developed on `origin/main` and merged into the v1.10.0 line without ever being locked, verified, or closed by the harness on this branch. There is no v1.8.3 contract, receipt, or tag; the feature ships inside the v1.10.0 release line.

`shipping_start` now always completes bounded read-only analysis before deciding what workflow is allowed. A terse or ambiguous analysis request returns `intentGate.status=CONFIRMATION_REQUIRED`, exactly one `Q-INTENT-001` workflow-boundary question, and the default `ANALYZE_ONLY`. The four stable intent modes are `ANALYZE_ONLY`, `PLAN_ONLY`, `IMPLEMENT`, and `AUTOPILOT`, answered through the existing `shipping_refine` tool. New non-approvable proposal states `INTENT_CONFIRMATION_REQUIRED`, `ANALYSIS_COMPLETE`, and `PLAN_COMPLETE`; intent confirmation precedes `DIRTY_BASELINE` so a dirty repository cannot hide the workflow choice. Before confirmation, `goalDiscovery`, `goalCharter`, and `releaseTrain` are null and approval, execution, verification, baseline mutation, and close are forbidden. Deterministic local classifier: no model call, no network call, no raw command field, and no tenth MCP tool — the surface stays at exactly nine tools. Adds `schemas/v1/intent-gate.schema.json` and `src/core/intent-gate.mjs`.

## [1.8.2] - 2026-09-01 — Plain Brief Budget Hotfix

Fixed a real-repository `DIRTY_BASELINE` proposal whose structured `plainBrief` JSON reached 8,538 bytes against a fixed 8,192-byte limit, dropping `plainBriefText` for end users. Removed derivable and zero-valued duplicate facts from the Fact Graph (approval readiness already implied by canonical state; zero-valued BLOCKER/UNKNOWN counts; Release Train facts duplicating the separate `releaseTrain` summary; compiler facts already expressed by schema and `modelAuthority=false`) while keeping canonical state, primary next action, and all prohibited-action facts. Structured output capped at 7,680 bytes, rendered text at 4,096 bytes. All remaining facts stay mechanical and evidence-referenced; hashes are unaffected by model labels.

## [1.8.1] - 2026-09-01 — Goal Discovery and Charter Field Hardening

The existing nine tools project bounded Goal Discovery, the Direction Critic, the Decision Ledger, the immutable Goal Charter, the Release Train, and Autopilot as one authority chain. Host-model prose cannot change canonical state, hashes, next action, approval readiness, acceptance, close, deployment, or `RELEASED`. The field report retains nine tools and zero false-authority or target-mutation counters.

## [1.8.0] - 2026-08-30 — Goal Charter and Direction Critic Binding

Turns a ready v1.7 direction into one immutable, independently readable Goal Charter bound to the approved proposal, locked contract, Git baseline, Release Train, Decision Ledger, and replan policy. The charter records final outcome, primary user, operating boundary, value, included results, non-goals, measurable success criteria, assumptions, evidence, rollback, and replan triggers. Before approval it is a non-authoritative preview; at approval Shipping persists exactly that charter, bound to proposal/revision/hash, current Git SHA, contract hash, baseline SHA, Release Train hash, approver class, and Decision Ledger event. The charter never grants command, model, approval, closure, deployment, external-write, public, customer, cost, data, authentication, security, license, or `RELEASED` authority; changing its outcome, primary user, operating boundary, non-goals, success criteria, rollback, or accepted hash requires a new proposal/replan.

## [1.7.0] - 2026-08-30 — Bounded Goal Discovery and Direction Ledger

Analyzes repository evidence before asking anything, skips interviews for specific goals, and asks at most three product-outcome questions across at most two rounds when the goal is materially ambiguous. Every question carries a conservative reversible default, and `shipping_refine` can record explicit answers or delegated recommended choices without adding a tenth tool. One to three deterministic direction candidates are reviewed by a bounded critic, while an append-only hash-chained Decision Ledger records discovery, answer provenance, direction readiness, acceptance, supersession, and replan triggers. Directions never gain command, approval, closure, deployment, model, or `RELEASED` authority; the accepted outcome only becomes input to the existing Release Train and policy Autopilot.

`shipping_start` now analyzes bounded Git, manifest, workspace, version, acceptance, baseline, and project-intelligence evidence before deciding whether any product question is needed. A concrete delivery goal proceeds without an interview. A materially broad or conflicting outcome produces zero to three user-level questions covering only the primary result, primary user, and operating boundary. Framework, library, database-table, file-path, shell, package-manager, and programming-language questions are prohibited.

Each question exposes a conservative reversible `recommendedChoice`. `shipping_refine` keeps the same proposal identity and accepts either explicit structured answers or the one-step delegated-recommendation flag already present in its schema. Discovery is limited to two rounds; if material ambiguity remains at the second round, the critic returns `STOP`.

The same proposal exposes `goalDiscovery`, deterministic direction candidates, critic findings, accepted `direction`, and `decisionLedger`. Candidate and direction hashes ignore host-model prose. Every direction has `commandAuthority=false`, `approvalAuthority=false`, `closureAuthority=false`, `released=false`, and `modelAuthority=false`.

The Decision Ledger is append-only JSONL under `.shipping/decision-ledger.jsonl`, bounded to 256 events and 1 MiB. It records proposal/revision/hash, current Git SHA, discovery hash, answer provenance, direction hash, evidence references, sequence, previous hash, and event hash. Tamper, sequence gaps, stale bindings, duplicate event keys, and retention overflow fail closed. The nine-tool MCP inventory remains unchanged.

## [1.6.1] - 2026-08-30 — Autopilot Field Hardening

Proves the accepted v1.6.0 policy boundary across clean, dirty nested, weak-acceptance, missing-rollback, destructive, authentication/security, external/cost/public, model-variant, replay, crash-recovery, pause/abort, and next-release lanes. Mutation lanes use disposable repositories; available real projects are fingerprinted read-only. Field evidence reports zero false authority, zero unauthorized target mutation, bounded decision latency and retention, nine unchanged MCP tools, `CLOSED != RELEASED`, and unchanged OMP binaries. The release gate includes deterministic model/consequence field tests, bounded retention/performance, a disposable automatic-closure lane, and read-only fingerprints for locally available real projects; the field report is evidence only and cannot approve, close, release, deploy, or change a target.

## [1.6.0] - 2026-08-30 — Policy-Authorized Autopilot

Adds a model-independent, default-deny `AUTO`/`NOTIFY`/`ASK`/`STOP` policy bound to the exact proposal, contract, Git baseline, and release train. `shipping_approve_scope` can bind one explicit `MANUAL` or `LOCAL_REVERSIBLE` policy to the exact proposal, contract, baseline, and train; existing tools then return deterministic autopilot decisions and durable status. Safe reversible local implementation, verification, blocker repair, `CLOSED`, and predecessor-gated train continuation may proceed under the approved policy; production, public release, external writes, cost, license, destructive data, authentication, and security consequences remain human-owned. `AUTO`/`NOTIFY` may continue only safe local work; `ASK` waits for a real human consequence decision; `STOP` cannot be overridden by host prose. `CLOSED` never means `RELEASED`, and the existing nine MCP tools remain unchanged.

Shipping Harness is planned for the owner's personal use and future private use inside the owner's company. Customer delivery, resale, public SaaS, and public integrated-runtime distribution are outside the accepted direction.

## [1.5.0] - 2026-08-30 — Release Train Planner

Compiles one final outcome into a deterministic rolling train of one to five value-bearing versions. The current release is fully bound to the proposal contract; later releases carry only value, entry, exit, rollback, and replan gates until their predecessor closes. Future plans cannot grant current authority, add commands, or imply release. `shipping_start` deterministically compiles the train; the first release exactly matches the current proposal contract. Exact approval atomically writes `.shipping/release-train.json`, bound to proposal hash, contract hash, and baseline SHA. The existing nine MCP tools expose the train and the Korean plain brief shows the full version sequence without an extra model call.

## [1.4.0] - 2026-08-30 — Evidence-First Plain Brief

Compiles one deterministic Korean beginner report directly from canonical Shipping evidence. Every proposal/status result presents `문제점`, `개선안`, `다음 진행 플랜`, `요약`, and one state-derived user action before technical evidence. `shipping_start`, `shipping_refine`, and `shipping_status` expose `plainBrief`, `briefFactGraph`, and `actionEnvelope`; the default text is compiled locally from canonical Shipping data in the fixed order `현재 상태 → 문제점 → 개선안 → 다음 진행 플랜 → 요약 → 지금 할 일`. Exact paths, hashes, commands, and evidence remain in structured details. A host model may add a clearly labeled `AI 참고 의견` but cannot rewrite state, readiness, next action, acceptance, blockers, `SHIPPABLE`, or `CLOSED`. Brief compilation invokes no model, network, or extra Git process. Host-model commentary is non-authoritative; the nine MCP tools and all approval, evidence, pause, blocker, and closure semantics remain unchanged.

## [1.3.1] - 2026-08-29 — OMP Bootstrap Temporary-Package Race Patch

Awaits the complete transactional OMP installation before removing its temporary package, adds a real bootstrap-apply lifecycle regression, and proves doctor, receipt, backup, cleanup, and explicit rollback without changing OMP or MCP semantics. Bootstrap explicitly awaits installation, configuration, doctor, receipt, and backup completion before deleting the temporary package directory; the patch changes no MCP methods, schemas, approval semantics, or nine-tool inventory.

## [1.3.0] - 2026-08-29 — Project Intelligence and Acceptance Coverage

Builds a bounded mixed-stack component graph, groups current product work into at most three evidence-backed themes, keeps inferred goals recommendation-only, requires every changed product path to be covered by an acceptance command, and runs side-effecting package checks in disposable detached worktrees with deterministic-output and source-mutation checks.

Proposals include a bounded component graph, a primary stack plus supporting stacks, one to three path-cited work themes, a recommendation-only concrete goal, and an acceptance coverage matrix. The user's stated outcome remains authoritative. If any blocking product or release-evidence path has no non-supplemental acceptance command with the correct `cwd`, the proposal becomes `NEEDS_ACCEPTANCE` even after its dirty baseline is preserved.

Every acceptance command carries a side-effect class. Package/release commands are mechanically marked `generated-artifacts`, require isolated execution, and require deterministic artifact output. Shipping runs them in disposable detached Git worktrees, repeats deterministic checks, compares artifact digests, fingerprints the source worktree before and after, and fails closed on nondeterminism or source mutation. External-state and data-state commands are not automatically runnable.

The technical approval projection remains `oneScreenApproval`; the default beginner projection is `plainBrief`. For repositories containing one real product below a wrapper root, Shipping scans only bounded Git-tracked manifest paths, selects the strongest runnable workspace, and binds every proposed command to its exact workspace-relative `cwd`. If candidates remain materially tied, `shipping_refine` may select one existing candidate without accepting a free-form path or command.

## [1.2.0] - 2026-08-29 — Safe Baseline Steward

Classifies dirty product, release-evidence, agent-runtime, Shipping-runtime, generated, and unknown paths; produces one hash-bound preservation plan and next action; and verifies a separately user-approved host commit without exposing Git mutation through MCP.

`DIRTY_BASELINE` returns a bounded `baseline` object with categorized entries, exact blocking/non-blocking paths, a suggested host commit message, a file-set hash, and one next action: `REVIEW_BASELINE`. Untracked agent/runtime and generated output remain visible but do not block; tracked or unknown entries fail closed. Shipping does not stage, commit, stash, reset, or delete files. After the user separately approves the displayed baseline plan, the host agent may commit exactly the included paths, then call `shipping_refine` with `rescan: true`, the exact `baselinePlanHash`, current full `baselineCommit`, and `baselineAuthorizedByUser: true`. The commit must directly follow the reviewed Git HEAD and contain exactly the reviewed paths or refinement fails with baseline drift. Baseline preservation approval is not release-scope approval.

## [1.1.2] - 2026-08-29 — Canonical Proposal State

Makes one canonical proposal state authoritative for every approval projection, safely projects legacy contradictory records without rewriting them, includes exact command `cwd` values, and makes evidence-identical refinement idempotent. Legacy `decision.approvalStatus` and `approvalBrief.status` values are non-authoritative compatibility projections derived from the canonical proposal state. Dirty, unresolved, weak, expired, or superseded proposals never project approval readiness. Each approval check includes its exact `cwd`; a rescan with no authority-bearing change returns `changed: false` and does not create a revision archive.

## [1.1.1] - 2026-08-29 — OMP Field Deployment and Rollback

Adds `shipping-harness-omp` preview/bootstrap/doctor/rollback, retains the active OMP `18.0.10` wrapper/core, backs up the previous Shipping package and managed OMP files, validates all nine MCP tools, and runs a planning-only nested-project field pilot without target mutation or approval.

## [1.1.0] - 2026-08-29 — Nested Workspace Intelligence and Proposal Refinement

Selects the actual runnable workspace from bounded Git-tracked evidence, derives manifest-owned acceptance commands with exact working directories, recommends the next semantic version from mechanical evidence, and adds `shipping_refine` so one proposal identity can be revised without replacement proposals or raw command input.

## [1.0.2] - 2026-08-29 — Proposal Safety Hardening

Adds one canonical proposal state, an active-proposal index, idempotent starts, audited supersession, AUTO-only MCP start, weak-acceptance rejection, and truthful pending-proposal status. Dirty, unresolved, or fallback-only proposals cannot be approved.

## [1.0.1] - 2026-08-29 — OMP MCP Compatibility Patch

Adds explicit MCP `2025-03-26` initialization compatibility for OMP `15.10.12`, preserves the negotiated protocol version for later requests, fixes the user-global npm installation form, and leaves Shipping authority and tool semantics unchanged.

## [1.0.0] - 2026-08-29 — Stable Internal Shipping Control Plane

Stable schemas and examples, authority-preserving migration, compatibility diagnostics, internal operations, completion benchmark, security inventory, clean install, v0.6-to-v1 upgrade, plugin rollback, installed MCP beginner flow, private OMO promotion verification, and internal remote recovery are the v1 release gates. See `docs/planning/09-SEQUENTIAL-ROADMAP-AND-DEVELOPMENT-PLAN.md`.

## [0.9.0] - 2026-08-28 — Authenticated Internal Remote Control

TLS-only private access, signed and replay-protected requests, project/action allowlists, one-time proposal approval, bounded notifications, and signed backup/restore were implemented and closed. The remote gateway is not a public MCP endpoint: it is a separate TLS-only internal JSON control surface that maps authenticated requests back to the same fixed `callShippingTool` functions used by the local MCP server. No remote request accepts a raw shell command or replaces the MCP server. Local MCP and CLI remain the recovery and higher-authority control paths; in particular, a local human stop prevents remote execution or resume. The gateway exposes only fixed project, status, proposal, approval, control, verification, close, notification, backup, restore, and health operations.

## [0.8.0] - 2026-08-28 — Evidence-Gated Team/DAG Decision

The v0.7 real pilot found no coordination bottleneck or parallel critical work, so Team/DAG was deliberately closed as disabled rather than implemented speculatively.

## [0.7.0] - 2026-08-28 — Private OMO Runtime Bridge

A separately pinned private OMO runtime, signed work orders and receipts, bounded execution, session ownership, human-stop precedence, package/install/canary/rollback proof, approved fallback or durable BLOCKED, and mandatory Shipping re-verification. OMO source is not bundled into Shipping Core. See `docs/internal-runtime/README.md`.

## [0.6.0] - 2026-08-28 — Beginner Plugin and Local MCP

Local plugin installer, concise approval/progress/blocker/completion views, MCP resources, doctor/repair/upgrade/rollback, isolated package installation, and a non-developer flow without project-specific CLI or JSON editing.

## [0.5.0] - 2026-08-28 — Durable Goal and Evidence Runtime

Locked contracts compile into stable Goal and Task records with append-only execution evidence, restart recovery, current-SHA completion proof, bounded retries, planning-stuck termination, human pause/abort propagation, and concise MCP status.

## [0.4.0] - 2026-08-28 — AI Decides, Human Approves

Model-agnostic automatic decision mode, bounded repository evidence, assumptions/confidence/reversibility, risk-based exception questions, one-screen approval brief, and deterministic decision-policy validation.

The user states the desired outcome; the connected agent chooses safe technical defaults, the smallest operable scope, acceptance checks, and deferred work. The user reviews one concise release brief and approves or edits it. `AUTO` is the default mode; questions are exceptional and limited to high-risk, irreversible, externally consequential, or genuinely unresolved core-product decisions. See `docs/planning/08-V0.4-AUTO-DECISION-DIRECTION.md`.

## [0.3.0] - 2026-08-28 — Beginner MCP Control Surface

A local STDIO MCP server, natural-language goal intake, repository analysis, minimal scope and acceptance proposal, explicit Git-bound approval, safe host-agent work orders, configured-adapter execution without raw command inputs, and deterministic verification/closure tools. The local MCP server validates the explicit confirmation field and proposal hash, but the MCP client must be configured to ask the user before mutating tools are invoked; a dedicated approval-card plugin UI remained outside v0.3.0. No MCP tool accepts a raw shell command; when no approved adapter command exists, `shipping_execute` returns a work order to the connected host agent instead of inventing CLI flags.

## [0.2.0] - 2026-08-28 — Harness Adapter Layer

Capability-negotiated adapters for Generic shell execution, Codex CLI, Gajae Code, Q00 Ouroboros, and OMO Native; external artifact collection; hook event ingestion; live capability probes; and fixture-based integration verification when a harness is not installed. Exposes one stable capability model across five adapters with capability reports using only four evidence levels: `live` (a non-mutating executable probe succeeded), `configured` (a repository command or repository-local integration artifact exists, but a live executable proof is incomplete), `fixture` (behavior was verified only against an isolated test fixture), and `unavailable` (neither a live probe nor repository-owned configuration is present). Executable discovery never proves authentication, provider access, model quota, or successful autonomous execution; Shipping Harness invokes only an operator-supplied command or a command explicitly stored in the locked contract.

## [0.1.0] - 2026-08-28 — Finish One Version

Local Git repository support, contract lock, state/ledger persistence, command acceptance gates, Git-SHA-bound evidence, scope drift detection, issue classification, bounded fix policy, pause/abort precedence, backlog generation, and version closure.
