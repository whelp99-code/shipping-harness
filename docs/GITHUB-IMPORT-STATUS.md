# GitHub import status — 2026-09-12

This is a development snapshot of the existing shipping-harness repository, including uncommitted intent-gate work. It is not a release or a claim of product acceptance. Existing Git history is retained; the original development checkout was not committed or reset.

Validation: `npm run release:verify` exited 1. It reached the private OMO bridge suite, where 3 tests passed and 5 failed because the required external runtime manifest was missing. Later chained checks did not run. External private runtime dependencies are not bundled in this repository.

Known correctness defect (now fixed): verification could become stale after uncommitted source changes while release close still accepted CLOSED. See [`issues/2026-09-12-stale-working-tree-closure.md`](issues/2026-09-12-stale-working-tree-closure.md). Fixed in v1.10.0 by binding evidence to a working-tree fingerprint; this snapshot was merged into the v1.10.0 line, which carries the fix.

Pre-upload credential-pattern screening covered 1,270 historical blobs and 551 current files with no matches for the checked key/token patterns. This is a limited pattern check, not a comprehensive security audit. Repository visibility is private.
