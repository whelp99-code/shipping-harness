# Third-Party Integration Inventory

Shipping Harness v1.0.0 has no required third-party runtime package dependencies and vendors no third-party source. The separately pinned private OMO runtime is installed and verified outside Shipping Core under an internal-only license boundary; Shipping stores only interoperability code, exact pins, digests, notices, and evidence references.

| Project | Current use | Accepted future use | License and boundary |
|---|---|---|---|
| Model Context Protocol | Local agent tool protocol | Local plugin/MCP and authenticated internal gateway control | Original newline-delimited JSON-RPC implementation; no SDK source or runtime dependency |
| OpenAI Codex CLI | Coding-agent host | Direct/fallback execution runtime | PATH discovery and configured command; authentication and provider access remain environment facts |
| Gajae Code | `gjc` adapter and code-audit reference | Selected MIT Goal/Ledger/receipt mechanisms may be adapted into the Shipping runtime | MIT; preserve notices for copied/adapted portions; full Gajae runtime remains optional behind the adapter |
| Q00 Ouroboros | `ooo`/`ouroboros` adapter and decision reference | Selected decision provenance, safe-default, conflict, rollback, and stop mechanisms may be ported with attribution | MIT; the Python runtime is not required by Shipping Core; evolution remains explicit and outside current-release closure |
| OMO Native / Oh My OpenAgent | `omo` process/config/event bridge and code-audit reference | Actual source runs from a separately pinned private internal runtime with its own notices, modification log, tests, artifact digest, and rollback pin | Repository default Sustainable Use License permits the accepted personal/company-internal direction but constrains distribution; no public/customer bundle is planned |
| Node.js HTTPS and crypto | TLS-only internal remote transport, HMAC request/receipt signing, and bounded local filesystem state | Stable v1 internal control-plane transport | Node.js standard library; no hosted service or runtime package dependency |
| OpenSSL executable | Disposable smoke-test certificate generation only | None required for production certificate issuance | Locally installed executable; not bundled, vendored, downloaded, or invoked by the production gateway |

## Internal OMO conditions

- personal and company-internal use only;
- private fork/runtime, not public package, image, SaaS, or customer installation;
- upstream notices remain intact;
- internal changes are recorded in `MODIFICATIONS.md`;
- exact upstream and internal patch commits are recorded;
- Shipping Core and OMO runtime are independently upgradeable and removable;
- OMO cannot mutate Shipping contracts, budgets, blocker policy, human stop, or release closure;
- any external-distribution requirement triggers a new direction and license review before work continues.

## v1 internal remote conditions

- loopback or private-network TLS listener only;
- standard-library HTTPS and cryptography only;
- environment-backed signing material, never repository values;
- explicit actor, project, and action allowlists;
- no arbitrary shell, raw command, environment, deployment, push, customer, or public-tenant surface;
- disposable OpenSSL usage is limited to local verification and creates no production dependency.

Names, protocol specifications, and documented interoperability concepts remain property of their respective projects. Integration does not imply endorsement, authentication, successful provider access, or full compatibility. See the project planning documents for the accepted product boundary.

## v1 stable-control conditions

- Stable schema documents and examples are original Shipping Harness artifacts.
- Package reports and operational evidence are excluded from the installable tarball.
- Compatibility reporting distinguishes discovery from proven operational health.
- Migrations preserve CLOSED, human-stop, contract, Git, and runtime-verification authority.
- Benchmark results cover governance correctness only and make no model-quality or cost-superiority claim.
- The project remains private and internal and is never published automatically.
