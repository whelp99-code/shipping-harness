# Traceability Matrix

| Goal | Requirements | Acceptance | Implementation area | Tests |
|---|---|---|---|---|
| GOAL-001 false-done prevention | REQ-EVIDENCE-001..004, REQ-GATE-001 | AC-0105, AC-0106 | evidence, gate | unit/evidence, adversarial/false-done |
| GOAL-002 fresh proof | REQ-CONTRACT-003..004, REQ-EVIDENCE-002..004 | AC-0103, AC-0104, AC-0106 | contract, evidence | integration/contract-flow |
| GOAL-003 scope control | REQ-SCOPE-001..003 | AC-0107 | git, scope | unit/glob, adversarial/scope-drift |
| GOAL-004 bounded execution | REQ-BUDGET-001..003 | AC-0108, AC-0110 | process, gate | adversarial/budgets |
| GOAL-005 human authority | REQ-STOP-001, REQ-HOOK-002 | AC-0109, AC-0208 | state, hooks | adversarial/human-stop |
| GOAL-006 close with debt | REQ-ISSUE-001..002, REQ-CLOSE-001..003 | AC-0111, AC-0112 | issues, closure | integration/close |
| GOAL-007 harness integration | REQ-ADAPTER-001..006, REQ-HOOK-001..002 | AC-0201..0210 | adapters, hooks | adapter fixtures/regression |
| GOAL-008 beginner release intake | REQ-ANALYZE-001..003, REQ-PROPOSAL-001..003 | AC-0304..0306 | analysis, proposals | MCP proposal tests |
| GOAL-009 model-accessible governance | REQ-MCP-001..008 | AC-0301..0312 | MCP protocol, tools, STDIO | MCP protocol/transport/adversarial tests |
| GOAL-010 user as approver | REQ-MODE-001..003, REQ-APPROVAL-001..004 | AC-0401..0402, AC-0407, AC-0409..0410 | decision modes, approval brief | planned decision/MCP tests |
| GOAL-011 risk-based autonomy | REQ-DECISION-001..008, REQ-ESCALATE-001..006, REQ-POLICY-001..004 | AC-0403..0408 | decision evidence, policy validator, escalation | planned decision/adversarial tests |
| GOAL-012 selective bounded absorption | REQ-GOAL-001..008, REQ-TEAM-001..006, REQ-POLICY-003..004 | AC-0501..0512, AC-0801..0812 | Goal/Evidence runtime, bounded team graph, Finisher | planned Goal/runtime/team suites |
| GOAL-013 governed internal runtime reuse | REQ-UPSTREAM-001..002, REQ-OMO-001..009, NFR-RUNTIME-001..002 | AC-0701..0714 | internal OMO bridge, private pinned runtime, Shipping verification | planned bridge/runtime/adversarial/canary/rollback suites |
| GOAL-014 internal-only product boundary | REQ-INTERNAL-001, REQ-OMO-009, NFR-LICENSE-001 | AC-0713, AC-1010..1012 | third-party policy, runtime promotion, release operations | planned policy/packaging/release tests |
| GOAL-015 safe internal remote control | REQ-REMOTE-001..005 | AC-0901..0912 | internal gateway, signed approval, backup/restore | planned remote/security/operations suites |
| GOAL-019 project intelligence and coverage | REQ-INTEL-001..002, REQ-COVER-001..002, REQ-ISOLATE-001..002 | AC-130-001..010 | component graph, work themes, coverage matrix, isolated acceptance | project intelligence, isolated acceptance, EvoHarvest pilot, MCP/full release suites |
| GOAL-020 evidence-first beginner report | REQ-BRIEF-001..012 | AC-140-001..014 | deterministic fact graph, action envelope, Korean plain brief, quality gate, OMP presentation | plain-brief state matrix, model-independence, adversarial, performance, OMP, and EvoHarvest pilots |
| GOAL-021 deterministic release train | REQ-TRAIN-001..012 | AC-15001..15012 | release-train compiler, proposal binding, train persistence, bounded plain-brief summary | release-train unit/adversarial/pilot/EvoHarvest/MCP/OMP/full release tests |
| GOAL-022 policy-authorized autopilot | REQ-AUTOPOL-001..004, REQ-AUTO-001..012 | AC-16001..16013 | deterministic policy engine, durable autopilot state/ledger, exact mutation receipts, verify/fix/close/advance integration | policy, flow, recovery, adversarial, pilot, MCP/OMP/full release tests |
| GOAL-024 autopilot field hardening | REQ-FIELD-001..010 | AC-16101..16111 | field matrix, bounded retention, model/consequence invariance, disposable/read-only pilot, immutable evidence | field, adversarial, performance, recovery, real-project fingerprint, MCP/OMP/full release tests |
| GOAL-023 race-free OMP bootstrap deployment | REQ-BOOTSTRAP-001..006 | AC-131-001..009 | OMP bootstrap await ordering, package lifecycle, backup/rollback, field deployment | bootstrap cleanup race, OMP main-harness, doctor, MCP, EvoHarvest pilot |
| GOAL-018 safe dirty-baseline stewardship | REQ-BASE-001..006 | AC-120-001..009 | baseline classifier, proposal preservation handshake, MCP next action | baseline steward, proposal lifecycle, OMP compatibility tests |
| GOAL-017 canonical proposal authority | REQ-CANON-001..006 | AC-112-001..008 | proposal state projection, proposal storage/refinement, MCP output | canonical proposal, lifecycle, nested refine, OMP compatibility tests |
| GOAL-016 stable internal product | REQ-STABLE-001..003, REQ-OPS-001..002, REQ-BENCH-001..002, REQ-SECURITY-001, REQ-HANDOVER-001, REQ-RELEASE-001 | AC-1001..1014 | stable schemas, migrations, operations, benchmark, security inventory, handover | implemented v1.0 gates |

