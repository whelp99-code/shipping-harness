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
