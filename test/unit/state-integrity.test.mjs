import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { closeRelease, verifyRelease } from '../../src/core/gate.mjs';
import { readState, readTrustedState } from '../../src/core/state.mjs';
import {
  assessStateIntegrity,
  buildStateIntegrity,
  ledgerEventDigest,
  ledgerProvenState,
  stateDigest,
  verifyLedgerChain,
} from '../../src/core/state-integrity.mjs';

/** @param {string} filePath */
async function readLedger(filePath) {
  return (await readFile(filePath, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** @param {string} filePath @param {Array<Record<string, any>>} events */
async function writeLedger(filePath, events) {
  await writeFile(filePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
}

/** @param {string} filePath @param {(state: Record<string, any>) => Record<string, any>} mutate */
async function editState(filePath, mutate) {
  const state = JSON.parse(await readFile(filePath, 'utf8'));
  await writeFile(filePath, `${JSON.stringify(mutate(state), null, 2)}\n`, 'utf8');
}

test('every state write signs the state and the ledger chain round trips', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const state = await readState(fixture.root);
    assert.equal(state.integrity.algorithm, 'sha256');
    assert.equal(state.integrity.digest, stateDigest(state, state.integrity.ledgerHead));
    const events = await readLedger(fixture.paths.ledger);
    assert.equal(events.at(-1).id, state.integrity.ledgerHead);
    assert.equal(events[0].prev, null);
    assert.equal(events[1].prev, events[0].digest);
    for (const event of events) assert.equal(event.digest, ledgerEventDigest(event));
    assert.equal(verifyLedgerChain(events).ok, true);
    assert.equal(ledgerProvenState(events), 'LOCKED');
    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'VERIFIED');
    assert.equal(assessed.ok, true);
    assert.equal(assessed.ledgerState, 'LOCKED');
  } finally {
    await fixture.cleanup();
  }
});

test('a state written before v1.10 is UNVERIFIED_LEGACY and still usable', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await editState(fixture.paths.state, ({ integrity: _integrity, ...rest }) => rest);
    const events = (await readLedger(fixture.paths.ledger)).map(({ prev: _prev, digest: _digest, stateWrite: _write, ...rest }) => rest);
    await writeLedger(fixture.paths.ledger, events);
    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'UNVERIFIED_LEGACY');
    assert.equal(assessed.ok, true);
    assert.equal(assessed.ledgerState, 'LOCKED');
    assert.equal((await readTrustedState(fixture.root)).state, 'LOCKED');
  } finally {
    await fixture.cleanup();
  }
});

test('check (a): editing any signed state field breaks the digest', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await editState(fixture.paths.state, (state) => ({ ...state, blockerCount: 0, agentRuns: 42 }));
    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'TAMPERED');
    assert.match(assessed.reason, /integrity digest/u);
    await assert.rejects(readTrustedState(fixture.root), /ERR_STATE_TAMPERED|integrity is broken/u);
  } finally {
    await fixture.cleanup();
  }
});

test('check (b): a deleted ledger line and a rewritten event both fail the chain', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const events = await readLedger(fixture.paths.ledger);
    await writeLedger(fixture.paths.ledger, events.slice(0, -1));
    const truncated = await assessStateIntegrity(fixture.root);
    assert.equal(truncated.level, 'TAMPERED');
    assert.match(truncated.reason, /last recorded state write/u);

    const rewritten = [...events];
    rewritten[0] = { ...rewritten[0], to: 'CLOSED' };
    await writeLedger(fixture.paths.ledger, rewritten);
    const forgedChain = await assessStateIntegrity(fixture.root);
    assert.equal(forgedChain.level, 'TAMPERED');
    assert.match(forgedChain.reason, /digest does not match its content/u);
    assert.equal(verifyLedgerChain(rewritten).ok, false);
  } finally {
    await fixture.cleanup();
  }
});

