# OMP Main Harness — Install, Doctor, and Rollback

**Release:** Shipping Harness v1.4.0
**Boundary:** personal and company-internal use only
**Primary tested host:** OMP 18.0.10 through the existing `omo-balance` launcher and standalone `omp-core`
**Compatibility host:** source-linked OMP 15.10.12

## What the installer changes

`shipping-harness-omp` manages only:

- the user-global Shipping Harness package under `~/.local`;
- the `shipping-harness` entry in `~/.omp/agent/mcp.json`;
- Shipping-specific keys in `tools.approval` and `tools.approvalMode`;
- one delimited Shipping block in `~/.omp/agent/AGENTS.md`;
- `~/.omp/agent/skills/shipping-harness/SKILL.md`;
- `~/.omp/agent/shipping-harness-install.json`.

It does **not** replace or update OMP, `omp-core`, the `omo-balance` router, provider credentials, model roles, other MCP servers, or target-project source.

## Install from the closed tag

Run as the ordinary Ubuntu user, not root:

```bash
cd /home/jm/orca/projects/shipping-harness

# Read-only preview
shipping-harness-omp bootstrap --tag v1.4.0

# Back up, install, merge, and verify
shipping-harness-omp bootstrap --tag v1.4.0 --apply

# Independent post-install check
shipping-harness-omp doctor
```

The applied bootstrap requires:

- a clean checkout;
- an annotated tag matching `HEAD`;
- a package version matching the tag;
- temporary package cleanup only after install, configuration, doctor, receipt, and backup operations settle;
- an OMP version in the tested matrix;
- `omp --smoke-test` success;
- MCP `2025-03-26` initialization;
- exactly nine Shipping tools, including `shipping_refine`;
- a healthy approval map, AGENTS block, Skill, and install receipt.

It creates the package locally with npm, installs it with `--offline --global --prefix ~/.local`, and never publishes it.

## Expected result

```text
DONE
Shipping Harness: 1.4.0
OMP: omp/18.0.10
MCP tools: 9 PASS
Approval: always-ask
Main harness: enabled
Receipt: /home/jm/.omp/agent/shipping-harness-install.json
Backup: /home/jm/.omp/backups/shipping-harness-<timestamp>
Rollback: /home/jm/.local/bin/shipping-harness-omp rollback --backup-id <id> --apply
```

## v1.3.1 bootstrap ordering

The bootstrap package lives in a private temporary directory only for the duration of the complete awaited install. Cleanup begins after package installation, OMP configuration merge, pre-receipt doctor, receipt creation, post-receipt doctor, and backup metadata completion.

The end-to-end regression uses real local npm packaging, a disposable user prefix and OMP agent directory, a fake OMP 18.0.10 host, and explicit rollback. It verifies no new `shipping-omp-bootstrap-*` directory remains afterward.

## v1.4.0 beginner presentation

The managed AGENTS block and installed Shipping Skill require OMP to show the Shipping-generated `plainBriefText` first and unchanged. The fixed order is `현재 상태`, `문제점`, `개선안`, `다음 진행 플랜`, `요약`, and `지금 할 일`. Optional model commentary must be placed under `AI 참고 의견` and has no authority over state, approval, acceptance, blockers, pause/abort, SHIPPABLE, or CLOSED. Doctor verifies the exact packaged Skill and managed block; it does not modify OMP binaries, router, providers, credentials, or model routing.

## Approval policy

Read/plan operations:

```text
shipping_start          allow
shipping_status         allow
shipping_verify         allow
```

User-confirmed operations:

```text
shipping_refine         prompt
shipping_approve_scope  prompt
shipping_execute        prompt
shipping_fix_blockers   prompt
shipping_pause          prompt
shipping_close          prompt
```

`always-ask` remains the global approval mode. Existing non-Shipping approval entries are preserved.

## Doctor

```bash
shipping-harness-omp doctor --json
```

Doctor fails unless all of the following are true:

- installed Shipping version equals the current package version;
- `shipping-harness-mcp` and `shipping-harness-omp` are executable;
- the actual OMP wrapper reports a tested version and passes its worker smoke;
- the Shipping MCP entry points to the installed binary;
- all nine approval policies match;
- the AGENTS block occurs exactly once;
- the installed Skill matches the package;
- a disposable Git project negotiates MCP and exposes exactly nine tools;
- the install receipt records the same Shipping and OMP versions.

## Field smoke

```bash
shipping-harness-omp field-smoke --project /home/jm/orca/projects/EvoHarvest --check --json
```

The field smoke does not approve or edit the supplied project. It:

1. reads bounded Git metadata;
2. verifies that the nested runtime is detected;
3. verifies the recommended patch version and authority-bearing command/`cwd` pairs;
4. uses a disposable tied-workspace fixture for `shipping_start → shipping_refine`;
5. requires one proposal identity, revision 2, and `AWAITING_APPROVAL`;
6. records that target source was not changed.

A dirty target remains dirty and is reported truthfully. The field smoke does not commit, stash, reset, or discard it.

For v1.3.0, the source release additionally runs `scripts/evoharvest-intelligence-pilot.mjs --check`. It proves the mixed Python/Node/Playwright/Alembic/Shell graph, bounded authentication and packaging themes, complete changed-path coverage, package isolation metadata, and an unchanged target fingerprint.

## Rollback

Read the backup ID from the install receipt:

```bash
node -e '
const r=require(process.env.HOME+"/.omp/agent/shipping-harness-install.json");
console.log(r.backup.id);
'
```

Preview and apply:

```bash
shipping-harness-omp rollback --backup-id <backup-id>
shipping-harness-omp rollback --backup-id <backup-id> --apply
```

Rollback verifies every backed-up file digest, restores the previous Shipping package, and restores the five managed OMP files exactly. A tampered backup fails closed.

## Recovery after a failed installation

Installation is transactional at the operational level:

1. the old package and managed OMP files are backed up first;
2. the new package and configuration are applied;
3. doctor runs before and after the new receipt is written;
4. any failure triggers automatic restoration;
5. the command reports `ERR_OMP_INSTALL_ROLLED_BACK` only after restoration succeeds.

Never delete `.shipping`, `~/.omp`, or the backup directory to resolve an installation problem.
