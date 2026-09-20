# Changelog

All notable changes to Shipping Harness are documented in this file, most recent version first, in a format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.13.15] - Unreleased

In progress. A reporting session named the pattern after a day of reading this product's errors.

- **A diagnostic named the defect and stopped.** `ERR_PLAN_HISTORY_LOST` says what changed, what was expected, what was observed, and where the evidence is, and that session called it the most useful error it saw all day. `PLAN_FILE_INVALID` named the offending field and left the reader with no reason to suspect that one bad stage had rejected the whole plan file and the proposal in front of them was no longer plan-derived; they lost time to exactly that. It now says so, and says that fixing the file and proposing again binds the stage. `GOAL_PATH_REFUSED` carried the token and the reason but not the consequence: the path is simply absent from `scope.paths.include`, so later work there reads as scope drift with nothing connecting it back to the goal sentence that asked for it. The token and reason every refusal carries are unchanged, and the adversarial suite still pins them exactly.

## [1.13.14] - Unreleased

In progress. Found while the v1.13.13 fix appeared not to work.

- **Nothing said which build was answering.** A STDIO MCP server loads its modules once and keeps serving them, so replacing the installed package leaves every attached session on the old code. `initialize` carries the server version, but a session that connected days earlier has no reason to look again, and no later response said anything. Six servers were running against this repository, three started days before. A session verified the fix in the installed source, called the tool, got the old behaviour with byte-identical numbers, and had to reason from process start times and symlink semantics to explain it. `shipping_status` now carries `harnessVersion`, the build actually serving the call rather than the one on disk; comparing it with `shipping-harness version`, which is always a fresh process, shows immediately when a server needs reconnecting. No process is restarted or killed: several sessions may share one, and that is the user's decision.

## [1.13.13] - Unreleased

In progress. Three reports from a live operating session in one day, all the same shape: what a person reads is not what gets locked.

- **A plan request that could not be met produced a proposal anyway.** One stage with `MINOR` in its `size` rejects the whole plan file, and the proposal fell back to a PATCH whose scope came from a generic template while still reading `READY_FOR_APPROVAL`. Passing `planPath` or `stageId` explicitly made no difference: the request was dropped and something else was delivered under its name. That now refuses with `ERR_PLAN_REQUEST_UNMET` and says nothing was proposed. A plan nobody asked for still degrades, because proposing without one is legitimate, but the plain brief now carries an item saying the scope came from a template rather than the plan. There was nowhere for that to appear before, since a plan that fails to load has no projection to hang a warning on.
- **The approval screen did not show the scope about to be locked.** A proposal correctly bound to a plan stage showed three generic sentences in `approvalBrief.included` and `oneScreenApproval.included`, while the contract carried the stage's own include and exclude lists, and `SCOPE_DRIFT_ZERO` is judged against that contract. The brief was built from the decision before the stage was applied to the contract. The contract is compiled first now and the brief renders its scope, names the stage in `planStageId` and in its text, and falls back to the derived scope when a stage states none. This screen is the only place the product asks a person to decide, so it was the most serious of the three.
- **The beginner projection was the thing that disappeared when text got long.** `plainBrief` failed `boundedOutput` at 9078 bytes against a 8192 limit and was dropped entirely. Every section had an item cap; the fact graph had none, and Korean scope text grew it to 3003 bytes. It now trims facts from the end, which `buildBriefFactGraph` emits in priority order, records how many in `factsTruncated`, and never trims the canonical state or the next action. The reporter expected the repeated boilerplate goal to be the cause; measuring showed it was not, and fixing the approval screen did not shrink it.

## [1.13.12] - Unreleased

In progress. v1.13.11 was only half the fix, and the half that shipped was announced as if it were the whole one.

