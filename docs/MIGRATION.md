# Shipping Harness v1 Migration and Rollback

## Supported upgrades

The stable v1 migration framework supports repository state produced by v0.6.0 through v0.9.0. Earlier releases are not silently guessed: export the existing `.shipping` directory, preserve the Git revision, and initialize a new release under operator review.

## Invariants

A migration must never:

- reopen a `CLOSED` release;
- remove `humanStop` from a paused or aborted workflow;
- change the contract hash, Git evidence binding, or runtime source binding;
- make stale evidence current;
- widen scope, budgets, permissions, or remote access;
- convert an OMO runtime completion receipt into Shipping release authority;
- turn `NEXT` work into `DONE` or `BLOCKER` without explicit policy.

## Process

1. Pause active work. Migration over `RUNNING`, `VERIFYING`, or `FIXING` state is prohibited.
2. Create an integrity-signed backup using the internal backup tool.
3. Record the source release, Git SHA, contract hash, state, and current runtime pins.
4. Run the stable migration functions against a copied fixture first.
5. Validate every migrated document against the schemas in `schemas/v1/`.
6. Compare the authority fields before and after migration.
7. Run plugin doctor, MCP discovery, private OMO doctor when configured, and remote health when enabled.
8. Resume only after validation succeeds. A non-terminal restored release remains `PAUSED` until the operator resumes it.

## v1.9 → v1.10 state integrity promotion

v1.10 signs `.shipping/state.json` with an `integrity` object (`algorithm`, `ledgerHead`, `digest`) and turns `.shipping/ledger.jsonl` into a hash chain (`prev`, `digest` on every event). A project last written by v1.9 or earlier has neither.

Procedure:

1. Commit or stash source changes and pause active work, as for any migration.
2. Back up `.shipping/` (the ledger especially: migration appends to it and never rewrites it).
3. Run `migrateStateIntegrity(root)` from `packages/stable-control/migration.mjs` against a copied fixture first, then against the project.
4. Re-read the status: `shipping-harness status --json` now reports `integrity.level`.

The migration signs the existing state only when the ledger already proves the state the file claims. It appends exactly one `state.migrated` event and writes the signature over the unchanged state document; it never edits history, never changes the recorded state, and never reopens a `CLOSED` release.

`UNVERIFIED_LEGACY` means the state predates signing and no signed state write exists yet, so the engine cannot prove the file was written by itself. It is reported everywhere but blocks nothing: `verify`, `close`, `release prepare`, and hook decisions all proceed. A legacy state is left at `UNVERIFIED_LEGACY` when the ledger cannot prove the recorded state (for example a ledger that was truncated or never carried a matching transition); that is not an error, but it also cannot be promoted, and the first normal state write after the upgrade signs it anyway.

`TAMPERED` is different in kind: the state contradicts the ledger, the receipt, or the evidence on disk. That is an incident, not a migration case. Restore `.shipping/state.json` from trusted project history or a verified backup before running any further command.

## Schema policy

The v1 schema registry rejects unknown schema IDs and unknown root fields. Legacy identifiers explicitly listed in `packages/stable-control/migration.mjs` may be mapped to their stable replacement. Unknown future major versions fail closed.

Each migration produces a `shipping-harness/migration-v1` receipt containing source and target release, source and target state, changed artifacts, and creation time.

## Rollback

Rollback restores the signed backup and the previously installed package/runtime pin. It does not reverse Git history or reopen a closed release. After rollback:

- verify the restored backup signature and file digests;
- confirm `CLOSED` remains `CLOSED`;
- confirm non-terminal state remains paused;
- run `shipping-harness-plugin doctor`;
- run the MCP discovery smoke;
- verify the private OMO pin and previous runtime tag when OMO is enabled;
- record the rollback in the internal event log.

A failed migration or rollback ends as an explicit operational blocker; it never fabricates a healthy state.
