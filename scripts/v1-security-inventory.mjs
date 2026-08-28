import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs', 'reports', 'v1-security-inventory.json');

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
}

function digest(relative) {
  return createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex');
}

export function inventory() {
  const pin = readJson('config/upstreams/omo-pin.json');
  const v08 = readJson('docs/internal-runtime/v0.8-team-dag-decision.json');
  return {
    schema: 'shipping-harness/security-inventory-v1',
    release: '1.0.0',
    boundaries: {
      internalOnly: true,
      publicSaas: false,
      customerDistribution: false,
      publicOmoBundle: false,
      rawShellMcp: false,
      rawShellRemote: false,
      remoteTlsRequired: true,
      remotePublicListener: false,
      credentialBackup: false,
    },
    authority: {
      humanStopFirst: true,
      shippingFinisherOnly: true,
      omoReceiptsRequireShippingVerification: true,
      scopeApprovalHumanOnly: true,
      closedVersionsNeverReopen: true,
    },
    limits: {
      unlimitedValuesAllowed: false,
      omoWorkers: pin.policy.parallelWorkers,
      omoDepth: pin.policy.agentDepth,
      omoContinuations: pin.policy.continuations,
      fixCycles: pin.policy.fixCycles,
      remoteBodyBytes: 65536,
      remoteConcurrency: 8,
    },
    thirdParty: {
      omo: {
        license: 'Sustainable Use License 1.0',
        use: 'personal/company-internal only',
        upstreamCommit: pin.expected.upstreamCommit,
        internalPatchCommit: pin.expected.internalPatchCommit,
        releaseCommit: pin.expected.releaseCommit,
        tag: pin.expected.tag,
        buildDigest: pin.expected.buildDigest,
        publicPublish: pin.publicPublish,
      },
      shippingCore: { license: 'MIT' },
    },
    optionalModes: {
      team: v08.enabled === true ? 'ENABLED' : 'DISABLED',
      dag: v08.enabled === true ? 'ENABLED' : 'DISABLED',
      entryGateDecision: v08.decision,
    },
    criticalFiles: {
      remotePolicy: digest('packages/internal-remote/policy.mjs'),
      remoteRequest: digest('packages/internal-remote/request.mjs'),
      omoReceiptValidator: digest('packages/internal-omo-bridge/receipt.mjs'),
      stableRegistry: digest('packages/stable-control/schema-registry.mjs'),
      migration: digest('packages/stable-control/migration.mjs'),
    },
    requiredRecords: [
      'THIRD_PARTY.md',
      'docs/SECURITY-INVENTORY.md',
      'docs/HANDOVER.md',
      'docs/operations/INTERNAL-REMOTE-INCIDENT.md',
      'docs/operations/RETENTION-SUPPORT.md',
      'docs/internal-runtime/OMO-RUNTIME.md',
      pin.evidence.license,
      pin.evidence.modifications,
      pin.evidence.notice,
    ],
    tests: [
      'npm run security',
      'npm run license:check',
      'npm run test:adversarial',
      'npm run test:omo-bridge',
      'npm run test:remote',
      'npm run test:stable',
    ],
  };
}

const next = inventory();
if (process.argv.includes('--record')) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(next, null, 2)}\n`);
} else if (process.argv.includes('--check')) {
  if (!existsSync(reportPath)) throw new Error('v1 security inventory is missing; run with --record after committing the implementation');
  const stored = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (JSON.stringify(stored) !== JSON.stringify(next)) throw new Error('v1 security inventory is stale');
  if (!stored.boundaries.internalOnly || stored.boundaries.rawShellMcp || stored.boundaries.rawShellRemote || stored.limits.unlimitedValuesAllowed) {
    throw new Error('v1 security boundary failed');
  }
} else {
  throw new Error('Use --record or --check');
}
process.stdout.write(`${JSON.stringify(next, null, 2)}\n`);
