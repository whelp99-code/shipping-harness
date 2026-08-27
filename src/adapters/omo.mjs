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

export const omoAdapter = Object.freeze({
  name: 'omo',
  aliases: ['omo-native', 'oh-my-openagent'],
  displayName: 'OMO Native',

  /** @param {{contract: Record<string, any>, root?: string, env?: NodeJS.ProcessEnv}} context */
  probe(context) {
    const config = adapterConfiguration(context.contract, 'omo');
    const command = configuredCommand(config);
    const discovered = findExecutable('omo', context.env);
    const opencode = findExecutable('opencode', context.env);
    const probe = discovered ? safeProbe(discovered.executable, [['--version'], ['version'], ['--help']], context.env) : null;
    const presence = context.root ? configuredArtifactPresence(context.root, config) : { candidates: [], present: [], missing: [] };
    return normalizeCapabilityReport({
      name: 'omo',
      displayName: 'OMO Native',
      installed: Boolean(discovered),
      executable: discovered?.executable ?? null,
      verificationLevel: discovered && probe?.ok ? 'live' : command || presence.present.length > 0 || discovered || opencode ? 'configured' : 'unavailable',
      version: probe ? probeVersion(probe) : null,
      capabilities: capabilities({
        execute: Boolean(discovered || command),
        cancel: Boolean(discovered || command),
        hooks: true,
        artifactCollection: presence.candidates.length > 0,
      }),
      diagnostics: [
        ...(!discovered ? ['omo executable was not found on PATH.'] : []),
        ...(discovered && !probe?.ok ? ['omo exists, but non-mutating version/help probes failed.'] : []),
        ...(!command ? ['No OMO execution command is configured.'] : []),
        ['Shipping Harness exposes a process/config/event bridge; a native OMO plugin is not inferred.'],
      ].flat(),
      metadata: {
        configuredCommand: Boolean(command),
        artifactPresence: presence,
        openCodeHost: opencode?.executable ?? null,
        hookBridge: true,
        nativePlugin: false,
        userConfigInspected: false,
        authentication: 'unknown',
      },
    });
  },
});