import { readFileSync } from 'node:fs';

const POSTGRES_PIN = /^postgres@sha256:[a-f0-9]{64}$/u;
const DEFAULT_ENVIRONMENT_FILE = '/etc/environment';
const DEFAULT_REVIEW_UI_BASE = 'http://127.0.0.1:4174/';

/**
 * @param {{ dockerPath: string | null, postgresImage: string, reviewUiOk: boolean, realAccountOk: boolean, revision?: string }} input
 */
export function decideCore5Release(input) {
  const blockers = [];
  if (!input.dockerPath) blockers.push({ id: 'H02', reason: 'docker is not on PATH' });
  if (!POSTGRES_PIN.test(String(input.postgresImage || '').trim())) {
    blockers.push({ id: 'H02-image', reason: 'CORE5_POSTGRES_IMAGE must be postgres@sha256:<64 hex>' });
  }
  if (!input.reviewUiOk) blockers.push({ id: 'H03', reason: 'no authenticated Core5 review UI' });
  if (!input.realAccountOk) blockers.push({ id: 'K04', reason: 'no allowed real test accounts' });
  const shippable = blockers.length === 0;
  return {
    schema: 'shipping-harness/core5-decision.v1',
    state: shippable ? 'SHIPPABLE' : 'NOT_SHIPPABLE',
    releaseDecision: shippable,
    development: 'checkpointed',
    test: shippable ? 'passed' : 'partial',
    userAcceptance: shippable ? 'passed' : 'blocked',
    deploy: 'not-started',
    observation: 'not-started',
    blockers,
    revision: input.revision || '',
  };
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function readHostPostgresImage(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = /^CORE5_POSTGRES_IMAGE=(.*)$/u.exec(trimmed);
      if (!match) continue;
      let value = match[1].trim();
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ environmentFile?: string }} [options]
 */
export function probeCore5DecisionEnv(env = process.env, options = {}) {
  const fromEnv = String(env.CORE5_POSTGRES_IMAGE || '').trim();
  return {
    postgresImage: fromEnv || readHostPostgresImage(options.environmentFile ?? DEFAULT_ENVIRONMENT_FILE),
    reviewUiOk: false,
    realAccountOk: env.CORE5_REAL_ACCOUNT_OK === '1',
  };
}

/** @param {Response} res */
function isCore5ReviewChallenge(res) {
  if (res.status !== 401) return false;
  const challenge = String(res.headers.get('www-authenticate') || '');
  return /basic/i.test(challenge) && /realm="core5 review"/i.test(challenge);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ fetch?: typeof fetch }} [options]
 */
export async function probeCore5ReviewUi(env = process.env, options = {}) {
  const configured = String(env.CORE5_UI_BASE_URL || '').trim();
  const base = configured || DEFAULT_REVIEW_UI_BASE;
  const key = String(env.CORE5_REVIEW_ACCESS_KEY || '').trim();
  const fetchImpl = options.fetch ?? fetch;
  try {
    const unauth = await fetchImpl(base, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    if (isCore5ReviewChallenge(unauth)) return true;
    if (!key) return false;
    const res = await fetchImpl(base, {
      headers: { Authorization: `Basic ${Buffer.from(`core5:${key}`, 'utf8').toString('base64')}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status !== 200) return false;
    const html = await res.text();
    return /<h1[^>]*>\s*(approval|review)/i.test(html) && /reject|cancel/i.test(html);
  } catch {
    return false;
  }
}
