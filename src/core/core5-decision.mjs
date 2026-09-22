const POSTGRES_PIN = /^postgres@sha256:[a-f0-9]{64}$/u;

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

/** @param {NodeJS.ProcessEnv} env */
export function probeCore5DecisionEnv(env = process.env) {
  return {
    postgresImage: env.CORE5_POSTGRES_IMAGE || '',
    reviewUiOk: false,
    realAccountOk: env.CORE5_REAL_ACCOUNT_OK === '1',
  };
}

/** @param {NodeJS.ProcessEnv} env */
export async function probeCore5ReviewUi(env = process.env) {
  const base = String(env.CORE5_UI_BASE_URL || '').trim();
  const key = String(env.CORE5_REVIEW_ACCESS_KEY || '').trim();
  if (!base || !key) return false;
  try {
    const res = await fetch(base, {
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
