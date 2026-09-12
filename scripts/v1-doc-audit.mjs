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
  'docs/planning/26-V1.5.0-RELEASE-TRAIN-PLANNER-DEVELOPMENT-PLAN.md',
  'docs/planning/27-V1.6.0-POLICY-AUTHORIZED-AUTOPILOT-DEVELOPMENT-PLAN.md',
  'docs/planning/28-V1.6.1-AUTOPILOT-FIELD-HARDENING-DEVELOPMENT-PLAN.md',
  'docs/operations/AUTOPILOT-RUNBOOK.md',
  'scripts/autopilot-field-pilot.mjs',
  'test/autopilot/field-matrix.test.mjs',
  'test/autopilot/autopilot-performance.test.mjs',
  'test/adversarial/autopilot-field-attacks.test.mjs',
  'docs/reports/v1.6.1-autopilot-field.json',
  'schemas/v1/release-train.schema.json',
  'schemas/v1/examples/release-train.example.json',
  'docs/research/PAPERTHIN-APPLICATION-DECISION.md',
  'schemas/v1/goal-discovery.schema.json',
  'schemas/v1/decision-ledger-event.schema.json',
  'schemas/v1/goal-charter.schema.json',
  'schemas/v1/intent-gate.schema.json',
  'schemas/v1/examples/intent-gate.example.json',
  'docs/planning/29-V1.7.0-BOUNDED-GOAL-DISCOVERY-AND-DIRECTION-LEDGER-DEVELOPMENT-PLAN.md',
  'docs/planning/30-V1.8.0-GOAL-CHARTER-AND-DIRECTION-CRITIC-DEVELOPMENT-PLAN.md',
  'docs/planning/31-V1.8.1-GOAL-DISCOVERY-AND-CHARTER-FIELD-HARDENING-DEVELOPMENT-PLAN.md',
  'scripts/goal-discovery-pilot.mjs',
  'scripts/goal-charter-pilot.mjs',
  'scripts/goal-charter-field-pilot.mjs',
  'test/integration/goal-direction-field.test.mjs',
  'test/adversarial/goal-direction-field-attacks.test.mjs',
  'test/integration/goal-direction-field-performance.test.mjs',
  'docs/reports/v1.8.1-goal-charter-field.json',
  'docs/planning/33-V1.8.3-INTENT-GATE-AND-ANALYSIS-MODE-DEVELOPMENT-PLAN.md',
  'scripts/intent-gate-pilot.mjs',
  'docs/reports/v1.8.3-intent-gate-field.json',
  'test/unit/intent-gate.test.mjs',
  'test/mcp/intent-gate.test.mjs',
  'test/adversarial/intent-gate-attacks.test.mjs',
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
const intentGateReport = JSON.parse(readFileSync(path.join(root, 'docs', 'reports', 'v1.8.3-intent-gate-field.json'), 'utf8'));
if (intentGateReport.schema !== 'shipping-harness/intent-gate-field-v1' || intentGateReport.status !== 'PASS' || intentGateReport.mcp?.tools !== 9) failures.push('intent gate field report is not a passing bounded internal report');
if (intentGateReport.cases?.terseAnalysis?.status !== 'CONFIRMATION_REQUIRED' || intentGateReport.cases?.terseAnalysis?.defaultMode !== 'ANALYZE_ONLY' || intentGateReport.cases?.terseAnalysis?.questionCount !== 1) failures.push('intent gate field report does not preserve the one-question analysis default');
if (Object.values(intentGateReport.safety ?? {}).some((value) => value !== 0)) failures.push('intent gate field report contains a non-zero safety counter');
if (intentGateReport.realProject?.available && intentGateReport.realProject?.unchanged !== true) failures.push('intent gate field report contains a mutated real-project lane');
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
