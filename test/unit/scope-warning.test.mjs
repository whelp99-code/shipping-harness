// v1.10.0 Phase B.3: `status` warns about working-tree changes outside the approved
// scope before verification decides. Advisory only: the verdict still belongs to verify.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { releaseStatus } from '../../src/core/gate.mjs';
import { renderStatus } from '../../src/cli/output.mjs';
import { buildUserStatusView } from '../../src/mcp/user-view.mjs';

/** @param {string} root @param {string} relative @param {string} content */
async function write(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('untracked and modified paths outside the approved scope are listed', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await write(fixture.root, 'src/in-scope.mjs', 'export const ok = true;\n');
    await write(fixture.root, 'vendor/outside.mjs', 'export const nope = true;\n');
    await write(fixture.root, 'CHANGELOG.md', '# changes\n');
    await fixture.commit('mixed change');
    await write(fixture.root, 'deploy/extra.sh', 'echo hi\n');

    const status = await releaseStatus(fixture.root);
    assert.deepEqual(status.scopeWarning.outside, ['CHANGELOG.md', 'deploy/extra.sh', 'vendor/outside.mjs']);
    assert.ok(status.scopeWarning.include.includes('src/**'));
    assert.match(renderStatus(status), /Scope warning: 3 changed path\(s\) outside the approved scope/u);

    // The same warning reaches MCP shipping_status (via the status view) and the plain brief.
    const view = buildUserStatusView({ ...status, initialized: true });
    assert.deepEqual(view.scopeWarning.outside, status.scopeWarning.outside);
    const brief = view.briefFactGraph.facts.find((entry) => entry.code === 'SCOPE_WARNING');
    assert.equal(brief.value.outside, 3);
  } finally {
    await fixture.cleanup();
  }
});

test('in-scope and .shipping/ runtime paths are never listed', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await write(fixture.root, 'src/in-scope.mjs', 'export const ok = true;\n');
    await write(fixture.root, 'docs/note.md', 'note\n');
    await write(fixture.root, '.shipping/scratch.json', '{}\n');

    const status = await releaseStatus(fixture.root);
    assert.deepEqual(status.scopeWarning.outside, []);
    assert.doesNotMatch(renderStatus(status), /Scope warning/u);
    const view = buildUserStatusView({ ...status, initialized: true });
    assert.equal(view.briefFactGraph.facts.find((entry) => entry.code === 'SCOPE_WARNING'), undefined);
  } finally {
    await fixture.cleanup();
  }
});

test('status carries no scope warning before a baseline exists', async () => {
  const fixture = await createFixtureRepo();
  try {
    const status = await releaseStatus(fixture.root);
    assert.equal(status.scopeWarning, null);
  } finally {
    await fixture.cleanup();
  }
});
