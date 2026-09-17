import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeRepository } from '../../src/core/project-analysis.mjs';

const PYPROJECT = '[project]\nname = "sample"\nversion = "1.0.0"\n[tool.ruff]\nline-length = 100\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n';

async function pythonProject(lockfile) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-python-uv-'));
  await writeFile(path.join(root, 'pyproject.toml'), PYPROJECT, 'utf8');
  if (lockfile) await writeFile(path.join(root, lockfile), 'version = 1\n', 'utf8');
  return root;
}

function commandFor(analysis, id) {
  return analysis.candidateCommands.find((candidate) => candidate.id === id)?.command;
}

test('a uv-locked python project is verified through the locked environment', async () => {
  // Without this the harness runs the ambient interpreter, which cannot import
  // tools installed only in the project .venv, and every release fails on a
  // contract defect rather than on the change under review.
  const root = await pythonProject('uv.lock');
  try {
    const analysis = await analyzeRepository(root);
    assert.equal(commandFor(analysis, 'python-ruff'), 'uv run --frozen ruff check .');
    assert.equal(commandFor(analysis, 'python-pytest'), 'uv run --frozen pytest');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a python project without a uv lockfile keeps the interpreter commands', async () => {
  const root = await pythonProject(null);
  try {
    const analysis = await analyzeRepository(root);
    assert.equal(commandFor(analysis, 'python-ruff'), 'python -m ruff check .');
    assert.equal(commandFor(analysis, 'python-pytest'), 'python -m pytest');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a uv lockfile past the truncated root listing is still detected', async () => {
  // The root listing is capped for display. A repository with hundreds of root
  // files pushes uv.lock past that cap, and detection must not read the cap.
  const root = await pythonProject('uv.lock');
  try {
    await Promise.all(Array.from({ length: 400 }, (_, index) => (
      writeFile(path.join(root, `NOTE-${String(index).padStart(4, '0')}.md`), 'note\n', 'utf8')
    )));
    const analysis = await analyzeRepository(root);
    assert.equal(commandFor(analysis, 'python-pytest'), 'uv run --frozen pytest');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
