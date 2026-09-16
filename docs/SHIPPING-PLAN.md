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
    { "path": "docs/planning/ROADMAP.md", "note": "read-only planning source" }
  ],
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
plan file itself.

## Prompt for a host model

Use this (or something close to it) to have a host model turn existing planning documents into a plan file a
human can review and commit:

```text
Read docs/planning/*.md and any STATUS/ROADMAP files in this repository. Write docs/shipping-plan.json
following schemas/v1/shipping-plan.schema.json (schema "shipping-harness/plan-v1"). Break the remaining work
into stages small enough that `shipping-harness` can lock, run, verify, and close each one on its own. Do not
include a `command`, `shell`, `args`, `argv`, `env`, or `environment` key anywhere in the file — reference only
candidate command IDs from `shipping-harness plan check --json`. Stop after writing the file; do not run
`shipping-harness lock`.
```

## What `shipping_start`/`shipping_refine` do with it

See [`docs/MCP.md`](MCP.md#plan-aware-proposals) for the `tier`/`shippingPlan` output shape. In short: `program`
is a read-only summary with no execution or approval authority; `milestone` (or `patch`, when no stage is
ready) is the one proposal that can actually be approved with `shipping_approve_scope`.

## Recommendation: one acceptance command per stage

The analyzer only offers the commands your project already defines (for example `npm test`, `npm run lint`). If one `npm test` runs the tests of every stage, the first stage cannot close until all stages are implemented. Give each stage its own script (`test:stage-1`, `test:stage-2`, …) so `plan check` can offer one candidate id per stage and each stage closes on its own evidence.
