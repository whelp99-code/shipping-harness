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
  return {
    schema: 'shipping-harness/core5-decision.v1',
    state: 'NOT_SHIPPABLE',
    releaseDecision: false,
    development: 'checkpointed',
    test: 'partial',
    userAcceptance: 'blocked',
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
    reviewUiOk: env.CORE5_REVIEW_UI_OK === '1',
    realAccountOk: env.CORE5_REAL_ACCOUNT_OK === '1',
  };
}