- **A write-side fix does not heal state already on disk.** v1.13.11 stops a close from stamping the closing release onto a spent autopilot binding. It cannot undo a stamp already written, and the reported worktree had closed under v1.13.10, so restarting on v1.13.11 still read `enabled: true`. Worse, under the v1.13.8 rule that state never recovers: spent required the bound release to differ from the current one, and the stamp had made them equal, so the dead policy reads live forever and the next autopilot approval is refused with `ERR_AUTOPILOT_ACTIVE`. Every repository that closed under an earlier build is in that state. The closure receipt is now the whole test: a policy bound to a release that has closed is spent, whatever that release is called relative to the current one. Nothing is forgiven that was not already closed, a binding whose release has no receipt still fails closed, and no state is rewritten on read. Proven against state produced by a v1.13.10 worktree rather than by this build.

## [1.13.11] - Unreleased

In progress. Found by the session that used v1.13.8 to escape the reported 1.0.3 deadlock, which noticed the closed train's hashes still sitting in the binding and asked whether that was intended. Measuring it showed one layer more.

- **A close rewrote which release a policy was bound to.** `completeManualAutopilotClosure` stamped the closing release onto the autopilot binding. Harmless when the policy authorised that release, because the two already matched; when the policy was spent it inverted the judgement. Spent means bound release is not the current one, and the close made them equal while `releaseTrainHash` and `baselineSha` stayed with the older train, producing a binding that never existed. A policy that authorised 1.0.2 and gates nothing then reported `enabled: true` for a 1.0.3 it never authorised. Behaviour stayed fail-closed the whole time, since the six-way check reported `BINDING_MISMATCH`, but the surface lied, and an untruthful surface is the false user state this product exists to prevent. Which release a policy is bound to is decided at activation. The close record's idempotency key reads the ledger now, because a spent binding's own `currentRelease` is not one.

## [1.13.10] - Unreleased

In progress. Two things v1.13.9 left open, both of which its own §6 had filed as decisions for later.

- **Every draft was born describing the release before it.** `release prepare` built the next contract as `{...current, release, goal}`, carrying the previous release's scope statements and path allowlist forward. This repository carried v1.8.2's scope as far as v1.13.8, where work done after the lock finally surfaced it as seven scope blockers and an amendment; the symptom is invisible whenever implementation precedes the lock, which is how this repository works. A prepared draft now states nothing about itself and keeps only the structural denial list. Emptying the allowlist alone would have been worse, because `analyzeScope` reads an empty include list as no restriction rather than a narrow one, so `lock` refuses a draft that never says what it may change.
- **The skip convention was not applied to the two cases that motivated it.** v1.13.9 added `SKIPPED:` so a step that cannot run could be gated instead of excluded, and `smoke:remote` and `smoke:stable` stayed excluded anyway. Both need the private OMO runtime retired in v1.11.1. The availability probe moved out of `test/omo/helpers.mjs` into the bridge package so a script can ask the same question a test could, and both are steps now: 23 become 25, with three honest WARNINGs.

## [1.13.9] - Unreleased

In progress. v1.13.8 put `test:omp-main` and `smoke:omp-main` into the gate for the first time, and both went red on GitHub while every local gate was green.

- **A fix that stopped at the production code.** v1.13.8 routed the OMP package's four npm defaults through one resolver and left seven call sites in the tests still spawning the literal `/usr/bin/npm`, which a stock runner does not have. They use the resolver now. Its PATH fallback is the only branch a runner takes and had never executed anywhere, because this machine has `/usr/bin/npm` and always took the other one; the preferred path is a parameter now, so the fallback is exercised rather than assumed.
- **A smoke that could not run had no way to say so.** `smoke:omp-main` drives the real OMP host, absent on a runner, and crashed with `spawnSync omp ENOENT`. Exiting zero quietly would have been worse, because a step that did not run reading as a plain PASS is the failure v1.13.8 existed to remove, and `release:verify` only counted a test runner's `ℹ skipped N`. A script reports `SKIPPED: <reason>` on its own line, that line counts as one skip, and it is printed as a WARNING like any other.

