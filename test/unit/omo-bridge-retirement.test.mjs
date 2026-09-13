// Regression for the v1.11.1 private OMO runtime bridge retirement (ADR 2026-09-13,
// ../../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md).
// The bridge's code, schemas, and tests are NOT deleted; only its automatic gate
// participation is removed. This asserts that retirement stuck and that the OMO
// Native adapter / the nine MCP tools were left untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listAdapters } from '../../src/adapters/registry.mjs';
import { SHIPPING_TOOLS } from '../../src/mcp/tools.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRepoFile = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

test('release-verify --list has no omo-bridge step', () => {
  const output = execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'release-verify.mjs'), '--list'], {
    encoding: 'utf8',
  });
  const steps = output.split('\n').filter(Boolean);
  assert.ok(steps.length > 0);
  for (const step of steps) assert.ok(!/omo/iu.test(step), `unexpected omo step in release:verify: ${step}`);
});

test('package.json release:verify and check scripts do not mention omo', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  assert.equal(typeof packageJson.scripts['release:verify'], 'string');
  assert.equal(typeof packageJson.scripts.check, 'string');
  assert.ok(!/omo/iu.test(packageJson.scripts['release:verify']));
  assert.ok(!/omo/iu.test(packageJson.scripts.check));
  // The manual script itself must still exist for operators who reactivate the bridge.
  assert.equal(typeof packageJson.scripts['test:omo-bridge'], 'string');
});

test('internal-omo-bridge deprecation notice exists and cites the ADR date', () => {
  const notice = readRepoFile('packages/internal-omo-bridge/DEPRECATED.md');
  assert.ok(notice.includes('2026-09-13'), 'deprecation notice must cite the ADR date 2026-09-13');
  assert.ok(/deprecat/iu.test(notice));
});

test('registry still lists the omo adapter', () => {
  assert.ok(listAdapters().some((adapter) => adapter.name === 'omo'), 'src/adapters/registry.mjs must still list the omo adapter');
});

test('SHIPPING_TOOLS still has exactly the same nine tool names', () => {
  const expectedNames = [
    'shipping_start',
    'shipping_refine',
    'shipping_approve_scope',
    'shipping_execute',
    'shipping_status',
    'shipping_verify',
    'shipping_fix_blockers',
    'shipping_pause',
    'shipping_close',
  ];
  assert.equal(SHIPPING_TOOLS.length, 9);
  assert.deepEqual(SHIPPING_TOOLS.map((tool) => tool.name), expectedNames);
});
