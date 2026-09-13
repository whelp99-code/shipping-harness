import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { runCommand } from './io.mjs';

async function initializeGit(root) {
  runCommand('git', ['init', '-q', '-b', 'main'], { cwd: root, timeoutMs: 30000 });
  runCommand('git', ['config', 'user.name', 'Shipping OMP Field Smoke'], { cwd: root, timeoutMs: 30000 });
  runCommand('git', ['config', 'user.email', 'shipping-omp-smoke@example.invalid'], { cwd: root, timeoutMs: 30000 });
}

async function commit(root, message) {
  runCommand('git', ['add', '.'], { cwd: root, timeoutMs: 30000 });
  runCommand('git', ['commit', '-q', '-m', message], { cwd: root, timeoutMs: 30000 });
}

/**
 * @typedef {{root: string, cleanup: () => Promise<void>}} FieldFixture
 */

/**
 * @returns {Promise<FieldFixture>}
 */
export async function createProtocolFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-omp-protocol-'));
  await initializeGit(root);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'shipping-omp-protocol-fixture',
    private: true,
    type: 'module',
    scripts: { build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(root, 'README.md'), '# Shipping OMP protocol fixture\n', 'utf8');
  await commit(root, 'fixture baseline');
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function addRuntime(root, name, version) {
  const runtime = path.join(root, name);
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, 'pyproject.toml'), `[project]\nname = "${name}"\nversion = "${version}"\n`, 'utf8');
  await writeFile(path.join(runtime, 'RELEASE_MANIFEST.json'), `${JSON.stringify({ name, version }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(runtime, 'README.md'), `# ${name}\n`, 'utf8');
  await writeFile(path.join(runtime, 'Makefile'), [
    '.PHONY: verify package',
    'verify:',
    '\t@python3 -c "print(\'verify-pass\')"',
    'package:',
    '\t@python3 -c "print(\'package-pass\')"',
    '',
  ].join('\n'), 'utf8');
}

/**
 * @param {string[]} [names]
 * @returns {Promise<FieldFixture>}
 */
export async function createNestedPilotFixture(names = ['alpha-runtime-v1.1.0', 'beta-runtime-v1.1.0']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-omp-nested-'));
  await initializeGit(root);
  await writeFile(path.join(root, 'README.md'), '# Nested workspace field fixture\n', 'utf8');
  for (const name of names) {
    const version = name.match(/(\d+\.\d+\.\d+)/u)?.[1] ?? '1.1.0';
    await addRuntime(root, name, version);
  }
  await commit(root, 'nested fixture baseline');
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
