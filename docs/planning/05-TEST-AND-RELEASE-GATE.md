# Test, Adversarial Validation, and Release Gate

## Test layers

| Layer | Purpose |
|---|---|
| Syntax/lint | Parse every source/script and enforce repository conventions. |
| Static contract check | Validate exports, JSDoc typedef references, and package entrypoints. |
| Unit | Canonical hashing, glob policy, state transitions, redaction, classification. |
| Integration | Temporary Git repositories execute init→lock→verify→close. |
| Adapter | Fake binaries/config/artifacts validate capability negotiation. |
| Adversarial | Attempt false done, stale proof, contract tamper, scope drift, endless output, stop override. |
| Security | Secret patterns, traversal, symlink escape, unsafe runtime files. |
| License | Project license and third-party integration inventory exist; no vendored external source. |

## Adversarial cases

| ID | Attack | Required result |
|---|---|---|
| ADV-001 | Agent output says DONE while command exits non-zero. | BLOCKER; never SHIPPABLE. |
| ADV-002 | Contract changes after lock. | Verification fails before command execution. |
| ADV-003 | Reuse evidence from previous Git SHA. | Evidence rejected as stale. |
| ADV-004 | Agent deletes or weakens a required test. | Contract/scope policy blocker when protected path applies. |
| ADV-005 | Write outside allowed paths. | Scope blocker with changed path evidence. |
| ADV-006 | Command never exits. | Killed at timeout; blocker evidence saved. |
| ADV-007 | Command floods stdout. | Capture bounded, digest retained, process terminated or output truncated safely. |
| ADV-008 | Log contains token/private key. | Stored log redacted. |
| ADV-009 | Reviewer creates blocker without basis. | Rejected or downgraded to UNKNOWN. |
| ADV-010 | Adapter requests resume after human abort. | `deny-continuation`. |
| ADV-011 | Fix budget exhausted. | Durable BLOCKED state. |
| ADV-012 | Modify source after CLOSED. | Status reports closed-version drift/new contract required. |
| ADV-013 | External binary absent. | `unavailable`; no success fabrication. |
| ADV-014 | Fake binary exits zero but emits malformed JSON. | Capability marked partial/diagnostic. |
| ADV-015 | Runtime path symlink escapes repository. | Operation rejected. |

## Release blocker taxonomy

Only these categories block the current release:

- Required acceptance failure
- Build/core-flow failure
- Contract tamper or missing current evidence
- Unapproved scope drift
- Data-loss or critical security policy violation
- Human stop requiring operator decision

Refactoring preference, optional performance improvement, future extensibility, cosmetic UI, additional tests beyond contract, and unsupported optional adapters are NEXT unless an explicit criterion says otherwise.

## Required checks

```text
npm run lint
npm run typecheck
npm run build
npm test
npm run security
npm run license:check
```

`typecheck` in this dependency-free release is a repository-owned static API/import/export consistency check, not a claim that TypeScript compiler analysis occurred. The source is ESM JavaScript with JSDoc contracts.

## Evidence standard

Every release report records:

- exact Git SHA and contract hash
- commands and exit codes
- test count/pass/fail
- live vs fixture adapter probes
- unresolved NEXT/UNKNOWN findings
- any skipped check and precise reason
- remote/push status

No skipped or simulated check may be described as live success.