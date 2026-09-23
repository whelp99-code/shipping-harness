# Post-v1 Backlog

Shipping Harness v1 deliberately closes with a small internal product surface. Items below are not release blockers and cannot enter a closed version without a new approved contract.

## Deferred product work

- [ ] BACKLOG-014: Software-delivery goals must not close on lint, `git diff --check`, or documentation-only acceptance. Require a repository-owned check that launches the app or asserts a named user outcome (v1.14+; planned after v1.13.20 trust fixes).
- [ ] BACKLOG-015: Governed acceptance-bootstrap phase so a host can author `test`/`start` under a separately approved preparation scope, then rescan, without editing `contract.yaml` by hand.
- [ ] BACKLOG-016: Compile discovery answers into the locked goal and acceptance; bind train continuation to plan hash and stage, not version number alone; reject unrelated goals.

- [ ] BACKLOG-001: Optional full YAML parser profile for repositories that require non-JSON YAML syntax.
- [ ] BACKLOG-002: GitHub Checks, protected-branch policy, and explicit push/tag approval integration.
- [ ] BACKLOG-003: Multi-repository release coordination under a separate bounded contract.
- [ ] BACKLOG-004: Internal dashboard and long-term completion metrics store.
- [ ] BACKLOG-005: Extended company RBAC beyond the current internal remote actor/project/action allowlists.
- [ ] BACKLOG-006: Optional LLM-assisted issue triage subordinate to deterministic blocker policy.
- [x] BACKLOG-007: Evidence-first Gajae-style bounded product interview and deterministic direction critic, completed in v1.7.0 without technical interrogation or model authority.
- [ ] BACKLOG-008: Ouroboros-style next-version evolution proposals; never automatic reopening of a closed release.
- [ ] BACKLOG-009: OMO memory/reflection evaluation only after a measured internal need and separate license/security review. The private OMO runtime bridge itself was retired from the release gates in v1.11.1 (pinned runtime archived); reactivating either requires a new ADR and contract, not this backlog item alone.
- [ ] BACKLOG-010: Team/DAG reconsideration only after a real coordination bottleneck and measurable completion benefit are proven.
- [ ] BACKLOG-011: Additional agent-host profiles and native integrations after the stable MCP interface proves insufficient.
- [ ] BACKLOG-012: Optional internal UI for approval, progress, blockers, completion, backup, and incident status.
- [ ] BACKLOG-013: An approval artifact for the CLI release path. `shipping_approve_scope` binds an exact proposal hash and records who approved, so a model cannot approve its own proposal. The CLI path has no equivalent: whoever runs `lock` is treated as the operator, and a model driving the CLI therefore closes a release with no record that a human authorised the scope. Every release from v1.9.0 to v1.13.5 was closed this way under an explicit instruction to proceed, so the authorisation existed but left no evidence. Options include a `--approved-by` receipt field, requiring an approval file before `lock`, or routing model-driven CLI use through the MCP proposal flow. Not a blocker: the CLI is an operator surface by design, and closing this needs a decision about what "operator" means when the hands are a model.
- [x] BACKLOG-013: Deterministic Intent Gate and read-only Analysis Mode, completed in v1.8.3 without a model classifier or tenth MCP tool.

## Completed roadmap items

- Auto decision, conservative defaults, risk escalation, and one-brief approval: completed in v0.4.0.
- Durable Goal/Task/Ledger and evidence freshness: completed in v0.5.0.
- Beginner plugin, local MCP, doctor, repair, upgrade, and rollback: completed in v0.6.0.
- Separate private OMO runtime, signed bridge, bounded execution, canary, and rollback: completed in v0.7.0.
- Team/DAG evidence gate: completed in v0.8.0 with the feature deliberately disabled.
- Authenticated internal TLS remote control and signed backup/restore: completed in v0.9.0.
- Stable schemas, migrations, compatibility, operations, benchmark, security inventory, and handover: completed in v1.0.0.
- Evidence-first bounded goal discovery, deterministic direction critic, and append-only Decision Ledger: completed in v1.7.0.

## Permanent exclusions under the locked direction

- Public SaaS, customer installation, resale, or public integrated OMO distribution.
- Unlimited autonomy, workers, retries, continuations, time, tool calls, or graph size.
- Automatic purchase, production deployment, customer communication, push, or merge without explicit authority.
- Model self-approval or runtime claims that bypass independent Shipping verification.
