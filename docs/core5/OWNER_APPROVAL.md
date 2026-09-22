# Core5 owner-approval queue

Product-fixable checkpoints are local-only. These items cannot be closed without the owner.

1. **H02 Docker + image digest** — install Docker on this Linux host, then set `CORE5_POSTGRES_IMAGE=postgres@sha256:<64 hex>` from a pinned official image. Until then `ci/core5/db-runner.mjs` is fail-closed.
2. **H03 authenticated review UI** — provide a loopback URL with visible approval/reject/cancel controls and a logged-in session. `:4173` is the JARVIS dashboard (no those headings). Mail `:3010` returns 401. `:4176` rejects as phone-host forbidden.
3. **K04 real test accounts** — allowed mailbox + CRM workspace + human reviewer for the live mail→work→draft→approve→send-status journey. Synthetic fixtures must not count.
4. **Push / merge / production activate** — standing exclusion. Not done.

K05 (7–14 day observation, ≥20 real jobs) and H06 SHIPPABLE/install digest contrast stay blocked until 1–3 pass. `core5 decision` will keep `NOT_SHIPPABLE` until those env/probes flip.
