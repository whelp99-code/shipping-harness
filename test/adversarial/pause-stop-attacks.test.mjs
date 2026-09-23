// v1.13.20: pause and humanStop must deny work orders and kill bounded commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { callShippingTool } from '../../src/mcp/tools.mjs';
import { createFixtureRepo } from '../helpers/repo.mjs';
import { pause } from '../../src/core/state.mjs';
import { runBoundedCommand } from '../../src/core/process.mjs';
import { ShippingError } from '../../src/core/errors.mjs';

test('shipping_execute after pause does not return a host work order', async () => {
  const fixture = await createFixtureRepo();
  try {
    const started = await callShippingTool(fixture.root, 'shipping_start', {
      goal: 'Ship one bounded and mechanically verified fixture release',
      release: '0.1.0',
    });
    await callShippingTool(fixture.root, 'shipping_approve_scope', {
      proposalId: started.structuredContent.proposalId,
      proposalHash: started.structuredContent.proposalHash,
      confirm: true,
    });
    await pause(fixture.root, 'operator stop');
    await assert.rejects(
      () => callShippingTool(fixture.root, 'shipping_execute', {}),
      (error) => error instanceof ShippingError && error.code === 'ERR_HUMAN_STOP',
    );
  } finally {
    await fixture.cleanup();
  }
});

test('runBoundedCommand abort kills the process group before the side effect', async () => {
  const fixture = await createFixtureRepo();
  try {
    const armed = path.join(fixture.root, 'armed');
    const fifo = path.join(fixture.root, 'block.fifo');
    const side = path.join(fixture.root, 'side-effect.txt');
    execSync(`mkfifo ${JSON.stringify(fifo)}`);
    const seenArmed = new Promise((resolve) => {
      const watcher = watch(fixture.root, (_event, file) => {
        if (file === 'armed' || existsSync(armed)) {
          watcher.close();
          resolve(undefined);
        }
      });
    });
    const ac = new AbortController();
    const pending = runBoundedCommand({
      command: `node -e ${JSON.stringify(`const fs=require('fs'); fs.writeFileSync(${JSON.stringify(armed)},'1'); fs.readFileSync(${JSON.stringify(fifo)}); fs.writeFileSync(${JSON.stringify(side)},'x');`)}`,
      cwd: fixture.root,
      timeoutSeconds: 8,
      maxOutputBytes: 4096,
      signal: ac.signal,
    });
    await seenArmed;
    ac.abort();
    const result = await pending;
    assert.equal(existsSync(side), false);
    assert.ok(result.signal || result.timedOut || result.exitCode !== 0);
  } finally {
    await fixture.cleanup();
  }
});
