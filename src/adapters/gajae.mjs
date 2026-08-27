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

export const gajaeAdapter = Object.freeze({
  name: 'gajae',
  aliases: ['gjc', 'gajae-code'],
  displayName: 'Gajae Code',

  /** @param {{contract: Record<string, any>, root?: string, env?: NodeJS.ProcessEnv}} context */
  probe(context) {
    const config = adapterConfiguration(context.contract, 'gajae');
    const command = configuredCommand(config);
    const discovered = findExecutable('gjc', context.env);
    const probe = discovered ? safeProbe(discovered.executable, [['--version'], ['version'], ['--help']], context.env) : null;
    const presence = context.root ? configuredArtifactPresence(context.root, config) : { candidates: [], present: [], missing: [] };
    const goals = presence.present.some((candidate) => candidate.endsWith('/goals.json') || candidate === 'goals.json');
    const ledger = presence.present.some((candidate) => candidate.endsWith('/ledger.jsonl') || candidate === 'ledger.jsonl');
    return normalizeCapabilityReport({
      name: 'gajae',
      displayName: 'Gajae Code',
      installed: Boolean(discovered),
      executable: discovered?.executable ?? null,
      verificationLevel: discovered && probe?.ok ? 'live' : command || presence.present.length > 0 || discovered ? 'configured' : 'unavailable',
      version: probe ? probeVersion(probe) : null,
      capabilities: capabilities({
        execute: Boolean(discovered || command),
        cancel: Boolean(discovered || command),
        durableGoals: goals,
        durableLedger: ledger,
        artifactCollection: presence.candidates.length > 0,
      }),
      diagnostics: [
        ...(!discovered ? ['gjc executable was not found on PATH.'] : []),
        ...(discovered && !probe?.ok ? ['gjc exists, but non-mutating version/help probes failed.'] : []),
        ...(!command ? ['No Gajae execution command is configured; Shipping Harness will not invent unstable flags.'] : []),
      ],
      metadata: {
        configuredCommand: Boolean(command),
        artifactPresence: presence,
        controllerSurface: 'operator-configured',
        authentication: 'unknown',
      },
    });
  },
});