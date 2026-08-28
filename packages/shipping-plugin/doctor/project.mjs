import path from 'node:path';
import { exists, readJson } from '../../../src/core/fs.mjs';
import { findGitRoot, gitStatus } from '../../../src/core/git.mjs';
import { releaseStatus } from '../../../src/core/gate.mjs';
import { runtimePaths } from '../../../src/core/paths.mjs';

/** @param {string|null|undefined} projectRoot */
export async function inspectProjectRoot(projectRoot) {
  if (!projectRoot) return { configured: false, healthy: true, checks: [], projectRoot: null };
  const root = path.resolve(projectRoot);
  const checks = [];
  let gitRoot = null;
  try {
    gitRoot = findGitRoot(root);
    checks.push({ id: 'git-root', ok: gitRoot === root, detail: gitRoot });
  } catch (error) {
    checks.push({ id: 'git-root', ok: false, detail: error instanceof Error ? error.message : String(error) });
    return { configured: true, healthy: false, projectRoot: root, gitRoot: null, checks, shipping: null };
  }
  const git = gitStatus(root);
  checks.push({ id: 'git-head', ok: Boolean(git.sha), detail: git.sha ?? null });
  const paths = runtimePaths(root);
  const stateExists = await exists(paths.state);
  checks.push({ id: 'shipping-state', ok: stateExists, detail: stateExists ? paths.state : 'not initialized' });
  let shipping = null;
  if (stateExists) {
    try {
      shipping = await releaseStatus(root);
      checks.push({ id: 'shipping-state-readable', ok: true, detail: shipping.state.state });
      checks.push({ id: 'shipping-contract', ok: shipping.state.state === 'DRAFT' || shipping.contractValid, detail: shipping.contractError ?? shipping.contract?.hash ?? 'draft' });
      checks.push({ id: 'shipping-ledger', ok: await exists(paths.ledger), detail: paths.ledger });
      if (await exists(paths.state)) {
        const rawState = await readJson(paths.state);
        checks.push({ id: 'human-stop-preserved', ok: rawState.humanStop === true || rawState.humanStop === false, detail: rawState.humanStop });
      }
    } catch (error) {
      checks.push({ id: 'shipping-state-readable', ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    configured: true,
    projectRoot: root,
    gitRoot,
    healthy: checks.every((entry) => entry.ok),
    checks,
    shipping,
  };
}
