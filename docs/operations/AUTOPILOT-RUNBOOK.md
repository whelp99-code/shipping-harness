# Policy-Authorized Autopilot Operations

**Release:** Shipping Harness v1.6.0  
**Boundary:** personal and company-internal development only  
**External authority:** production, public release, customer communication, cost, license, destructive data, authentication, and security changes remain human-owned

## Operating model

The user approves one operating policy together with the current release proposal. Shipping then decides every bounded transition from mechanical evidence as exactly one of:

- `AUTO` — safe reversible local work may continue;
- `NOTIFY` — continue and report the auditable result;
- `ASK` — a real consequence requires a human decision;
- `STOP` — evidence, rollback, scope, value, or policy is insufficient.

Host-model text is never policy authority. The default decision is `STOP`.

## Profiles

### `MANUAL`

Analysis and deterministic verification may run automatically. Mutating actions require human authority.

### `LOCAL_REVERSIBLE`

Allows bounded local implementation, exact-path baseline/commit receipts, verification, blocker-only repair, automatic local `CLOSED`, and predecessor-gated train continuation. It does not permit `RELEASED` or external consequences.

The current MCP approval call carries the one-time policy selection:

```json
{
  "proposalId": "<exact active proposal>",
  "proposalHash": "<exact proposal hash>",
  "confirm": true,
  "autopilotProfile": "LOCAL_REVERSIBLE",
  "confirmAutopilot": true
}
```

Later train continuation uses the previously approved current policy only after the predecessor closure is committed and the next release is freshly replanned:

```json
{
  "proposalId": "<fresh next proposal>",
  "proposalHash": "<fresh proposal hash>",
  "confirm": false,
  "autopilotContinuation": true
}
```

## Automatic close gate

Local `CLOSED` is allowed only when all of these are mechanically true:

```text
policy binding current
value gate proven
required acceptance passed
current Git evidence fresh
rollback available
BLOCKER = 0
UNKNOWN = 0
scope drift = 0
Shipping state = SHIPPABLE
```

Any missing gate produces `STOP`. `CLOSED` never means `RELEASED`.

## Human authority

Pause or abort immediately outranks every automatic transition. OMP must not reinterpret a Shipping decision.

```text
AUTO / NOTIFY  continue only within the locked local policy
ASK            show the consequence and wait
STOP           do not continue or weaken the gate
```

Production deployment, public publishing, customer communication, purchasing, paid API activation, destructive migration, data deletion, authentication/authorization change, security weakening, secrets, and license changes are never automatic under the default policy.

## Durable evidence

Repository-local runtime records are kept under `.shipping/`:

```text
autopilot-policy.json       exact approved policy and bindings
autopilot-state.json        current durable phase
autopilot-ledger.jsonl      append-only hash chain
autopilot-mutations/        exact mutation receipts and rollback references
release-train.json          approved train authority envelope
```

State recovery verifies the policy/contract/baseline/train binding and ledger tail. A stale or tampered binding fails closed.

## Verification

```bash
npm run test:autopilot
npm run smoke:autopilot
npm run test:mcp
npm run test:omp-main
npm run release:verify
```

The disposable pilot proves safe implementation, human pause/resume, automatic local closure, next-release continuation, public-release refusal, durable receipts, exact nine MCP tools, and `RELEASED=false`.

## Incident response

1. Ask Shipping for status; do not edit runtime JSON by hand.
2. If `ASKING` or `STOPPED`, inspect the decision code and evidence.
3. If `PAUSED`, resume only from an explicit human request.
4. If `REPLAN_REQUIRED`, preserve closed history and create a fresh higher-version proposal.
5. If policy, state, ledger, or receipt validation fails, stop automation and restore from the previous closed source/tag or verified backup.
6. Never reset or delete `.shipping` to force progress.

## Rollback

Source rollback is annotated tag `v1.5.0`. Runtime rollback never reopens or deletes a closed release. It pauses the train, restores only verified reversible local state, and requires fresh policy/plan evidence before further execution.

---

# Autopilot Recovery and Incident Procedure

