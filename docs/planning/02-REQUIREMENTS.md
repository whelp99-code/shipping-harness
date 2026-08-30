# Requirements and Acceptance Contract

## Functional requirements

### Contract and scope

| ID | Requirement | Release |
|---|---|---|
| REQ-CONTRACT-001 | Initialize a repository-native contract at `.shipping/contract.yaml`. | 0.1.0 |
| REQ-CONTRACT-002 | Reject malformed contracts, duplicate acceptance IDs, unsafe budgets, and contracts without a required gate. | 0.1.0 |
| REQ-CONTRACT-003 | Lock the exact contract bytes with SHA-256 and a Git baseline SHA. | 0.1.0 |
| REQ-CONTRACT-004 | Reject verification and closure when the locked contract hash no longer matches. | 0.1.0 |
| REQ-SCOPE-001 | Detect changed/untracked paths against the lock baseline. | 0.1.0 |
| REQ-SCOPE-002 | Classify changes outside allowed path patterns or inside denied patterns as release blockers. | 0.1.0 |
| REQ-SCOPE-003 | Exclude Shipping Harness runtime evidence from project drift decisions. | 0.1.0 |

### State, authority, and budgets

| ID | Requirement | Release |
|---|---|---|
| REQ-STATE-001 | Persist a deterministic release state machine. | 0.1.0 |
| REQ-STATE-002 | Append every state transition and decision to a JSONL ledger. | 0.1.0 |
| REQ-STATE-003 | Restore state after process restart without replaying mutable commands. | 0.1.0 |
| REQ-STOP-001 | A human pause/abort must override adapter continuation. | 0.1.0 |
| REQ-BUDGET-001 | Enforce maximum command seconds and captured output bytes. | 0.1.0 |
| REQ-BUDGET-002 | Enforce maximum agent runs and fix cycles. | 0.1.0 |
| REQ-BUDGET-003 | End in a durable BLOCKED state when a hard budget is exhausted with blockers remaining. | 0.1.0 |

### Evidence and release decision

| ID | Requirement | Release |
|---|---|---|
| REQ-EVIDENCE-001 | Execute each acceptance command with timeout and bounded output. | 0.1.0 |
| REQ-EVIDENCE-002 | Bind every evidence record to run ID, criterion ID, contract hash, Git SHA, exit code, timestamps, and output digests. | 0.1.0 |
| REQ-EVIDENCE-003 | Redact common credential patterns before logs are persisted. | 0.1.0 |
| REQ-EVIDENCE-004 | Reject evidence from a different contract or Git SHA. | 0.1.0 |
| REQ-ISSUE-001 | Represent findings as BLOCKER, NEXT, IGNORE, or UNKNOWN. | 0.1.0 |
| REQ-ISSUE-002 | Require every BLOCKER to cite a criterion or policy ID and evidence reference. | 0.1.0 |
| REQ-GATE-001 | Mark a release SHIPPABLE only when all required criteria pass, drift is absent, and blockers equal zero. | 0.1.0 |
| REQ-CLOSE-001 | Close only a SHIPPABLE release with fresh evidence for the current Git SHA. | 0.1.0 |
| REQ-CLOSE-002 | Generate a release report and migrate NEXT/UNKNOWN findings to the backlog. | 0.1.0 |
| REQ-CLOSE-003 | Detect post-close source changes and require a new version contract. | 0.1.0 |

### Adapter layer

| ID | Requirement | Release |
|---|---|---|
| REQ-ADAPTER-001 | Expose one adapter contract for probe, execute, collect, pause/cancel, and capabilities. | 0.2.0 |
| REQ-ADAPTER-002 | Distinguish installed/live, configured, unavailable, and fixture verification levels. | 0.2.0 |
| REQ-ADAPTER-003 | Support Generic and Codex adapters without private APIs. | 0.2.0 |
| REQ-ADAPTER-004 | Support Gajae via CLI/controller-compatible commands and artifact collection without terminal scraping. | 0.2.0 |
| REQ-ADAPTER-005 | Support Ouroboros via `ooo`/`ouroboros` CLI commands and Seed/Ledger artifact collection. | 0.2.0 |
| REQ-ADAPTER-006 | Support OMO Native via `omo` discovery, unified config detection, process execution, and normalized event bridge. | 0.2.0 |
| REQ-HOOK-001 | Ingest normalized lifecycle events and return a machine-readable stop decision. | 0.2.0 |
| REQ-HOOK-002 | Return `deny-continuation` whenever human stop, closed state, or exhausted budget applies. | 0.2.0 |

### Beginner workflow and MCP

