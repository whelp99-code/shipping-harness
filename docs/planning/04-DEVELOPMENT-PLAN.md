# Development Plan through v0.2.0

## Delivery rule

Each slice follows `inspect → implement → closest check → adversarial check → release-blocker fix`. New ideas discovered during a release go to `BACKLOG.md` unless they violate an existing requirement.

## v0.1.0 — Finish One Version

### PR-001: Foundation and planning

- Package/CLI skeleton, license, project charter, stable requirements, architecture, and release gates.
- **Exit:** manifest parses; documentation traceability is complete.

### PR-002: Contract, state, and ledger

- Contract initialization/validation/canonical hash.
- Lock receipt with Git baseline.
- Atomic state writes, allowed transitions, append-only ledger.
- **Maps:** REQ-CONTRACT-001..004, REQ-STATE-001..003.
- **Exit:** mutation and restart tests pass.

### PR-003: Evidence and scope guard

- Command runner with timeout/output/redaction.
- Evidence manifests tied to contract/Git.
- Git delta and glob scope policy.
- **Maps:** REQ-EVIDENCE-001..004, REQ-SCOPE-001..003.
- **Exit:** stale proof, denied path, timeout, and secret-redaction tests pass.

### PR-004: Gate, issues, budgets, and closure

- Issue schema and blocker basis validation.
- SHIPPABLE/BLOCKED decision.
- Pause/resume/abort precedence.
- Close report, backlog migration, closure receipt.
- **Maps:** REQ-ISSUE-001..002, REQ-GATE-001, REQ-CLOSE-001..003, REQ-STOP-001, REQ-BUDGET-001..003.
- **Exit:** all AC-01xx tests pass.

### v0.1.0 release gate

```text
npm run release:verify
git status --short == empty after release artifacts committed
tag v0.1.0
```

## v0.2.0 — Harness Adapter Layer

### PR-005: Adapter SDK and doctor

- Registry, executable discovery, safe probe runner, capability model.
- Generic and Codex adapters.
- **Maps:** REQ-ADAPTER-001..003.

### PR-006: Gajae and Ouroboros adapters

- Configurable execution commands.
- Gajae controller/goal/ledger artifact candidates.
- Ouroboros Seed/Ledger/artifact candidates.
- Explicit live/configured/fixture status.
- **Maps:** REQ-ADAPTER-004..005.

### PR-007: OMO and lifecycle bridge

- `omo`/OpenCode detection and `.omo/omo.json[c]` config discovery.
- Hook event ingestion and deterministic continuation decision.
- **Maps:** REQ-ADAPTER-006, REQ-HOOK-001..002.

### PR-008: Integration and regression validation

- Fake executable fixtures for absent harnesses.
- Live non-mutating Codex probe.
- Adapter evidence, compatibility report, and regression suite.
- **Maps:** AC-0201..0210.

### v0.2.0 release gate

```text
npm run release:verify
node ./bin/shipping-harness.mjs adapter probe --all --json
node ./bin/shipping-harness.mjs doctor --json
git status --short == empty after release artifacts committed
tag v0.2.0
```

## Commit strategy

1. Commit validated v0.1.0 implementation and docs.
2. Create annotated `v0.1.0` tag.
3. Implement adapters without rewriting the v0.1 core contract.
4. Commit validated v0.2.0 implementation and docs.
5. Create annotated `v0.2.0` tag.
6. Push branch and tags only when a configured remote and permissions exist.

## Rollback

- Core state writes are atomic and append a ledger receipt.
- A failed adapter run cannot alter contract lock.
- Failed evidence runs remain inspectable but do not become current proof.
- Version rollback is Git checkout of a tagged release; no database migration exists.