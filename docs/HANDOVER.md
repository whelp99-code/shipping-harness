# Shipping Harness v1 Internal Handover

**Current version:** 1.13.3

## Product promise

The user states the desired outcome. Shipping Harness analyzes the repository, proposes the smallest releasable scope, asks only for exceptional high-risk decisions, requires one exact approval, controls bounded execution, independently verifies evidence, and closes the release only when blockers are zero.

The user is the approver, not the technical interviewer.

## Authority order

1. Human pause or abort.
2. Locked Shipping contract, scope, budgets, and approval receipt.
3. Deterministic evidence and Release Judge.
4. Shipping Finisher and closure receipt.
5. Host agent, adapters, and private OMO execution claims.

No model, OMO task, remote client, or recovery routine can outrank the first four levels.

When `shipping_start`/`shipping_refine` project a repository-owned `docs/shipping-plan.json`, the resulting `PROGRAM` view (the whole-project title, outcome, and progress) has no execution, approval, or closure authority of any kind — it is a read-only summary, never a proposal. Only the `MILESTONE` or `PATCH` layer derived from one plan stage can be approved with `shipping_approve_scope`, following the same exact-hash approval flow as a plan-less proposal.

Shipping Harness writes Git history in exactly one place, and it is `src/core/baseline-commit.mjs`. Before `shipping_start` analyzes anything, it commits the user's working tree as one local commit so the release baseline is a revision that cannot move under the proposal (`commitBaseline: false` opts out and restores the pre-v1.13.0 dirty-baseline review flow). That commit is the boundary: no push, no tag, no amend, no rebase, no `reset --hard`, no branch switch, and one documented undo (`git reset --soft HEAD~1`). Repository hooks are bypassed for it, so the analysis path still runs no repository code; commit signing is not overridden, so a repository that signs every commit keeps signing this one and a signing failure surfaces as `ERR_BASELINE_COMMIT_FAILED`. Untracked files are enumerated with `git ls-files --others --exclude-standard` — never `git add -A`/`git add .` — so an ignored file cannot be staged, `.shipping/**` is excluded unconditionally, and one credential-like, oversized, or over-count file refuses the WHOLE commit with `ERR_BASELINE_UNSAFE_UNTRACKED`, leaving the tree, the index and `HEAD` byte-identical. The file is never silently skipped so the rest can be committed. Approving a baseline commit is not approving release scope, and the auto-commit grants no other authority: it appends a `baseline.autocommitted` ledger event and no state transition.

`postLockCommits` in a closed release receipt is the commits made between the locked baseline and the closed revision, with `commitsSinceLock` reported by `status`. It is evidence, not a gate: whether a commit made after approval belongs to the approved goal is not mechanically decidable, so the harness records it (bounded to 50 commits, 20 paths, 120-character subjects) and a human reads it. Nothing in this path may ever block a close, and a release that shows unexpected commits is a question for the reviewer, not a refusal by the engine.

Evidence freshness is bound to the working tree, not only to `HEAD`. Every evidence manifest records `treeFingerprint` (sha256 over the HEAD sha plus each path changed relative to HEAD and the blob sha of its working copy, `.shipping/` excluded) and `dirtyPaths` (those paths). `assertFreshEvidence` compares that fingerprint as well as the contract hash and Git SHA, so acceptance results recorded against uncommitted work go stale the moment any file changes, even though `HEAD` never moved; `state.currentEvidenceFingerprint` carries the accepted run's fingerprint and `status` reports `evidence: dirty (N uncommitted paths)` whenever the tree holds uncommitted work. Manifests written before v1.10.0 carry no fingerprint and keep the old Git-SHA-only contract. `close` deliberately does not compare the fingerprint: in-scope uncommitted work is already refused with `ERR_CLOSE_UNCOMMITTED`, and committing it moves `HEAD` and fails the evidence-SHA check.

A state whose integrity is `TAMPERED` blocks every command until an operator restores it from trusted history. `.shipping/state.json` carries an `integrity` digest bound to the head of the append-only `.shipping/ledger.jsonl` hash chain, and a `CLOSED` or `SHIPPABLE` state is additionally checked against the release receipt and the evidence manifest on disk. `verify`, `close`, `release prepare`, and hook ingestion refuse with `ERR_STATE_TAMPERED`; a Stop hook decision returns `DENY_CONTINUATION` with reason code `STATE_INTEGRITY_TAMPERED`. `status` and MCP `shipping_status` never throw: they report `integrity`, report the last state the ledger proves rather than the claim in the file, and add a derived `false-user-state` BLOCKER that is never persisted into `issues.json`. A state file written before v1.10 has no signature and reads as `UNVERIFIED_LEGACY`; that is reported but does not block.

## Components