| ID | Requirement | Release |
|---|---|---|
| REQ-ANALYZE-001 | Inspect only repository-owned manifests, README files, and package scripts to identify project type and candidate verification commands. | 0.3.0 |
| REQ-ANALYZE-002 | Produce a minimal scope proposal from a natural-language goal without silently adding unrelated product features. | 0.3.0 |
| REQ-ANALYZE-003 | Produce a deterministic short execution plan whose steps map to proposed acceptance criteria. | 0.3.0 |
| REQ-PROPOSAL-001 | Bind every proposal to project root, Git SHA, proposal hash, release, goal, scope, acceptance, and expiry metadata. | 0.3.0 |
| REQ-PROPOSAL-002 | Require an explicit confirmation and matching proposal hash before writing a contract. | 0.3.0 |
| REQ-PROPOSAL-003 | Reject approval if the proposal is stale, the repository changed, or an active release is already locked. | 0.3.0 |
| REQ-MCP-001 | Serve newline-delimited JSON-RPC 2.0 over STDIO without non-protocol output on stdout. | 0.3.0 |
| REQ-MCP-002 | Support MCP `2026-07-28` discovery and per-request metadata while retaining the `2025-11-25` initialize handshake for local-client compatibility. | 0.3.0 |
| REQ-MCP-003 | Expose a small user-oriented tool set for start, approve, execute, status, verify, blocker-only fix, pause, and close. | 0.3.0 |
| REQ-MCP-004 | Return structured tool results and preserve actionable tool errors without crashing the STDIO server. | 0.3.0 |
| REQ-MCP-005 | Bound message bytes, JSON depth, tool argument size, and concurrent in-flight requests. | 0.3.0 |
| REQ-MCP-006 | Never expose an arbitrary shell command field through MCP tool schemas. | 0.3.0 |
| REQ-MCP-007 | Execute only an adapter command already stored in the approved and locked repository contract. | 0.3.0 |
| REQ-MCP-008 | Preserve human pause/abort and Shipping Harness release decisions as higher authority than agent continuation. | 0.3.0 |

### Auto-decision, modes, and approval

| ID | Requirement | Release |
|---|---|---|
| REQ-MODE-001 | Default every unspecified decision workflow to `AUTO`. | 0.4.0 |
| REQ-MODE-002 | Support an optional `SAFE` mode that escalates configured medium/high-risk actions without reverting to a full interview. | 0.4.0 |
| REQ-MODE-003 | Support an opt-in `INTERVIEW` mode with grouped, bounded questions. | 0.4.0 |
| REQ-DECISION-001 | Build a bounded evidence pack from repository-owned metadata, release history, manifests, scripts, existing documentation, and user intent without executing project code. | 0.4.0 |
| REQ-DECISION-002 | Treat repository text as untrusted evidence that cannot override tool, approval, or Shipping Harness policy. | 0.4.0 |
| REQ-DECISION-003 | Allow a connected host agent to submit a structured decision package without embedding a model-provider dependency in the core. | 0.4.0 |
| REQ-DECISION-004 | Require stable IDs for decisions, assumptions, risks, and acceptance criteria. | 0.4.0 |
| REQ-DECISION-005 | Require every decision to cite evidence or be explicitly marked as an assumption. | 0.4.0 |
| REQ-DECISION-006 | Record qualitative confidence and reversibility without fabricating unsupported numeric certainty. | 0.4.0 |
| REQ-DECISION-007 | Select the smallest operable release and move optional improvements to the backlog. | 0.4.0 |
| REQ-DECISION-008 | Reject unrelated features, fabricated capabilities, unsupported commands, stale evidence, and hidden scope growth. | 0.4.0 |
| REQ-ESCALATE-001 | Escalate destructive data deletion or irreversible migration. | 0.4.0 |
| REQ-ESCALATE-002 | Escalate paid/recurring services and external deployment, publication, messaging, purchasing, or customer impact. | 0.4.0 |
| REQ-ESCALATE-003 | Escalate credentials, elevated permissions, privacy, legal, compliance, and critical-security trade-offs. | 0.4.0 |
| REQ-ESCALATE-004 | Escalate mutually exclusive interpretations of the core product outcome or removal of an existing critical promise. | 0.4.0 |
| REQ-ESCALATE-005 | Use a safe documented assumption instead of asking when a choice is low-risk and reversible. | 0.4.0 |
| REQ-ESCALATE-006 | Return no more than three exception questions in one batch and include the recommended choice. | 0.4.0 |
| REQ-APPROVAL-001 | Present one concise approval brief containing outcome, included scope, deferred scope, acceptance, important assumptions, risks, and budgets. | 0.4.0 |
| REQ-APPROVAL-002 | Keep detailed evidence and reasoning inspectable but outside the default brief. | 0.4.0 |
| REQ-APPROVAL-003 | Bind mode, decisions, assumptions, risks, questions, evidence, Git SHA, and expiry into the proposal hash. | 0.4.0 |
| REQ-APPROVAL-004 | Prevent the submitting model from approving its own proposal; explicit user confirmation remains mandatory. | 0.4.0 |
| REQ-POLICY-001 | Prefer the existing stack, conventions, and dependencies unless the accepted outcome requires a change. | 0.4.0 |
| REQ-POLICY-002 | Prefer the minimum reversible change and an operable release over speculative architecture improvement. | 0.4.0 |
| REQ-POLICY-003 | Preserve human stop, bounded execution, evidence freshness, and release closure invariants. | 0.4.0 |
| REQ-POLICY-004 | Reject silent mode changes, question flooding, automatic approval, and policy weakening. | 0.4.0 |

### Durable Goal, Task, and Evidence runtime

