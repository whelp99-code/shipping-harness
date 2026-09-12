import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashObject } from '../../src/core/crypto.mjs';
import { buildDecisionEvidence } from '../../src/core/decision-evidence.mjs';
import { composeDefaultDecision, validateDecisionPackage } from '../../src/core/decision-package.mjs';
import { currentGitSha, runGit } from '../../src/core/git.mjs';
import { createScopeProposal, refineScopeProposal } from '../../src/core/proposals.mjs';

async function put(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function mixedRepo({ packageOnly = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-intelligence-'));
  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.name', 'Shipping Intelligence Test']);
  runGit(root, ['config', 'user.email', 'shipping-intelligence@example.invalid']);
  await put(root, 'README.md', '# Wrapper repository\n');
  await put(root, '.gitignore', '.shipping/evidence/\n.shipping/tmp/\n.release/\n');
  await put(root, 'runtime-v1.1.0/pyproject.toml', packageOnly
    ? '[project]\nname = "runtime"\nversion = "1.1.0"\n'
    : '[project]\nname = "runtime"\nversion = "1.1.0"\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
  await put(root, 'runtime-v1.1.0/RELEASE_MANIFEST.json', `${JSON.stringify({ version: '1.1.0', validated: false }, null, 2)}\n`);
  await put(root, 'runtime-v1.1.0/SHA256SUMS.txt', 'baseline  package.tar\n');
  await put(root, 'runtime-v1.1.0/README.md', '# Runtime\n');
  await put(root, 'runtime-v1.1.0/src/main.py', 'def run():\n    return "ok"\n');
  if (!packageOnly) {
    await put(root, 'runtime-v1.1.0/tests/test_runtime.py', 'def test_runtime():\n    assert True\n');
    await put(root, 'runtime-v1.1.0/tests/test_config.py', 'def test_config():\n    assert True\n');
  }
  await put(root, 'runtime-v1.1.0/apps/web/package.json', `${JSON.stringify({ name: '@runtime/web', version: '1.1.0', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2)}\n`);
  await put(root, 'runtime-v1.1.0/apps/web/playwright.config.ts', 'export default { testDir: "./tests" };\n');
  await put(root, 'runtime-v1.1.0/apps/web/tests/auth.spec.ts', 'export const authScenario = "baseline";\n');
  await put(root, 'runtime-v1.1.0/alembic/env.py', '# alembic baseline\n');
  await put(root, 'runtime-v1.1.0/scripts/verify-web-auth.sh', '#!/usr/bin/env sh\nexit 0\n');
  await put(root, 'runtime-v1.1.0/scripts/package_release.py', 'from pathlib import Path\nPath(".release").mkdir(exist_ok=True)\nPath(".release/package.txt").write_text("stable\\n")\n');
  const makefile = packageOnly
    ? 'package:\n\t@python scripts/package_release.py\n'
    : 'verify:\n\t@printf "verify-pass\\n"\npackage:\n\t@python scripts/package_release.py\n';
  await put(root, 'runtime-v1.1.0/Makefile', makefile);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'fixture baseline']);
  return {
    root,
    async dirtyMixedWork() {
      await put(root, 'runtime-v1.1.0/apps/web/tests/auth.spec.ts', 'export const authScenario = "hardened";\n');
      await put(root, 'runtime-v1.1.0/apps/web/playwright.config.ts', 'export default { testDir: "./tests", retries: 1 };\n');
      await put(root, 'runtime-v1.1.0/scripts/verify-web-auth.sh', '#!/usr/bin/env sh\nprintf "auth-pass\\n"\n');
      await put(root, 'runtime-v1.1.0/scripts/package_release.py', 'from pathlib import Path\nPath(".release").mkdir(exist_ok=True)\nPath(".release/package.txt").write_text("stable-v2\\n")\n');
      await put(root, 'runtime-v1.1.0/RELEASE_MANIFEST.json', `${JSON.stringify({ version: '1.1.0', validated: true }, null, 2)}\n`);
      await put(root, 'runtime-v1.1.0/SHA256SUMS.txt', 'updated  package.tar\n');
      await put(root, 'runtime-v1.1.0/tests/test_config.py', 'def test_config():\n    assert "auth" != "disabled"\n');
    },
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

test('mixed-stack intelligence selects the runtime, explains current work, and covers changed paths', async () => {
  const fixture = await mixedRepo();
  try {
    await fixture.dirtyMixedWork();
    const explicitGoal = 'Finish the smallest operable patch without adding new product features';
    const evidence = await buildDecisionEvidence(fixture.root, { goal: explicitGoal });
    const { analysis, intelligence, baseline } = evidence;

    assert.equal(analysis.workspace.root, 'runtime-v1.1.0');
    assert.equal(intelligence.explicitGoal, explicitGoal);
    assert.equal(intelligence.componentGraph.primaryStack, 'python');
    for (const stack of ['node', 'playwright', 'alembic', 'shell']) {
      assert.ok(intelligence.componentGraph.supportingStacks.includes(stack), `missing supporting stack ${stack}`);
    }
    assert.ok(intelligence.componentGraph.components.some((entry) => entry.root === 'runtime-v1.1.0/apps/web'));
    assert.ok(intelligence.componentGraph.components.some((entry) => entry.role === 'database-migrations'));
    assert.ok(intelligence.workThemes.length > 0 && intelligence.workThemes.length <= 3);
    const themeText = intelligence.workThemes.map((entry) => entry.title).join(' ').toLowerCase();
    assert.match(themeText, /authentication/u);
    assert.match(themeText, /packaging|release/u);
    assert.equal(intelligence.goalRecommendation.authority, 'recommendation-only');
    assert.equal(intelligence.goalRecommendation.explicitUserGoalWins, true);
    assert.equal(intelligence.acceptanceCoverage.complete, true);
    assert.equal(intelligence.acceptanceCoverage.totalPaths, baseline.blockingPaths.length);
    assert.deepEqual(intelligence.acceptanceCoverage.uncoveredPaths, []);

    const verify = intelligence.acceptanceCommands.find((entry) => entry.command === 'make verify');
    const pack = intelligence.acceptanceCommands.find((entry) => entry.command === 'make package');
    assert.equal(verify.cwd, 'runtime-v1.1.0');
    assert.equal(verify.aggregate, true);
    assert.equal(pack.cwd, 'runtime-v1.1.0');
    assert.deepEqual(
      {
        sideEffect: pack.sideEffect,
        isolationRequired: pack.isolationRequired,
        deterministicOutputRequired: pack.deterministicOutputRequired,
        automaticallyRunnable: pack.automaticallyRunnable,
      },
      {
        sideEffect: 'generated-artifacts',
        isolationRequired: true,
        deterministicOutputRequired: true,
        automaticallyRunnable: true,
      },
    );

    const { proposal } = await createScopeProposal(fixture.root, { goal: explicitGoal });
    assert.equal(proposal.goal, explicitGoal);
    assert.equal(proposal.canonicalState, 'DIRTY_BASELINE');
    assert.equal(proposal.oneScreenApproval.goal, explicitGoal);
    assert.equal(proposal.oneScreenApproval.recommendationIsAuthority, false);
    assert.ok(proposal.oneScreenApproval.boundedBytes < 8192);
    assert.ok(proposal.oneScreenApproval.checks.some((entry) => entry.command === 'make verify' && entry.cwd === 'runtime-v1.1.0'));
    assert.ok(proposal.oneScreenApproval.checks.some((entry) => entry.command === 'make package' && entry.isolated === true));
  } finally {
    await fixture.cleanup();
  }
});

test('uncovered dirty product work remains NEEDS_ACCEPTANCE after an exact baseline preservation commit', async () => {
  const fixture = await mixedRepo({ packageOnly: true });
  try {
    await put(fixture.root, 'runtime-v1.1.0/src/main.py', 'def run():\n    return "changed"\n');
    const goal = 'Package the existing runtime without changing its product behavior';
    const { proposal } = await createScopeProposal(fixture.root, { goal });
    assert.equal(proposal.canonicalState, 'DIRTY_BASELINE');
    assert.equal(proposal.acceptanceStrength.level, 'UNCOVERED');
    assert.equal(proposal.intelligence.acceptanceCoverage.complete, false);
    assert.ok(proposal.intelligence.acceptanceCoverage.uncoveredPaths.includes('runtime-v1.1.0/src/main.py'));

    const plan = proposal.baseline.plan;
    runGit(fixture.root, ['add', '--', ...plan.includePaths]);
    runGit(fixture.root, ['commit', '-m', plan.suggestedCommitMessage]);
    const commit = currentGitSha(fixture.root);
    const refined = await refineScopeProposal(fixture.root, {
      proposalId: proposal.id,
      proposalHash: proposal.hash,
      rescan: true,
      baselinePlanHash: plan.hash,
      baselineCommit: commit,
      baselineAuthorizedByUser: true,
    });
    assert.equal(refined.changed, true);
    assert.equal(refined.proposal.id, proposal.id);
    assert.equal(refined.proposal.canonicalState, 'NEEDS_ACCEPTANCE');
    assert.equal(refined.proposal.acceptanceStrength.level, 'UNCOVERED');
    assert.ok(refined.proposal.intelligence.acceptanceCoverage.uncoveredPaths.includes('runtime-v1.1.0/src/main.py'));
    assert.equal(refined.proposal.oneScreenApproval.readyForApproval, false);
    const { hash: evidenceHash, ...evidenceBody } = refined.proposal.evidence;
    assert.equal(hashObject(evidenceBody), evidenceHash);
    assert.equal(refined.proposal.decision.evidenceHash, evidenceHash);
  } finally {
    await fixture.cleanup();
  }
});

test('decision validation rejects any attempt to downgrade mechanical package isolation', async () => {
  const fixture = await mixedRepo();
  try {
    const goal = 'Verify the existing runtime package without deployment';
    const evidence = await buildDecisionEvidence(fixture.root, { goal });
    const decision = composeDefaultDecision(evidence, {
      release: evidence.analysis.versionEvidence.recommendedVersion,
      projectName: evidence.analysis.projectName,
    });
    const packageCriterion = decision.acceptance.find((entry) => entry.command === 'make package');
    assert.ok(packageCriterion);
    packageCriterion.isolationRequired = false;
    packageCriterion.deterministicOutputRequired = false;
    await assert.rejects(
      async () => validateDecisionPackage(evidence, decision),
      (error) => error.code === 'ERR_DECISION_ISOLATION',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('project-intelligence hash changes when authority-bearing coverage changes, not when key order changes', async () => {
  const fixture = await mixedRepo();
  try {
    await fixture.dirtyMixedWork();
    const evidence = await buildDecisionEvidence(fixture.root, { goal: 'Finish a bounded patch release' });
    const clone = JSON.parse(JSON.stringify(evidence.intelligence));
    const originalHash = clone.hash;
    delete clone.hash;
    assert.equal(hashObject(clone), originalHash);
    clone.acceptanceCoverage.uncoveredPaths.push('runtime-v1.1.0/src/uncovered.py');
    clone.acceptanceCoverage.complete = false;
    assert.notEqual(hashObject(clone), originalHash);
  } finally {
    await fixture.cleanup();
  }
});
