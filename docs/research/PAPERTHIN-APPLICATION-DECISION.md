# Paperthin Application Decision for Shipping Harness v1.4.0

**Decision:** selectively reimplement general output-quality principles as original deterministic Shipping Core checks; do not install, vendor, copy, auto-update, or depend on Paperthin at runtime.

## 1. Reference

- Project: `LilMGenius/paperthin`
- Repository: `https://github.com/LilMGenius/paperthin`
- Observed license: MIT
- Reference date: 2026-08-30 KST

Paperthin describes an agent-agnostic suite of plain-Markdown skills for artifact clarity, correctness, restraint, single-source-of-truth maintenance, one-next-action navigation, independent-evaluation checks, and post-change quality review.

## 2. Why not install it into Shipping Core

Shipping Core is an authority-bearing deterministic control plane. Paperthin skills are primarily model-executed Markdown workflows. Making the full catalog a core dependency would add invocation choices and model interpretation to a path whose purpose is to reduce model-dependent variance.

Therefore v1.4.0 does not:

- install the Paperthin package;
- link its global skills;
- copy or vendor its source;
- auto-update from its repository;
- grant any Paperthin workflow release, approval, Git, or closure authority;
- add a Paperthin adapter or tenth MCP tool.

## 3. Concepts selected for original implementation

| Reference idea | Shipping implementation | Authority |
|---|---|---|
| instruction-read check | deterministic consistency between explicit goal, canonical state, and compiled headline | quality diagnostic only |
| one next best action | one state-derived primary action in `actionEnvelope` | canonical Shipping state projection |
| single source of truth | `briefFactGraph` as the sole input to all beginner projections | mechanical |
| debloat/restraint | bounded sections, item caps, duplicate detection, and byte limit | quality gate |
| independent verification | reject model prose or self-referential claims as acceptance evidence | existing acceptance authority |
| post-output review | deterministic plain-brief quality report before exposure | quality diagnostic only |

These are general software and communication principles, implemented from Shipping Harness requirements and existing code conventions. No Paperthin text or implementation is copied.

## 4. Explicit exclusions

- release/tag/publish automation from an external skill;
- automatic commit, push, deploy, reset, stash, or discard;
- multi-model voting or consensus as proof;
- specific model or vendor routing;
- user-facing skill catalog installation;
- modifying the existing Shipping contract, evidence, approval, blocker, pause, or closure authorities.

## 5. Attribution and license boundary

Because Shipping v1.4.0 does not copy or vendor Paperthin code or documentation, Paperthin is not a shipped runtime dependency. This design record preserves conceptual provenance. If future work copies substantial Paperthin material, the MIT copyright and permission notice must be added to `THIRD_PARTY.md`/NOTICE and the copied scope must be inventoried before release.

## 6. Verification

The v1.4.0 test suite must prove:

- the installable package has no Paperthin dependency;
- no Paperthin source path is included in the package;
- normal report generation invokes no model, network, or external skill process;
- model fixtures cannot change the compiled brief hash;
- the existing nine-tool Shipping authority surface remains unchanged.