## Source layout mapping

```text
src/core/contract.mjs       REQ-CONTRACT-*
src/core/state.mjs          REQ-STATE-*, REQ-STOP-*
src/core/git.mjs            REQ-SCOPE-*
src/core/process.mjs        REQ-BUDGET-*, REQ-EVIDENCE-001/003
src/core/evidence.mjs       REQ-EVIDENCE-*
src/core/issues.mjs         REQ-ISSUE-*
src/core/gate.mjs           REQ-GATE-*, REQ-CLOSE-*
src/adapters/*.mjs          REQ-ADAPTER-*
src/core/hooks.mjs          REQ-HOOK-*
src/core/release-transition.mjs REQ-CLOSE-003, AC-0210
src/adapters/sdk.mjs        REQ-ADAPTER-001..003
src/adapters/artifacts.mjs  REQ-ADAPTER-003..006, REQ-SEC-001..003
src/adapters/registry.mjs   REQ-ADAPTER-001..006
src/core/project-analysis.mjs REQ-ANALYZE-*
src/core/proposal-state.mjs and src/core/proposals.mjs REQ-CANON-* (implemented v1.1.2)
src/core/baseline.mjs and proposal refinement REQ-BASE-* (implemented v1.2.0)
src/core/project-intelligence.mjs and isolated-verification.mjs REQ-INTEL-*, REQ-COVER-*, REQ-ISOLATE-* (implemented v1.3.0)
src/core/plain-brief.mjs, src/mcp/user-view.mjs, and OMP presentation config REQ-BRIEF-* (implemented v1.4.0)
src/core/release-train.mjs, proposal approval persistence, status, and plain-brief train projection REQ-TRAIN-* (implemented v1.5.0)
src/core/autopilot-policy.mjs, src/core/autopilot.mjs, and existing MCP orchestration REQ-AUTOPOL-*, REQ-AUTO-* (implemented v1.6.0)
scripts/autopilot-field-pilot.mjs and field matrix/adversarial/performance tests REQ-FIELD-* (implemented v1.6.1)
packages/omp-main-harness/install.mjs REQ-BOOTSTRAP-* (implemented v1.3.1)
src/core/proposals.mjs      REQ-PROPOSAL-*
src/mcp/tools.mjs           REQ-MCP-003, REQ-MCP-006..008
src/mcp/protocol.mjs        REQ-MCP-002..005
src/mcp/stdio.mjs           REQ-MCP-001, REQ-MCP-005
src/core/decision-*.mjs     REQ-DECISION-*, REQ-ESCALATE-*, REQ-POLICY-* (implemented v0.4)
src/mcp/tools.mjs           REQ-MODE-*, REQ-APPROVAL-* (implemented v0.4)
src/core/goals/*.mjs        REQ-GOAL-* (implemented v0.5)
packages/shipping-plugin/*  REQ-PLUGIN-* (implemented v0.6)
packages/internal-omo-bridge/* REQ-OMO-* (implemented v0.7)
private shipping-harness-omo-runtime REQ-UPSTREAM-*, REQ-OMO-* (separate internal runtime, implemented v0.7)
scripts/team-dag-entry-gate.mjs REQ-TEAM-* (entry gate implemented v0.8; Team/DAG disabled)
packages/internal-remote/*  REQ-REMOTE-* (implemented v0.9)
packages/stable-control/* and schemas/v1/* REQ-STABLE-* (implemented v1.0)
docs/operations/* and docs/HANDOVER.md REQ-OPS-*, REQ-HANDOVER-* (implemented v1.0)
scripts/v1-completion-benchmark.mjs REQ-BENCH-* (implemented v1.0)
src/cli.mjs                 user flows and orchestration
```

