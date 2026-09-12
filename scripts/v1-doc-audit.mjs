import path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { STABLE_SCHEMA_DESCRIPTORS, validateAllStableExamples } from '../packages/stable-control/index.mjs';

const root = process.cwd();

// (a) Core documents that must always exist, regardless of which version added them.
// Version-specific planning docs, schema/example pairs, and field reports are instead
// enforced by the directory scans below (auditPlanningSequence / auditSchemaExamplePairs),
// so a new version's plan or schema does not need a new hardcoded entry here.
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
  'docs/operations/AUTOPILOT-RUNBOOK.md',
  'docs/research/PAPERTHIN-APPLICATION-DECISION.md',
  'schemas/v1/README.md',
];

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(full);
  }
  return output;
}

/**
 * (b1) docs/planning/*.md must be numbered with no gaps, starting at 00. This replaces
 * hardcoding every individual plan doc: adding docs/planning/34-....md just needs 34 to
 * be the next integer after the highest existing one.
 * @param {string[]} failures
 * @returns {string[]} the discovered planning doc relative paths, for the placeholder scan
 */
function auditPlanningSequence(failures) {
  const dir = path.join(root, 'docs', 'planning');
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const match = entry.name.match(/^(\d+)-/u);
      return match ? { name: entry.name, num: Number(match[1]) } : null;
    });
  if (entries.some((entry) => entry === null)) failures.push('docs/planning contains a file without a leading NN- sequence number');
  const numbered = entries.filter(Boolean).sort((a, b) => a.num - b.num);
  numbered.forEach((entry, index) => {
    if (entry.num !== index) failures.push(`docs/planning numbering has a gap: expected ${index}, found ${entry.num} (${entry.name})`);
  });
  return numbered.map((entry) => path.join('docs', 'planning', entry.name));
}

/**
 * (b2) Every schemas/v1/<name>.schema.json must have a matching
 * schemas/v1/examples/<name>.example.json, and vice versa.
 * @param {string[]} failures
 */
function auditSchemaExamplePairs(failures) {
  const schemaDir = path.join(root, 'schemas', 'v1');
  const exampleDir = path.join(schemaDir, 'examples');
  const schemaNames = new Set(readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json')).map((f) => f.replace(/\.schema\.json$/u, '')));
  const exampleNames = new Set(readdirSync(exampleDir).filter((f) => f.endsWith('.example.json')).map((f) => f.replace(/\.example\.json$/u, '')));
  for (const name of schemaNames) if (!exampleNames.has(name)) failures.push(`schemas/v1/${name}.schema.json has no matching examples/${name}.example.json`);
  for (const name of exampleNames) if (!schemaNames.has(name)) failures.push(`schemas/v1/examples/${name}.example.json has no matching ${name}.schema.json`);
}

const failures = [];
for (const relative of required) if (!existsSync(path.join(root, relative))) failures.push(`missing required document: ${relative}`);
const planningDocs = auditPlanningSequence(failures);
auditSchemaExamplePairs(failures);

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
  const relativePath = path.relative(root, real);
  if (/\b(?:TODO|TBD|FIXME)\b/u.test(text) && (required.includes(relativePath) || planningDocs.includes(relativePath))) failures.push(`unfinished placeholder in ${relativePath}`);
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

/**
 * (c) README's "**Version:** X.Y.Z" line, HANDOVER's "**Current version:** X.Y.Z" line, and
 * CHANGELOG's topmost "## [X.Y.Z]" entry must all equal package.json version. This checks
 * one designated line per file, not every historical "vX.Y.Z ..." heading those documents
 * also contain.
 * @param {string[]} failures
 * @param {string} version
 */
function auditVersionMentions(failures, version) {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const readmeMatch = readme.match(/^\*\*Version:\*\*\s*(\S+)/mu);
  if (!readmeMatch) failures.push('README.md has no "**Version:** X.Y.Z" line');
  else if (readmeMatch[1] !== version) failures.push(`README.md version line is ${readmeMatch[1]}, package.json is ${version}`);

  const handover = readFileSync(path.join(root, 'docs', 'HANDOVER.md'), 'utf8');
  const handoverMatch = handover.match(/^\*\*Current version:\*\*\s*(\S+)/mu);
  if (!handoverMatch) failures.push('docs/HANDOVER.md has no "**Current version:** X.Y.Z" line');
  else if (handoverMatch[1] !== version) failures.push(`docs/HANDOVER.md current-version line is ${handoverMatch[1]}, package.json is ${version}`);

  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const changelogMatch = changelog.match(/^##\s*\[([^\]]+)\]/mu);
  if (!changelogMatch) failures.push('CHANGELOG.md has no topmost "## [X.Y.Z]" entry');
  else if (changelogMatch[1] !== version) failures.push(`CHANGELOG.md topmost version is ${changelogMatch[1]}, package.json is ${version}`);
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
auditVersionMentions(failures, packageJson.version);
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
const trainSchema = JSON.parse(readFileSync(path.join(root, 'schemas', 'v1', 'release-train.schema.json'), 'utf8'));
const trainExample = JSON.parse(readFileSync(path.join(root, 'schemas', 'v1', 'examples', 'release-train.example.json'), 'utf8'));
if (trainSchema.$id !== 'shipping-harness/release-train-v1') failures.push('release train schema identifier mismatch');
if (trainExample.schema !== 'shipping-harness/release-train-v1' || trainExample.modelAuthority !== false || trainExample.releases?.length < 1) failures.push('release train example is not a bounded model-independent train');
const fieldReport = JSON.parse(readFileSync(path.join(root, 'docs', 'reports', 'v1.6.1-autopilot-field.json'), 'utf8'));
if (fieldReport.schema !== 'shipping-harness/autopilot-field-pilot-v1' || fieldReport.status !== 'PASS' || fieldReport.released !== false || fieldReport.mcpTools !== 9) failures.push('autopilot field report is not a passing bounded internal report');
if (Object.values(fieldReport.safety ?? {}).some((value) => value !== 0)) failures.push('autopilot field report contains a non-zero safety counter');
if ((fieldReport.realProjects ?? []).filter((entry) => entry.available).some((entry) => entry.unchanged !== true)) failures.push('autopilot field report contains a mutated real-project lane');
const goalDirectionFieldReport = JSON.parse(readFileSync(path.join(root, 'docs', 'reports', 'v1.8.1-goal-charter-field.json'), 'utf8'));
if (goalDirectionFieldReport.schema !== 'shipping-harness/goal-direction-field-v1' || goalDirectionFieldReport.status !== 'PASS' || goalDirectionFieldReport.released !== false || goalDirectionFieldReport.mcp?.tools !== 9) failures.push('goal direction field report is not a passing bounded internal report');
if (Object.values(goalDirectionFieldReport.safety ?? {}).some((value) => value !== 0)) failures.push('goal direction field report contains a non-zero safety counter');
if ((goalDirectionFieldReport.realProjects ?? []).filter((entry) => entry.available).some((entry) => entry.unchanged !== true)) failures.push('goal direction field report contains a mutated real-project lane');
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
