import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
export const FAULT_SEEDS = Object.freeze(['reverse', 'duplicate', 'SIGKILL', 'lost-ack']);

export async function runFaults(db, provider, databaseUrl) {
  const results = [];
  for (const version of [2, 1]) {
    await db.query(`INSERT INTO events(id, version) VALUES('reverse', $1)
      ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version
      WHERE events.version < EXCLUDED.version`, [version]);
  }
  assert.equal((await db.query("SELECT version FROM events WHERE id='reverse'")).rows[0].version, 2);
  results.push({ id: 'reverse', passed: true });
  const send = (operationId, loseAck = false) => fetch(provider.url, {
    method: 'POST', body: JSON.stringify({ operationId, loseAck }), signal: AbortSignal.timeout(5000),
  });
  for (let i = 0; i < 2; i++) assert.equal((await send('duplicate')).status, 200);
  await assert.rejects(send('lost-ack', true));
  assert.equal((await send('lost-ack')).status, 200);
  const child = fork(new URL('./fault-worker.mjs', import.meta.url), [], {
    env: { ...process.env, CORE5_DATABASE_URL: databaseUrl, CORE5_PROVIDER_URL: provider.url },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Worker exited before effect'); })]);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    const [, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
  } finally { clearTimeout(timer); child.kill('SIGKILL'); }
  assert.equal((await send('kill-operation')).status, 200);
  for (const [id, operation] of [['duplicate', 'duplicate'], ['SIGKILL', 'kill-operation'], ['lost-ack', 'lost-ack']]) {
    assert.equal((await db.query('SELECT count(*)::int AS count FROM effects WHERE id=$1', [operation])).rows[0].count, 1);
    results.push({ id, passed: true });
  }
  return results;
}
