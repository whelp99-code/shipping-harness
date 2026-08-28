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
| GOAL-012 selective bounded absorption | REQ-GOAL-001..008, REQ-TEAM-001..006, REQ-POLICY-003..004 | v0.5/v0.8 roadmap gates plus AC-0411..0412 regression authority | Goal/Evidence runtime, bounded team graph, Finisher | planned Goal/runtime/team suites |
| GOAL-013 governed internal runtime reuse | REQ-UPSTREAM-001..002, REQ-OMO-001..008 | v0.7 internal-runtime acceptance plan | internal OMO bridge, private pinned runtime, Shipping verification | planned bridge/runtime/adversarial/canary suites |
| GOAL-014 internal-only product boundary | REQ-INTERNAL-001, REQ-OMO-009, NFR-LICENSE-001 | distribution guard and v1.0 license/modification inventory | third-party policy, runtime promotion, release operations | planned policy/packaging/release tests |

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
src/core/proposals.mjs      REQ-PROPOSAL-*
src/mcp/tools.mjs           REQ-MCP-003, REQ-MCP-006..008
src/mcp/protocol.mjs        REQ-MCP-002..005
src/mcp/stdio.mjs           REQ-MCP-001, REQ-MCP-005
src/core/decision-*.mjs     REQ-DECISION-*, REQ-ESCALATE-*, REQ-POLICY-* (planned v0.4)
src/mcp/tools.mjs           REQ-MODE-*, REQ-APPROVAL-* (planned extension v0.4)
src/core/goals/*.mjs        REQ-GOAL-* (planned v0.5)
plugin/* / skill/*          REQ-PLUGIN-* (planned v0.6)
packages/internal-omo-bridge/* REQ-OMO-* (planned v0.7)
private shipping-harness-omo-runtime REQ-UPSTREAM-*, REQ-OMO-* (separate internal runtime, planned v0.7)
src/core/team-policy/*.mjs  REQ-TEAM-* (planned v0.8)
src/remote/*                REQ-REMOTE-* (planned v0.9)
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

## v0.4 planned verification mapping

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
| v0.5 | Goal/Task schema and cycle tests; append-only replay/recovery; stale-proof and repeated-failure adversarial tests; single-agent real-project pilot |
| v0.6 | clean install/doctor/reinstall/uninstall; no-CLI beginner workflow; approval/progress/blocker/completion surface tests |
| v0.7 | exact upstream/internal pins and notices; work-order/receipt validation; OMO task/routing/continuation/recovery tests; Shipping re-verification; canary and previous-pin rollback |
| v0.8 | graph ownership and cycle checks; bounded team/depth/parallelism; node-scoped retry/amend; no-progress/oscillation tests; benchmark against v0.7 |
| v0.9 | authentication/allowlist/replay/cross-project tests; signed approvals; backup/restore; mobile/web internal pilot; runtime migration and rollback |
| v1.0 | compatibility matrix, completion benchmark, security/license/modification inventory, operations and non-developer end-to-end acceptance |

Any implementation that cannot map to a requirement is out of scope or must amend this matrix before coding.