| ID | Requirement | Release |
|---|---|---|
| REQ-GOAL-001 | Compile a locked release contract into stable Goal and Task records with requirement and acceptance links. | 0.5.0 |
| REQ-GOAL-002 | Reject orphan tasks, duplicate IDs, invalid dependencies, and cyclic task graphs. | 0.5.0 |
| REQ-GOAL-003 | Persist Goal, Task, attempt, blocker, checkpoint, and evidence transitions in an append-only ledger. | 0.5.0 |
| REQ-GOAL-004 | Restore the current Goal/Task state after process restart without replaying completed work. | 0.5.0 |
| REQ-GOAL-005 | Require current-contract and current-Git-SHA evidence before a Goal or Task can become DONE. | 0.5.0 |
| REQ-GOAL-006 | Fingerprint repeated failures and stop identical no-progress retries on unchanged source/state. | 0.5.0 |
| REQ-GOAL-007 | Represent exhausted planning/review/repair paths as durable PLANNING_STUCK or BLOCKED outcomes. | 0.5.0 |
| REQ-GOAL-008 | Keep human pause/abort, release budgets, and Shipping Finisher authority above Goal/Task execution state. | 0.5.0 |

### Beginner plugin and local agent experience

| ID | Requirement | Release |
|---|---|---|
| REQ-PLUGIN-001 | Package the local MCP server, Shipping skill, agent instructions, and lifecycle rules through one supported install path. | 0.6.0 |
| REQ-PLUGIN-002 | Allow normal start, approval, status, pause, blocker handling, and close flows without project-specific CLI commands or JSON editing. | 0.6.0 |
| REQ-PLUGIN-003 | Present concise approval, progress, blocker, and completion surfaces while keeping full evidence separately inspectable. | 0.6.0 |
| REQ-PLUGIN-004 | Provide doctor, repair, upgrade, uninstall, and reinstall flows that preserve repository Shipping state. | 0.6.0 |
| REQ-PLUGIN-005 | Expose no public listener, customer endpoint, or arbitrary shell surface in the local plugin release. | 0.6.0 |

### Internal upstream runtime and OMO boundary

| ID | Requirement | Release |
|---|---|---|
| REQ-INTERNAL-001 | Treat the integrated product as personal/company-internal only; any customer/public distribution requirement must block promotion pending a new direction and license review. | 0.7.0 |
| REQ-UPSTREAM-001 | Record the exact upstream commit, internal patch commit, runtime build digest, and compatibility version for every promoted OMO runtime. | 0.7.0 |
| REQ-UPSTREAM-002 | Preserve upstream license/copyright notices and maintain an internal modification inventory. | 0.7.0 |
| REQ-OMO-001 | Run actual OMO source through a separately pinned private runtime and a narrow Shipping bridge rather than importing the upstream monorepo into Shipping Core. | 0.7.0 |
| REQ-OMO-002 | Prevent the OMO runtime from editing or approving Shipping contracts, increasing budgets, changing blocker policy, or transitioning SHIPPABLE/CLOSED. | 0.7.0 |
| REQ-OMO-003 | Bind every OMO work order and receipt to release ID, contract hash, Git SHA, Shipping Goal/Task IDs, scope paths, acceptance IDs, and budgets. | 0.7.0 |
| REQ-OMO-004 | Deny OMO continuation, revival, or child work whenever Shipping is paused, aborted, closed, out of budget, or unable to prove session ownership. | 0.7.0 |
| REQ-OMO-005 | Forbid unlimited concurrency/depth/continuation values and start with team/DAG disabled, parallel workers <= 2, depth <= 1, and continuation limit <= 3. | 0.7.0 |
| REQ-OMO-006 | Treat OMO task completion as an untrusted claim until current Shipping acceptance checks verify the resulting repository state. | 0.7.0 |
| REQ-OMO-007 | Report an unavailable/unhealthy/incompatible OMO runtime truthfully and use only contract-approved fallback or a durable BLOCKED result. | 0.7.0 |
| REQ-OMO-008 | Retain the previous promoted runtime pin and prove rollback before accepting an OMO runtime update. | 0.7.0 |
| REQ-OMO-009 | Keep public package, image, source, and customer-deployment publishing paths disabled for the integrated internal runtime. | 0.7.0 |

### Bounded Team/DAG and internal remote operation

| ID | Requirement | Release |
|---|---|---|
| REQ-TEAM-001 | Start Team/DAG integration only after a v0.7 pilot proves a concrete coordination bottleneck and stable single-runtime closure. | 0.8.0 |
| REQ-TEAM-002 | Compile only locked Shipping Goals/Tasks into a graph whose nodes map to requirement or acceptance consumers. | 0.8.0 |
| REQ-TEAM-003 | Keep the Shipping Finisher outside every OMO team and deny agents authority to expand top-level scope. | 0.8.0 |
| REQ-TEAM-004 | Enforce bounded members, parallelism, depth, time, turns, tool calls, retries, and graph size; unlimited values are forbidden. | 0.8.0 |
| REQ-TEAM-005 | Retry or amend only failed/changed nodes and preserve successful unrelated node evidence. | 0.8.0 |
| REQ-TEAM-006 | Detect no-progress, oscillation, repetitive review, and role ping-pong, then stop with an inspectable terminal reason. | 0.8.0 |
| REQ-REMOTE-001 | Expose remote control only through authenticated, encrypted, replay-protected internal access and explicit project allowlists. | 0.9.0 |
| REQ-REMOTE-002 | Prevent remote clients from supplying arbitrary commands or overriding local human stop, budgets, contract lock, or Finisher. | 0.9.0 |
| REQ-REMOTE-003 | Bind remote approval to a signed proposal/approval receipt and exact project/release identity. | 0.9.0 |
| REQ-REMOTE-004 | Back up and restore Shipping state plus the minimum required OMO runtime state without breaking evidence links or release authority. | 0.9.0 |
| REQ-REMOTE-005 | Provide health, upgrade, migration, rollback, notification, and cross-project-isolation operations for the internal deployment. | 0.9.0 |

