import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { hashObject } from './crypto.mjs';
import { invariant } from './errors.mjs';
import { assertContainedPath, ensureDir, readJson, writeJsonAtomic } from './fs.mjs';
import { runtimePaths } from './paths.mjs';
import { analyzeRepository } from './project-analysis.mjs';

const SCHEMA = 'shipping-harness/prep-approval-v1';
const MAX_BYTES = 64 * 1024;

/** @param {unknown} value @returns {string} */
function normalizeRel(value) {
  const rel = String(value ?? '').replaceAll('\\', '/').replace(/^\.\//u, '');
  invariant(rel.length > 0 && rel.length <= 300, 'ERR_PREP_SCOPE', 'Prep path is missing or too long');
  invariant(!rel.startsWith('/') && !rel.split('/').includes('..'), 'ERR_PREP_SCOPE', 'Prep path must stay inside the repository');
  invariant(rel !== '.shipping/contract.yaml' && !rel.startsWith('.shipping/') && !rel.startsWith('.git/'), 'ERR_PREP_SCOPE', 'Prep scope cannot cover shipping authority files');
  return rel;
}

/** @param {string} rel @param {string[]} approved @returns {boolean} */
function pathAllowed(rel, approved) {
  return approved.some((entry) => {
    if (entry.endsWith('/**')) {
      const prefix = entry.slice(0, -2);
      return rel === prefix.slice(0, -1) || rel.startsWith(prefix);
    }
    return rel === entry;
  });
}

/** @param {unknown} value @returns {string[]} */
function kindList(value) {
  const kinds = Array.isArray(value) ? value : String(value ?? 'test,start').split(',');
  const normalized = kinds.map((entry) => String(entry).trim()).filter(Boolean);
  invariant(normalized.length > 0 && normalized.every((entry) => entry === 'test' || entry === 'start'), 'ERR_PREP_SCOPE', 'Prep kinds must be test and/or start');
  return [...new Set(normalized)];
}

/**
 * Record a separately approved preparation scope. Does not write contract.yaml.
 * @param {string} root
 * @param {{approver: string, paths: string[], kinds?: string[]}} input
 * @returns {Promise<Record<string, any>>}
 */
export async function approvePrepScope(root, input) {
  const approver = String(input.approver ?? '').trim();
  invariant(approver.length > 0 && approver.length <= 160, 'ERR_PREP_AUTHORITY', 'Prep scope requires a named operator approver');
  invariant(!/^(?:model|assistant|system)$/iu.test(approver), 'ERR_PREP_AUTHORITY', 'A model cannot approve a preparation scope');
  const paths = (input.paths ?? []).map(normalizeRel);
  invariant(paths.length > 0 && paths.length <= 32, 'ERR_PREP_SCOPE', 'Prep scope needs 1 to 32 paths');
  const body = {
    schema: SCHEMA,
    approver,
    paths,
    kinds: kindList(input.kinds),
    approvedAt: new Date().toISOString(),
    modelAuthority: false,
  };
  const approval = { ...body, hash: hashObject(body) };
  await writeJsonAtomic(runtimePaths(root).prepApproval, approval);
  return approval;
}

/** @param {string} root @returns {Promise<Record<string, any>>} */
async function loadApproval(root) {
  const filePath = runtimePaths(root).prepApproval;
  const approval = await readJson(filePath);
  invariant(approval?.schema === SCHEMA && approval.modelAuthority === false, 'ERR_PREP_SCOPE', 'Preparation approval is missing or unsigned');
  return approval;
}

/** @param {string} root @param {string} rel @param {string} contents */
async function writeApprovedFile(root, rel, contents) {
  invariant(Buffer.byteLength(contents) <= MAX_BYTES, 'ERR_PREP_SCOPE', 'Prep file exceeds the size budget');
  const absolute = await assertContainedPath(root, path.join(root, rel));
  await ensureDir(path.dirname(absolute));
  await writeFile(absolute, contents, 'utf8');
}

/** @param {string} root @param {string} kind @param {string} script */
async function writePackageScript(root, kind, script) {
  invariant(script.length > 0 && script.length <= 500, 'ERR_PREP_SCOPE', 'Prep script is missing or too long');
  const packagePath = path.join(root, 'package.json');
  const parsed = JSON.parse(await readFile(packagePath, 'utf8'));
  parsed.scripts = { ...(parsed.scripts ?? {}), [kind]: script };
  await writeFile(packagePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

/**
 * Author a test or start script inside the approved prep scope, then leave contract.yaml untouched.
 * @param {string} root
 * @param {{kind: string, script: string, relPath?: string | null, contents?: string | null}} input
 * @returns {Promise<{kind: string, wrote: string[]}>}
 */
export async function authorPrep(root, input) {
  const approval = await loadApproval(root);
  const kind = String(input.kind ?? '');
  invariant(approval.kinds.includes(kind), 'ERR_PREP_SCOPE', `Kind ${kind} is outside the approved prep scope`);
  const wrote = [];
  if (input.relPath) {
    const rel = normalizeRel(input.relPath);
    invariant(pathAllowed(rel, approval.paths), 'ERR_PREP_SCOPE', `Path ${rel} is outside the approved prep scope`);
    await writeApprovedFile(root, rel, String(input.contents ?? ''));
    wrote.push(rel);
  }
  invariant(pathAllowed('package.json', approval.paths), 'ERR_PREP_SCOPE', 'package.json is outside the approved prep scope');
  await writePackageScript(root, kind, String(input.script ?? ''));
  wrote.push('package.json');
  return { kind, wrote };
}

/**
 * Re-read the repository. Detection only: this does not write contract.yaml.
 * @param {string} root
 * @returns {Promise<{test: string | null, start: Record<string, any> | null, contractWritten: false}>}
 */
export async function rescanPrep(root) {
  const analysis = await analyzeRepository(root);
  const test = analysis.candidateCommands.find((entry) => entry.command === 'npm test' || entry.command === 'npm run test') ?? null;
  return { test: test?.command ?? null, start: analysis.start ?? null, contractWritten: false };
}