## v0.2 verification mapping

| Acceptance | Proof |
|---|---|
| AC-0201 | `adapter probe --all --json`; strict five-adapter capability schema |
| AC-0202 | `doctor --json`; Node, Git, contract, and adapter compatibility |
| AC-0203 | Gajae executable fixture and Goal/Ledger metadata receipt test |
| AC-0204 | Ouroboros executable fixture, Seed evidence, Ledger receipt, and explicit-only evolution policy |
| AC-0205 | OMO project-config evidence and bridge-without-native-plugin test |
| AC-0206 | Repository-relative artifact, credential-path, raw-content, and symlink escape tests |
| AC-0207 | Hook payload limit, recursive redaction, and normalized audit-stream tests |
| AC-0208 | Human stop and terminal-state override tests |
| AC-0209 | Remaining blocker, exhausted budget, verification-required, and SHIPPABLE Stop decisions |
| AC-0210 | Semver, source-drift guard, archive, lock removal, and CLOSED-to-DRAFT transition tests |

## v0.3 verification mapping

| Acceptance | Proof |
|---|---|
| AC-0301..0303 | `test/mcp/protocol.test.mjs`; discovery, legacy compatibility, and bounded high-level tool schemas |
| AC-0304..0306 | `test/mcp/proposal.test.mjs`; repository analysis, explicit approval, stale/dirty/tampered rejection |
| AC-0307..0308 | `test/mcp/tools.test.mjs`; host-agent work order, no command injection, and core delegation |
| AC-0309..0310 | `test/mcp/stdio.test.mjs` and `scripts/mcp-smoke.mjs`; framing, input bounds, and spawned client |
| AC-0311 | `npm test`; v0.1 and v0.2 regression suites plus MCP suite |
| AC-0312 | `.shipping/releases/0.3.0.json`; own release contract closure |

## v0.4 verification mapping

