#!/usr/bin/env node
import { main } from '../packages/omp-main-harness/cli.mjs';

main().catch((error) => {
  const code = error && typeof error === 'object' && 'code' in error ? ` [${error.code}]` : '';
  process.stderr.write(`shipping-harness-omp: ${error instanceof Error ? error.message : String(error)}${code}\n`);
  process.exitCode = 1;
});
