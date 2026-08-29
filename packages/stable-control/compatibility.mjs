import { execFileSync } from 'node:child_process';
import { STABLE_SCHEMAS } from './schema-registry.mjs';
import { SUPPORTED_RELEASES } from './migration.mjs';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const COMPATIBILITY = deepFreeze({
  schema: STABLE_SCHEMAS.compatibility,
  shippingVersion: '1.1.0',
  supportedReleases: [...SUPPORTED_RELEASES],
  platforms: ['linux', 'darwin'],
  architectures: ['x64', 'arm64'],
  node: { minimum: 22, tested: ['22.23.2'] },
  git: { minimum: '2.30' },
  plugin: { upgradeFrom: ['0.6.0', '0.7.0', '0.8.0', '0.9.0'], localOnly: true },
  omoRuntime: {
    shippingBridge: '0.7.0',
    upstreamVersion: '5.0.0-beta.23',
    nativePackage: '5.0.0-0.beta.23',
    senpi: '2026.8.27',
    internalOnly: true,
    optional: true,
  },
  mcp: {
    current: '2026-07-28',
    compatible: ['2025-03-26', '2025-11-25'],
    omp: { version: '15.10.12', protocol: '2025-03-26' },
    tools: 9,
    refinement: 'shipping_refine',
    nestedWorkspace: true,
    transport: 'stdio',
  },
  remote: { schema: STABLE_SCHEMAS.remoteRequest, tlsMinimum: '1.2', publicListener: false, optional: true },
  teamDag: { default: 'DISABLED', entryGate: 'docs/reports/v0.8-entry-gate.json' },
});

function major(version) {
  const value = Number.parseInt(String(version).replace(/^v/u, '').split('.')[0], 10);
  return Number.isFinite(value) ? value : null;
}

export function compatibilityReport(input = {}) {
  const nodeVersion = input.nodeVersion ?? process.versions.node;
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  let gitVersion = input.gitVersion ?? null;
  if (gitVersion === null) {
    try {
      gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim().replace(/^git version\s+/u, '');
    } catch {
      gitVersion = 'unavailable';
    }
  }
  const diagnostics = [];
  if ((major(nodeVersion) ?? 0) < COMPATIBILITY.node.minimum) diagnostics.push(`Node ${nodeVersion} is below ${COMPATIBILITY.node.minimum}`);
  if (!COMPATIBILITY.platforms.includes(platform)) diagnostics.push(`Unsupported platform: ${platform}`);
  if (!COMPATIBILITY.architectures.includes(arch)) diagnostics.push(`Unsupported architecture: ${arch}`);
  if (gitVersion === 'unavailable') diagnostics.push('Git is unavailable');
  return {
    ...structuredClone(COMPATIBILITY),
    observed: { nodeVersion, platform, arch, gitVersion },
    supported: diagnostics.length === 0,
    diagnostics,
  };
}
