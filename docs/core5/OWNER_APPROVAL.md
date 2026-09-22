# Core5 owner-approval queue

1. **H02 Docker + image digest** — done on this host. Docker 29.1.3, image pin in `/etc/environment`, `db-runner.mjs` rc=0.
2. **H03 authenticated review UI** — still missing a page with approval heading and reject/cancel controls. Mail `:3010` logs in but is not that surface. Do not retarget H03 at `:4173`.
3. **K04 real test accounts** — still missing an allowed mailbox + CRM workspace + human reviewer. Host sudo/Basic access is not a Graph/CRM account.
4. **Merge / production activate** — feature branches merge separately. `--activate` stays blocked while `core5 decision` is `NOT_SHIPPABLE`.