### Stable internal control plane

| ID | Requirement | Release |
|---|---|---|
| REQ-STABLE-001 | Freeze and document supported contract, decision, Goal/Task, evidence, MCP, bridge, graph, remote, backup, and release schemas with limits and canonical hashing rules. | 1.0.0 |
| REQ-STABLE-002 | Provide tested migration, deprecation, compatibility, and rollback policy for supported prior releases and persisted states. | 1.0.0 |
| REQ-STABLE-003 | Maintain a tested compatibility matrix for Shipping Core, plugin/MCP, private OMO runtime, bridge schema, and optional Team/DAG profile. | 1.0.0 |
| REQ-OPS-001 | Provide proven installation, upgrade, backup, restore, observability, incident, recovery, and rollback runbooks. | 1.0.0 |
| REQ-OPS-002 | Define internal owners, support boundaries, retention policy, review cadence, and direction/license reconsideration triggers. | 1.0.0 |
| REQ-BENCH-001 | Provide repeatable direct-agent, Shipping-only, private OMO, and optional Team/DAG benchmark scenarios. | 1.0.0 |
| REQ-BENCH-002 | Measure ship rate, false-done rate, scope drift, stale evidence, retries, interventions, elapsed time, cost when available, recovery, and question count. | 1.0.0 |
| REQ-SECURITY-001 | Complete final authorization, path, secret, replay, isolation, runtime-boundary, denial-of-service, and internal-distribution security review. | 1.0.0 |
| REQ-HANDOVER-001 | Produce release notes, operator handover, known limitations, support boundaries, and next-version backlog. | 1.0.0 |
| REQ-RELEASE-001 | Close v1.0.0 with zero release blockers while preserving every governance invariant across supported execution paths. | 1.0.0 |

## Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-PORT-001 | Core commands run on macOS and Ubuntu with Node 22+. |
| NFR-DEP-001 | Core runtime has zero required third-party packages. |
| NFR-AUDIT-001 | Decisions are inspectable from repository files without a service. |
| NFR-SEC-001 | Paths must remain inside the governed repository. |
| NFR-SEC-002 | No adapter may install software or alter credentials implicitly. |
| NFR-COMPAT-001 | External CLI flag changes must degrade to a diagnostic, not fabricated success. |
| NFR-TEST-001 | Unit, integration, adversarial, security, and license checks are repeatable offline. |
| NFR-MCP-001 | The MCP runtime requires no network listener and no remote authentication in v0.3.0. |
| NFR-MCP-002 | MCP logs go only to stderr or repository audit files, never protocol stdout. |
| NFR-USABILITY-001 | A user can begin with a natural-language goal and one explicit scope approval rather than composing CLI commands. |
| NFR-USABILITY-002 | In `AUTO`, ordinary fixtures should require zero technical questions before the approval brief. |
| NFR-DECISION-001 | The core remains model-agnostic and does not require network model calls. |
| NFR-DECISION-002 | Decision inputs, outputs, questions, and evidence have bounded byte, depth, item, and expiry limits. |
| NFR-LICENSE-001 | Internal upstream use remains auditable through pins, notices, modification records, and an external-distribution reconsideration gate. |
| NFR-RUNTIME-001 | Shipping Core and the internal OMO runtime can be upgraded, disabled, and rolled back independently. |
| NFR-RUNTIME-002 | The core remains operable with a truthful Codex/Generic fallback or durable BLOCKED result when OMO is unavailable. |
| NFR-OPS-001 | Every supported upgrade, backup, restore, and rollback path is verified through a repeatable drill. |
| NFR-STABLE-001 | Unsupported schema or component combinations fail with stable diagnostics and never fabricate compatibility. |

## Release acceptance criteria

### v0.1.0

| ID | Acceptance criterion |
|---|---|
| AC-0101 | `init` creates a valid repository contract and runtime directory. |
| AC-0102 | A contract without a required acceptance command cannot lock. |
| AC-0103 | Lock records a contract hash and existing Git HEAD. |
| AC-0104 | Contract mutation invalidates lock and evidence. |
| AC-0105 | Agent text containing DONE cannot make a failed release SHIPPABLE. |
| AC-0106 | Evidence from a previous Git SHA is rejected. |
| AC-0107 | Scope-denied file mutation becomes a BLOCKER. |
| AC-0108 | Command timeout and output limits terminate safely. |
| AC-0109 | Human abort denies continuation. |
| AC-0110 | Exhausted fix cycles produce BLOCKED, not an infinite loop. |
| AC-0111 | NEXT findings remain while a zero-blocker release becomes SHIPPABLE. |
| AC-0112 | Close generates release report, backlog, closed state, and immutable receipt. |

### v0.2.0