**Release:** Shipping Harness v1.6.0  
**Applies to:** repository-local Policy-Authorized Autopilot state  
**Authority:** human pause/abort and Shipping evidence remain final

## Stop first

When policy, train, contract, baseline, ledger, mutation receipt, rollback, acceptance, or Git evidence is inconsistent, do not continue automatically. Preserve the repository and ask Shipping for status.

```bash
shipping-harness status --json
```

Do not edit, delete, reset, or recreate `.shipping` runtime files manually.

## Failure classes

### `ASKING`

A real external, production, customer, cost, data, credential, authentication, authorization, security, license, or public-release consequence was detected. Automation remains stopped until a consequence-level human decision is recorded through the supported host flow.

### `STOPPED`

Required authority or evidence is missing. Common causes are stale policy binding, missing rollback, incomplete value gate, scope drift, unresolved `UNKNOWN`, exhausted fix budget, or invalid mutation receipt.

### `REPLAN_REQUIRED`

The active release train no longer matches the project, contract, value, risk, rollback, or acceptance reality. Preserve completed release history, create a fresh proposal for the next greater release, and recompute the train. Never rewrite a closed train step.

### `PAUSED`

A human pause is active. No automatic recovery may resume it. Resume only through an explicit human request using the existing pause tool.

### `ABORTED`

The active Autopilot run is terminal. Start again only from a fresh proposal and policy decision; never replay prior mutation authority.

## Evidence preservation

Before repair, retain:

```text
.shipping/autopilot-policy.json
.shipping/autopilot-state.json
.shipping/autopilot-ledger.jsonl
.shipping/autopilot-mutation.json or .shipping/autopilot-mutations/
.shipping/release-train.json
.shipping/contract.yaml
.shipping/contract.lock
.shipping/state.json
.shipping/evidence/
.shipping/releases/
```

Also record the current Git HEAD, `git status --porcelain`, installed Shipping version, OMP version, and doctor result.

## Integrity checks

1. Validate the policy hash and proposal/contract/baseline/train bindings.
2. Validate the Autopilot state hash and current release/index.
3. Replay the append-only ledger and confirm its sequence, previous-event hash, and final state hash.
4. Validate every mutation receipt against the exact effect ID, action, release, before/after Git SHA, paths, policy hash, and train hash.
5. Confirm the active release is the first incomplete train step and every predecessor has a committed `CLOSED` receipt.
6. Confirm rollback evidence still exists and matches its recorded digest.
7. Run current-SHA acceptance without weakening commands, `cwd`, isolation, or determinism.

Any mismatch remains `STOPPED` or `REPLAN_REQUIRED`.

## Safe source rollback

The source rollback point for v1.6.0 is annotated tag `v1.5.0` until v1.6.0 itself is closed and tagged. Source rollback does not alter target-project runtime history and must not reopen a `CLOSED` release.

## Installed OMP rollback

Use the backup ID and exact rollback command from:

```text
~/.omp/agent/shipping-harness-install.json
```

Preview first:

```bash
shipping-harness-omp rollback --backup-id <backup-id>
```

Apply only when the operator explicitly chooses installation rollback:

```bash
shipping-harness-omp rollback --backup-id <backup-id> --apply
```

The rollback must verify backup digests and preserve OMP, `omp-core`, router, provider, credential, model-routing, unrelated MCP, and target-project bytes.

## Crash recovery

On process restart, Autopilot may resume only when:

- policy/state/ledger hashes validate;
- bindings match current proposal, contract, baseline, and train;
- the effect ID has not already completed with different parameters;
- human stop is false;
- current Git state matches the last valid receipt;
- the next action remains allowed by the same policy.

Duplicate identical invocations return the stored result. Duplicate IDs with changed input fail closed.

## Verification after repair

```bash
npm run test:autopilot
npm run smoke:autopilot
npm run test:mcp
npm run test:omp-main
npm run release:verify
```

Then confirm:

```text
BLOCKER = 0
UNKNOWN = 0
policy binding current
ledger valid
rollback available
released = false
```

Do not force `SHIPPABLE`, `CLOSED`, or the next release by editing runtime records.