## [1.13.8] - Unreleased

In progress. A live release reached a state with no way out, reported with the exact sequence.

- **A policy outlived the release it authorised.** An autopilot policy approved for 1.0.2 stayed active after that release closed. Approving 1.0.3 then failed with `ERR_AUTOPILOT_ACTIVE`, and `verify` on 1.0.3 was stopped with `STALE_POLICY_BINDING` by a policy that had no authority over it. `approve` refused because the state was `LOCKED` and `verify` refused because of the spent policy, so the release was trapped. A policy whose bound release has a closure receipt and is not the current release is now spent: it reports `enabled: false`, gates nothing, and is replaced by the next activation. A binding that disagrees while naming the current release, or one whose release never closed, still fails closed, because that is tampering rather than lifecycle.
- **A failed approval had already changed the state.** The approval committed the contract, the lock, the release train, the charter and three ledger events, and only then attempted the activation that threw. The caller saw a failure and the scope was locked, and the retry was refused with `ERR_APPROVAL_STATE`. An activation that cannot succeed is now refused before the approval mutates anything, and its message says that nothing was approved or locked.
- **Allowing the replacement moved the deadlock instead of removing it.** Activating a policy on a new train wrote its first ledger event with sequence 1 and a null previous hash, but the autopilot ledger is one append-only chain for the whole repository. The chain became `…#4, #1` on disk and every later read failed with `ERR_AUTOPILOT_SEQUENCE`, so the release that could not be approved became the release that could not be verified. Activation now continues the existing chain. This was unreachable while re-activation was refused outright, and was found by replaying the reported sequence end to end rather than by testing the fix in isolation.
- **Four test directories were run by nothing.** `npm test` walks five suite roots and `release:verify` had no step for `test/autopilot`, `test/usability` or `test/omp-main-harness`; `test/team-dag` had no npm script at all. A regression introduced in v1.13.0 sat in `test/autopilot/field-matrix.test.mjs` through five releases while `release:verify` reported every one of them green. All four are now steps, and `npm run verify:gate-coverage` fails if any test directory or `test:*`/`smoke:*` script is reachable from no step and has no written reason, or if an exclusion goes stale. Exclusions and their reasons live in `scripts/release-verify-steps.mjs`.
- **Defects the closed gap was hiding.** `npm pack --json` returns a name-keyed object on npm 12 rather than an array, and all five call sites read `[0].filename` — including the OMP install and backup paths, not only smoke scripts. Both shapes are handled now, and an ambiguous or filename-less result is refused instead of read as `undefined`. The packaged-install smoke also still required the installed version to be `1.0.0`; it follows `package.json` now. The v1.13.0 regression itself was the fifth dirty-baseline test, which never received the `commitBaseline: false` its four siblings did: the working-tree bytes were never touched, only committed, and the fingerprint the test compares covers `HEAD`.
- **A test that needs a retired runtime now skips instead of failing.** `test/team-dag/entry-gate.test.mjs` reads the promotion evidence of the private OMO runtime retired in v1.11.1, which is pinned to an absolute path outside this repository. It follows the same rule as `test/omo/`, and `release:verify` prints the skip as a WARNING.

## [1.13.7] - 2026-09-19

In progress. A blocking defect reported from a live release, and the version-number bug found beside it.

- **Closing a release then committing anything made the next release impossible.** `release prepare` compared the closed Git SHA against the working tree, so every commit landed after the close counted as drift and the command refused with `ERR_RELEASE_DRIFT`, telling the user to commit work that was already committed. Close, commit the next piece of work, prepare the next release is this product's basic cycle, and it stopped after one turn. Only uncommitted source changes outside `.shipping/` block now, which is what the error always claimed to mean, and the message names the paths instead of leaving them in an unprinted details field.
- **The next release number ignored the analyzer.** With no explicit version the harness bumped the minor, discarding a version recommendation it had already derived with a change kind and a confidence: after closing 1.0.2 a patch-sized change was proposed as 1.1.0 while the evidence said 1.0.3. The recommendation is used whenever it is ahead of the closed release, with the minor bump as the fallback.

