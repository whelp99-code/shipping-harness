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

## Definition of Done

A release is done when its acceptance criteria pass, required checks succeed, release blockers are zero, non-blockers are moved to backlog, release documentation exists, and Git has a clean committed tag. A missing remote is documented and does not justify fabricating a push.