# Shipping Harness v1 Internal Handover

## Product promise

The user states the desired outcome. Shipping Harness analyzes the repository, proposes the smallest releasable scope, asks only for exceptional high-risk decisions, requires one exact approval, controls bounded execution, independently verifies evidence, and closes the release only when blockers are zero.

The user is the approver, not the technical interviewer.

## Authority order

1. Human pause or abort.
2. Locked Shipping contract, scope, budgets, and approval receipt.
3. Deterministic evidence and Release Judge.
4. Shipping Finisher and closure receipt.
5. Host agent, adapters, and private OMO execution claims.

No model, OMO task, remote client, or recovery routine can outrank the first four levels.

## Components

- `shipping-harness`: deterministic CLI engine.
- `shipping-harness-mcp`: project-root-fixed local STDIO MCP server.
- `shipping-harness-plugin`: beginner installer, doctor, upgrade, rollback, and uninstall surface.
- `shipping-harness-remote`: optional authenticated internal TLS gateway; no arbitrary shell.
- `shipping-harness-omo-runtime`: separate private internal runtime pinned outside Shipping Core.
- `packages/stable-control`: stable schema, compatibility, migration, health, and event surfaces.

## Operator checks

Before using a project:

1. confirm the repository has at least one Git commit;
2. register the project-specific MCP root;
3. run plugin doctor and MCP discovery;
4. ask Shipping to propose the next small release;
5. inspect the one-screen scope and approve only the exact proposal;
6. monitor `RUNNING`, `PAUSED`, `BLOCKED`, `SHIPPABLE`, or `CLOSED`;
7. retain the release receipt, tag, and backlog.

## v1.4.0 beginner-report authority

Shipping Core compiles the default Korean report from canonical state, baseline, coverage, issues, and evidence. The report always includes problems, improvements, next plan, summary, and one next action. OMP must render it before optional model advice. Model advice is explicitly non-authoritative and cannot change approval readiness, acceptance, blockers, pause/abort, SHIPPABLE, or CLOSED. If rendering fails, operators use the raw Shipping fields; the failure never changes the core state.

## Support boundary

Supported internal issues include installation, MCP registration, contract/proposal state, evidence freshness, plugin repair, private OMO pin/bridge, internal remote gateway, backup/restore, and rollback. Application-specific feature design remains the responsibility of the selected host agent under the approved Shipping contract.

## Known limitations

- Internal use only; no customer/public SaaS or integrated OMO redistribution.
- Team/DAG remains disabled because the v0.7 pilot did not prove a coordination bottleneck.
- Remote mobile use requires an operator-managed private TLS endpoint and credentials.
- Shipping does not automatically push, deploy, purchase, or contact customers.
- Completion benchmark validates governance correctness, not model quality or token-cost superiority.
- Optional improvements may remain in `NEXT` after a version closes.

## Ownership

- Product direction and scope approval: repository owner.
- Shipping Core and release policy: internal engineering owner.
- Private OMO fork/pin/license notices: internal runtime owner.
- Remote credentials, TLS, backup, and incident response: internal operations owner.
- Security and license review on direction change: designated internal reviewer.

## Direction-change triggers

Stop and re-plan before public publication, customer deployment, multi-tenant service, external collaborator distribution, billing, unrestricted remote shell, automatic deployment, or a different OMO licensing boundary.

## v1.5.0 release-train authority

`shipping_start` deterministically compiles a rolling one-to-five-version train. The first release exactly matches the current proposal contract. Future releases carry value, entry, exit, rollback, and replan gates only and cannot execute or grant current authority. Exact approval writes `.shipping/release-train.json`, bound to proposal hash, contract hash, and baseline SHA. Replan after every predecessor closure; a train never implies `RELEASED`.

## v1.6.0 policy-autopilot authority

One explicit approval may bind `MANUAL` or `LOCAL_REVERSIBLE` to the exact proposal, contract, baseline, and release train. The deterministic policy engine, not the host model, selects `AUTO`, `NOTIFY`, `ASK`, or `STOP`. Reversible local implementation, verification, bounded blocker repair, local `CLOSED`, and predecessor-gated continuation may run only while every binding and rollback remains current. Production, public/customer, external write, cost, license, destructive data, authentication, and security consequences remain human-owned. Pause/abort is immediate, stale or tampered state fails closed, and `CLOSED` never marks `RELEASED`. Operations are defined in `docs/operations/AUTOPILOT-RUNBOOK.md`.

## v1.6.1 field evidence handover

Operators retain `docs/reports/v1.6.1-autopilot-field.json` with the source repository. It records tested lanes, decision performance, read-only project fingerprints, and zero-valued safety counters. The file is not shipped in the npm package. Installation handover additionally records pre/post OMP hashes, doctor, exact nine tools, package digest, backup ID, and rollback preview.

## v1.7.0 goal discovery handover

Operators retain the CLOSED receipt, annotated tag, `docs/reports/v1.7.0-goal-discovery.json`, and the stable Goal Discovery and Decision Ledger schema examples. The field report must show nine tools, zero technical questions, zero model-authority leaks, zero false direction/ready/closed/released results, and unchanged available real-project fingerprints. `.shipping/decision-ledger.jsonl` is runtime authority evidence: do not edit, truncate, reorder, or merge it manually. A hash, sequence, event-key, Git-binding, or retention failure is an incident and must stop planning until recovered from trusted project history or a separately verified backup.