| Acceptance | Planned proof |
|---|---|
| AC-0401..0403 | decision-mode and safe-assumption unit/fixture tests |
| AC-0404..0406 | mandatory-risk matrix, question-budget, evidence/assumption validation tests |
| AC-0407 | proposer/approver separation and exact-hash approval adversarial tests |
| AC-0408 | hostile README/source prompt-injection fixtures |
| AC-0409..0410 | mode-selection and concise approval-brief MCP tests |
| AC-0411 | `npm run release:verify`, `npm run test:mcp`, and planned `npm run test:decision` |
| AC-0412 | v0.4.0 release receipt, clean status, and annotated tag |

## Later-version planned proof

| Release | Planned proof |
|---|---|
| v0.5 / AC-0501..0512 | Goal/Task schema and cycle tests; append-only replay/recovery; stale-proof and repeated-failure adversarial tests; single-agent real-project pilot |
| v0.6 / AC-0601..0612 | clean install/doctor/reinstall/uninstall; no-CLI beginner workflow; approval/progress/blocker/completion surface tests |
| v0.7 / AC-0701..0714 | exact upstream/internal pins and notices; work-order/receipt validation; OMO task/routing/continuation/recovery tests; Shipping re-verification; canary and previous-pin rollback |
| v0.8 / AC-0801..0812 | graph ownership and cycle checks; bounded team/depth/parallelism; node-scoped retry/amend; no-progress/oscillation tests; benchmark against v0.7 |
| v0.9 / AC-0901..0912 | authentication/allowlist/replay/cross-project tests; signed approvals; backup/restore; mobile/web internal pilot; runtime migration and rollback |
| v1.0 / AC-1001..1014 | schema/migration matrix, all regressions, completion benchmark, operations drills, security/license/modification inventory, and handover |

Any implementation that cannot map to a requirement is out of scope or must amend this matrix before coding.

## v0.7.0 Private OMO Runtime Traceability

| Requirement / acceptance | Implementation | Verification |
|---|---|---|
| REQ-INTERNAL-001, REQ-UPSTREAM-001..005 | `config/upstreams/omo-pin.json`, separate `shipping-harness-omo-runtime` | AC-0701, AC-0702, AC-0711, AC-0712, AC-0713 |
| REQ-OMO-001..007 | `packages/internal-omo-bridge/` | `npm run test:omo-bridge`, AC-0703..AC-0710 |
| Shipping-only Finisher and current evidence | `bridge.mjs`, `receipt.mjs`, core release gate | AC-0708, AC-0714 |
| Real installation and operations | sibling runtime verification evidence, `scripts/omo-pilot.mjs` | AC-0711, AC-0714 |
| Conditional Team/DAG entry gate | `docs/internal-runtime/v0.7-pilot.json` | v0.8 decision = DISABLED |

## v1.0 verification mapping

| Acceptance | Proof |
|---|---|
| AC-1001 | `schemas/v1/**`, stable schema registry, and schema/example tests |
| AC-1002 | Stable migration module, migration guide, and migration/adversarial tests |
| AC-1003 | Compatibility module and compatibility guide |
| AC-1004..1005 | Final smoke: clean install, v0.6 upgrade, plugin rollback, and installed MCP user flow |
| AC-1006..1007 | Completion benchmark and current Git/contract-bound evidence |
| AC-1008 | Current private OMO promotion plus v0.8 disabled decision evidence |
| AC-1009 | v0.9 internal TLS, replay, backup, and restore pilot |
| AC-1010..1012 | v1 security inventory, third-party inventory, handover, retention, and security documents |
| AC-1013..1014 | v1 acceptance script, Shipping verify/close receipt, and clean annotated tag |

## v1.1.2 verification mapping

| Acceptance | Proof |
|---|---|
| AC-112-001..003 | `test/mcp/canonical-proposal-state.test.mjs`, proposal lifecycle and approval-gate tests |
| AC-112-004 | legacy contradictory proposal byte/hash preservation test |
| AC-112-005 | cwd-bound approval-brief assertions |
| AC-112-006..007 | no-op and meaningful refinement revision-chain tests |
| AC-112-008 | `npm run test:mcp`, `npm run release:verify`, OMP compatibility and release receipt |