The workaround this repository had written into `AGENTS.md` for the first defect is removed. It should have been a fix.

## [1.13.6] - 2026-09-17

In progress: documentation only. Records BACKLOG-013, the CLI release path's missing approval artifact. The MCP flow binds an exact proposal hash and records who approved so a model cannot approve its own proposal; the CLI path treats whoever runs `lock` as the operator, so a model driving it closes a release with no record that a human authorised the scope. Noticed while closing this repository's own releases that way. Not a blocker, and closing it needs a decision about what "operator" means when the hands are a model.

## [1.13.5] - 2026-09-17

In progress. Reported from a live session that verified the v1.13.4 fixes and found the display still lying.

- `plan status` resolved nothing against the repository, so it printed READY for a stage `shipping_start` refuses to bind. The gate was right and the table was wrong, which is the false user state this product exists to prevent. The command now resolves acceptance the way binding does, and says why a blocked stage is blocked: `no-acceptance-reference` or `undetected-acceptance-command`.
- The baseline auto-commit reported a count but not the paths, so a caller who did not expect the commit could not see what it swallowed before undoing it. The summary and the first response line now name the files, bounded to ten with a remainder count.

## [1.13.4] - 2026-09-17

In progress. Four holes reported from a live session, all of them ours.

- A plan stage naming no acceptance reference reached READY, so it could be bound to a release and closed with nothing proving it. An empty `acceptanceRefs` is now ungated rather than ready, reported as `UNGATED_STAGE`.
- The v1.13.3 unproven-objective report read `contract.goal`, which a plan-driven milestone rewrites to the stage outcome. It now reads the goal the approver stated, so the enumerated objectives are measured again.
- A proposal stored by an earlier build was reused without regard for the build that made it, serving stale analysis after an upgrade. A proposal records the harness version and a different version regenerates.
- Outcomes listed inside one sentence counted as none. A parenthesised letter list is now counted wherever it appears.

## [1.13.3] - 2026-09-17

In progress: a goal that claims more than the contract can prove now says so.

The harness locks only what a repository-owned command can prove, which is correct, but it said nothing when a goal also named work no command reaches: an external database, a home-directory configuration, a third-party collector. Those outcomes were silently absent from the gate and the release closed without evidence for them. Two facts now reach the approval brief and neither blocks. `UNPROVEN_OBJECTIVES` states how many outcomes the goal enumerates against how many required acceptance checks the contract locks. `EXTERNAL_REFERENCE` names the URLs, home paths, absolute system paths, and host:port targets the goal points at outside the repository. An ordinary one-sentence goal reports neither.

## [1.13.2] - 2026-09-17

In progress. Three fixes found by running the harness against real repositories.

- A goal sentence only widens scope for a token carrying real path evidence: a filename extension or an explicit trailing slash. A slash alone is not evidence, so a branch name (`codex/shared-memory-completion-20260907`), a URL, and a fraction (`3/4`) are no longer read as repository paths and no longer add globs to the approved scope. A path-shaped escape attempt stays reportable as `GOAL_PATH_REFUSED`; ordinary prose is skipped in silence.
- A pyproject naming ruff or pytest produced ambient interpreter commands. Where `uv.lock` is present the acceptance commands now run through `uv run --frozen`, so a uv project is verified in its locked environment instead of stalling on a contract defect.
- Root manifest detection read the listing capped at 200 entries, so `uv.lock` sorted past the cutoff in a large repository and the uv fix never fired. Detection now reads the full name set while the reported listing stays capped.

## [1.13.1] - 2026-09-17

In progress: workspace detection accepts product directories whose names contain interior spaces (for example an umbrella checkout holding "JM-AI Action Hub/.../server"). Leading and trailing spaces stay rejected so a workspace root remains one unambiguous token in evidence, scope globs, and receipts. Found while running the harness against a real umbrella repository.

