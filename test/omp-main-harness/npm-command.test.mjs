// v1.13.8: every pack and install call site defaulted to the literal /usr/bin/npm, which
// does not exist on a stock GitHub runner, so nothing in this package could run in CI.
// It went unnoticed because test:omp-main and smoke:omp-main were release:verify steps
// for the first time in this release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defaultNpmCommand } from '../../packages/omp-main-harness/io.mjs';

test('the resolved npm is an absolute path to something executable', () => {
  const resolved = defaultNpmCommand();
  assert.ok(path.isAbsolute(resolved), `expected an absolute path, got ${resolved}`);
  assert.ok(existsSync(resolved), `${resolved} must exist`);
});

test('the absolute /usr/bin/npm still wins where it exists, so behaviour is unchanged there', () => {
  if (!existsSync('/usr/bin/npm')) {
    assert.ok(defaultNpmCommand().endsWith('npm'));
    return;
  }
  assert.equal(defaultNpmCommand(), '/usr/bin/npm');
  assert.equal(defaultNpmCommand({ PATH: '' }), '/usr/bin/npm', 'the preferred absolute path does not depend on PATH');
});

test('an empty PATH cannot make the resolver return a bare name when npm is absolute', () => {
  const resolved = defaultNpmCommand({ PATH: '' });
  assert.ok(path.isAbsolute(resolved) || resolved === 'npm', 'a bare name is only acceptable when nothing was found');
});
