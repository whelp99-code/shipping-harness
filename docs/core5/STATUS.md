# Core5 status

> BLOCKED (H02): `docker` is not on PATH, and `CORE5_POSTGRES_IMAGE` is unset (must be `postgres@sha256:<64 hex>`). `node ci/core5/db-runner.mjs` rc=1, report status BLOCKED, `releaseDecision: false`.
>
> BLOCKED (H03 live UI): Chromium installed. Against `http://127.0.0.1:4173` (HTTP 200 dashboard) both Playwright journeys fail: no heading `/approval|review/i` and no button `/reject|cancel/i`. Specs need a Core5 review surface, not this loopback page. Mail `:3010` is 401. `:4176` is `PHONE_HOST_FORBIDDEN`.
>
> H06: `node bin/shipping-harness.mjs core5 decision --json` exits 2, `state=NOT_SHIPPABLE`, `releaseDecision=false`. Owner gates are listed in `docs/core5/OWNER_APPROVAL.md`. K05 observation is not started.

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