## [1.13.0] - 2026-09-17

In progress: dirty-tree friction. See `docs/planning/38-V1.13.0-DIRTY-TREE-FRICTION-DEVELOPMENT-PLAN.md`.

### Added

- Baseline auto-commit (`src/core/baseline-commit.mjs`): `shipping_start` commits the working tree as one local, undoable commit before it analyzes anything, so the proposal's `baselineSha` is that commit and cleaning the tree afterwards can no longer discard the proposal with `ERR_PROPOSAL_STALE`. This is the only place Shipping Harness writes Git history: no push, tag, amend, rebase, `reset --hard`, or branch switch, and one documented undo (`git reset --soft HEAD~1`). Hooks and signing are bypassed for this commit so the analysis path still runs no repository code. Untracked files are enumerated with `git ls-files --others --exclude-standard` (never `git add -A`/`git add .`), so ignored files cannot be staged; `.shipping/**` is excluded unconditionally. Any file `HEAD` does not already contain that is credential-like (the adapter artifact deny-list, plus `.git/`, `.shipping/`, `.ssh/`, `.aws/`, `.gnupg/` segments), larger than 8 MiB, or one of more than 200 such files refuses the WHOLE commit with `ERR_BASELINE_UNSAFE_UNTRACKED`, naming the file and leaving the tree, index and `HEAD` byte-identical — it is never silently skipped. A repository with no commit, or with `user.name`/`user.email` unset, fails as `ERR_BASELINE_COMMIT_FAILED` carrying git's stderr. The commit is recorded as a `baseline.autocommitted` ledger event (not a state transition) and returned as `structuredContent.baselineCommit` = `{sha, filesCommitted, untrackedIncluded, undo}` (or `null`), announced on the response's first text line.
- `shipping_start` input `commitBaseline` (boolean, optional, default `true`). `false` keeps the pre-v1.13.0 `DIRTY_BASELINE` review flow exactly. The MCP surface stays at nine tools and no forbidden input property name is introduced.
- `BASELINE_ALREADY_PASSING` proposal diagnostic: when (and only when) an auto-commit happened, the v1.12.1 acceptance preflight runs once against the committed tree, and every required criterion already passing is reported with the undo command. Advisory — it never blocks, and a preflight that cannot run is simply not reported.
- Post-lock commit evidence: a closed release receipt carries `postLockCommits` (every commit between the locked baseline and the closed revision as `{sha, subject, paths}`, bounded to 50 commits, 20 paths per commit and 120-character subjects, with `postLockCommitsTruncated`/`pathsTruncated` for the remainder and `.shipping/` paths omitted), the release report gains a "Commits after lock" section, and `releaseStatus`/`shipping_status`/`shipping-harness status` gain `commitsSinceLock`. Evidence only: whether a commit made after approval belongs to the approved goal is not mechanically decidable, so it is recorded for a human and never blocks a close. `schemas/v1/release.schema.json` gains both fields as optional and additive.
- Goal-named scope paths (`src/core/goal-paths.mjs`): the goal sentence is read for path-like tokens and each one widens the proposed `scope.paths.include` at the single place a proposal builds it, so a goal naming a file in a directory the baseline does not have (`Implement hello() in a new file src/index.mjs`) is no longer blocked as `Unapproved scope drift` on the first verify. A root-level file contributes only itself; a nested file contributes `<parent>/**`. Absolute paths, `..`, `~`, over-length tokens, anything matching `scope.paths.exclude`, and anything under `.shipping/` or `.git/` are refused with a `GOAL_PATH_REFUSED: <token> (<reason>)` diagnostic and never added; at most 8 tokens of at most 200 characters are considered; every addition appears as `GOAL_PATH_ADDED: <glob> (goal named "<token>")` in the proposal's diagnostics so the approval brief shows why the scope grew.

### Changed

