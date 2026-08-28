# Audit Scope, Pins, and Method

## Question being answered

Before Shipping Harness implements v0.4 and later absorption work, determine from the actual upstream code:

1. Which behaviors are real code rather than README claims?
2. Which mechanisms solve Shipping Harness problems directly?
3. Which behaviors conflict with `AI decides, human approves`, human-stop authority, bounded execution, or version closure?
4. Which ideas can be independently reimplemented, which should remain adapters, and which must be excluded?

## Local source acquisition

The official repositories were fetched into the ignored audit directory and checked out at detached exact revisions. Direct `git clone` was unavailable through the execution policy, so the equivalent `git init -> remote add -> fetch --depth 1 -> checkout FETCH_HEAD` sequence was used. This changes no audit semantics.

| Repository | Local path | Pin source |
|---|---|---|
| Gajae Code | `.chatgpt2codex/upstreams/gajae-code` | `UPSTREAM-PINS.json` |
| Q00 Ouroboros | `.chatgpt2codex/upstreams/ouroboros` | `UPSTREAM-PINS.json` |
| Oh My OpenAgent / OMO Native | `.chatgpt2codex/upstreams/oh-my-openagent` | `UPSTREAM-PINS.json` |

The source trees are not nested Git submodules and are not part of the Shipping Harness commit.

## Audit boundaries

### Included

- Requirement interview and automatic decision logic
- Decision provenance and conflict handling
- Immutable specification / Seed / contract construction
- Goal, task, ledger, event, and evidence persistence
- Evidence freshness and stale-result rejection
- Planning review caps and failure states
- Execution continuation and stop conditions
- Agent/category/model routing
- Concurrency, depth, task residency, recovery, and exactly-once delivery
- Human pause/abort behavior
- License and clean-room implementation boundary

### Excluded

- Exhaustive line-by-line review of every UI, telemetry, memory, LSP, installer, or provider module
- Dependency installation and complete upstream test suites
- Authenticated provider/model runs
- Performance benchmarking
- Security audit of unrelated upstream features
- Copying upstream source into Shipping Harness

## Method

For each upstream:

1. Record repository origin, requested branch, exact HEAD, date, and license.
2. Locate feature entrypoints by symbols and persistence filenames.
3. Trace source-of-truth state, transitions, evidence, stop paths, and recovery.
4. Read adjacent tests and architecture notes where they reveal invariants.
5. Record exact source paths and bounded constants.
6. Classify each mechanism as `REIMPLEMENT`, `ADAPT`, `DEFER`, or `EXCLUDE`.
7. Correct the Shipping roadmap only where code evidence changes the prior plan.

## Verification performed

- All three repository trees are present locally at pinned revisions.
- Selected Ouroboros Python control-path files passed `python3 -m py_compile`.
- Source paths referenced in the reports were checked to exist at the pins.
- Shipping Harness documentation checks, lint, typecheck, security, and license checks are run after the reports are written.

## Verification not performed

Bun is not installed and neither TypeScript monorepo has dependencies installed, so full Gajae and OMO test suites were not executed. Provider-authenticated end-to-end runs were also excluded. This audit therefore proves source design and control flow, not live provider compatibility.

## Interpretation rule

A source path proves that a mechanism exists at the pinned revision. It does not prove provider availability, production suitability, or correct behavior in every environment. Where a claim depends on upstream live QA rather than inspected code, the report says so explicitly.