## v1.2.0 verification mapping

| Acceptance | Proof |
|---|---|
| AC-120-001..003 | classifier category and tracked/untracked tests in `test/mcp/baseline-steward.test.mjs` |
| AC-120-004 | exact baseline plan/hash/status projection test |
| AC-120-005..006 | no-Git-mutation tool schema and commit path/history drift tests |
| AC-120-007 | explicit host commit plus same-proposal rescan test |
| AC-120-008 | beginner text/action assertions |
| AC-120-009 | MCP/OMP/full release verification and release receipt |

## v1.3.0 verification mapping

| Acceptance | Proof |
|---|---|
| AC-130-001..003 | `test/mcp/project-intelligence.test.mjs` component, theme, and recommendation assertions |
| AC-130-004..005 | acceptance coverage and mechanical isolation-policy validation tests |
| AC-130-006..007 | `test/integration/isolated-acceptance.test.mjs` source fingerprint and deterministic digest tests |
| AC-130-008 | bounded `oneScreenApproval` assertions |
| AC-130-009 | `scripts/evoharvest-intelligence-pilot.mjs --check` target fingerprint receipt |
| AC-130-010 | MCP/OMP/full release verification, Shipping receipt, annotated tag, and deployment doctor |

## v1.3.1 verification mapping

| Acceptance | Proof |
|---|---|
| AC-131-001..002 | `test/omp-main-harness/bootstrap-cleanup-race.test.mjs` real package lifecycle and scratch cleanup assertions |
| AC-131-003 | bootstrap result, installed version, nine-tool doctor and receipt assertions |
| AC-131-004 | backup manifest/package digest and explicit rollback restoration assertions |
| AC-131-005 | `npm run test:omp-main`, field smoke, MCP, full release, security, license, and docs gates |
| AC-131-006..007 | Shipping SHIPPABLE/CLOSED receipt, fresh evidence, annotated tag, and clean worktree |
| AC-131-008..009 | actual OMP 18 deployment hash audit, installed doctor, receipt, MCP inventory, and EvoHarvest read-only pilot |

## v1.4.0 verification mapping

| Acceptance | Proof |
|---|---|
| AC-140-001..004 | `test/mcp/plain-brief.test.mjs` state matrix, evidence-bound items, compact dirty-baseline output, and one action |
| AC-140-005..006 | no/weak/strong host hash invariance and hostile-model assertions in plain-brief MCP/adversarial tests |
| AC-140-007 | `test/integration/plain-brief-performance.test.mjs` dependency scan, deterministic hash, and local latency budget |
| AC-140-008..009 | deterministic quality-gate tamper tests and injected-renderer fallback tests |
| AC-140-010 | full MCP inventory and unchanged nine-tool schema tests |
| AC-140-011 | OMP main-harness config/Skill regression, bootstrap doctor, protocol, and installation receipt |
| AC-140-012 | `scripts/plain-brief-pilot.mjs --check` and read-only `scripts/evoharvest-intelligence-pilot.mjs --check` |
| AC-140-013..014 | full release/security/license/docs gates, Shipping SHIPPABLE/CLOSED receipt, annotated tag, clean source, and deployed doctor |

## v1.5.0 verification mapping

| Acceptance | Proof |
|---|---|
| AC-15001..15004 | `test/mcp/release-train.test.mjs` deterministic, rolling-depth, current-binding, model-independence tests |
| AC-15005 | `test/adversarial/release-train-attacks.test.mjs` fail-closed authority attacks |
| AC-15006..15008 | MCP start/status/refine/approval persistence and Korean plain-brief train assertions |
| AC-15009 | nine-tool inventory, no raw command/mutation tests, bounded compiler implementation |
| AC-15010 | `scripts/release-train-pilot.mjs`, read-only EvoHarvest pilot, OMP and full release gates |
| AC-15011..15012 | Shipping verify/close receipt, annotated tag, and clean source audit |

