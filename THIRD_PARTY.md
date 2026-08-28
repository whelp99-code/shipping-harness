# Third-Party Integration Inventory

Shipping Harness has no runtime package dependencies and vendors no third-party source code.

| Project | Use | Integration boundary | Live status in this development environment |
|---|---|---|---|
| Model Context Protocol | Local agent tool protocol | Original newline-delimited JSON-RPC STDIO implementation; no SDK source or runtime package dependency | Protocol and transport fixtures verify 2026-07-28 plus legacy 2025-11-25 initialization |
| OpenAI Codex CLI | Coding-agent host | PATH discovery, safe version/help probe, configurable command | Live non-mutating probe passes in the release environment; authentication remains unknown |
| Gajae Code | External coding-agent harness and design reference | `gjc` adapter plus clean-room study of interview, ralplan, Goal/Ledger, evidence freshness, and bounded termination | Official source locally audited at the pin in `docs/research/upstream-code-audit/UPSTREAM-PINS.json`; MIT; source not vendored |
| Q00 Ouroboros | Agent OS/runtime and primary v0.4 decision reference | `ooo`/`ouroboros` adapter plus clean-room study of Seed, decision provenance, safe defaults, conflict handling, convergence, and watchdog behavior | Official source locally audited at the recorded pin; MIT; source not vendored; evolution remains explicit-only |
| OMO Native / Oh My OpenAgent | Agent harness and later orchestration reference | `omo` adapter plus clean-room study of Senpi continuation, task state, role/model routing, concurrency, and recovery | Official source locally audited at the recorded pin; repository default Sustainable Use License limits redistribution; no source copied and no native-plugin claim |

Names, protocol specifications, and documented interoperability concepts remain property of their respective projects. Shipping Harness MCP, adapters, and future absorbed mechanisms are independently implemented, store no copied external source, and do not imply endorsement, authentication, successful provider access, or full native-plugin compatibility. Any future direct dependency or code reuse requires a separate license review.