# Third-Party Integration Inventory

Shipping Harness has no runtime package dependencies and vendors no third-party source code.

| Project | Use | Integration boundary | Live status in this development environment |
|---|---|---|---|
| OpenAI Codex CLI | Coding-agent host | PATH discovery, safe version/help probe, configurable command | Installed; non-mutating probe required before v0.2.0 release |
| Gajae Code | External coding-agent harness | `gjc` executable/controller-compatible JSON and repository artifacts | Not installed at intake; fixture verification required |
| Q00 Ouroboros | Agent OS/runtime | `ooo`/`ouroboros` executable and configured Seed/Ledger artifacts | Not installed at intake; fixture verification required |
| OMO Native / Oh My OpenAgent | Agent harness | `omo` executable, project `.omo` config, normalized event bridge | Not installed at intake; fixture verification required |

Names and documented interoperability concepts remain property of their respective projects. Shipping Harness adapters are independently implemented and do not imply endorsement or full native-plugin compatibility.