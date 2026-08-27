import { access, readFile } from 'node:fs/promises';

const failures = [];
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.license !== 'MIT') failures.push(`package license is ${String(packageJson.license)}, expected MIT`);
const license = await readFile('LICENSE', 'utf8');
if (!license.startsWith('MIT License')) failures.push('LICENSE is not the expected MIT text');
const inventory = await readFile('THIRD_PARTY.md', 'utf8');
for (const project of ['Codex', 'Gajae', 'Ouroboros', 'OMO']) {
  if (!inventory.includes(project)) failures.push(`THIRD_PARTY.md missing ${project}`);
}
for (const directory of ['vendor', 'third_party', 'third-party']) {
  try {
    await access(directory);
    failures.push(`unexpected vendored source directory: ${directory}`);
  } catch {
    // Expected.
  }
}
if (Object.keys(packageJson.dependencies ?? {}).length > 0) failures.push('runtime dependency inventory is not empty');

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('license: MIT and third-party interoperability inventory verified\n');
}