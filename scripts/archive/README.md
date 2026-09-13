# Archived scripts

These scripts were used for one specific version's work and are referenced by
no `package.json` script, no test, no doc audit, and no other live script
(verified by grep across `package.json`, `scripts/`, `src/`, `packages/`,
`bin/`, and `test/` before moving). They are kept for historical reference
only. They are excluded from `package.json` `files` and from lint/typecheck
targets (`scripts/lint.mjs`, `eslint.config.mjs`, `tsconfig.json` all target
`scripts/` directly, not `scripts/archive/`).

| File | Used in | Purpose |
|---|---|---|
| `amend-v09-packaging-scope.mjs` | v0.9.0 | One-time `AMEND-0.9.0-001` contract amendment adding `scripts/build.mjs` to the locked scope paths. Its effect is recorded permanently in `.shipping/amendments/AMEND-0.9.0-001.json`. |
| `omo-amend-v07-contract.mjs` | v0.7.0 | One-time contract amendment for the private OMO bridge introduction. |
| `v1-amend-plugin-test-scope.mjs` | v1.x (plugin work) | One-time contract amendment widening scope to include `shipping-plugin` tests. |
| `omo-v0.7-gate.mjs` | v0.7.0 | Ad hoc acceptance-criterion gate runner for the v0.7.0 private OMO bridge release (AC-0703..AC-0710), superseded by `test:omo-bridge` and `smoke:*` npm scripts. |
| `evoharvest-intelligence-pilot.mjs` | v1.3.0 / v1.4.0 | Pilot fixture proving a fingerprinted mixed Python/Node/Playwright/Alembic/Shell project graph for `AC-130-009` and `AC-140-012`. Referenced only in historical planning/traceability docs (`docs/TRACEABILITY.md`, `docs/planning/26-...`, `docs/operations/OMP-MAIN-HARNESS.md`), which describe past release evidence and are not updated to point elsewhere. |
| `plain-brief-pilot.mjs` | v1.4.0 | Pilot fixture proving plain-brief budget classification counts for `AC-140-012`. Referenced only in `docs/TRACEABILITY.md`'s historical evidence table. |

Scripts that remain manual operational tools (`scripts/omo-pilot.mjs`,
`scripts/mcp-smoke.mjs`, `scripts/remote-acceptance.mjs`,
`scripts/team-dag-entry-gate.mjs`) were **not** archived even though some are
not wired into `package.json`: they are documented, ongoing procedures
(`docs/internal-runtime/README.md`, `docs/MCP.md`,
`docs/internal-remote/README.md`) or are imported by a live test
(`test/team-dag/entry-gate.test.mjs`), not one-off version work.
