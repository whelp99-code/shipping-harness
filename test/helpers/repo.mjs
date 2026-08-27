import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runGit, currentGitSha } from '../../src/core/git.mjs';
import { initializeContract, loadContract, lockContract } from '../../src/core/contract.mjs';
import { initializeState, transitionState } from '../../src/core/state.mjs';
import { stableStringify } from '../../src/core/crypto.mjs';
import { runtimePaths } from '../../src/core/paths.mjs';

/**
 * @param {{testScript?: string, packageScripts?: Record<string, string>, initializeShipping?: boolean, contract?: (contract: Record<string, any>) => Record<string, any>}} [options]
 */
export async function createFixtureRepo(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-harness-test-'));
  runGit(root, ['init', '-b', 'main']);
  runGit(root, ['config', 'user.name', 'Shipping Harness Test']);
  runGit(root, ['config', 'user.email', 'shipping-harness@example.invalid']);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'shipping-harness-fixture',
    private: true,
    scripts: {
      test: options.testScript ?? `node -e "process.stdout.write('fixture-pass')"`,
      ...(options.packageScripts ?? {}),
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(root, '.gitignore'), '.shipping/evidence/\n.shipping/tmp/\n', 'utf8');
  await writeFile(path.join(root, 'README.md'), '# Fixture\n', 'utf8');
  if (options.initializeShipping !== false) {
    await initializeContract(root, 'fixture');
    await initializeState(root);
  }
  if (options.contract && options.initializeShipping !== false) {
    const paths = runtimePaths(root);
    const contract = options.contract(await loadContract(paths.contract));
    await writeFile(paths.contract, stableStringify(contract), 'utf8');
  }
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'fixture baseline']);
  return {
    root,
    paths: runtimePaths(root),
    async lock() {
      if (options.initializeShipping === false) throw new Error('Shipping Harness is not initialized in this fixture');
      const sha = currentGitSha(root);
      const { contract, lock } = await lockContract(root, sha);
      await transitionState(root, 'LOCKED', {
        release: contract.release,
        contractHash: lock.contractHash,
        baselineSha: sha,
      }, 'test lock');
      return { contract, lock, sha };
    },
    async commit(message = 'fixture change') {
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-m', message]);
      return currentGitSha(root);
    },
    async read(relativePath) {
      return readFile(path.join(root, relativePath), 'utf8');
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}