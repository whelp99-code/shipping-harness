// v1.13.0 Phase A adversarial: the baseline auto-commit must refuse the WHOLE commit
// rather than quietly committing everything except the dangerous file. Every refusal here
// asserts that `git status --porcelain` and `git diff --cached` are byte-identical before
// and after (empty in every case but the one where the user staged something themselves),
// i.e. the harness staged nothing, committed nothing, and moved no HEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_UNTRACKED_BYTES, MAX_UNTRACKED_FILES, collectBaselineChanges, commitBaseline } from '../../src/core/baseline-commit.mjs';
import { runGit } from '../../src/core/git.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return runGit(root, args).stdout;
}

/**
 * Run `body`, require it to throw `code`, and prove the repository is untouched.
 * @param {Record<string, any>} fixture
 * @param {() => unknown} body
 * @param {string} code
 * @param {RegExp} messagePattern
 */
async function refusesWithoutTouchingTheRepository(fixture, body, code, messagePattern) {
  const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
  const statusBefore = git(fixture.root, ['status', '--porcelain']);
  const indexBefore = git(fixture.root, ['diff', '--cached']);
  const error = await assert.rejects(async () => body(), (thrown) => {
    assert.equal(thrown.code, code);
    assert.match(thrown.message, messagePattern);
    return true;
  }).then(() => null).catch((problem) => problem);
  assert.equal(error, null);
  assert.equal(git(fixture.root, ['status', '--porcelain']), statusBefore, 'the working tree changed');
  // Nothing was staged by the harness: the index is exactly what the caller left, which in
  // every case but the deliberately pre-staged one is empty.
  assert.equal(git(fixture.root, ['diff', '--cached']), indexBefore, 'the index changed');
  assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore, 'HEAD moved');
}

for (const credential of ['.env', 'id_rsa', 'credentials.json', 'config/auth.json', 'tokens.json']) {
  test(`an untracked ${credential} refuses the whole commit and leaves the tree byte-identical`, async () => {
    const fixture = await createFixtureRepo();
    try {
      await fixture.write('README.md', '# real work that would otherwise be committed\n');
      await fixture.write('src/index.mjs', 'export const value = 1;\n');
      await fixture.write(credential, 'SECRET=do-not-commit\n');
      await refusesWithoutTouchingTheRepository(
        fixture,
        () => commitBaseline(fixture.root),
        'ERR_BASELINE_UNSAFE_UNTRACKED',
        new RegExp(`${credential.replaceAll('.', '\\.')}`, 'u'),
      );
      // The refusal names the file, so the user knows which one to deal with.
      assert.equal(await fixture.read(credential), 'SECRET=do-not-commit\n');
    } finally {
      await fixture.cleanup();
    }
  });
}

