# Core5 status

## H01 — committed

Code checkpoint `3508271` (`feat: lock Core5 release bundle v1`). The earlier `.git` EROFS was Codex sandbox, not the disk. No push, merge, or deploy.

Implemented `shipping-harness/core5-release-bundle.v1` with:

- repository revision and contract hash binding;
- additive migration IDs and tool/model/image version maps;
- content-addressed criterion version and criteria hash;
- non-empty, repository-contained evidence manifest;
- immutable bundle hash and fail-closed validation;
- `shipping-harness core5 bundle lock|check` CLI surface;
- schema/example pair and adversarial unit coverage.

The bundle is written to `.shipping/core5-release-bundle.json`. Runtime dependencies remain zero, and no promptfoo, Playwright, database, or model package is imported by runtime code.

## Verification

- Host remasure 2026-09-22: `npm test` rc=0, 475 passed / 0 failed (duration_ms 11134).
- `node scripts/lint.mjs` — passed.
- `node scripts/typecheck.mjs` — passed.
- `node scripts/v1-doc-audit.mjs` — passed.
- `node scripts/test-suite-coverage.mjs` — passed.
- `node scripts/security-check.mjs` — passed.
- `npm run typecheck:tsc` could not run because this checkout lacks the installed `@types/node` package.