| ID | Acceptance criterion |
|---|---|
| AC-0201 | `adapter list` reports all five adapters and normalized capabilities. |
| AC-0202 | Probe distinguishes a real installed Codex CLI from absent harnesses. |
| AC-0203 | Fake Gajae executable and goal/ledger artifacts are detected and collected. |
| AC-0204 | Fake Ouroboros executable and Seed/Ledger artifacts are detected and collected. |
| AC-0205 | Fake OMO executable/config is detected and normalized hook events are recorded. |
| AC-0206 | Adapter launch commands are bounded and evidence-producing. |
| AC-0207 | Unsupported capability requests fail clearly without fallback fabrication. |
| AC-0208 | Stop decision denies continuation after abort, close, or budget exhaustion. |
| AC-0209 | Live-vs-fixture integration status is emitted in a release report. |
| AC-0210 | All v0.1.0 guarantees remain green after adapter addition. |

### v0.3.0

| ID | Acceptance criterion |
|---|---|
| AC-0301 | `server/discover` reports supported protocol versions, identity, and tools capability. |
| AC-0302 | A legacy `initialize` request negotiates `2025-11-25` and does not require a stateful session afterward. |
| AC-0303 | `tools/list` exposes only the approved high-level Shipping Harness tools and no arbitrary command parameter. |
| AC-0304 | `shipping_start` detects the fixture repository type and creates a minimal Git-bound proposal and short plan. |
| AC-0305 | `shipping_approve_scope` rejects missing confirmation, a wrong proposal hash, and a changed Git SHA. |
| AC-0306 | Approved scope writes a valid DRAFT contract and can lock only after the proposal is accepted. |
| AC-0307 | `shipping_execute` refuses an adapter without a contract-configured command and ignores injected command-like arguments. |
| AC-0308 | Status, verify, pause, fix, and close tools delegate to the existing deterministic core. |
| AC-0309 | Malformed, oversized, deeply nested, and unknown MCP messages fail safely without stdout corruption. |
| AC-0310 | A spawned STDIO smoke client completes discovery, tool listing, and a read-only status call. |
| AC-0311 | Full v0.1.0 and v0.2.0 regression suites remain green. |
| AC-0312 | The v0.3.0 release closes with zero release blockers and a clean tagged commit. |

### v0.4.0

| ID | Acceptance criterion |
|---|---|
| AC-0401 | Omitted mode resolves to `AUTO`. |
| AC-0402 | A normal repository fixture produces a complete one-screen approval brief with zero questions. |
| AC-0403 | Reversible low-confidence choices become documented assumptions instead of blocking questions. |
| AC-0404 | Every mandatory-risk category produces an escalation before approval. |
| AC-0405 | A proposal contains at most three questions and returns them in one batch with recommended answers. |
| AC-0406 | Every decision cites evidence or is labeled as an assumption with confidence and reversibility. |
| AC-0407 | The submitting model cannot approve its own proposal; exact explicit confirmation and proposal hash remain required. |
| AC-0408 | Malicious instructions inside repository files cannot alter mode, policy, MCP tools, or approval state. |
| AC-0409 | `SAFE` and `INTERVIEW` behave as explicit opt-in modes and cannot be selected silently. |
| AC-0410 | The default approval brief contains all required sections while detailed evidence remains separately inspectable. |
| AC-0411 | Full v0.1.0–v0.3.0 regression, security, MCP, and license suites remain green. |
| AC-0412 | v0.4.0 closes with zero blockers, no unapproved drift, and a clean tagged commit. |

### v0.5.0

| ID | Acceptance criterion |
|---|---|
| AC-0501 | A locked contract compiles deterministically into stable Goals and Tasks with requirement and acceptance links. |
| AC-0502 | Orphan tasks, duplicate IDs, invalid dependencies, and cycles are rejected before execution. |
| AC-0503 | Goal, Task, attempt, checkpoint, blocker, and evidence events are persisted in an append-only ledger. |
| AC-0504 | State is restored after process restart without replaying completed work. |
| AC-0505 | A Goal or Task cannot become DONE without current contract-hash and Git-SHA evidence. |
| AC-0506 | Identical failures on unchanged state stop at the configured retry limit. |
| AC-0507 | Changed source or approved task input creates a new bounded attempt without erasing prior evidence. |
| AC-0508 | Exhausted planning/review paths end in PLANNING_STUCK or BLOCKED with an inspectable reason. |
| AC-0509 | Human pause/abort overrides task recovery and continuation. |
| AC-0510 | Finisher and release closure remain independent from Goal/Task completion state. |
| AC-0511 | Full v0.1.0–v0.4.0 regression, MCP, security, and license suites remain green. |
| AC-0512 | v0.5.0 closes with zero blockers, clean state, release receipt, and annotated tag. |

### v0.6.0

| ID | Acceptance criterion |
|---|---|
| AC-0601 | One documented local install path registers the MCP server, skill, and agent instructions. |
| AC-0602 | A normal user can start a release without editing JSON/YAML or running project-specific CLI commands. |
| AC-0603 | The normal flow presents one concise approval surface before execution. |
| AC-0604 | Progress surfaces truthfully map core state to PLANNING, RUNNING, PAUSED, BLOCKED, SHIPPABLE, or CLOSED. |
| AC-0605 | Every blocker surface includes reason, evidence, required action, and remaining budget. |
| AC-0606 | The user can pause or abort from the connected agent surface and the core stops continuation. |
| AC-0607 | Doctor and repair recover common registration/install faults without resetting repository release state. |
| AC-0608 | Upgrade, uninstall, and reinstall preserve contract, ledger, evidence, and closed receipts. |
| AC-0609 | No local plugin tool exposes arbitrary shell, public listener, customer endpoint, or automatic approval. |
| AC-0610 | Detailed evidence remains inspectable without appearing in the default concise view. |
| AC-0611 | Full v0.1.0–v0.5.0 regression, MCP, security, and license suites remain green. |
| AC-0612 | v0.6.0 closes with a successful beginner scenario, zero blockers, clean commit, and annotated tag. |