test('check (c): a re-signed state that the ledger never proved is still TAMPERED', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await editState(fixture.paths.state, (state) => {
      const forged = { ...state, state: 'SHIPPABLE' };
      delete forged.integrity;
      return { ...forged, integrity: buildStateIntegrity(forged, state.integrity.ledgerHead) };
    });
    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'TAMPERED');
    assert.equal(assessed.ledgerState, 'LOCKED');
    assert.match(assessed.reason, /the ledger never recorded/u);
  } finally {
    await fixture.cleanup();
  }
});

test('check (d): a CLOSED state without a matching receipt is TAMPERED', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    const closed = await closeRelease(fixture.root);
    assert.equal((await assessStateIntegrity(fixture.root)).level, 'VERIFIED');

    const receipt = JSON.parse(await readFile(closed.receiptPath, 'utf8'));
    await writeFile(closed.receiptPath, JSON.stringify({ ...receipt, closedGitSha: 'f'.repeat(40) }, null, 2), 'utf8');
    const mismatched = await assessStateIntegrity(fixture.root);
    assert.equal(mismatched.level, 'TAMPERED');
    assert.match(mismatched.reason, /closedGitSha/u);

    await rm(closed.receiptPath, { force: true });
    const missing = await assessStateIntegrity(fixture.root);
    assert.equal(missing.level, 'TAMPERED');
    assert.match(missing.reason, /no release receipt/u);
  } finally {
    await fixture.cleanup();
  }
});

test('check (e): a SHIPPABLE state without its evidence manifest is TAMPERED', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    const verification = await verifyRelease(fixture.root);
    assert.equal(verification.decision, 'SHIPPABLE');
    assert.equal((await assessStateIntegrity(fixture.root)).level, 'VERIFIED');
    await rm(path.join(fixture.paths.evidence, verification.manifest.runId), { recursive: true, force: true });
    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'TAMPERED');
    assert.match(assessed.reason, /evidence manifest/u);
  } finally {
    await fixture.cleanup();
  }
});

test('a DRAFT left by a pre-v1.10 release prepare is UNVERIFIED_LEGACY, not TAMPERED', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await verifyRelease(fixture.root);
    await closeRelease(fixture.root);
    // Exactly what v1.9 `release prepare` left behind: a fresh DRAFT for the next release and
    // a ledger whose last recorded state is the previous release's CLOSED.
    const closedState = JSON.parse(await readFile(fixture.paths.state, 'utf8'));
    await writeFile(fixture.paths.state, `${JSON.stringify({
      schema: 'shipping-harness/state-v1',
      state: 'DRAFT',
      release: '0.2.0',
      previousRelease: closedState.release,
      contractHash: null,
      baselineSha: null,
      currentEvidenceSha: null,
      lastRunId: null,
      agentRuns: 0,
      fixCycles: 0,
      blockerCount: 0,
      nextCount: 0,
      ignoreCount: 0,
      humanStop: false,
      resumeState: null,
      createdAt: closedState.createdAt,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    const events = (await readLedger(fixture.paths.ledger)).map(({ prev: _prev, digest: _digest, stateWrite: _write, ...rest }) => rest);
    await writeLedger(fixture.paths.ledger, events);

    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'UNVERIFIED_LEGACY');
    assert.equal(assessed.ok, true);
    assert.equal(assessed.ledgerState, 'DRAFT');
    assert.equal((await readTrustedState(fixture.root)).state, 'DRAFT');
  } finally {
    await fixture.cleanup();
  }
});

test('legacy leniency never extends upward to a SHIPPABLE or CLOSED claim', async () => {
  const fixture = await createFixtureRepo();
  try {
    await fixture.lock();
    await editState(fixture.paths.state, ({ integrity: _integrity, ...state }) => ({
      ...state,
      state: 'CLOSED',
      previousRelease: '0.0.9',
      release: '0.1.0',
    }));
    const events = (await readLedger(fixture.paths.ledger)).map(({ prev: _prev, digest: _digest, stateWrite: _write, ...rest }) => rest);
    await writeLedger(fixture.paths.ledger, events);
    const assessed = await assessStateIntegrity(fixture.root);
    assert.equal(assessed.level, 'TAMPERED');
    assert.equal(assessed.expected, 'LOCKED');
    assert.equal(assessed.observed, 'CLOSED');
  } finally {
    await fixture.cleanup();
  }
});