- Surface-freeze baselines: `tools` (the added optional `commitBaseline` property) and `schemas` (the additive release-schema fields) are updated deliberately, with their previous values and reasons recorded in `test/stable/surface-freeze.test.mjs` and in section 6 of the plan. `help` is unchanged — v1.13.0 adds no CLI command or flag.

## [1.12.1] - 2026-09-16

In progress: plan-file update rules. See `docs/planning/37-V1.12.1-PLAN-UPDATE-RULES-DEVELOPMENT-PLAN.md`.

### Added

- Plan-stage immutability: a stage that already carries evidence (a `CLOSED` release receipt or the current contract lock) freezes its `id`/`title`/`outcome`/scope/`acceptanceRefs`/`size`/`dependsOn` in `docs/shipping-plan.json`. `closeRelease` and `lockContract` snapshot the bound stage into the release receipt and the lock (`planStage`), and `auditPlanHistory`/`assertPlanHistory` refuse a rewrite of an evidenced stage with `ERR_PLAN_HISTORY_LOST`, wired through `loadShippingPlan`, `shipping_start`/`shipping_refine`, `lock`, `close`, `plan status`, and `plan check`. Not-started stages stay fully editable and new stages can always be added. `program.supersedes` (a plan-replacing hash) skips the audit, reports the abandoned stage count as `PLAN_SUPERSEDED`, and recounts progress from zero against the new plan hash alone.
- `sources[].sha256` (optional, additive): compared against the file on disk at load time. A mismatch is `PLAN_SOURCE_DRIFT: <path> changed since the plan was written (plan <hash8>, now <hash8>)`; a missing file is `PLAN_SOURCE_MISSING: <path>`; a source with no `sha256` (or a plan with no `revision`) is `PLAN_LEGACY_FORMAT`. All three are diagnostics only — never blocking — surfaced in `plan status` (`WARNING:` lines), `plan check --json` (`sourceDrift`, `legacyFormat`), `shipping_start`'s `shippingPlan.diagnostics`, and one bounded plain-brief line when drift exists.
- `revision` (optional positive integer, additive) and the append-only, hash-chained `.shipping/plan-history.jsonl` (`src/core/plan-history.mjs`, reusing the same `prev`/`digest` hash-chain helpers as `.shipping/ledger.jsonl`). One entry is recorded whenever `plan check`, `shipping_start`/`shipping_refine`, or `lock` sees a plan hash it has not recorded yet; the same hash seen again is a no-op. `revision` going backwards is `ERR_PLAN_REVISION_REGRESSED`; the same `revision` naming a different plan hash is `ERR_PLAN_REVISION_REUSED`; a broken history chain is `ERR_PLAN_HISTORY_TAMPERED`. Each entry also diffs the plan's bounded stage snapshots against the previous entry into `changedStages: { added, modified, removed }`. `plan check --json` gains `history: { entries, lastRevision, lastPlanHash }`; `plan status` prints `Revision: <n> (history entries: m)`.
- `docs/SHIPPING-PLAN.md`: an "Updating an existing plan" section with the immutability table, the `program.supersedes` escape hatch, and a replaced host-model prompt that checks `plan check --json` first and never rewrites an evidenced stage.

### Changed

- `.shipping/plan-history.jsonl` is runtime authority evidence like `.shipping/ledger.jsonl` and `.shipping/decision-ledger.jsonl`: committed (never gitignored), append-only, and must never be hand-edited (`docs/HANDOVER.md`).
- `schemas/v1` hash updated twice this cycle: Phase A added optional `planStage` snapshots to `release.schema.json`/`lock.schema.json` and `program.supersedes` to `shipping-plan.schema.json`; Phase B added optional `revision` and `sources[].sha256` to `shipping-plan.schema.json`. Both purely additive, `additionalProperties: false` kept, examples updated. `tools` and `help` unchanged in both phases. See section 6 of the development plan.

## [1.12.0] - 2026-09-16

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
