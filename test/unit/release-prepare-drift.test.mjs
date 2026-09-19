// v1.13.7: reported from a live session that closed 1.0.2 and could not open the next
// release. Closing, committing the next piece of work, and preparing the next release is
// this product's basic cycle; comparing the closed SHA against the working tree made that
// cycle stop after one turn and told the user to commit work that was already committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { runGit } from '../../src/core/git.mjs';
import { prepareNextRelease } from '../../src/core/release-transition.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

/** A fixture carried all the way to a genuine CLOSED release with its receipt on disk. */
async function closedFixture() {
  const fixture = await createFixtureRepo();
  await fixture.lock();
  assert.equal((await verifyRelease(fixture.root)).decision, 'SHIPPABLE');
  await closeRelease(fixture.root);
  await fixture.commit('chore: close the fixture release');
  return fixture;
}

test('a source commit made after the close does not block the next release', async () => {
  const fixture = await closedFixture();
  try {
    await fixture.write('NOTES.md', '# work that belongs to the next release\n');
    await fixture.commit('docs: start the next release');
    assert.equal(runGit(fixture.root, ['status', '--porcelain=v1']).stdout.trim(), '', 'nothing is left uncommitted');

    const prepared = await prepareNextRelease(fixture.root, { release: '0.2.0', goal: 'Ship the next outcome end to end.' });
    assert.equal(prepared.release, '0.2.0');
    assert.equal(prepared.state, 'DRAFT');
  } finally {
    await fixture.cleanup();
  }
});

test('uncommitted source changes still block, and the error names them', async () => {
  const fixture = await closedFixture();
  try {
    await fixture.write('NOTES.md', '# never committed\n');
    await assert.rejects(
      () => prepareNextRelease(fixture.root, { release: '0.2.0', goal: 'Ship the next outcome end to end.' }),
      (error) => {
        assert.equal(error.code, 'ERR_RELEASE_DRIFT');
        assert.match(error.message, /NOTES\.md/u, 'the message names what is blocking');
        assert.deepEqual(error.details.changed, ['NOTES.md']);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('preparing straight after the close still works', async () => {
  const fixture = await closedFixture();
  try {
    const prepared = await prepareNextRelease(fixture.root, { release: '0.2.0', goal: 'Ship the next outcome end to end.' });
    assert.equal(prepared.state, 'DRAFT');
  } finally {
    await fixture.cleanup();
  }
});

// v1.13.7: the analyzer derives a version recommendation with a change kind and a
// confidence, then the next release number ignored it and always bumped the minor. The
// reported case: after closing 1.0.2, a patch-sized stage was proposed as 1.1.0 while the
// evidence said 1.0.3 with high confidence.
test('a patch recommendation ahead of the closed release wins over a minor bump', async () => {
  const { createScopeProposal } = await import('../../src/core/proposals.mjs');
  const fixture = await closedFixture();
  try {
    const manifest = JSON.parse(await fixture.read('package.json'));
    manifest.version = '1.0.2';
    await fixture.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    await fixture.commit('chore: record the shipped version');

    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Fix the reported defect in the existing flow.' });
    assert.equal(proposal.evidence.analysis.versionEvidence.recommendedVersion, '1.0.3');
    assert.equal(proposal.release, '1.0.3', 'the recommendation wins; 1.1.0 would discard the evidence');
  } finally {
    await fixture.cleanup();
  }
});

test('a recommendation that is not ahead falls back to the minor bump', async () => {
  const { createScopeProposal } = await import('../../src/core/proposals.mjs');
  const fixture = await closedFixture();
  try {
    // The fixture manifest carries no version, so the analyzer can only recommend 0.1.0,
    // which is the release just closed. Bumping the minor is then the only safe move.
    const { proposal } = await createScopeProposal(fixture.root, { goal: 'Fix the reported defect in the existing flow.' });
    assert.equal(proposal.evidence.analysis.versionEvidence.recommendedVersion, '0.1.0');
    assert.equal(proposal.release, '0.2.0');
  } finally {
    await fixture.cleanup();
  }
});
