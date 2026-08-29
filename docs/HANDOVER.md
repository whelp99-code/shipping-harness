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
