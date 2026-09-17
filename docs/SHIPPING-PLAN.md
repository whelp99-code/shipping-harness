# The shipping-plan file

`docs/shipping-plan.json` is a repository-owned, reviewable file that lets `shipping_start`/`shipping_refine`
see the whole project plan — not just the next small patch. The harness never writes this file and never calls
a model to produce it. A host model (or a person) writes it; a human reviews and commits it like any other
source file; the harness only validates it and computes progress deterministically from closed release receipts.

If the file is absent, or the caller does not point `shipping_start` at it, nothing changes: proposals stay
exactly the small-patch shape they were before v1.12.0.

## The file can never carry a command

`command`, `shell`, `args`, `argv`, `env`, and `environment` keys are rejected anywhere in the document (nested
objects and arrays included). A stage's acceptance criteria are expressed only as **references** to a
candidate command the project analyzer already detected in the repository — never as a command string the
plan file supplies itself. This is enforced by `src/core/shipping-plan.mjs` (`ERR_PLAN_RAW_COMMAND`), not by
convention.

## Updating an existing plan

The plan file is a document whose **evidenced parts are immutable and whose unevidenced parts are free**.
Evidence is a `CLOSED` release receipt for that stage (it is `DONE`) or the current contract lock (it is
`ACTIVE`). An update rewrites `docs/shipping-plan.json` in place — the path is fixed and any other path (or
`--plan`/`planPath` pointing elsewhere) is refused with `ERR_PLAN_PATH_FIXED`.

| Stage state | Evidence | `id` | title/outcome/scope/acceptanceRefs/size | `dependsOn` | Delete |
|---|---|---|---|---|---|
| DONE | `planStageId` on a `CLOSED` receipt | immutable | immutable | immutable | not allowed |
| ACTIVE | `plan.stageId` on the current contract | immutable | immutable | immutable | not allowed |
| Not started (READY/BLOCKED) | none | free | free | free (no cycles) | allowed |

(한국어: 계획 파일은 **증거가 붙은 부분은 불변, 증거가 없는 부분만 가변**인 문서다. 증거 = 그 단계의
CLOSED receipt 또는 현재 잠긴 계약. 표는 위 영문 표와 동일하다.)

- Adding a new stage is always allowed. Adding a new entry to a `DONE`/`ACTIVE` stage's `dependsOn` is
  rewriting the past, so it is refused even though the new stage itself is free.
- Any violation — a renamed or deleted evidenced stage ID, a changed evidenced field, or a rewritten
  `dependsOn` on an evidenced stage — is refused as `ERR_PLAN_HISTORY_LOST` with one `VIOLATION:` line per
  rewritten field, citing the receipt or lock that proves the stage.
- If a closed stage genuinely must change, that is not an update — it is a new plan: set
  `program.supersedes` to the SHA-256 hash of the plan being replaced (the harness reports how many
  completed stages are not inherited, `PLAN_SUPERSEDED`, and progress recounts from zero against the new
  plan hash alone). A `supersedes` value that names no closed receipt is refused as
  `ERR_PLAN_SUPERSEDES_UNKNOWN`.
- Bump `revision` by one on every update that changes the plan hash, and recompute `sources[].sha256` for
  every cited source document. `.shipping/plan-history.jsonl` records the hash, revision, and a diff of
  which stages changed (`added`/`modified`/`removed`) every time `plan check`, `shipping_start`/`refine`, or
  `lock` sees a new plan hash. `revision` going backwards is `ERR_PLAN_REVISION_REGRESSED`; reusing a
  revision number under a different plan hash is `ERR_PLAN_REVISION_REUSED`. The history file is
  append-only and hash-chained exactly like `.shipping/ledger.jsonl`; a broken chain is
  `ERR_PLAN_HISTORY_TAMPERED`.
- A plan with no `revision`, or a `sources[]` entry with no `sha256`, still works exactly as it did in
  v1.12.0 — it is warned once (`PLAN_LEGACY_FORMAT`), never blocked.

## Source drift

