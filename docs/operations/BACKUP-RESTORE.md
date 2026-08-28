# Shipping State Backup and Restore

## Backup contents

A v0.9 signed backup may contain only bounded Shipping state:

- contract and lock;
- state, issues, backlog, integrations, and hook audit stream;
- Goal/Task snapshots and execution ledger;
- proposals, acceptance evidence, and release receipts;
- selected runtime pin or OMO manifest files as `restore: false` evidence.

The backup walker ignores symlinks, `.shipping/tmp`, oversized files, and credential-like paths such as `.env`, `auth.json`, credentials, and private keys.

## Create

Use the authenticated `backup/create` action. The bundle is HMAC-signed with the server signing credential and stored below the configured per-project backup root.

Record:

- project ID;
- backup ID;
- path;
- file count and total bytes;
- signature;
- creation time and package version.

## Validate

Validation checks:

1. schema and project binding;
2. bundle HMAC signature;
3. every file size and SHA-256 digest;
4. total byte count and hard size ceiling;
5. safe logical paths and explicit restore flags.

Do not edit a bundle manually. Any changed byte must fail validation.

## Restore preconditions

- Stop or pause active work.
- `RUNNING`, `VERIFYING`, `TRIAGE`, and `FIXING` states reject restore.
- Confirm the bundle belongs to the exact project.
- Confirm the bundle path remains inside that project's configured backup directory.
- Retain the current `.shipping` directory as the automatic previous-state copy.

## Restore behavior

Restore is staged in a new directory and swapped atomically. If the swap fails, the previous `.shipping` directory is put back.

Terminal behavior:

- `CLOSED` remains `CLOSED`.
- `ABORTED` remains `ABORTED`.
- Terminal work is never replayed.

Non-terminal behavior:

- Any restored non-terminal state other than an existing `PAUSED` is rewritten to `PAUSED`.
- `resumeState` records the original restored state.
- `humanStop` is set to `true`.
- Local inspection and an explicit local resume are required before execution.

OMO manifests and runtime pins included as evidence are not written into the target project.

## Drill

The automated drill is part of:

```bash
npm run test:remote
npm run smoke:remote
```

The real smoke flow creates a closed release, backs it up, corrupts local state, restores it, restarts the gateway, confirms replay protection remains durable, and confirms the release is still `CLOSED`.

A separate unit test restores a `LOCKED` backup and proves it becomes `PAUSED` with human stop.

## Failure handling

- Signature or digest failure: quarantine the bundle; do not retry with validation disabled.
- Active-state rejection: pause locally, inspect active ownership, then retry.
- Swap failure: verify the automatic previous-state directory and service account permissions.
- Missing runtime ownership evidence: keep the restored release paused and treat it as a blocker.
- Credential exposure suspicion: rotate actor and server credentials, invalidate client configuration, and follow the incident runbook.
