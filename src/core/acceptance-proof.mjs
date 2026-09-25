import net from 'node:net';

const DOCS_GOAL = /documentation[- ]only|문서만|docs-only/iu;
const SOFTWARE_GOAL = /\b(?:mvp|app|application|runnable|launch)\b|구동|앱|user outcome|사용자 결과/iu;

/**
 * Classify an acceptance command. Weak classes cannot prove a software goal.
 * @param {string} command
 * @returns {'lint'|'diff-check'|'docs'|'start'|'liveness'|'other'}
 */
export function commandClass(command) {
  const text = String(command ?? '').trim();
  if (text === 'git diff --check') return 'diff-check';
  if (/^listen:\d{1,5}$/u.test(text)) return 'liveness';
  if (/^(?:npm start|npm run start|pnpm start|pnpm run start|yarn start|bun run start)$/u.test(text)) return 'start';
  if (/\bverify:docs\b|\bmarkdownlint\b/u.test(text)) return 'docs';
  if (/(?:^|\s)(?:npm run lint|pnpm run lint|yarn lint|bun run lint|npx eslint)(?:\s|$)/u.test(text)) return 'lint';
  return 'other';
}

/** @param {string} command @returns {boolean} */
export function isWeakCommand(command) {
  const kind = commandClass(command);
  return kind === 'lint' || kind === 'diff-check' || kind === 'docs';
}

/**
 * @param {Record<string, any>} criterion
 * @returns {string | null}
 */
export function namedUserOutcome(criterion) {
  const explicit = typeof criterion?.userOutcome === 'string' ? criterion.userOutcome.trim() : '';
  if (explicit) return explicit.slice(0, 200);
  const match = /^User outcome:\s*(\S(?:.*\S)?)/u.exec(String(criterion?.description ?? '').trim());
  return match ? match[1].slice(0, 200) : null;
}

/** @param {Record<string, any>} criterion @returns {boolean} */
export function isProvingCriterion(criterion) {
  if (!criterion || criterion.required === false) return false;
  const kind = commandClass(criterion.command);
  if (kind === 'start' || kind === 'liveness') return true;
  return Boolean(namedUserOutcome(criterion)) && !isWeakCommand(criterion.command);
}

/** @param {string} goal @returns {boolean} */
export function isSoftwareDeliveryGoal(goal) {
  const text = String(goal ?? '').trim();
  if (!text || DOCS_GOAL.test(text)) return false;
  return SOFTWARE_GOAL.test(text);
}

/** @param {Record<string, any>} contract @returns {boolean} */
export function softwareGoalRequiresProof(contract) {
  const policy = Array.isArray(contract?.blockerPolicy) ? contract.blockerPolicy : [];
  if (policy.includes('software-goal-unproven')) return true;
  return isSoftwareDeliveryGoal(contract?.goal);
}

/**
 * Blocker when a software goal's required acceptance is only lint, diff-check, or docs.
 * Cites the first required criterion so the issue has an acceptance basis.
 * @param {Record<string, any>} contract
 * @param {string | null} [runId]
 * @returns {Array<Record<string, any>>}
 */
export function softwareGoalGap(contract, runId = null) {
  if (!softwareGoalRequiresProof(contract)) return [];
  const required = (contract.acceptance ?? []).filter((entry) => entry?.required !== false);
  if (required.some((entry) => isProvingCriterion(entry))) return [];
  const cited = typeof required[0]?.id === 'string' ? required[0].id : 'AC-UNPROVEN';
  return [{
    id: 'ISSUE-SOFTWARE-GOAL',
    title: 'Software goal has no user-outcome check',
    description: 'A software-delivery goal cannot close on lint, git diff --check, or documentation-only acceptance. Require a repository-owned check that launches the app or asserts a named user outcome.',
    classification: 'BLOCKER',
    basisId: cited,
    evidenceRef: `acceptance:${cited}`,
    source: 'software-goal',
    runId,
  }];
}

/**
 * Name the release goal on the first non-weak command so a repo-owned test can prove it.
 * Leaves a lint/diff/docs-only list unchanged, which the gate then blocks.
 * @param {Array<Record<string, any>>} acceptance
 * @param {string} goal
 * @returns {Array<Record<string, any>>}
 */
export function annotateProvingOutcome(acceptance, goal) {
  const next = acceptance.map((entry) => ({ ...entry }));
  if (next.some((entry) => isProvingCriterion(entry))) return next;
  const host = next.find((entry) => entry && entry.required !== false && !isWeakCommand(entry.command));
  if (!host) return next;
  const name = String(goal ?? '').trim().slice(0, 180) || 'stated release outcome';
  host.description = `User outcome: ${name}. ${host.description ?? ''}`.trim().slice(0, 1000);
  return next;
}

/**
 * @param {Record<string, unknown>} scripts
 * @param {string} [manager]
 * @returns {{detected: true, command: string, script: string, source: string} | null}
 */
export function detectStartScript(scripts, manager = 'npm') {
  const script = scripts?.start;
  if (typeof script !== 'string' || !script.trim()) return null;
  const command = manager === 'yarn' ? 'yarn start'
    : manager === 'pnpm' ? 'pnpm start'
      : manager === 'bun' ? 'bun run start'
        : 'npm start';
  return { detected: true, command, script: script.trim().slice(0, 500), source: 'package.json' };
}

/**
 * Liveness predicate: true only when a TCP accept happens on the port.
 * @param {number} port
 * @param {string} [host]
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function portListens(port, host = '127.0.0.1', timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
