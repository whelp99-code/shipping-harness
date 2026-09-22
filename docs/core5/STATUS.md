# Core5 status

> H02 PASS (2026-09-22): Docker 29.1.3 active. `CORE5_POSTGRES_IMAGE=postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551`. `node ci/core5/db-runner.mjs` rc=0, reverse/duplicate/SIGKILL/lost-ack passed. `releaseDecision` still false until H03/K04.
>
> BLOCKED (H03 live UI): Mail `:3010` Basic login reaches HTTP 200 (`Mail Intelligence` / draft+review copy) but has no heading `/approval|review/i` and no button `/reject|cancel/i`. `:4173` is the JARVIS dashboard. `:4176` is `PHONE_HOST_FORBIDDEN`.
>
> H06: `core5 decision` stays `NOT_SHIPPABLE` until H03/K04. K05 observation is not started.

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
