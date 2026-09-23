# Core5 status

> H02 PASS (2026-09-22): Docker 29.1.3 active. `CORE5_POSTGRES_IMAGE=postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551`. `node ci/core5/db-runner.mjs` rc=0, reverse/duplicate/SIGKILL/lost-ack passed. `releaseDecision` still false until H03/K04.
>
> H03 PASS (2026-09-22): authenticated Core5 review UI on `http://127.0.0.1:4174/` (Basic `core5`, not `:4173`). systemd user unit `core5-review-ui.service` is active. Unauthenticated GET is 401 (`WWW-Authenticate: Basic realm="Core5 review"`). Fixture, not Mail. `npm run h03` in `ci/core5` — 2 passed / 0 failed.
>
> H06 (2026-09-23): `core5 decision` probe reads `CORE5_POSTGRES_IMAGE` from `/etc/environment` when unset in the process, and treats unauthenticated 401 on `http://127.0.0.1:4174/` as H03. Still `NOT_SHIPPABLE` — K04 real accounts/send remain missing. Not retargeted at `:4173`. K05 observation is not started.

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
