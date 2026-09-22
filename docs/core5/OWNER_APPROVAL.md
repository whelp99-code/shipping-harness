# Core5 owner-approval queue

1. **H02 Docker + image digest** — done on this host. Docker 29.1.3, image pin in `/etc/environment`, `db-runner.mjs` rc=0.
2. **H03 authenticated review UI** — done: `ci/core5/h03/review-server.mjs` on loopback `:4174`, Playwright 2 passed. Not `:4173`.
3. **K04 real test accounts** — still missing an allowed mailbox + CRM workspace + human reviewer. Host sudo/Basic access is not a Graph/CRM account. Blocks H06 SHIPPABLE, K04 live journey, and K05 observation.
4. **Merge / production activate** — Core5 branches merged. `--activate` stays blocked while `core5 decision` is `NOT_SHIPPABLE` (K04).
