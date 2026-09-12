import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureRepo } from '../helpers/repo.mjs';

const mainRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Whether the private OMO runtime pinned by config/upstreams/omo-pin.json is actually
 * installed on this machine. Tests that exercise the real runtime binary (not a fixture's
 * deliberately-broken cliPath) must skip, not fail, when it is not: the pin is a real
 * absolute path outside this repo and may not exist on every contributor's machine.
 * @returns {{ available: boolean, reason: string }}
 */
export function privateOmoRuntimeAvailability() {
  const pinPath = path.join(mainRoot, 'config', 'upstreams', 'omo-pin.json');
  let pin;
  try {
    pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  } catch (error) {
    return { available: false, reason: `omo-pin.json could not be read: ${error?.message ?? error}` };
  }
  const manifestPath = path.join(pin.runtimeRoot, 'runtime-manifest.json');
  if (!existsSync(manifestPath)) {
    return { available: false, reason: `private OMO runtime is not installed at the pinned path (missing ${manifestPath})` };
  }
  return { available: true, reason: '' };
}

export function v07Contract(contract) {
  return {
    ...contract,
    release: '0.7.0',
    goal: 'Run one bounded private OMO task while Shipping remains the only Finisher.',
    scope: {
      include: ['Private OMO probe receipt followed by independent Shipping verification.'],
      exclude: ['Team Mode', 'DAG Mode', 'public publishing'],
      paths: {
        include: ['README.md', 'package.json', 'verify.mjs', 'config/upstreams/omo-pin.json'],
        exclude: ['.shipping/contract.yaml', '.shipping/contract.lock', '.git/**'],
      },
    },
    acceptance: [{
      id: 'AC-0708',
      description: 'Independent Shipping verification passes after the OMO receipt.',
      type: 'command',
      command: 'node verify.mjs',
      cwd: '.',
      required: true,
      timeoutSeconds: 60,
    }],
    requirements: ['REQ-OMO-003'],
    internalRuntime: {
      schema: 'shipping-harness/private-runtime-profile-v1',
      profile: 'private-omo-v0.7',
      configPath: 'config/upstreams/omo-pin.json',
      workOrderSchema: 'shipping-omo/v1',
      receiptSchema: 'shipping-omo-receipt/v1',
      fallback: ['codex', 'generic', 'blocked'],
      humanStopWins: true,
      shippingFinisherOnly: true,
      publicPublish: false,
      teamMode: false,
      dagMode: false,
      maxParallelWorkers: 2,
      maxAgentDepth: 1,
      maxContinuations: 3,
      maxFixCycles: 2,
    },
  };
}

export async function createOmoFixture(options = {}) {
  const fixture = await createFixtureRepo({
    contract: (contract) => {
      const next = v07Contract(contract);
      if (options.configureFallback) {
        next.adapters = {
          ...next.adapters,
          generic: { command: `node -e "process.stdout.write('fallback-ok')"`, artifactPaths: [] },
        };
      }
      return next;
    },
  });
  await writeFile(path.join(fixture.root, 'verify.mjs'), "process.stdout.write('shipping-verify-ok')\n", 'utf8');
  const source = JSON.parse(await readFile(path.join(mainRoot, 'config', 'upstreams', 'omo-pin.json'), 'utf8'));
  const config = {
    ...source,
    stateRoot: path.join(fixture.root, '.shipping', 'tmp', 'private-omo-state'),
    hmacKeyPath: path.join(fixture.root, '.shipping', 'tmp', 'private-omo-hmac.key'),
    allowedRoots: [fixture.root],
  };
  if (options.breakRuntime) config.cliPath = path.join(fixture.root, 'missing-private-omo-runtime.mjs');
  await mkdir(path.join(fixture.root, 'config', 'upstreams'), { recursive: true });
  await writeFile(path.join(fixture.root, 'config', 'upstreams', 'omo-pin.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fixture.commit('add v0.7 fixture config');
  const locked = await fixture.lock();
  const executionSha = await fixture.commit('commit v0.7 scope lock receipt');
  return { ...fixture, config, locked: { ...locked, executionSha }, mainRoot };
}
