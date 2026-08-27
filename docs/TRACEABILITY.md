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

Any implementation that cannot map to a requirement is out of scope or must amend this matrix before coding.