#!/usr/bin/env node
import path from 'node:path';
import { findGitRoot } from '../src/core/git.mjs';
import { startStdioServer } from '../src/mcp/stdio.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
}

try {
  const requestedRoot = option('--root') || process.env.SHIPPING_HARNESS_ROOT || process.cwd();
  const root = findGitRoot(path.resolve(requestedRoot));
  const { completed } = startStdioServer({ root });
  await completed;
} catch (error) {
  process.stderr.write(`shipping-harness-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}