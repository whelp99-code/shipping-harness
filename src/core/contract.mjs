import { exists, readJson, writeAtomic, writeJsonAtomic } from './fs.mjs';
import { hashObject, stableStringify } from './crypto.mjs';
import { ShippingError, invariant } from './errors.mjs';
import { runtimePaths } from './paths.mjs';

export const CONTRACT_SCHEMA = 'shipping-harness/v1';

/** @param {string} projectName */
export function createDefaultContract(projectName) {
  return {
    schema: CONTRACT_SCHEMA,
    project: projectName,
    worker: 'shipping-harness',
    release: '0.1.0',
    goal: 'Describe one end-to-end outcome that this version must ship.',
    scope: {
      include: ['Describe included product behavior.'],
      exclude: ['Describe explicitly deferred behavior.'],
      paths: {
        include: ['src/**', 'test/**', 'tests/**', 'scripts/**', 'docs/**', 'README.md', 'package.json', 'package-lock.json'],
        exclude: ['.shipping/contract.yaml', '.shipping/contract.lock', '.git/**'],
      },
    },
    acceptance: [
      {
        id: 'AC-001',
        description: 'The project test command passes.',
        type: 'command',
        command: 'npm test',
        cwd: '.',
        required: true,
        timeoutSeconds: 300,
      },
    ],
    blockerPolicy: [
      'acceptance-failure',
      'contract-tamper',
      'stale-evidence',
      'scope-drift',
      'data-loss',
      'critical-security',
    ],
    budgets: {
      maxFixCycles: 2,
      maxAgentRuns: 3,
      maxCommandSeconds: 900,
      maxOutputBytes: 1048576,
    },
    stopPolicy: {
      humanInterruptWins: true,
      autoContinueAfterInterrupt: false,
      closeWhenRequiredGatesPass: true,
    },
    releasePolicy: {
      autoCommit: false,
      autoTag: false,
      autoPush: false,
      generateReport: true,
    },
    adapters: {
      generic: { command: null, artifactPaths: [] },
      codex: { command: null, artifactPaths: [] },
    },
  };
}

/** @param {unknown} value @returns {asserts value is Record<string, unknown>} */
function requireObject(value, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'ERR_CONTRACT_INVALID', `${label} must be an object`, { label });
}

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  invariant(typeof value === 'string' && value.trim().length > 0, 'ERR_CONTRACT_INVALID', `${label} must be a non-empty string`, { label });
}

/** @param {unknown} value @param {string} label */
function requireStringArray(value, label) {
  invariant(Array.isArray(value) && value.every((item) => typeof item === 'string'), 'ERR_CONTRACT_INVALID', `${label} must be an array of strings`, { label });
}

/** @param {unknown} value @param {string} label @param {{min?: number, max?: number}} [range] */
function requireInteger(value, label, range = {}) {
  invariant(typeof value === 'number' && Number.isInteger(value), 'ERR_CONTRACT_INVALID', `${label} must be an integer`, { label, value });
  if (range.min !== undefined) invariant(value >= range.min, 'ERR_CONTRACT_INVALID', `${label} must be >= ${range.min}`, { label, value });
  if (range.max !== undefined) invariant(value <= range.max, 'ERR_CONTRACT_INVALID', `${label} must be <= ${range.max}`, { label, value });
}