Each entry in `sources[]` may carry the SHA-256 hash of the source document's content when the plan was
written (`sources[].sha256`, optional, additive). On every load the harness compares that hash against the
file on disk: a mismatch is `PLAN_SOURCE_DRIFT: <path> changed since the plan was written (plan <hash8>, now
<hash8>)` and a missing file is `PLAN_SOURCE_MISSING: <path>`. Both are diagnostics only — they never block a
proposal, a lock, or a close. They surface as `WARNING:` lines in `shipping-harness plan status`, as
`sourceDrift`/`legacyFormat` in `plan check --json`, in `shipping_start`'s `shippingPlan.diagnostics`, and —
only when drift exists — as one bounded plain-brief line ("계획 원본 N개가 바뀌었습니다. 계획 파일 갱신을
검토하세요.").

## Format

Schema: [`schemas/v1/shipping-plan.schema.json`](../schemas/v1/shipping-plan.schema.json)
(`shipping-harness/plan-v1`, `additionalProperties: false`). Worked example:
[`schemas/v1/examples/shipping-plan.example.json`](../schemas/v1/examples/shipping-plan.example.json).

```jsonc
{
  "schema": "shipping-harness/plan-v1",
  "project": "example-project",
  "program": {
    // The whole-project completion goal, in one or two sentences. PROGRAM has no
    // execution or approval authority — it is a read-only summary of where the
    // project is going and how much of it is done.
    "title": "Example program",
    "outcome": "Deliver the example product end to end so an internal operator can install it, use the core flow, and recover from failure."
  },
  "sources": [
    // Optional. The planning documents the host model read to produce this file —
    // repository-relative paths only, for a human reviewer to check against.
    // Optional "sha256": the source file's content hash when this plan was written;
    // compared against the file on disk at load time (see "Source drift" below).
    { "path": "docs/planning/ROADMAP.md", "note": "read-only planning source", "sha256": "…64 hex…" }
  ],
  // Optional positive integer, bumped by one on every update that changes the plan
  // hash. See "Updating an existing plan" below.
  "revision": 1,
  "stages": [
    {
      // A stage is one release the harness can lock, run, verify, and close on its own.
      "id": "S-01",
      "title": "Deliver the core flow",
      "outcome": "A user can complete the core flow from start to result on the current revision.",
      "dependsOn": [],
      // References to candidate command IDs the project analyzer already detected —
      // never a command string. Discover the valid IDs for your repository with
      // `shipping-harness plan check --json` (see below).
      "acceptanceRefs": ["node-test"],
      "scopeInclude": ["Core flow implementation and its acceptance evidence."],
      "scopeExclude": ["Optional polish and future extensibility work."],
      // MILESTONE (default) or PATCH. PATCH stages get the same small-fix budgets
      // (maxFixCycles 1, maxAgentRuns 1) as a plan-less small patch.
      "size": "MILESTONE"
    },
    {
      "id": "S-02",
      "title": "Operate and recover",
      "outcome": "The result can be installed, checked, and rolled back with reproducible evidence.",
      "dependsOn": ["S-01"],
      "acceptanceRefs": ["node-test"],
      "size": "PATCH"
    }
  ]
}
```

Bounds (all enforced, none configurable): 64 KiB file size, 24 stages, 8 `acceptanceRefs`/`dependsOn` per
stage, 24 scope entries per stage, 16 `sources`. A dependency cycle, a duplicate stage ID, a stage that depends
on an unknown ID, an absolute or `../`-escaping path, or a path under `.shipping/` is rejected.

## Progress is computed, not declared

`shipping-harness` never asks the plan file which stage is "done" — it looks at `.shipping/releases/*.json`
closure receipts. A stage is `DONE` only when a closed receipt carries a matching `planStageId`. A stage is
`READY` only when every stage in its `dependsOn` is `DONE`. The currently locked contract's `plan.stageId`
(if any) marks that stage `ACTIVE`. Everything else is `BLOCKED_BY_DEPENDENCY` (or `BLOCKED_BY_UNRESOLVED` if
its `acceptanceRefs` don't resolve against the current analyzer output). This is exactly what
`shipping-harness plan status` prints and what `shipping_start` projects as `shippingPlan.progress`.

## A stage must name something that can prove it

`acceptanceRefs` may not be left empty. A stage with no reference has nothing that can
prove it, so it never becomes READY: it is reported as `UNGATED_STAGE` and stays blocked
until it references a command the analyzer detected. This is deliberate. A stage the
harness cannot prove is work for a person to judge, not a gate to pass.

## Discovering candidate command IDs

A stage's `acceptanceRefs` must reference a command the project analyzer can already detect in your
repository — run this before writing (or after editing) the plan file:

```bash
shipping-harness plan check --json
```

This validates `docs/shipping-plan.json` (or `--plan PATH`) and, on success, lists `candidateCommandIds`: the
exact strings usable in any stage's `acceptanceRefs`. It does not touch `.shipping/` state. A reference that
doesn't resolve degrades that stage to `BLOCKED_BY_UNRESOLVED` with a visible diagnostic — it never causes a
raw command to be accepted instead.

## CLI

```bash
shipping-harness plan status [--plan PATH] [--json]   # progress table: stage id, title, status, next
shipping-harness plan check  [--plan PATH] [--json]    # validate the plan file only; exit 1 + error code if invalid
```

Both default `--plan` to `docs/shipping-plan.json` (repository-relative) and never write to `.shipping/` or the
plan file itself. `plan check` also records a newly-seen plan hash into `.shipping/plan-history.jsonl` (a
no-op when the hash is unchanged); `plan status` additionally prints `Revision: <n> (history entries: m)` and
one `WARNING:` line per source-drift or legacy-format diagnostic.

## Prompt for a host model

Use this (or something close to it) whenever a host model is asked to write or update the plan file. It
covers both the empty-repository case and the far more common case where `docs/shipping-plan.json` already
exists:

```text
If docs/shipping-plan.json already exists, run `shipping-harness plan check --json` first and read its
`protectedStageIds`: those stages already carry evidence (a CLOSED receipt or the current lock). Never change
a single character of a protected stage's id, title, outcome, scope, acceptanceRefs, size, or dependsOn, and
never delete one — reflect any change in the source documents only by editing an unstarted (READY/BLOCKED)
stage or by adding a new stage. If a protected stage genuinely must change, that is a new plan, not an
update: set program.supersedes to the plan's current hash instead of rewriting it. After editing, bump
`revision` by one and recompute the sha256 of every entry in `sources[]`.

If the file does not exist yet, read docs/planning/*.md and any STATUS/ROADMAP files in this repository and
write docs/shipping-plan.json following schemas/v1/shipping-plan.schema.json (schema
"shipping-harness/plan-v1"). Break the remaining work into stages small enough that `shipping-harness` can
lock, run, verify, and close each one on its own, and set an initial `revision: 1`.

Either way: do not include a `command`, `shell`, `args`, `argv`, `env`, or `environment` key anywhere in the
file — reference only candidate command IDs from `shipping-harness plan check --json`. Never create a second
plan file or point `--plan`/`planPath` at a different location; the path is fixed at
docs/shipping-plan.json. Stop after writing the file; do not run `shipping-harness lock`.
```

## What `shipping_start`/`shipping_refine` do with it

See [`docs/MCP.md`](MCP.md#plan-aware-proposals) for the `tier`/`shippingPlan` output shape. In short: `program`
is a read-only summary with no execution or approval authority; `milestone` (or `patch`, when no stage is
ready) is the one proposal that can actually be approved with `shipping_approve_scope`.

## Recommendation: one acceptance command per stage

The analyzer only offers the commands your project already defines (for example `npm test`, `npm run lint`). If one `npm test` runs the tests of every stage, the first stage cannot close until all stages are implemented. Give each stage its own script (`test:parse`, `lint:api`, `check:stage-2`, …). The analyzer offers scripts named `test|lint|typecheck|check|verify|e2e|smoke` followed by `:`, `.`, `_` or `-` as stage-scoped candidate ids (`node-test-parse`), listed by `plan check --json`. They are never added to a default proposal; only a plan stage that references them makes them acceptance criteria.