- `shipping-harness`: deterministic CLI engine.
- `shipping-harness-mcp`: project-root-fixed local STDIO MCP server.
- `shipping-harness-plugin`: beginner installer, doctor, upgrade, rollback, and uninstall surface.
- `shipping-harness-remote`: optional authenticated internal TLS gateway; no arbitrary shell.
- `shipping-harness-omo-runtime`: separate private internal runtime pinned outside Shipping Core; **deprecated as of v1.11.1** — the pinned runtime repository was archived and `packages/internal-omo-bridge` is retired from the release gates (see `packages/internal-omo-bridge/DEPRECATED.md` and `../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md`). The OMO Native adapter (`src/adapters/omo.mjs`) is unaffected.
- `packages/stable-control`: stable schema, compatibility, migration, health, and event surfaces.

## Operator checks

Before using a project:

1. confirm the repository has at least one Git commit;
2. register the project-specific MCP root;
3. run plugin doctor and MCP discovery;
4. ask Shipping to propose the next small release;
5. inspect the one-screen scope and approve only the exact proposal;
6. monitor `RUNNING`, `PAUSED`, `BLOCKED`, `SHIPPABLE`, or `CLOSED`;
7. retain the release receipt, tag, and backlog.

## v1.4.0 beginner-report authority

Shipping Core compiles the default Korean report from canonical state, baseline, coverage, issues, and evidence. The report always includes problems, improvements, next plan, summary, and one next action. OMP must render it before optional model advice. Model advice is explicitly non-authoritative and cannot change approval readiness, acceptance, blockers, pause/abort, SHIPPABLE, or CLOSED. If rendering fails, operators use the raw Shipping fields; the failure never changes the core state.

## Support boundary

Supported internal issues include installation, MCP registration, contract/proposal state, evidence freshness, plugin repair, internal remote gateway, backup/restore, and rollback. The private OMO pin/bridge is deprecated as of v1.11.1 (see Known limitations); it is no longer a supported operational surface pending a new ADR. Application-specific feature design remains the responsibility of the selected host agent under the approved Shipping contract.

## Known limitations

- Internal use only; no customer/public SaaS or integrated OMO redistribution.
- The private OMO runtime bridge (`packages/internal-omo-bridge`, `config/upstreams/omo-pin.json`) is deprecated as of v1.11.1: the pinned runtime repository was archived, so its 5 runtime-dependent tests are excluded from `release:verify` and run only manually (`npm run test:omo-bridge`). The code, schemas, and historical receipts are retained; reactivation requires a new ADR and contract (`../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md`). The OMO Native adapter and the nine MCP tools are unchanged.
- Team/DAG remains disabled because the v0.7 pilot did not prove a coordination bottleneck.
- Remote mobile use requires an operator-managed private TLS endpoint and credentials.
- Shipping does not automatically push, deploy, purchase, or contact customers.
- Completion benchmark validates governance correctness, not model quality or token-cost superiority.
- Optional improvements may remain in `NEXT` after a version closes.

## Ownership

- Product direction and scope approval: repository owner.
- Shipping Core and release policy: internal engineering owner.
- Private OMO fork/pin/license notices: internal runtime owner.
- Remote credentials, TLS, backup, and incident response: internal operations owner.
- Security and license review on direction change: designated internal reviewer.

## Direction-change triggers

Stop and re-plan before public publication, customer deployment, multi-tenant service, external collaborator distribution, billing, unrestricted remote shell, automatic deployment, or a different OMO licensing boundary.

## v1.5.0 release-train authority

`shipping_start` deterministically compiles a rolling one-to-five-version train. The first release exactly matches the current proposal contract. Future releases carry value, entry, exit, rollback, and replan gates only and cannot execute or grant current authority. Exact approval writes `.shipping/release-train.json`, bound to proposal hash, contract hash, and baseline SHA. Replan after every predecessor closure; a train never implies `RELEASED`.

## v1.6.0 policy-autopilot authority

One explicit approval may bind `MANUAL` or `LOCAL_REVERSIBLE` to the exact proposal, contract, baseline, and release train. The deterministic policy engine, not the host model, selects `AUTO`, `NOTIFY`, `ASK`, or `STOP`. Reversible local implementation, verification, bounded blocker repair, local `CLOSED`, and predecessor-gated continuation may run only while every binding and rollback remains current. Production, public/customer, external write, cost, license, destructive data, authentication, and security consequences remain human-owned. Pause/abort is immediate, stale or tampered state fails closed, and `CLOSED` never marks `RELEASED`. Operations are defined in `docs/operations/AUTOPILOT-RUNBOOK.md`.

## v1.6.1 field evidence handover

Operators retain `docs/reports/v1.6.1-autopilot-field.json` with the source repository. It records tested lanes, decision performance, read-only project fingerprints, and zero-valued safety counters. The file is not shipped in the npm package. Installation handover additionally records pre/post OMP hashes, doctor, exact nine tools, package digest, backup ID, and rollback preview.

## v1.7.0 goal discovery handover

