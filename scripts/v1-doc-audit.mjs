import path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { STABLE_SCHEMA_DESCRIPTORS, validateAllStableExamples } from '../packages/stable-control/index.mjs';

const root = process.cwd();
const required = [
  'README.md',
  'BACKLOG.md',
  'THIRD_PARTY.md',
  'docs/COMPATIBILITY.md',
  'docs/MIGRATION.md',
  'docs/HANDOVER.md',
  'docs/MCP.md',
  'docs/SECURITY-INVENTORY.md',
  'docs/TRACEABILITY.md',
  'docs/internal-runtime/OMO-RUNTIME.md',
  'docs/operations/INSTALL-UPGRADE-ROLLBACK.md',
  'docs/operations/RETENTION-SUPPORT.md',
  'docs/operations/INTERNAL-REMOTE-RUNBOOK.md',
  'docs/operations/INTERNAL-REMOTE-INCIDENT.md',
  'docs/operations/BACKUP-RESTORE.md',
  'schemas/v1/README.md',
  'schemas/v1/plain-brief.schema.json',
  'schemas/v1/examples/plain-brief.example.json',
  'docs/planning/25-V1.4.0-EVIDENCE-FIRST-PLAIN-BRIEF-DEVELOPMENT-PLAN.md',
  'docs/research/PAPERTHIN-APPLICATION-DECISION.md',
];

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(full);
  }
  return output;
}

const failures = [];
for (const relative of required) if (!existsSync(path.join(root, relative))) failures.push(`missing required document: ${relative}`);

const markdown = [
  ...['README.md', 'BACKLOG.md', 'THIRD_PARTY.md'].map((entry) => path.join(root, entry)).filter(existsSync),
  ...walk(path.join(root, 'docs')),
  path.join(root, 'schemas', 'v1', 'README.md'),
];
const seen = new Set();
for (const file of markdown) {
  const real = path.resolve(file);
  if (seen.has(real)) continue;
  seen.add(real);
  const text = readFileSync(real, 'utf8');
  if (/\[REDACTED\]/u.test(text)) failures.push(`literal redaction placeholder in ${path.relative(root, real)}`);
  if (/\b(?:TODO|TBD|FIXME)\b/u.test(text) && required.includes(path.relative(root, real))) failures.push(`unfinished placeholder in ${path.relative(root, real)}`);
  const withoutFences = text.replace(/```[\s\S]*?```/gu, '');
  for (const match of withoutFences.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1].trim().split('#')[0];
    if (!target || /^(?:https?:|mailto:|#)/u.test(target)) continue;
    target = decodeURIComponent(target.replace(/^<|>$/gu, ''));
    const resolved = path.resolve(path.dirname(real), target);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) failures.push(`link escapes repository in ${path.relative(root, real)}: ${target}`);
    else if (!existsSync(resolved)) failures.push(`broken local link in ${path.relative(root, real)}: ${target}`);
  }
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const dependencyNames = Object.keys({
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
});
if (dependencyNames.some((name) => /paperthin/u.test(name))) failures.push('Paperthin must remain a conceptual reference, not a package dependency');
const plainSchema = JSON.parse(readFileSync(path.join(root, 'schemas', 'v1', 'plain-brief.schema.json'), 'utf8'));
const plainExample = JSON.parse(readFileSync(path.join(root, 'schemas', 'v1', 'examples', 'plain-brief.example.json'), 'utf8'));
if (plainSchema.$id !== 'https://shipping-harness.local/schemas/v1/plain-brief.schema.json') failures.push('plain brief schema identifier mismatch');
if (plainExample.schema !== 'shipping-harness/plain-brief-v1' || plainExample.quality?.healthy !== true) failures.push('plain brief example is not a healthy compiler output');
const activeContract = JSON.parse(readFileSync(path.join(root, '.shipping', 'contract.yaml'), 'utf8'));
if (packageJson.version !== activeContract.release) failures.push(`package version is ${packageJson.version}, active release is ${activeContract.release}`);
if (!/^1\.\d+\.\d+$/u.test(packageJson.version)) failures.push(`package version ${packageJson.version} is outside the stable v1 release line`);
for (const key of ['test:stable', 'benchmark:completion', 'smoke:stable', 'security:inventory', 'verify:docs', 'acceptance:v1']) {
  if (typeof packageJson.scripts?.[key] !== 'string') failures.push(`missing package script: ${key}`);
}
if (!(packageJson.files ?? []).includes('schemas/')) failures.push('installable package does not include schemas/');
if (!(packageJson.files ?? []).includes('!docs/reports/**')) failures.push('installable package does not exclude repository-local reports');

const schemas = await validateAllStableExamples();
if (schemas.length !== Object.keys(STABLE_SCHEMA_DESCRIPTORS).length) failures.push('stable schema/example count mismatch');
for (const descriptor of Object.values(STABLE_SCHEMA_DESCRIPTORS)) {
  if (!statSync(descriptor.schemaPath).isFile() || !statSync(descriptor.examplePath).isFile()) failures.push(`missing stable schema material: ${descriptor.name}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`docs: ${seen.size} markdown files, ${schemas.length} stable schemas/examples, required v1 links and package docs passed\n`);
}
