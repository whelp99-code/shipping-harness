import {
  adapterConfiguration,
  capabilities,
  configuredCommand,
  findExecutable,
  normalizeCapabilityReport,
  probeVersion,
  safeProbe,
} from './sdk.mjs';
import { configuredArtifactPresence } from './artifacts.mjs';

export const ouroborosAdapter = Object.freeze({
  name: 'ouroboros',
  aliases: ['ooo', 'q00-ouroboros'],
  displayName: 'Q00 Ouroboros',

  /** @param {{contract: Record<string, any>, root?: string, env?: NodeJS.ProcessEnv}} context */
  probe(context) {
    const config = adapterConfiguration(context.contract, 'ouroboros');
    const command = configuredCommand(config);
    const discovered = findExecutable(['ooo', 'ouroboros'], context.env);
    const probe = discovered ? safeProbe(discovered.executable, [['--version'], ['version'], ['--help']], context.env) : null;
    const presence = context.root ? configuredArtifactPresence(context.root, config) : { candidates: [], present: [], missing: [] };
    const ledger = presence.present.some((candidate) => candidate.endsWith('/ledger.jsonl') || candidate === 'ledger.jsonl');
    const seed = presence.present.some((candidate) => /(^|\/)seed\.json$/u.test(candidate));
    return normalizeCapabilityReport({
      name: 'ouroboros',
      displayName: 'Q00 Ouroboros',
      installed: Boolean(discovered),
      executable: discovered?.executable ?? null,
      verificationLevel: discovered && probe?.ok ? 'live' : command || presence.present.length > 0 || discovered ? 'configured' : 'unavailable',
      version: probe ? probeVersion(probe) : null,
      capabilities: capabilities({
        execute: Boolean(discovered || command),
        cancel: Boolean(discovered || command),
        durableLedger: ledger,
        artifactCollection: presence.candidates.length > 0,
        costTelemetry: true,
      }),
      diagnostics: [
        ...(!discovered ? ['Neither ooo nor ouroboros was found on PATH.'] : []),
        ...(discovered && !probe?.ok ? ['Ouroboros executable exists, but non-mutating version/help probes failed.'] : []),
        ...(!command ? ['No Ouroboros execution command is configured; evolve workflows are never started implicitly.'] : []),
      ],
      metadata: {
        executableCandidate: discovered?.candidate ?? null,
        configuredCommand: Boolean(command),
        artifactPresence: presence,
        seedEvidence: seed,
        evolutionPolicy: 'explicit-only',
        authentication: 'unknown',
      },
    });
  },
});