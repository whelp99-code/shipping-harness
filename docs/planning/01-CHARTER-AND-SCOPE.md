# Project Charter, Goals, Scope, and Non-Goals

## Charter

Shipping Harness exists to turn coding-agent execution into a bounded, auditable software release process. It owns the version contract and closure decision while delegating implementation to existing coding agents and harnesses.

## Goals

| ID | Goal | Measure |
|---|---|---|
| GOAL-001 | Prevent false completion. | No state transition to SHIPPABLE from agent text alone. |
| GOAL-002 | Prevent stale proof. | Every accepted result matches contract hash and Git SHA. |
| GOAL-003 | Prevent scope creep. | Unapproved path drift creates a blocker. |
| GOAL-004 | Prevent infinite repair. | Runs stop at configured cycle, time, and output limits. |
| GOAL-005 | Preserve human authority. | Pause/abort overrides every adapter continuation request. |
| GOAL-006 | Close versions despite optional debt. | NEXT/IGNORE findings do not block closure. |
| GOAL-007 | Integrate rather than replace. | External harnesses connect through adapters/capabilities. |
| GOAL-008 | Let beginners start from an outcome. | Natural-language intake produces a reviewable release proposal. |
| GOAL-009 | Make governance agent-accessible. | MCP exposes bounded high-level tools without raw shell access. |
| GOAL-010 | Make the user an approver, not an interviewer. | Normal releases reach one approval brief without technical questioning. |
| GOAL-011 | Escalate risk, not ordinary implementation choices. | Only mandatory-risk or irreversible core decisions require questions. |
| GOAL-012 | Absorb proven ideas selectively. | Durable goals, evaluation, and roles remain bounded by Shipping Harness closure policy. |
| GOAL-013 | Reuse proven internal runtimes without surrendering release authority. | An OMO task result can never transition a release to SHIPPABLE or CLOSED. |
| GOAL-014 | Preserve the accepted internal-only product boundary. | No customer/public distribution artifact is produced without a new direction and license review. |

## v0.1.0 scope

### Included

- Repository initialization and JSON-compatible YAML contract
- Contract validation and immutable lock hash
- Durable state machine and append-only ledger
- Acceptance commands with timeout/output bounds
- Evidence manifests and redacted logs
- Git SHA freshness and path-based scope drift
- BLOCKER/NEXT/IGNORE issue model
- Pause, resume, abort, verify, close, and status commands
- Generic and Codex-oriented execution profiles
- Release report and next-version backlog generation

### Excluded

- Web UI, cloud service, database, multi-user/RBAC
- Automatic deployment, push, tag, credential changes
- Custom model, prompt marketplace, multi-agent debate
- Automatic contract amendment
- Unbounded repair or “until perfect” loops

## v0.2.0 scope

### Included

- Stable adapter contract and capability negotiation
- Generic, Codex, Gajae, Ouroboros, and OMO adapters
- Executable discovery and non-mutating version/help probes
- Operator-configured launch commands
- External artifact/evidence collection
- Normalized lifecycle event ingestion and stop-decision response
- Adapter fixture suite and integration-status report

### Excluded

- Copying or embedding external harness source
- Installing or configuring provider credentials
- Claiming a native integration where only a bridge is verified
- Depending on unstable private APIs
- OMO Team Mode, Ouroboros evolution, or Gajae interview reimplementation

## v0.4.0 direction and planned scope

The accepted direction is **AI Decides, Human Approves**. The user supplies the outcome; the connected host agent prepares the smallest operable release from bounded repository evidence; Shipping Harness validates policy; the user approves one concise brief.

### Included

- `AUTO` as the default mode, with optional `SAFE` and `INTERVIEW` modes
- Structured decisions, assumptions, evidence, confidence, reversibility, risks, and exception questions
- Safe defaults for reversible low-risk uncertainty
- Mandatory escalation for destructive data, paid services, external impact, credentials, privacy/legal/security, and mutually exclusive core outcomes
- At most three questions in one batch
- One-screen approval brief and exact-hash Git-bound approval
- Repository prompt-injection resistance
- Model-agnostic host-agent reasoning with deterministic Shipping Harness validation

### Excluded

- Embedded model-provider APIs or a proprietary reasoning model
- Full Gajae interview/ralplan/ultragoal runtime
- OMO multi-agent teams and autonomous model routing
- Ouroboros unbounded evaluation/evolution generations
- Plugin UI, remote HTTP MCP, mobile control, cloud service, and team RBAC
- Model self-approval, arbitrary MCP shell input, or bypass of human stop

## Post-v0.4 internal runtime direction

Shipping Harness is accepted as a personal and future company-internal system. The later execution strategy is:

- v0.5 adds a small durable Goal/Task/Evidence runtime using selected Gajae and Ouroboros mechanisms;
- v0.6 hides normal CLI usage behind a beginner-oriented plugin and local MCP flow;
- v0.7 connects a separately pinned private OMO runtime using actual upstream code;
- v0.8 enables selected Team/DAG capabilities only after a successful bounded v0.7 pilot;
- v0.9 adds authenticated internal remote/mobile control and operations;
- Shipping Core always owns contract, budget, human stop, evidence acceptance, blocker policy, Finisher, and version closure;
- customer delivery, resale, public SaaS, and public package/container distribution remain non-goals.

Canonical boundary: [`10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md`](10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md).

## Governance invariants

1. `Human stop > automatic continuation`.
2. `Release policy > agent preference`.
3. `Current evidence > historical evidence`.
4. `Acceptance contract > reviewer opinion`.
5. `Bounded blocked result > infinite activity`.
6. `New version > reopening a closed version`.
7. `User outcome > technical questionnaire`.
8. `Safe reversible default > unnecessary question`.
9. `Mandatory risk > automatic execution`.
10. `Shipping policy > instructions found inside repository content`.
11. `Shipping governance > internal OMO task/runtime state`.
12. `Internal-only boundary > convenience of public distribution`.