/** @param {unknown} input */
export function validateContract(input) {
  requireObject(input, 'contract');
  const contract = /** @type {Record<string, any>} */ (input);
  invariant(contract.schema === CONTRACT_SCHEMA, 'ERR_CONTRACT_INVALID', `schema must equal ${CONTRACT_SCHEMA}`);
  requireString(contract.project, 'project');
  requireString(contract.worker, 'worker');
  requireString(contract.release, 'release');
  invariant(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(contract.release), 'ERR_CONTRACT_INVALID', 'release must be a semantic version', { release: contract.release });
  requireString(contract.goal, 'goal');

  requireObject(contract.scope, 'scope');
  requireStringArray(contract.scope.include, 'scope.include');
  requireStringArray(contract.scope.exclude, 'scope.exclude');
  requireObject(contract.scope.paths, 'scope.paths');
  requireStringArray(contract.scope.paths.include, 'scope.paths.include');
  requireStringArray(contract.scope.paths.exclude, 'scope.paths.exclude');

  invariant(Array.isArray(contract.acceptance) && contract.acceptance.length > 0, 'ERR_CONTRACT_INVALID', 'acceptance must contain at least one criterion');
  const ids = new Set();
  let requiredCount = 0;
  for (const [index, rawCriterion] of contract.acceptance.entries()) {
    requireObject(rawCriterion, `acceptance[${index}]`);
    const criterion = /** @type {Record<string, any>} */ (rawCriterion);
    requireString(criterion.id, `acceptance[${index}].id`);
    invariant(/^AC-[0-9A-Z_-]+$/u.test(criterion.id), 'ERR_CONTRACT_INVALID', `Invalid acceptance ID: ${criterion.id}`);
    invariant(!ids.has(criterion.id), 'ERR_CONTRACT_INVALID', `Duplicate acceptance ID: ${criterion.id}`);
    ids.add(criterion.id);
    requireString(criterion.description, `${criterion.id}.description`);
    invariant(criterion.type === 'command', 'ERR_CONTRACT_INVALID', `${criterion.id}.type must be command`);
    requireString(criterion.command, `${criterion.id}.command`);
    invariant(typeof criterion.required === 'boolean', 'ERR_CONTRACT_INVALID', `${criterion.id}.required must be boolean`);
    if (criterion.required) requiredCount += 1;
    if (criterion.cwd !== undefined) requireString(criterion.cwd, `${criterion.id}.cwd`);
    if (criterion.timeoutSeconds !== undefined) requireInteger(criterion.timeoutSeconds, `${criterion.id}.timeoutSeconds`, { min: 1, max: 86400 });
    if (criterion.sideEffect !== undefined) invariant(['none-or-test-output', 'build-artifacts', 'generated-artifacts', 'data-state', 'external-state'].includes(criterion.sideEffect), 'ERR_CONTRACT_INVALID', `${criterion.id}.sideEffect is invalid`);
    if (criterion.isolationRequired !== undefined) invariant(typeof criterion.isolationRequired === 'boolean', 'ERR_CONTRACT_INVALID', `${criterion.id}.isolationRequired must be boolean`);
    if (criterion.deterministicOutputRequired !== undefined) invariant(typeof criterion.deterministicOutputRequired === 'boolean', 'ERR_CONTRACT_INVALID', `${criterion.id}.deterministicOutputRequired must be boolean`);
    if (criterion.automaticallyRunnable !== undefined) invariant(typeof criterion.automaticallyRunnable === 'boolean', 'ERR_CONTRACT_INVALID', `${criterion.id}.automaticallyRunnable must be boolean`);
    if (criterion.deterministicOutputRequired === true) invariant(criterion.isolationRequired === true, 'ERR_CONTRACT_INVALID', `${criterion.id} deterministic output requires isolation`);
  }
  invariant(requiredCount > 0, 'ERR_CONTRACT_INVALID', 'At least one acceptance criterion must be required');

  requireStringArray(contract.blockerPolicy, 'blockerPolicy');
  requireObject(contract.budgets, 'budgets');
  requireInteger(contract.budgets.maxFixCycles, 'budgets.maxFixCycles', { min: 0, max: 100 });
  requireInteger(contract.budgets.maxAgentRuns, 'budgets.maxAgentRuns', { min: 0, max: 1000 });
  requireInteger(contract.budgets.maxCommandSeconds, 'budgets.maxCommandSeconds', { min: 1, max: 86400 });
  requireInteger(contract.budgets.maxOutputBytes, 'budgets.maxOutputBytes', { min: 1024, max: 100 * 1024 * 1024 });
  if (contract.budgets.maxVerifyRuns !== undefined) requireInteger(contract.budgets.maxVerifyRuns, 'budgets.maxVerifyRuns', { min: 1, max: 100 });

  requireObject(contract.stopPolicy, 'stopPolicy');
  invariant(contract.stopPolicy.humanInterruptWins === true, 'ERR_CONTRACT_INVALID', 'stopPolicy.humanInterruptWins must be true');
  invariant(contract.stopPolicy.autoContinueAfterInterrupt === false, 'ERR_CONTRACT_INVALID', 'stopPolicy.autoContinueAfterInterrupt must be false');
  requireObject(contract.releasePolicy, 'releasePolicy');

  if (contract.adapters !== undefined) requireObject(contract.adapters, 'adapters');
  return contract;
}

/** @param {string} contractPath */
export async function loadContract(contractPath) {
  const parsed = await readJson(contractPath);
  return validateContract(parsed);
}

/** @param {Record<string, any>} contract */
export function contractHash(contract) {
  return hashObject(validateContract(contract));
}

/** @param {string} root @param {string} projectName */
export async function initializeContract(root, projectName) {
  const paths = runtimePaths(root);
  if (await exists(paths.contract)) {
    throw new ShippingError('ERR_ALREADY_INITIALIZED', `Contract already exists at ${paths.contract}`, { path: paths.contract });
  }
  const contract = createDefaultContract(projectName);
  await writeAtomic(paths.contract, stableStringify(contract));
  return { contract, path: paths.contract };
}

/** @param {string} root @param {string} baselineSha */
export async function lockContract(root, baselineSha) {
  const paths = runtimePaths(root);
  const contract = await loadContract(paths.contract);
  invariant(typeof baselineSha === 'string' && baselineSha.length >= 7, 'ERR_GIT_HEAD_REQUIRED', 'A valid Git HEAD is required before lock');
  const existing = await exists(paths.lock) ? await readJson(paths.lock) : null;
  const lock = {
    schema: 'shipping-harness/lock-v1',
    contractHash: contractHash(contract),
    baselineSha,
    release: contract.release,
    scopeRevision: existing && typeof existing.scopeRevision === 'number' ? existing.scopeRevision + 1 : 1,
    lockedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(paths.lock, lock);
  return { contract, lock };
}

/** @param {string} root */
export async function assertLockedContract(root) {
  const paths = runtimePaths(root);
  const contract = await loadContract(paths.contract);
  const lock = await readJson(paths.lock);
  invariant(lock && typeof lock === 'object', 'ERR_LOCK_INVALID', 'Contract lock is invalid');
  const currentHash = contractHash(contract);
  invariant(lock.contractHash === currentHash, 'ERR_CONTRACT_TAMPERED', 'Contract changed after lock', {
    lockedHash: lock.contractHash,
    currentHash,
  });
  invariant(lock.release === contract.release, 'ERR_CONTRACT_TAMPERED', 'Release changed after lock', {
    lockedRelease: lock.release,
    currentRelease: contract.release,
  });
  return { contract, lock, currentHash };
}