Operators retain the CLOSED receipt, annotated tag, `docs/reports/v1.7.0-goal-discovery.json`, and the stable Goal Discovery and Decision Ledger schema examples. The field report must show nine tools, zero technical questions, zero model-authority leaks, zero false direction/ready/closed/released results, and unchanged available real-project fingerprints. `.shipping/decision-ledger.jsonl` is runtime authority evidence: do not edit, truncate, reorder, or merge it manually. A hash, sequence, event-key, Git-binding, or retention failure is an incident and must stop planning until recovered from trusted project history or a separately verified backup.

### Intent Gate handover

For a new terse request, verify `intentGate` before interpreting baseline or Goal Discovery output. `CONFIRMATION_REQUIRED` means read-only analysis is complete and exactly one workflow-boundary answer remains. Preserve `ANALYZE_ONLY` as the default; do not create a Goal Charter, Release Train, approval, execution, verification command, commit, or close from that state. `ANALYSIS_COMPLETE` and `PLAN_COMPLETE` are non-approvable. Only `IMPLEMENT` or `AUTOPILOT` can enter the existing scope-approval flow. The intent answer must be appended through `shipping_refine`, never by editing the Proposal JSON.

Operational verification is `npm run test:intent-gate` plus `npm run smoke:intent-gate`. The field smoke fingerprints the real Orca-JARVIS HEAD, porcelain, and all tracked bytes before and after bounded analysis. Any target mutation, extra MCP tool, model authority, premature planning, or premature implementation is a release blocker.

## v1.12.0 plan-aware proposal authority

`shipping_start`/`shipping_refine` may bind an optional repository-owned `docs/shipping-plan.json` (schema `shipping-harness/plan-v1`; see `docs/SHIPPING-PLAN.md`). The file is written and committed by a person (a host model may draft it, but never runs it), never by Shipping Harness, and can never carry a `command`/`shell`/`args`/`argv`/`env`/`environment` key anywhere in the document — stage acceptance only references a candidate command the deterministic project analyzer already detected. Progress (`DONE`/`ACTIVE`/`READY`/`BLOCKED_BY_DEPENDENCY`/`BLOCKED_BY_UNRESOLVED`) is computed only from `.shipping/releases/*.json` closure receipts carrying a matching `planStageId`, never from the plan file's own claims. `PROGRAM` (the whole-project projection) has no execution or approval authority; only `MILESTONE`/`PATCH` (one plan stage, or the existing small-patch fallback) is ever approvable, and `shipping_approve_scope` rejects any attempt to approve the `PROGRAM` projection's hash with `ERR_PLAN_PROGRAM_NOT_APPROVABLE`. A missing or invalid plan file changes nothing: the proposal degrades to the pre-v1.12.0 small-patch shape with a visible diagnostic. The CLI (`shipping-harness plan status`, `shipping-harness plan check`) is read-only and never mutates `.shipping/` or the plan file.

## v1.12.1 plan-file update rules

The plan file is **evidence-immutable**: a stage that already carries evidence — a `CLOSED` release receipt
(`DONE`) or the current contract lock (`ACTIVE`) — can never have its `id`, `title`, `outcome`, scope,
`acceptanceRefs`, `size`, or `dependsOn` changed or the stage deleted, in `docs/shipping-plan.json` or via
`shipping_start`/`shipping_refine`'s `planPath`. Only not-started (`READY`/`BLOCKED_BY_*`) stages are free to
edit, and adding a new stage is always allowed; adding a new dependency to an evidenced stage's `dependsOn`
is refused as `ERR_PLAN_HISTORY_LOST` even though the new stage itself is fine. A closed stage that genuinely
must change requires `program.supersedes` (the previous plan's hash) rather than an in-place rewrite; an
unknown `supersedes` value is `ERR_PLAN_SUPERSEDES_UNKNOWN`. See "Updating an existing plan" in
`docs/SHIPPING-PLAN.md`.

`.shipping/plan-history.jsonl` is runtime authority evidence with the same status as
`.shipping/decision-ledger.jsonl` and `.shipping/ledger.jsonl`: append-only, hash-chained with the same
`prev`/`digest` fields, and committed (never gitignored). Do not edit, truncate, reorder, or merge it
manually — a broken chain is `ERR_PLAN_HISTORY_TAMPERED` and blocks every plan-touching command the same way
a tampered `state.json` blocks release commands. `revision` (optional, on the plan file) must never go
backwards (`ERR_PLAN_REVISION_REGRESSED`) or be reused against a different plan hash
(`ERR_PLAN_REVISION_REUSED`); a plan with no `revision`, or a `sources[]` entry with no `sha256`, is legacy
(pre-v1.12.1) and only warned (`PLAN_LEGACY_FORMAT`), never blocked. `sources[].sha256` drift
(`PLAN_SOURCE_DRIFT`/`PLAN_SOURCE_MISSING`) is diagnostic-only and never blocks a proposal, lock, or close.

## v1.8.1 handover

Operators verify the tagged package, nine-tool protocol, Goal Direction field report, real-project unchanged receipts, doctor, install receipt, OMP binary hashes, and rollback preview. Any non-zero safety counter blocks handover.