test('a tracked .env.local modification refuses the whole baseline commit', async () => {
  const fixture = await createFixtureRepo({
    files: { '.env.local': 'SECRET=old\n' },
  });
  try {
    await fixture.write('.env.local', 'SECRET=new\n');
    await fixture.write('README.md', '# also dirty\n');
    await refusesWithoutTouchingTheRepository(
      fixture,
      () => commitBaseline(fixture.root),
      'ERR_BASELINE_UNSAFE_UNTRACKED',
      /\.env\.local/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('an untracked file inside a credential directory refuses the whole commit', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('README.md', '# real work\n');
    await fixture.write('.ssh/known_hosts', 'host key\n');
    await refusesWithoutTouchingTheRepository(
      fixture,
      () => commitBaseline(fixture.root),
      'ERR_BASELINE_UNSAFE_UNTRACKED',
      /\.ssh\/known_hosts/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('a credential file the user staged by hand is refused exactly like an untracked one', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('README.md', '# real work\n');
    await fixture.write('.env', 'TOKEN=leak\n');
    runGit(fixture.root, ['add', '--', '.env']);
    // The harness refuses before touching anything, so the user's own staging survives
    // untouched; what must never happen is the harness turning it into a commit.
    await refusesWithoutTouchingTheRepository(
      fixture,
      () => commitBaseline(fixture.root),
      'ERR_BASELINE_UNSAFE_UNTRACKED',
      /\.env/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('an untracked file over the 8 MiB budget refuses the whole commit', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('README.md', '# real work\n');
    await writeFile(path.join(fixture.root, 'huge.bin'), Buffer.alloc(MAX_UNTRACKED_BYTES + 1, 0x61));
    await refusesWithoutTouchingTheRepository(
      fixture,
      () => commitBaseline(fixture.root),
      'ERR_BASELINE_UNSAFE_UNTRACKED',
      /huge\.bin is larger than the baseline size budget/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('more than 200 untracked files refuses the whole commit', async () => {
  const fixture = await createFixtureRepo();
  try {
    for (let index = 0; index <= MAX_UNTRACKED_FILES; index += 1) {
      await fixture.write(`generated/file-${index}.txt`, `${index}\n`);
    }
    await refusesWithoutTouchingTheRepository(
      fixture,
      () => commitBaseline(fixture.root),
      'ERR_BASELINE_UNSAFE_UNTRACKED',
      new RegExp(`over the ${MAX_UNTRACKED_FILES}-file baseline budget`, 'u'),
    );
  } finally {
    await fixture.cleanup();
  }
});

test('a .gitignore-d credential file never reaches the screen and never reaches the commit', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.write('.gitignore', '.shipping/evidence/\n.shipping/tmp/\n.env\n');
    await fixture.commit('ignore the credential file');
    await fixture.write('.env', 'TOKEN=ignored\n');
    await fixture.write('README.md', '# real work\n');
    const changes = collectBaselineChanges(fixture.root);
    assert.deepEqual(changes.untracked, []);
    const result = commitBaseline(fixture.root);
    assert.deepEqual(result?.files, ['README.md']);
    assert.equal(git(fixture.root, ['ls-files', '.env']), '');
    assert.equal(await fixture.read('.env'), 'TOKEN=ignored\n');
  } finally {
    await fixture.cleanup();
  }
});

test('a repository with no commit fails as ERR_BASELINE_COMMIT_FAILED, not a stack trace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-baseline-empty-'));
  try {
    runGit(root, ['init', '-b', 'main']);
    runGit(root, ['config', 'user.name', 'Shipping Harness Test']);
    runGit(root, ['config', 'user.email', 'shipping-harness@example.invalid']);
    await writeFile(path.join(root, 'README.md'), '# first\n', 'utf8');
    await assert.rejects(async () => commitBaseline(root), (error) => {
      assert.equal(error.code, 'ERR_BASELINE_COMMIT_FAILED');
      assert.equal(error.name, 'ShippingError');
      assert.match(error.message, /no commit to build a baseline on/u);
      assert.equal(typeof error.details.stderr, 'string');
      return true;
    });
    assert.equal(runGit(root, ['diff', '--cached'], { allowFailure: true }).stdout, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unset git identity fails as ERR_BASELINE_COMMIT_FAILED carrying git stderr, and stages nothing', async () => {
  const fixture = await createFixtureRepo();
  try {
    // An empty value is how git reports "please tell me who you are" deterministically,
    // without depending on whatever global identity the test host happens to have.
    runGit(fixture.root, ['config', 'user.email', '']);
    runGit(fixture.root, ['config', 'user.name', '']);
    await fixture.write('README.md', '# identity is missing\n');
    const statusBefore = git(fixture.root, ['status', '--porcelain']);
    const headBefore = git(fixture.root, ['rev-parse', 'HEAD']);
    await assert.rejects(async () => commitBaseline(fixture.root), (error) => {
      assert.equal(error.code, 'ERR_BASELINE_COMMIT_FAILED');
      assert.match(error.message, /git refused to commit/u);
      assert.ok(error.details.stderr.length > 0, 'git stderr is carried, not swallowed');
      assert.ok(!('stack' in error.details), 'no stack trace is reported as the cause');
      return true;
    });
    assert.equal(git(fixture.root, ['diff', '--cached']), '', 'the index was restored');
    assert.equal(git(fixture.root, ['status', '--porcelain']), statusBefore);
    assert.equal(git(fixture.root, ['rev-parse', 'HEAD']), headBefore);
  } finally {
    await fixture.cleanup();
  }
});
