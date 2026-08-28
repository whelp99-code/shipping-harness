# Internal Remote Incident Response

## Trigger conditions

Treat any of the following as an incident:

- repeated signature, replay, cross-project, or permission failures;
- a listener bound to an unintended address;
- certificate or signing credential exposure;
- remote state differs from locally inspected Shipping state;
- notification/replay state corruption;
- unexpected restore, terminal replay, or missing runtime ownership evidence;
- a raw command, environment, credential, deploy, push, or arbitrary path field reaches adapter execution.

## Immediate containment

1. Stop the remote gateway process. This does not alter release state.
2. Apply a local Shipping pause or abort to every affected non-terminal project.
3. Block client access at the existing VPN/firewall layer.
4. Preserve gateway logs, replay store, notification stream, config metadata, package version, TLS certificate fingerprint, and current Git SHAs.
5. Do not delete replay state or restore a backup until evidence is copied.

## Credential response

- Rotate the server signing credential and every affected actor credential.
- Update environment-variable-backed service configuration.
- Revoke or replace exposed TLS keys and certificates.
- Do not put replacement values in Git, support tickets, or release reports.

## Project integrity checks

For each affected project:

1. Read local `shipping_status` without the remote gateway.
2. Verify contract hash, Git SHA, human stop, blocker count, evidence freshness, and terminal state.
3. Inspect `.shipping/ledger.jsonl` and Goal execution ledger for unexpected transitions.
4. Compare current runtime pin and OMO manifest evidence with the promoted internal tag.
5. Run the locked acceptance contract before declaring recovery.

## Restore decision

Use a signed backup only when current state is damaged or untrusted. Validate the bundle before restore. Any restored non-terminal state must remain paused. A closed release must remain closed and must not emit or execute late work.

## Recovery

1. Install a known verified package version.
2. Run `npm run test:remote` and `npm run smoke:remote` in isolation.
3. Start on loopback or a new private port.
4. Verify health and one signed read-only status call.
5. Confirm old request nonces remain rejected after restart.
6. Resume projects locally, one at a time, only after evidence review.

## Post-incident record

Record:

- detection and containment times;
- affected actors and project IDs, never credential values;
- package/runtime versions and Git SHAs;
- failed controls and root cause;
- backup/restore actions;
- acceptance evidence and release authority decision;
- required code, policy, certificate, or operational changes.

An incident cannot be closed solely because the gateway starts. Shipping verification and zero release blockers remain required.
