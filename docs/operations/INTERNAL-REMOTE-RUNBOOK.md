# Internal Remote Operations Runbook

## Purpose

Operate the Shipping Harness v0.9 remote gateway on a trusted owner/company network without weakening local Shipping authority.

## Preconditions

- Node.js 22 or newer and Git are installed.
- Each configured project is a real Git repository under an explicit `allowedRoots` path.
- TLS certificate and key files are readable only by the service account.
- Server and actor HMAC credentials are random, unique, stored in environment variables, and not present in repository files.
- The service binds only to loopback or a private address.
- Firewall and VPN policy already restrict client reachability. The gateway does not change DNS or firewall rules.

## Start

```bash
export SHIPPING_REMOTE_SERVER_CREDENTIAL='...'
export SHIPPING_REMOTE_OWNER_CREDENTIAL='...'

shipping-harness-remote \
  --config /etc/shipping-harness/internal-remote.json \
  --cert /etc/shipping-harness/tls/server.crt \
  --key /etc/shipping-harness/tls/server.key \
  --host 127.0.0.1 \
  --port 9443
```

Expected startup output contains the fixed host and selected port, but no credential values.

## Health check

```bash
curl --cacert /etc/shipping-harness/tls/ca.crt \
  https://127.0.0.1:9443/health
```

Expected facts:

```json
{"status":"healthy","tls":true,"internalOnly":true}
```

A health response does not prove actor authorization or project access. Verify one signed `shipping/status` request separately.

## Routine checks

1. Confirm the listener address is still loopback/private.
2. Confirm certificate validity and file permissions.
3. Confirm configured project real paths remain under the intended allowlist roots.
4. Review failed signature, replay, permission, rate-limit, and restore events.
5. Confirm notification and replay files remain writable by the service account only.
6. Run `npm run test:remote` and `npm run smoke:remote` after code, Node, TLS, or runtime-pin changes.
7. Create and validate a signed backup before upgrading.

## Pause and stop authority

A local pause or abort always wins. When `humanStop=true`, remote `shipping/resume` and `shipping/execute` are denied. Recovery requires a deliberate local resume after the owner inspects state and evidence.

To stop the gateway, terminate the service process. This does not change any project release state.

## Upgrade

1. Stop accepting new remote requests.
2. Create signed backups for all configured projects.
3. Record current package version and runtime pin files.
4. Install the candidate package in an isolated prefix.
5. Run remote tests and the disposable HTTPS pilot.
6. Start the candidate on a separate private port and verify signed status.
7. Switch the service only after the checks pass.
8. Retain the prior package and configuration until rollback testing passes.

## Rollback

1. Stop the candidate gateway.
2. Restore the prior package and unchanged private configuration.
3. Keep replay and notification state unless corruption is proven; deleting replay state weakens duplicate protection.
4. Validate project state before any remote mutation.
5. If a project backup is restored and was non-terminal, leave it `PAUSED` until local ownership and runtime health are proven.

## Evidence

- Unit, integration, HTTPS, backup, and adversarial tests: `npm run test:remote`
- Real disposable-repository HTTPS flow: `npm run smoke:remote`
- Recorded pilot: `docs/reports/v0.9-remote-pilot.json`
- Backup drill: `docs/operations/BACKUP-RESTORE.md`
- Incident response: `docs/operations/INTERNAL-REMOTE-INCIDENT.md`