### v0.7.0

| ID | Acceptance criterion |
|---|---|
| AC-0701 | A separate private runtime is reproducible from recorded upstream pin, internal patch commit, build digest, and compatibility version. |
| AC-0702 | Upstream notices and an internal modification inventory are preserved. |
| AC-0703 | Work orders and receipts bind release, contract hash, Git SHA, session, Goal/Task, scope, acceptance, and budgets. |
| AC-0704 | OMO cannot modify or approve the Shipping contract, increase budgets, or transition SHIPPABLE/CLOSED. |
| AC-0705 | The default profile enforces workers <= 2, depth <= 1, continuations <= 3, Team/DAG disabled, and no unlimited values. |
| AC-0706 | Shipping pause/abort/close denies continuation, revival, and late work. |
| AC-0707 | Foreign-session, stale-SHA, wrong-task, or out-of-scope receipts are rejected. |
| AC-0708 | OMO task completion remains untrusted until current Shipping acceptance checks pass. |
| AC-0709 | Runtime/model unavailability results in approved fallback or durable BLOCKED, never fabricated success. |
| AC-0710 | Runtime crash/restart does not replay terminal work and completion delivery is deduplicated. |
| AC-0711 | An upstream update is promoted only after selected tests, bridge tests, canary, and compatibility checks pass. |
| AC-0712 | The previous runtime pin and artifact can be restored without reopening or amending the active Shipping contract. |
| AC-0713 | No public/customer package, source, binary, image, container, or endpoint is produced. |
| AC-0714 | v0.7.0 closes after one real internal OMO-backed release, all regressions pass, and zero blockers remain. |

### v0.8.0

| ID | Acceptance criterion |
|---|---|
| AC-0801 | v0.8 activation is backed by recorded v0.7 pilot evidence of a real coordination bottleneck. |
| AC-0802 | Every graph node maps to a locked Goal/Task and requirement or acceptance consumer. |
| AC-0803 | Missing dependencies, cycles, stale bindings, invalid scope, and oversized graphs are rejected. |
| AC-0804 | Finisher is outside the OMO team and no agent can expand top-level release scope. |
| AC-0805 | Members, parallelism, depth, time, turns, tools, retries, amendments, and graph size remain within policy; unlimited values are impossible. |
| AC-0806 | Failed or changed nodes can be retried/amended without rerunning unrelated successful nodes. |
| AC-0807 | No-progress, oscillation, repetitive review, and role ping-pong end with an inspectable terminal reason. |
| AC-0808 | Pause/abort/cancel prevents child continuation and late results cannot change Shipping state. |
| AC-0809 | Crash recovery preserves node ownership and deduplicates completion delivery. |
| AC-0810 | Team/DAG can be disabled and the release can continue through the approved v0.7 or direct fallback path. |
| AC-0811 | Benchmark evidence compares direct, v0.7, and v0.8 modes and records coordination overhead. |
| AC-0812 | v0.8.0 closes only when Team/DAG improves a real pilot without regression in contract, stop, evidence, or Finisher authority. |

### v0.9.0

| ID | Acceptance criterion |
|---|---|
| AC-0901 | All remote access is authenticated, encrypted, replay-protected, bounded, and restricted to explicit project allowlists. |
| AC-0902 | Per-project permissions prevent unauthorized read, approval, execution, pause, or close actions. |
| AC-0903 | No remote schema exposes raw command, argv, environment, arbitrary path execution, or policy override. |
| AC-0904 | Remote approval is signed and bound to exact actor, project, release, proposal hash, Git SHA, expiry, and nonce. |
| AC-0905 | Expired, replayed, transferred, wrong-SHA, or unauthorized approvals are rejected. |
| AC-0906 | A trusted web/mobile client can view status, approve, pause, inspect blockers, and receive completion notification. |
| AC-0907 | Local pause/abort remains stronger than any remote execute or resume request. |
| AC-0908 | Notifications are deduplicated and notification failure cannot change release state. |
| AC-0909 | Backup/restore preserves contract, Goal/Task state, evidence links, receipts, runtime pin, and CLOSED authority. |
| AC-0910 | Restored non-terminal work remains paused until ownership and runtime health are proven; terminal work is never replayed. |
| AC-0911 | Cross-project isolation, upgrade, migration, rollback, health, and incident runbooks pass operational drills. |
| AC-0912 | v0.9.0 closes after an internal mobile/web pilot, restore drill, security suite, all regressions, and zero blockers. |

### v1.0.0

