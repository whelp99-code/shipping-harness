import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decideCore5Release, probeCore5DecisionEnv, probeCore5ReviewUi } from '../../src/core/core5-decision.mjs';

const PIN_A = 'postgres@sha256:' + 'a'.repeat(64);
const PIN_B = 'postgres@sha256:' + 'b'.repeat(64);
const PIN_C = 'postgres@sha256:' + 'c'.repeat(64);

/**
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} handler
 * @param {(url: string) => Promise<unknown>} fn
 */
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected tcp address');
  try {
    return await fn(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('H06 decision stays NOT_SHIPPABLE without docker, image pin, review UI, or real accounts', () => {
  const decision = decideCore5Release({
    dockerPath: null,
    postgresImage: '',
    reviewUiOk: false,
    realAccountOk: false,
    revision: 'abc',
  });
  assert.equal(decision.state, 'NOT_SHIPPABLE');
  assert.equal(decision.releaseDecision, false);
  assert.deepEqual(decision.blockers.map((row) => row.id).sort(), ['H02', 'H02-image', 'H03', 'K04']);
  assert.equal(decision.deploy, 'not-started');
  assert.equal(decision.observation, 'not-started');
});

test('H06 decision still refuses SHIPPABLE if only docker is present', () => {
  const decision = decideCore5Release({
    dockerPath: '/usr/bin/docker',
    postgresImage: PIN_A,
    reviewUiOk: false,
    realAccountOk: false,
  });
  assert.equal(decision.releaseDecision, false);
  assert.ok(decision.blockers.some((row) => row.id === 'H03'));
  assert.ok(decision.blockers.some((row) => row.id === 'K04'));
});

test('probe defaults never enable review UI or real accounts', () => {
  const probed = probeCore5DecisionEnv({}, { environmentFile: path.join(os.tmpdir(), 'core5-no-environment') });
  assert.equal(probed.reviewUiOk, false);
  assert.equal(probed.realAccountOk, false);
  assert.equal(probed.postgresImage, '');
});

test('H02 probe reads CORE5_POSTGRES_IMAGE from host environment file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'core5-h02-'));
  const file = path.join(dir, 'environment');
  await writeFile(file, `PATH=/usr/bin\nCORE5_POSTGRES_IMAGE=${PIN_B}\n`);
  const probed = probeCore5DecisionEnv({}, { environmentFile: file });
  assert.equal(probed.postgresImage, PIN_B);
  assert.equal(probed.realAccountOk, false);
  assert.equal(probed.reviewUiOk, false);
});

test('H02 probe prefers process env over environment file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'core5-h02-'));
  const file = path.join(dir, 'environment');
  await writeFile(file, `CORE5_POSTGRES_IMAGE=${PIN_B}\n`);
  const probed = probeCore5DecisionEnv({ CORE5_POSTGRES_IMAGE: PIN_C }, { environmentFile: file });
  assert.equal(probed.postgresImage, PIN_C);
});

test('H02 probe unwraps quoted CORE5_POSTGRES_IMAGE', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'core5-h02-'));
  const file = path.join(dir, 'environment');
  await writeFile(file, `CORE5_POSTGRES_IMAGE="${PIN_B}"\n`);
  const probed = probeCore5DecisionEnv({}, { environmentFile: file });
  assert.equal(probed.postgresImage, PIN_B);
});

test('H02 probe does not invent K04 from environment file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'core5-h02-'));
  const file = path.join(dir, 'environment');
  await writeFile(file, 'CORE5_REAL_ACCOUNT_OK=1\nCORE5_REVIEW_ACCESS_KEY=nope\nCORE5_UI_BASE_URL=http://127.0.0.1:4173/\n');
  const probed = probeCore5DecisionEnv({}, { environmentFile: file });
  assert.equal(probed.realAccountOk, false);
  assert.equal(probed.postgresImage, '');
});

test('H03 probe treats unauthenticated Core5 review 401 as present', async () => {
  const ok = await withServer((_req, res) => {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Core5 review"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Core5 review access key required.');
  }, (url) => probeCore5ReviewUi({ CORE5_UI_BASE_URL: url }));
  assert.equal(ok, true);
});

test('H03 probe defaults to loopback 4174 and does not target 4173', async () => {
  /** @type {string[]} */
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return new Response('Core5 review access key required.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Core5 review"' },
    });
  };
  assert.equal(await probeCore5ReviewUi({}, { fetch: fetchImpl }), true);
  assert.deepEqual(urls, ['http://127.0.0.1:4174/']);
});

test('H03 probe does not treat unauthenticated 200 review HTML as Core5 UI', async () => {
  const ok = await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Review</h1><button type="button">Reject</button>');
  }, (url) => probeCore5ReviewUi({ CORE5_UI_BASE_URL: url }));
  assert.equal(ok, false);
});

test('H03 probe ignores generic 401 challenges', async () => {
  const ok = await withServer((_req, res) => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mail"' });
    res.end('auth');
  }, (url) => probeCore5ReviewUi({ CORE5_UI_BASE_URL: url }));
  assert.equal(ok, false);
});

test('H03 probe still accepts authenticated 200 Core5 review HTML', async () => {
  const ok = await withServer((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="other"' });
      res.end('no');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Review</h1><button type="button">Reject</button>');
  }, (url) => probeCore5ReviewUi({ CORE5_UI_BASE_URL: url, CORE5_REVIEW_ACCESS_KEY: 'secret' }));
  assert.equal(ok, true);
});

test('H06 decision stays NOT_SHIPPABLE when only K04 remains', () => {
  const decision = decideCore5Release({
    dockerPath: '/usr/bin/docker',
    postgresImage: PIN_A,
    reviewUiOk: true,
    realAccountOk: false,
  });
  assert.equal(decision.state, 'NOT_SHIPPABLE');
  assert.equal(decision.releaseDecision, false);
  assert.deepEqual(decision.blockers.map((row) => row.id), ['K04']);
  assert.equal(decision.observation, 'not-started');
});

test('H06 decision is SHIPPABLE only when docker, image, review UI, and real accounts all pass', () => {
  const decision = decideCore5Release({
    dockerPath: '/usr/bin/docker',
    postgresImage: PIN_A,
    reviewUiOk: true,
    realAccountOk: true,
  });
  assert.equal(decision.state, 'SHIPPABLE');
  assert.equal(decision.releaseDecision, true);
  assert.deepEqual(decision.blockers, []);
  assert.equal(decision.observation, 'not-started');
});
