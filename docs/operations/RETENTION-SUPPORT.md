# Retention, Support, and Review Policy

## Retention

| Artifact | Minimum retention | Notes |
|---|---:|---|
| Locked contracts and locks | Life of repository | Authority source for each release |
| Release receipts and annotated tags | Life of repository | Never rewritten or reopened |
| Decision and approval receipts | Life of supported release history | Required for scope audit |
| Goal/Task ledger and checkpoints | Life of active release; archive after closure | Keep append-only evidence chain |
| Acceptance evidence and redacted logs | 365 days or life of supported release, whichever is longer | Delete only through an audited retention action |
| Stable event log | 180 days online, older entries archived | Per-event size and read limits remain bounded |
| Internal remote notifications | Most recent configured bounded set | Not an authority source |
| Signed backups | Latest three successful generations plus one pre-upgrade generation | Store outside the repository with restricted access |
| Private OMO build/pin evidence | While the pin is supported plus one rollback generation | Keep license notices and modification log |

Credentials, API keys, authorization headers, private keys, `.env`, and provider tokens are never valid backup or evidence content.

## Support ownership

| Area | Primary owner |
|---|---|
| Product direction and release approval | Repository owner |
| Shipping Core and schema migrations | Internal engineering owner |
| Plugin/MCP installation and host registration | Internal tooling owner |
| Private OMO pin, patches, notices, canary, rollback | Internal runtime owner |
| TLS, remote actors, backups, restore, incident response | Internal operations owner |
| Security/license direction changes | Designated reviewer |

## Review cadence

- Before each Shipping release: acceptance, security, license, and documentation gates.
- Monthly while actively used: dependency/runtime pins, backup restore sample, remote actor list, and notification/event retention.
- Quarterly: full recovery drill, compatibility matrix, operator access, and internal-only boundary review.
- Immediately after an incident, failed upgrade, OMO upstream change, or public/customer request: direction and threat review.

## Escalation

Normal application bugs become release `BLOCKER`, `NEXT`, or `IGNORE` according to the locked contract. Infrastructure or authority issues remain durable operational blockers until evidence proves recovery. Repeated identical failures on unchanged state must not be retried indefinitely.
