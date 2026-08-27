# Third-Party Integration Inventory

Shipping Harness has no runtime package dependencies and vendors no third-party source code.

| Project | Use | Integration boundary | Live status in this development environment |
|---|---|---|---|
| OpenAI Codex CLI | Coding-agent host | PATH discovery, safe version/help probe, configurable command | Live non-mutating probe passes in the release environment; authentication remains unknown |
| Gajae Code | External coding-agent harness | `gjc` executable plus repository-local Goal/Ledger metadata receipts | Fixture-verified; local runtime status remains evidence-dependent |
| Q00 Ouroboros | Agent OS/runtime | `ooo`/`ouroboros` executable plus configured Seed/Ledger metadata receipts | Fixture-verified; evolution remains explicit-only |
| OMO Native / Oh My OpenAgent | Agent harness | `omo` executable, project `.omo` config, normalized lifecycle bridge | Fixture-verified process/config/event bridge; no native-plugin claim |

Names and documented interoperability concepts remain property of their respective projects. Shipping Harness adapters are independently implemented, store no copied external source, and do not imply endorsement, authentication, successful provider access, or full native-plugin compatibility.