| ID | Acceptance criterion |
|---|---|
| AC-1001 | All supported contract, decision, Goal/Task, evidence, MCP, bridge, graph, remote, backup, and release schemas are versioned and documented. |
| AC-1002 | Supported prior versions and states migrate and roll back without weakening contract, evidence, stop, or CLOSED authority. |
| AC-1003 | Unsupported component/runtime combinations fail truthfully through the compatibility matrix. |
| AC-1004 | Clean install, upgrade, rollback, backup, restore, observability, and incident runbooks pass practical drills. |
| AC-1005 | Representative non-developers can start, approve, monitor, pause, recover, and receive CLOSED releases without project-specific CLI knowledge. |
| AC-1006 | Benchmark and adversarial suites produce zero false SHIPPABLE transitions, stale-evidence acceptance, human-stop violations, or unapproved scope changes. |
| AC-1007 | Every accepted completion claim is bound to current contract and Git evidence. |
| AC-1008 | Direct, private OMO, and any enabled Team/DAG modes can be disabled or rolled back without corrupting Shipping governance state. |
| AC-1009 | Remote access remains authenticated, allowlisted, bounded, replay-protected, and free of arbitrary shell or policy override. |
| AC-1010 | OMO pins, internal modifications, notices, build digests, tests, and rollback artifacts are complete and private. |
| AC-1011 | The internal-only boundary is enforced and any public/customer distribution path triggers a blocking review. |
| AC-1012 | Final security, license, support, retention, and operational ownership reviews are complete. |
| AC-1013 | Optional findings are moved to NEXT and do not keep v1.0 open after all release blockers reach zero. |
| AC-1014 | v1.0.0 closes with a clean committed release receipt, annotated tag, known limitations, operator handover, and zero blockers. |

### v1.1.2

| ID | Acceptance criterion |
|---|---|
| AC-112-001 | DIRTY_BASELINE has no approval-ready nested projection. |
| AC-112-002 | NEEDS_INPUT and NEEDS_ACCEPTANCE have no approval-ready nested projection. |
| AC-112-003 | READY_FOR_APPROVAL is the only state accepted by the approval gate. |
| AC-112-004 | Legacy contradictory proposal records project safely without rewriting or hash breakage. |
| AC-112-005 | Approval-brief command rows include exact working directories. |
| AC-112-006 | Evidence-identical refinement creates no revision archive and returns `changed: false`. |
| AC-112-007 | Meaningful refinement preserves the immutable revision and previous-hash chain. |
| AC-112-008 | OMP 18.0.10/15.10.12 compatibility, security, license, docs, and all regressions pass. |

### v1.2.0

| ID | Acceptance criterion |
|---|---|
| AC-120-001 | Shipping runtime is not counted as product dirty state. |
| AC-120-002 | Untracked agent runtime is separately visible and non-blocking. |
| AC-120-003 | Tracked or ambiguous runtime and UNKNOWN remain blocking. |
| AC-120-004 | The baseline plan shows exact included/excluded paths, rationale, message, and file-set hash. |
| AC-120-005 | Shipping exposes no automatic commit, stash, reset, or discard operation. |
| AC-120-006 | File-set or history drift invalidates the preservation handshake. |
| AC-120-007 | A user-approved host commit rescans under the same proposal ID. |
| AC-120-008 | Normal beginner guidance never presents destructive discard. |
| AC-120-009 | OMP 18 nine-tool compatibility, security, license, docs, and full regression pass. |

### v1.3.0

| ID | Acceptance criterion |
|---|---|
| AC-130-001 | Python, Node, Playwright, Shell, and Alembic mixed structure is represented with path-bound components. |
| AC-130-002 | Dirty product work is grouped into no more than three evidence-backed themes. |
| AC-130-003 | The explicit user goal remains authoritative and every inferred goal is labeled recommendation-only. |
| AC-130-004 | Every blocking product/release-evidence path is covered or the proposal remains NEEDS_ACCEPTANCE. |
| AC-130-005 | Every selected command records exact `cwd`, side-effect class, isolation, determinism, and automatic-run policy. |
| AC-130-006 | Generated-artifact verification runs outside and leaves the source worktree unchanged. |
| AC-130-007 | Repeated package artifact mismatch becomes a failed acceptance result. |
| AC-130-008 | The bounded one-screen projection contains goal, recommendation label, scope, checks, themes, coverage, and state. |
| AC-130-009 | The real EvoHarvest pilot is read-only and proves mixed-stack, themes, coverage, and exact command policy. |
| AC-130-010 | OMP 18 nine-tool compatibility, security, license, docs, full regression, and release closure pass. |

### v1.3.1

| ID | Acceptance criterion |
|---|---|
| AC-131-001 | Full bootstrap apply succeeds in a disposable environment using real local npm packaging. |
| AC-131-002 | Temporary cleanup begins only after install, configuration, doctor, receipt, and backup completion. |
| AC-131-003 | The installed package reports v1.3.1 and OMP exposes exactly nine tools including `shipping_refine`. |
| AC-131-004 | The backup contains the previous package and explicit rollback restores the prior version and managed files. |
| AC-131-005 | Existing OMP install/rollback, field smoke, MCP, regression, security, license, and docs gates pass. |
| AC-131-006 | Shipping verification reaches SHIPPABLE with zero blockers and unknowns using fresh evidence. |
| AC-131-007 | The CLOSED receipt and annotated `v1.3.1` tag point to the closure commit with a clean worktree. |
| AC-131-008 | Actual user installation reports v1.3.1 while OMP remains 18.0.10 and protected hashes are unchanged. |
| AC-131-009 | Installed doctor, MCP tool inventory, receipt audit, and non-destructive EvoHarvest pilot pass. |

