# Install, Upgrade, and Rollback Runbook

## Clean internal install

Requirements: Node.js 22+, Git 2.30+, and `~/.local/bin` on `PATH`.

1. Build or obtain the locally verified `shipping-harness-1.0.0.tgz` from the tagged internal repository.
2. Install without lifecycle scripts:

   ```bash
   npm install --prefix "$HOME/.local" /absolute/path/shipping-harness-1.0.0.tgz --ignore-scripts --no-audit --no-fund
   ```

3. Confirm:

   ```bash
   shipping-harness version
   shipping-harness-mcp --help
   shipping-harness-plugin --help
   ```

4. Register a project-root-fixed MCP entry through the selected host or plugin installer.
5. Run plugin doctor and one disposable repository smoke before using production work.

## Upgrade

1. Pause active releases and record the installed version.
2. Back up every governed repository's `.shipping` state and the private OMO pin evidence.
3. Keep the previous package tarball and plugin backup ID.
4. Install the new local tarball over the same prefix.
5. Run:

   ```bash
   shipping-harness version
   shipping-harness-plugin upgrade --install-root <root> --host <host> --project-root <repo> --apply --json
   shipping-harness-plugin doctor --install-root <root> --project-root <repo> --json
   ```

6. Verify MCP discovery, tool list, and read-only status.
7. Verify the private OMO doctor/canary when configured and the remote gateway health when enabled.
8. Resume only after state, contract hash, human stop, and closed receipts are unchanged.

## Rollback

1. Stop the new MCP/remote processes.
2. Use the plugin rollback command with the recorded backup ID.
3. Reinstall the previous local package tarball.
4. Restore repository state only from a verified signed backup when state migration occurred.
5. Restore the previous private OMO tag/commit independently when required.
6. Run doctor, MCP discovery, release status, and evidence freshness checks.
7. Record the rollback and reason in the stable event log.

## Failure rules

- Never upgrade or restore over `RUNNING`, `VERIFYING`, or `FIXING` work.
- Never delete `.shipping` to solve an installation problem.
- Never modify a closed receipt or tag to make an upgrade appear successful.
- Never download or publish OMO runtime code through the Shipping package.
- A failed drill becomes `BLOCKED`; it is not retried without a changed cause or approved recovery.
