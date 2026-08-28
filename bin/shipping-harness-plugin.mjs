#!/usr/bin/env node
import { main } from '../packages/shipping-plugin/installer/cli.mjs';

main().catch((error) => {
  process.stderr.write(`shipping-harness-plugin: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