## v1.6.0 verification mapping

| Acceptance | Proof |
|---|---|
| AC-16001..16003 | `test/autopilot/policy-engine.test.mjs` deterministic policy and model-independence assertions |
| AC-16004..16007 | `test/autopilot/autopilot-flow.test.mjs` activation, work order, bounded repair, auto-close, and continuation assertions |
| AC-16008 | `test/adversarial/autopilot-attacks.test.mjs` external, destructive, data, auth, security, license, cost, and RELEASED authority attacks |
| AC-16009..16010 | `test/autopilot/autopilot-recovery.test.mjs` pause/abort, idempotence, crash recovery, stale binding, and history-preserving replan tests |
| AC-16011 | stable autopilot schemas/examples, exact nine MCP tools, OMP 18, plain brief, remote, OMO, security, license, and full regression gates |
| AC-16012 | Shipping verify result with fresh current-Git evidence, zero blockers, and zero unknowns |
| AC-16013 | CLOSED receipt, annotated `v1.6.0` tag, and clean source audit |

## v1.6.1 verification mapping

| Acceptance | Proof |
|---|---|
| AC-16101 | `test/autopilot/field-matrix.test.mjs` and `test/adversarial/autopilot-field-attacks.test.mjs` mandatory and hostile lanes |
| AC-16102 | `test/autopilot/autopilot-recovery.test.mjs`, bounded mutation receipts, ledger replay, pause, and idempotence assertions |
| AC-16103 | `scripts/autopilot-field-pilot.mjs --check` clean/dirty/model/consequence/performance/real-project lanes |
| AC-16104 | `npm run test:autopilot` and `node scripts/autopilot-pilot.mjs --check` regression |
| AC-16105 | `test/autopilot/autopilot-performance.test.mjs` p95 and retention limits |
| AC-16106 | `npm run test:mcp`, `npm run test:omp-main`, and `npm run release:verify` |
| AC-16107..16109 | `git diff --check`, Shipping status, and `docs/reports/v1.6.1-autopilot-field.json` |
| AC-16110..16111 | Shipping CLOSED receipt/tag/clean audit and tagged OMP hash/doctor/tool/rollback deployment audit |

## v1.7.0 Goal Discovery and Decision Ledger

| Requirement | Implementation | Verification |
|---|---|---|
| REQ-DISCOVERY-001..007 | `src/core/goal-discovery.mjs`, proposal/MCP integration, Korean plain brief | `test/mcp/goal-discovery.test.mjs`, `test/adversarial/goal-discovery-attacks.test.mjs` |
| REQ-DIRECTION-001..005 | deterministic candidates, critic, accepted direction, Release Train input | goal-discovery MCP/adversarial tests and `scripts/goal-discovery-pilot.mjs --check` |
| REQ-LEDGER-001..004 | `src/core/decision-ledger.mjs`, runtime paths, proposal lifecycle events | `test/integration/decision-ledger.test.mjs`, retention/performance tests |
| REQ-BOUNDARY-001..002 | nine-tool reuse, no technical questions, no model/command/approval/close/release authority | MCP inventory, OMP tests, hostile-model tests, read-only real-project pilot |
| AC-17001..17016 | locked v1.7.0 contract acceptance and closure evidence | full `npm run release:verify`, Shipping receipt, annotated tag, clean source, installed doctor/rollback audit |

## v1.8.1 Goal Direction Field Hardening

| Requirement | Evidence |
|---|---|
| REQ-FIELD-181-001..004 | integrated/model-variant/interview lanes in `test/integration/goal-direction-field.test.mjs` and field pilot |
| REQ-FIELD-181-005..010 | adversarial ledger, charter, policy, pause, and RELEASED attacks |
| REQ-FIELD-181-011..014 | read-only real-project pilot, MCP nine-tool check, safety report, and performance test |
