#!/usr/bin/env node
import { handleCliError, main } from '../src/cli.mjs';

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    process.exitCode = handleCliError(error);
  },
);