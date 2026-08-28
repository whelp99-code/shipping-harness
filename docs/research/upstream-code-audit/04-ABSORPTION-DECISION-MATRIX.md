# Upstream Absorption Decision Matrix

## Accepted product rule

Shipping Harness is a personal and future company-internal system. This permits direct internal use of OMO under its current license boundary, but does not change the release-governance hierarchy.

A mechanism is accepted only when it strengthens one of these outcomes:

1. AI decides ordinary choices without interrogating the user.
2. The approved release contract remains immutable.
3. Work state and proof survive sessions.
4. Loops terminate with `CLOSED` or a durable `BLOCKED` reason.
5. Human pause/abort remains absolute.
6. Shipping Core remains independently upgradeable and able to run without OMO.
7. Internal upstream use remains pinned, attributed, testable, and rollbackable.

## Final matrix

| Capability | Best upstream source | Accepted use | Target |
|---|---|---|---|
| Repository facts vs product decisions | Ouroboros ledger source/provenance | Port into Shipping decision records | v0.4 |
| AI-first reversible defaults | Ouroboros automatic decision pipeline | Port safe-default, conflict, ambiguity, and rollback behavior | v0.4 |
| Exception-only questions | Ouroboros unsafe/conflicting gap handling | Ask only for high-risk, irreversible, external, or unresolved-core decisions | v0.4 |
| Immutable release definition | Ouroboros Seed plus Shipping Contract | Extend Shipping Contract; no second release constitution | v0.4 |
| Proposal critic | Gajae ralplan and Ouroboros grade gate | One bounded critic/policy pass; no planning council | v0.4 |
| Goal/Task state | Gajae Goal runtime | Adapt selected MIT code/algorithms into Shipping-owned schemas | v0.5 |
| Append-only proof ledger | Gajae ledger plus Shipping ledger | Extend Shipping ledger with Goal/Task checkpoints and failure fingerprints | v0.5 |
| Evidence freshness | Gajae receipts, Ouroboros authority, Shipping SHA gate | Current-contract/current-SHA proof only | v0.5 |
| Repeated failure and planning-stuck | Gajae bounded loops | Durable no-progress terminal states | v0.5 |
| Beginner install and approval UX | Shipping MCP/plugin | Shipping-owned plugin; no OMO dependency yet | v0.6 |
| Durable task state machine and child runners | OMO `senpi-task` | Use actual source in a separate private pinned internal runtime | v0.7 |
| Model/category routing with provenance | OMO `model-core` and task category resolver | Use selected actual runtime paths behind Shipping policy | v0.7 |
| Continuation ownership and stale-state suppression | OMO Senpi continuation components | Use actual runtime behavior, capped by stricter Shipping limits | v0.7 |
| Session suspend/resume and exactly-once completion | OMO `senpi-task` lifecycle/completion | Use actual runtime behavior; Shipping verifies resulting repository state | v0.7 |
| Human pause authority | Shipping Harness | Override OMO `paused` continuation semantics; Shipping pause always wins | v0.7 |
| Concurrency/depth budgets | OMO config/task engine plus Shipping contract | Actual runtime limits, but no unlimited values; initial max workers 2/depth 1 | v0.7 |
| Team and DAG orchestration | OMO team/DAG engines | Enable selected actual capabilities only after v0.7 pilot evidence | v0.8 |
| Full deep interview | Gajae/Ouroboros | Optional bounded `INTERVIEW` mode only | Later |
| Current-release evolutionary loop | Ouroboros | Exclude; improvement becomes a next-version proposal | Later/adapter |
| OMO memory/reflection/telemetry/branding | OMO | Exclude until a concrete internal requirement is accepted | Post-v1.0 or never |
| External/customer distribution | N/A | Outside accepted product direction; triggers a new license/architecture review | Always |

## Product architecture

```text
User outcome
   -> Decision Composer                   (Ouroboros-derived, v0.4)
   -> One approval brief
   -> Immutable Shipping Contract
   -> Goal/Evidence Runtime               (Gajae-derived, v0.5)
   -> Beginner Plugin / Local MCP         (Shipping-owned, v0.6)
   -> Internal OMO Runtime Bridge         (actual private runtime, v0.7)
   -> Optional bounded Team/DAG           (actual selected OMO runtime, v0.8)
   -> Deterministic Shipping Verification
   -> Finisher / Release Judge            (Shipping-owned)
   -> CLOSED or BLOCKED
```

## Authority order

```text
1. Human pause / abort
2. Locked Shipping Contract
3. Release budgets and blocker policy
4. Fresh deterministic evidence
5. Shipping Finisher closure decision
6. OMO task/team/DAG runtime state
7. Individual agent preferences and continuation requests
```

No upstream agent, OMO task record, or internal runtime may move above this order.

## Source-use boundary

### Gajae and Ouroboros

Both audited repositories use MIT licenses. Selected code may be adapted with required notices when it is smaller and safer than reimplementation. The adapted result must use Shipping schemas and tests rather than importing unnecessary runtime scope.

### OMO

Actual OMO source may be used because the accepted product is personal/company-internal only. The source is kept in a separately pinned private runtime/fork with:

- intact license and copyright notices;
- `MODIFICATIONS.md`;
- upstream and internal patch commit pins;
- build digest and compatibility record;
- selected upstream tests plus Shipping integration tests;
- previous-pin rollback;
- no public/customer distribution path.

OMO source is not pasted into Shipping Core. The runtime may be disabled or replaced without changing the release contract or Finisher.

Canonical decision: [`../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](../../planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).
