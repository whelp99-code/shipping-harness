# Shipping Harness v0.9 Internal Remote Control

Shipping Harness v0.9 adds a **company-internal, TLS-only control surface** for explicitly allowlisted local repositories. It does not expose a public service, arbitrary shell, raw command, deployment, push, provider credential, or customer tenant API.

## Authority model

```text
Trusted web/mobile client
  -> HTTPS JSON request
  -> timestamp + HMAC signature
  -> actor / project / action authorization
  -> durable nonce replay claim
  -> fixed Shipping tool mapping
  -> Shipping Core authority and evidence gate
```

Shipping Core remains authoritative. The gateway cannot approve its own proposal, alter contract bytes, expand budgets, bypass blocker policy, reopen `CLOSED`, or override a local human stop.

## Exposed actions

| Action | Permission | Behavior |
|---|---|---|
| `projects/list` | read | List only projects assigned to the actor. |
| `shipping/status` | read | Read current state, blockers, evidence freshness, and Git SHA. |
| `shipping/start` | write | Create a bounded proposal from a user outcome. |
| `approval/issue` | approve | Issue a short-lived, signed, one-time approval receipt. |
| `shipping/approve` | approve | Consume the exact receipt and call the deterministic proposal approval. |
| `shipping/execute` | write | Invoke only the existing high-level Shipping execution tool; no command fields exist. |
| `shipping/pause`, `shipping/resume`, `shipping/abort` | control | Apply human control. Remote resume/execute is denied while local human stop is active. |
| `shipping/fix-blockers`, `shipping/verify` | write | Run bounded deterministic control-plane operations. |
| `shipping/close` | close | Close only a fresh, zero-blocker `SHIPPABLE` release. |
| `evidence/summary` | read | Read a bounded evidence summary. |
| `notifications/list` | read | Read bounded, append-only project notifications. |
| `backup/create`, `backup/restore` | admin | Create or restore integrity-signed Shipping state bundles. |
| `health/read` | read | Return bounded internal health facts. |

## Request envelope

```json
{
  "schema": "shipping-remote/request-v1",
  "requestId": "request-unique-id",
  "actorId": "owner",
  "projectId": "project-a",
  "action": "shipping/status",
  "params": {},
  "timestamp": "2026-08-28T12:00:00.000Z",
  "nonce": "single-use-random-value",
  "signature": "hmac-sha256"
}
```

Unknown fields and nested command-like keys (`command`, `argv`, `environment`, `cwd`, `credential`, `deploy`, `push`, and equivalents) fail closed before adapter execution.

## Approval receipt

An approval receipt is signed by the server and bound to:

- issue request ID and nonce;
- actor and project;
- release;
- proposal ID and proposal hash;
- current Git SHA;
- issue and expiry timestamps;
- unique receipt ID and one-time consumption.

Changing any bound value, reusing the receipt, or allowing it to expire rejects approval.

## Configuration

Copy `config/internal-remote.example.json` to a private operational location. Replace only absolute allowlisted paths and environment-variable names. Never place credential values in the JSON file.

Required environment variables in the example:

```bash
export SHIPPING_REMOTE_SERVER_CREDENTIAL='at-least-40-random-characters'
export SHIPPING_REMOTE_OWNER_CREDENTIAL='at-least-32-random-characters'
```

Start the service:

```bash
shipping-harness-remote \
  --config /etc/shipping-harness/internal-remote.json \
  --cert /etc/shipping-harness/tls/server.crt \
  --key /etc/shipping-harness/tls/server.key \
  --host 127.0.0.1 \
  --port 9443
```

The supported listen boundary is loopback, RFC1918 private IPv4, or IPv6 loopback. Public wildcard and public internet addresses are rejected.

## Backup and recovery

Backups include Shipping contract, lock, state, ledgers, issues, backlog, Goal/Task snapshots, proposals, evidence, release receipts, and selected runtime-pin evidence. Credential-like paths are excluded. OMO runtime manifests are evidence-only and are never restored into a project.

A restored non-terminal release is forced into `PAUSED` with `humanStop=true`. A terminal `CLOSED` or `ABORTED` state remains terminal.

## Verification

```bash
npm run test:remote
npm run smoke:remote
node scripts/remote-acceptance.mjs AC-0901
```

The recorded disposable-repository pilot is in `docs/reports/v0.9-remote-pilot.json` and `.md`.
