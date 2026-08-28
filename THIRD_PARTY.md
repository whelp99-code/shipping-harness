# Third-Party Integration Inventory

Shipping Harness v0.7 has no runtime package dependencies and vendors no third-party source. The separately pinned private OMO runtime is installed and verified outside Shipping Core under an internal-only license boundary; Shipping stores only interoperability code, exact pins, digests, notices, and evidence references.

| Project | Current use | Accepted future use | License and boundary |
|---|---|---|---|
| Model Context Protocol | Local agent tool protocol | Local plugin/MCP and later authenticated internal gateway | Original newline-delimited JSON-RPC implementation; no SDK source or runtime dependency |
| OpenAI Codex CLI | Coding-agent host | Direct/fallback execution runtime | PATH discovery and configured command; authentication and provider access remain environment facts |
| Gajae Code | `gjc` adapter and code-audit reference | Selected MIT Goal/Ledger/receipt mechanisms may be adapted into the v0.5 Shipping runtime | MIT; preserve notices for copied/adapted portions; full Gajae runtime remains optional behind the adapter |
| Q00 Ouroboros | `ooo`/`ouroboros` adapter and primary v0.4 decision reference | Selected decision provenance, safe-default, conflict, rollback, and stop mechanisms may be ported with attribution | MIT; the Python runtime is not required by Shipping Core; evolution remains explicit and outside current-release closure |
| OMO Native / Oh My OpenAgent | `omo` process/config/event bridge and code-audit reference | Actual source runs in v0.7 from a separately pinned private internal runtime with its own notices, modification log, tests, artifact digest, and rollback pin | Repository default Sustainable Use License permits the accepted personal/company-internal direction but constrains distribution; no public/customer bundle is planned |

## Internal OMO conditions

- personal and company-internal use only;
- private fork/runtime, not public package, image, SaaS, or customer installation;
- upstream notices remain intact;
- internal changes are recorded in `MODIFICATIONS.md`;
- exact upstream and internal patch commits are recorded;
- Shipping Core and OMO runtime are independently upgradeable and removable;
- OMO cannot mutate Shipping contracts, budgets, blocker policy, human stop, or release closure;
- any external-distribution requirement triggers a new direction and license review before work continues.

Names, protocol specifications, and documented interoperability concepts remain property of their respective projects. Integration does not imply endorsement, authentication, successful provider access, or full compatibility. See `docs/planning/10-INTERNAL-ONLY-UPSTREAM-RUNTIME-DIRECTION.md` for the accepted product boundary.

## Private internal OMO runtime boundary (v1.0)

Shipping Harness interoperates with a separately stored private OMO runtime pinned by `config/upstreams/omo-pin.json`. That runtime retains the upstream Sustainable Use License 1.0, notices and modification record. It is used only personally or inside the user's company and is not included in the public/portable Shipping Core package. Shipping Core communicates through a signed local JSON-STDIO protocol and never treats an OMO task receipt as release authority.
