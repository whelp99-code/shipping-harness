import path from 'node:path';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { walkFiles } from './shared.mjs';

const root = process.cwd();
const destination = path.join(root, 'dist');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const entry of ['src', 'packages', 'schemas', 'bin', 'config', 'docs', 'README.md', 'LICENSE', 'THIRD_PARTY.md']) {
  await cp(path.join(root, entry), path.join(destination, entry), { recursive: true });
}
// Operational evidence is repository-local and must not become part of the installable package.
await rm(path.join(destination, 'docs', 'reports'), { recursive: true, force: true });

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const distributionPackage = {
  ...packageJson,
  private: false,
  scripts: undefined,
  devDependencies: undefined,
};
await writeFile(path.join(destination, 'package.json'), `${JSON.stringify(distributionPackage, null, 2)}\n`, 'utf8');
for (const executable of [
  'shipping-harness.mjs',
  'shipping-harness-mcp.mjs',
  'shipping-harness-plugin.mjs',
  'shipping-harness-remote.mjs',
]) {
  await chmod(path.join(destination, 'bin', executable), 0o755);
}

const files = await walkFiles(destination);
const manifest = [];
for (const filePath of files) {
  const content = await readFile(filePath);
  manifest.push({
    path: path.relative(destination, filePath).replaceAll('\\', '/'),
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}
manifest.sort((left, right) => left.path.localeCompare(right.path));
await writeFile(
  path.join(destination, 'BUILD-MANIFEST.json'),
  `${JSON.stringify({ schema: 'shipping-harness/build-v1', version: packageJson.version, files: manifest }, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`build: dist created with ${manifest.length} files for ${packageJson.version}\n`);
