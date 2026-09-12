// Reproduces round 5 of the v1.9.0 model-independence experiment: a host model that is told
// it may edit `.shipping/` writes "state": "CLOSED" into state.json instead of doing the work.
// Before v1.10 every reporting and decision surface believed it. These tests pin the new
// behaviour: the forgery is reported, and no command continues on top of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { parseCliJson, runCli } from '../helpers/cli.mjs';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { addManualIssue } from '../../src/core/issues.mjs';

/**
 * Remove every v1.10 signature so the fixture looks like it was written by v1.9.
 * @param {{state: string, ledger: string}} paths
 */
async function stripSignatures(paths) {
  const { integrity: _integrity, ...state } = JSON.parse(await readFile(paths.state, 'utf8'));
  await writeFile(paths.state, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const events = (await readFile(paths.ledger, 'utf8')).split('\n').filter(Boolean)
    .map((line) => JSON.parse(line))
    .map(({ prev: _prev, digest: _digest, stateWrite: _stateWrite, ...rest }) => rest);
  await writeFile(paths.ledger, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
}

/** @param {string} filePath @param {(state: Record<string, any>) => Record<string, any>} mutate */
async function forgeState(filePath, mutate) {
  const state = JSON.parse(await readFile(filePath, 'utf8'));
  await writeFile(filePath, `${JSON.stringify(mutate(state), null, 2)}\n`, 'utf8');
}

test('a hand-edited CLOSED state is reported, and prepare and hook decisions refuse it', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await forgeState(fixture.paths.state, (state) => ({
      ...state,
      state: 'CLOSED',
      closedAt: new Date().toISOString(),
      closedGitSha: state.baselineSha,
    }));

    const status = runCli(fixture.root, ['status', '--json']);
    assert.equal(status.exitCode, 2, status.stderr);
    const document = parseCliJson(status);
    assert.equal(document.integrity.ok, false);
    assert.equal(document.integrity.level, 'TAMPERED');
    assert.equal(document.integrity.ledgerState, 'LOCKED');
    // The reported state is the last state the ledger proves, never the forged one.
    assert.equal(document.state.state, 'LOCKED');
    const blocker = document.issues.items.find((item) => item.basisId === 'false-user-state');
    assert.ok(blocker, 'a false-user-state BLOCKER must be reported');
    assert.equal(blocker.classification, 'BLOCKER');
    assert.equal(document.issues.counts.BLOCKER, 1);

    // The derived blocker is never written into issues.json.
    const persisted = await readFile(fixture.paths.issues, 'utf8').catch(() => '{"issues":[]}');
    assert.equal((JSON.parse(persisted).issues ?? []).some((item) => item.basisId === 'false-user-state'), false);

    const prepared = runCli(fixture.root, ['release', 'prepare', '--version', '0.2.0', '--goal', 'next release']);
    assert.notEqual(prepared.exitCode, 0);
    assert.match(prepared.stderr, /ERR_STATE_TAMPERED/u);

    const hook = runCli(fixture.root, ['hook', 'decision', '--json']);
    const decision = parseCliJson(hook);
    assert.equal(decision.action, 'DENY_CONTINUATION');
    assert.equal(decision.continue, false);
    assert.equal(decision.reasonCode, 'STATE_INTEGRITY_TAMPERED');
    assert.equal(decision.state, 'LOCKED');
    assert.equal(decision.integrity.ok, false);
    assert.notEqual(hook.exitCode, 3, 'a tampered state must never produce a CONTINUE exit code');

    const mcp = await callShippingTool(fixture.root, 'shipping_status', {});
    assert.equal(mcp.structuredContent.integrity.ok, false);
    assert.equal(mcp.structuredContent.integrity.level, 'TAMPERED');
    assert.equal(mcp.structuredContent.state.state, 'LOCKED');
    assert.equal(mcp.structuredContent.userView.integrity.level, 'TAMPERED');
  } finally {
    await fixture.cleanup();
  }
});