### v1.4.0

| ID | Acceptance criterion |
|---|---|
| AC-140-001 | All proposal and active-release states compile the four required beginner sections: problems, improvements, next plan, and summary. |
| AC-140-002 | Every brief item is bound to a mechanical code and evidence reference; model advisory text has no authority field. |
| AC-140-003 | Every state produces exactly one primary next action plus explicit allowed and forbidden actions. |
| AC-140-004 | Dirty-baseline output summarizes product, release-evidence, agent-runtime, and Shipping-runtime groups without flooding the default view with exact paths. |
| AC-140-005 | No-model, weak-model, and strong-model host fixtures produce an identical brief hash for identical Shipping authority input. |
| AC-140-006 | Host attempts to reinterpret dirty or blocked states, recommend destructive discard, or close early cannot change the compiled result. |
| AC-140-007 | Normal brief compilation performs no Git subprocess, network request, or model call and meets the local latency/size budget. |
| AC-140-008 | Deterministic quality checks detect contradiction, duplicate next action, missing evidence, unbounded output, and verification self-reference. |
| AC-140-009 | Rendering/quality failure returns raw authority fields and never changes canonical state or approval readiness. |
| AC-140-010 | MCP remains exactly nine tools with unchanged operational authority and input schemas. |
| AC-140-011 | OMP 18.0.10 renders the Shipping-generated beginner contract and passes doctor, protocol, and receipt checks. |
| AC-140-012 | The EvoHarvest field pilot emits the plain brief, one safe action, correct workspace/version/coverage, and zero target mutation, approval, or execution. |
| AC-140-013 | Full release, security, license, docs, plugin, OMO, remote, stable, and adversarial regressions pass. |
| AC-140-014 | v1.4.0 closes with fresh evidence, zero blockers/unknowns, annotated tag at the closure commit, clean source, and verified OMP installation. |

## Definition of Done

A release is done when its acceptance criteria pass, required checks succeed, release blockers are zero, non-blockers are moved to backlog, release documentation exists, and Git has a clean committed tag. A missing remote is documented and does not justify fabricating a push.
### v1.5.0

| ID | Acceptance criterion |
|---|---|
| AC-15001 | Clean, dirty, nested, and documentation fixtures compile deterministic one-to-five-release trains. |
| AC-15002 | Every version has strict semver order, measurable user value, entry/exit, rollback, and replan gates. |
| AC-15003 | The current release exactly matches proposal scope and acceptance; future versions have no current command authority. |
| AC-15004 | No-model, weak-host, strong-host, and hostile-host variants produce identical authority hashes. |
| AC-15005 | Test-only value, duplicate/backward versions, missing rollback/replan, stale binding, and model authority fail closed. |
| AC-15006 | Existing `shipping_start`, `shipping_refine`, and `shipping_status` expose one train without adding a tool. |
| AC-15007 | Approval atomically persists a train bound to proposal hash, contract hash, and baseline SHA. |
| AC-15008 | Korean `plainBriefText` includes a bounded `전체 개발계획` while details remain structured. |
| AC-15009 | No new model/network call, unbounded scan, raw command, Git mutation, push, deploy, or tenth MCP tool exists. |
| AC-15010 | Full regression, security, license, docs, OMP 18, and read-only EvoHarvest pilot pass. |
| AC-15011 | Shipping verification is SHIPPABLE with zero blockers/unknowns and fresh evidence. |
| AC-15012 | CLOSED receipt and annotated `v1.5.0` tag point to the closure commit with a clean worktree. |

### v1.6.0

| ID | Acceptance criterion |
|---|---|
| AC-16001 | Policy fixtures produce exactly one stable AUTO/NOTIFY/ASK/STOP decision for each action. |
| AC-16002 | Default policy permits safe read/verify and denies external, destructive, security, auth, license, cost, and unknown actions. |
| AC-16003 | Identical facts produce identical policy decision hashes independent of host-model text. |
| AC-16004 | Only the first incomplete train release can activate; predecessor bypass is impossible. |
| AC-16005 | Policy-authorized local baseline and commits are exact-path/head/hash bound and rollback-backed. |
| AC-16006 | Autopilot runs implementation work orders, verification, bounded blocker repair, and fresh re-verification without raw shell authority. |
| AC-16007 | Automatic CLOSED occurs only with value, acceptance, scope, evidence, rollback, policy, blocker, and unknown gates passing. |
| AC-16008 | Production/public/customer/cost/data/security/license effects produce ASK or STOP and never automatic RELEASED. |
| AC-16009 | Pause/abort, restart, duplicate invocation, stale receipts, and crash recovery are idempotent and fail closed. |
| AC-16010 | Replan triggers preserve completed releases and cannot rewrite active or closed history. |
| AC-16011 | Existing nine MCP tools, OMP 18, plain brief, security, remote, OMO, and stable-control tests pass. |
| AC-16012 | Shipping verification is SHIPPABLE with zero blockers/unknowns and fresh evidence. |
| AC-16013 | CLOSED receipt and annotated `v1.6.0` tag point to the closure commit with a clean worktree. |
