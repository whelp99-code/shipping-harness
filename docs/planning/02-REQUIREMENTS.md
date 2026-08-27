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

## Definition of Done

A release is done when its acceptance criteria pass, required checks succeed, release blockers are zero, non-blockers are moved to backlog, release documentation exists, and Git has a clean committed tag. A missing remote is documented and does not justify fabricating a push.