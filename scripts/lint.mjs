import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { walkFiles, text, relative } from './shared.mjs';

const roots = ['src', 'bin', 'scripts', 'test'];
// scripts/archive/ holds one-off scripts from past versions (see scripts/archive/README.md);
// they are kept for historical reference only and are excluded from lint the same way
// eslint.config.mjs excludes them.
const isArchived = (file) => relative(file).startsWith('scripts/archive/');
const sourceFiles = (await Promise.all(
  roots.map((root) => walkFiles(path.resolve(root), (file) => /\.(?:mjs|js)$/u.test(file) && !isArchived(file))),
)).flat();

const failures = [];
for (const filePath of sourceFiles) {
  const syntax = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8', timeout: 10000 });
  if (syntax.status !== 0) failures.push(`${relative(filePath)}: syntax error\n${syntax.stderr || syntax.stdout}`);
  const content = await text(filePath);
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (/[\t ]+$/u.test(line)) failures.push(`${relative(filePath)}:${index + 1}: trailing whitespace`);
    if (line.includes('\t')) failures.push(`${relative(filePath)}:${index + 1}: tab character`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`lint: ${sourceFiles.length} source files passed\n`);
}