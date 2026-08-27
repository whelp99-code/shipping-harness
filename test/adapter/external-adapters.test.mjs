import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { collectAdapterArtifacts, probeAdapter } from '../../src/adapters/registry.mjs';

async function fakeExecutable(directory, name, version) {
  const target = path.join(directory, name);
  await writeFile(target, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, 'utf8');
  await chmod(target, 0o755);
  return target;
}

test('Gajae probe and artifact collection distinguish executable proof from durable evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-gajae-'));
  const bin = await mkdtemp(path.join(os.tmpdir(), 'shipping-bin-'));
  try {
    await fakeExecutable(bin, 'gjc', 'gjc 9.9.9-fixture');
    await mkdir(path.join(root, '.gjc'), { recursive: true });
    await writeFile(path.join(root, '.gjc/goals.json'), '{"goals":[{"id":"G-1","token":"do-not-copy"}]}\n', 'utf8');
    await writeFile(path.join(root, '.gjc/ledger.jsonl'), '{"type":"checkpoint","goal":"G-1"}\n', 'utf8');
    const contract = {
      adapters: {
        gajae: {
          command: null,
          artifactPaths: ['.gjc/goals.json', '.gjc/ledger.jsonl'],
        },
      },
    };
    const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
    const report = probeAdapter('gajae', { contract, root, env });
    assert.equal(report.verificationLevel, 'live');
    assert.equal(report.capabilities.execute, true);
    assert.equal(report.capabilities.durableGoals, true);
    assert.equal(report.capabilities.durableLedger, true);

    const artifacts = await collectAdapterArtifacts('gajae', { contract, root });
    assert.equal(artifacts.collected.length, 2);
    assert.equal(artifacts.missing.length, 0);
    assert.match(artifacts.collected[0].sha256, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(artifacts).includes('do-not-copy'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('Ouroboros stays explicit-only while OMO reports a bridge rather than a native plugin', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shipping-external-'));
  const bin = await mkdtemp(path.join(os.tmpdir(), 'shipping-bin-'));
  try {
    await fakeExecutable(bin, 'ooo', 'ooo 2.0.0-fixture');
    await mkdir(path.join(root, '.ouroboros'), { recursive: true });
    await mkdir(path.join(root, '.omo'), { recursive: true });
    await writeFile(path.join(root, '.ouroboros/seed.json'), '{"goal":"fixture"}\n', 'utf8');
    await writeFile(path.join(root, '.ouroboros/ledger.jsonl'), '{"type":"evaluation"}\n', 'utf8');
    await writeFile(path.join(root, '.omo/omo.jsonc'), '{ // fixture\n  "enabled": true\n}\n', 'utf8');
    const contract = {
      adapters: {
        ouroboros: {
          command: null,
          artifactPaths: ['.ouroboros/seed.json', '.ouroboros/ledger.jsonl'],
        },
        omo: {
          command: null,
          artifactPaths: ['.omo/omo.jsonc', '.omo/omo.json'],
        },
      },
    };
    const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
    const ouroboros = probeAdapter('ooo', { contract, root, env });
    assert.equal(ouroboros.verificationLevel, 'live');
    assert.equal(ouroboros.metadata.seedEvidence, true);
    assert.equal(ouroboros.metadata.evolutionPolicy, 'explicit-only');
    assert.equal(ouroboros.capabilities.resume, false);

    const omo = probeAdapter('omo', { contract, root, env });
    assert.equal(omo.verificationLevel, 'configured');
    assert.equal(omo.capabilities.hooks, true);
    assert.equal(omo.capabilities.execute, false);
    assert.equal(omo.metadata.nativePlugin, false);
    assert.equal(omo.metadata.userConfigInspected, false);
    assert.deepEqual(omo.metadata.artifactPresence.present, ['.omo/omo.jsonc']);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});