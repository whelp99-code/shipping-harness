import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { walkFiles, relative } from './shared.mjs';

const sourceFiles = await walkFiles(path.resolve('src'), (file) => file.endsWith('.mjs'));
const binFiles = await walkFiles(path.resolve('bin'), (file) => file.endsWith('.mjs'));
const files = [...sourceFiles, ...binFiles];
const failures = [];

const importPattern = /(?:from\s+|import\s*)['"](\.[^'"]+)['"]/gu;
for (const filePath of files) {
  const content = await readFile(filePath, 'utf8');
  for (const match of content.matchAll(importPattern)) {
    const resolved = path.resolve(path.dirname(filePath), match[1]);
    try {
      await access(resolved);
    } catch {
      failures.push(`${relative(filePath)} imports missing ${match[1]}`);
    }
  }
  if (sourceFiles.includes(filePath)) {
    try {
      await import(`${pathToFileURL(filePath).href}?typecheck=${Date.now()}`);
    } catch (error) {
      failures.push(`${relative(filePath)} failed dynamic import: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const [name, binPath] of Object.entries(packageJson.bin ?? {})) {
  try {
    await access(path.resolve(String(binPath)));
  } catch {
    failures.push(`package bin ${name} points to missing ${binPath}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`typecheck: ${files.length} modules and package entrypoints resolved\n`);
}