test('editing blockerCount to hide a real blocker is detected', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await addManualIssue(fixture.root, {
      title: 'Required acceptance criterion fails',
      description: 'A real release blocker.',
      classification: 'BLOCKER',
      basisId: 'AC-0001',
      evidenceRef: 'manual:operator',
    });
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 2);
    const verified = JSON.parse(await readFile(fixture.paths.state, 'utf8'));
    assert.equal(verified.blockerCount, 1);

    await forgeState(fixture.paths.state, (state) => ({ ...state, blockerCount: 0 }));
    const document = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(document.integrity.ok, false);
    assert.match(document.integrity.reason, /integrity digest/u);
    assert.ok(document.issues.counts.BLOCKER >= 1);
  } finally {
    await fixture.cleanup();
  }
});

test('deleting the last ledger line is detected as a broken chain head', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const lines = (await readFile(fixture.paths.ledger, 'utf8')).split('\n').filter(Boolean);
    await writeFile(fixture.paths.ledger, `${lines.slice(0, -1).join('\n')}\n`, 'utf8');
    const document = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(document.integrity.ok, false);
    assert.match(document.integrity.reason, /last recorded state write/u);
    const hook = parseCliJson(runCli(fixture.root, ['hook', 'decision', '--json']));
    assert.equal(hook.action, 'DENY_CONTINUATION');
  } finally {
    await fixture.cleanup();
  }
});

test('deleting the receipt of a genuine close invalidates the CLOSED claim', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal(runCli(fixture.root, ['lock', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
    const closed = runCli(fixture.root, ['close', '--json']);
    assert.equal(closed.exitCode, 0, closed.stderr);
    const before = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(before.integrity.level, 'VERIFIED');
    assert.equal(before.state.state, 'CLOSED');

    const receipt = JSON.parse(await readFile(fixture.paths.state, 'utf8')).releaseReceipt;
    await rm(`${fixture.root}/${receipt}`, { force: true });
    const after = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(after.integrity.ok, false);
    assert.match(after.integrity.reason, /no release receipt/u);
    const prepared = runCli(fixture.root, ['release', 'prepare', '--version', '0.2.0', '--goal', 'next release']);
    assert.notEqual(prepared.exitCode, 0);
    assert.match(prepared.stderr, /ERR_STATE_TAMPERED/u);
  } finally {
    await fixture.cleanup();
  }
});

test('legacy leniency does not let an unsigned state forge CLOSED', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await stripSignatures(fixture.paths);
    // The unsigned ledger ends at LOCKED; claiming CLOSED is an upward claim it cannot support.
    await forgeState(fixture.paths.state, (state) => ({ ...state, state: 'CLOSED', closedGitSha: state.baselineSha }));
    const document = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(document.integrity.level, 'TAMPERED');
    assert.equal(document.integrity.ledgerState, 'LOCKED');
    assert.equal(document.state.state, 'LOCKED');
    assert.ok(document.issues.items.some((item) => item.basisId === 'false-user-state'));
  } finally {
    await fixture.cleanup();
  }
});

test('an unsigned CLOSED cannot be rolled forward to the next release without a receipt', async () => {
  const fixture = await createFixtureRepo();
  try {
    assert.equal(runCli(fixture.root, ['lock', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['verify', '--json']).exitCode, 0);
    assert.equal(runCli(fixture.root, ['close', '--json']).exitCode, 0);
    await stripSignatures(fixture.paths);
    // The ledger proves CLOSED for 0.1.0. Claiming CLOSED for 0.2.0 with no receipt is a forged
    // close, not the legacy prepare shape: CLOSED is never granted by leniency.
    await forgeState(fixture.paths.state, ({ releaseReceipt: _receipt, ...state }) => ({
      ...state,
      release: '0.2.0',
      previousRelease: '0.1.0',
    }));
    const document = parseCliJson(runCli(fixture.root, ['status', '--json']));
    assert.equal(document.integrity.level, 'TAMPERED');
    assert.match(document.integrity.reason, /no release receipt/u);
    const prepared = runCli(fixture.root, ['release', 'prepare', '--version', '0.3.0', '--goal', 'next release']);
    assert.notEqual(prepared.exitCode, 0);
    assert.match(prepared.stderr, /ERR_STATE_TAMPERED/u);
  } finally {
    await fixture.cleanup();
  }
});
