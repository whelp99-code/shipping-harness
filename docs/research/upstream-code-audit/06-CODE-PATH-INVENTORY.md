# Audited Code Path Inventory

This inventory lists the exact upstream paths reviewed for Shipping Harness decisions. Paths are relative to each pinned repository root.

## Gajae Code

### Interview and planning

- `packages/coding-agent/src/defaults/gjc/skills/deep-interview/SKILL.md`
- `packages/coding-agent/src/defaults/gjc/skills/deep-interview/auto-answer-uncertain.md`
- `packages/coding-agent/src/defaults/gjc/skills/ralplan/SKILL.md`
- `packages/coding-agent/src/gjc-runtime/deep-interview-ambiguity.ts`
- `packages/coding-agent/src/gjc-runtime/deep-interview-runtime.ts`
- `packages/coding-agent/src/gjc-runtime/deep-interview-state.ts`
- `packages/coding-agent/src/gjc-runtime/ralplan-runtime.ts`

### Goal, evidence and termination

- `packages/coding-agent/src/defaults/gjc/skills/ultragoal/SKILL.md`
- `packages/coding-agent/src/gjc-runtime/ultragoal-runtime.ts`
- `packages/coding-agent/src/gjc-runtime/ultragoal-guard.ts`
- `packages/coding-agent/src/gjc-runtime/ultragoal-evidence.ts`
- `packages/coding-agent/src/gjc-runtime/ultragoal-receipt-freshness.ts`

### License

- `LICENSE`

## Q00 Ouroboros

### Interview, decision and specification

- `src/ouroboros/bigbang/interview.py`
- `src/ouroboros/auto/interview_driver.py`
- `src/ouroboros/auto/ledger.py`
- `src/ouroboros/core/seed.py`
- `src/ouroboros/core/seed_contract.py`

### Persistence, evaluation and stopping

- `src/ouroboros/persistence/event_store.py`
- `src/ouroboros/evolution/loop.py`
- `src/ouroboros/evolution/convergence.py`
- `src/ouroboros/runtime/controls.py`
- `src/ouroboros/runtime/watchdog.py`
- `src/ouroboros/ralph_loop.py`

### License

- `LICENSE`

## Oh My OpenAgent / OMO Native

### Native distribution boundary

- `packages/omo-native/AGENTS.md`
- `packages/omo-native/src/cli.ts`
- `packages/omo-native/src/senpi.ts`
- `packages/omo-native/src/doctor.ts`

### Component composition and continuation

- `packages/omo-senpi/AGENTS.md`
- `packages/omo-senpi/src/components/ulw-execute-continuation/index.ts`
- `packages/omo-senpi/src/components/ulw-execute-continuation/boulder-eligibility.ts`
- `packages/omo-senpi/src/components/ulw-loop/index.ts`

### Task, roles and recovery

- `packages/senpi-task/AGENTS.md`
- `packages/senpi-task/src/agents/invocation-guard.ts`
- `packages/senpi-task/src/agents/resolve-agent.ts`
- `packages/senpi-task/src/category/resolver.ts`
- `packages/senpi-task/src/manager/manager.ts`
- `packages/senpi-task/src/manager/concurrency.ts`
- `packages/senpi-task/src/state/transitions.ts`
- `packages/senpi-task/src/store/`
- `packages/senpi-task/src/lifecycle/`
- `packages/senpi-task/src/completion/`
- `packages/senpi-task/src/dag/`
- `packages/omo-senpi/src/components/task/engine.ts`
- `packages/omo-senpi/src/components/task/dag-runtime.ts`
- `packages/omo-senpi/src/components/task/team-service.ts`

### Model and configuration policy

- `packages/model-core/src/model-resolution-pipeline.ts`
- `packages/model-core/src/model-resolver.ts`
- `packages/omo-config-core/src/schema/task.ts`

### License

- `LICENSE.md`
- `packages/omo-senpi/plugin/LICENSE`

## Source-path validation

A repository-local validation script checks that every non-directory path above exists at the pinned revisions. Directory entries are intentional scope references. Full upstream source remains ignored and uncommitted.
