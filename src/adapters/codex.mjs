import {
  adapterConfiguration,
  capabilities,
  configuredCommand,
  findExecutable,
  normalizeCapabilityReport,
  probeVersion,
  safeProbe,
} from './sdk.mjs';

export const codexAdapter = Object.freeze({
  name: 'codex',
  aliases: ['codex-cli'],
  displayName: 'OpenAI Codex CLI',

  /** @param {{contract: Record<string, any>, env?: NodeJS.ProcessEnv}} context */
  probe(context) {
    const config = adapterConfiguration(context.contract, 'codex');
    const command = configuredCommand(config);
    const discovered = findExecutable('codex', context.env);
    const probe = discovered ? safeProbe(discovered.executable, [['--version'], ['--help']], context.env) : null;
    const live = Boolean(discovered && probe?.ok);
    return normalizeCapabilityReport({
      name: 'codex',
      displayName: 'OpenAI Codex CLI',
      installed: Boolean(discovered),
      executable: discovered?.executable ?? null,
      verificationLevel: live ? 'live' : discovered || command ? 'configured' : 'unavailable',
      version: probe ? probeVersion(probe) : null,
      capabilities: capabilities({
        execute: Boolean(discovered || command),
        cancel: Boolean(discovered || command),
        artifactCollection: Array.isArray(config.artifactPaths) && config.artifactPaths.length > 0,
      }),
      diagnostics: [
        ...(!discovered ? ['Codex executable was not found on PATH.'] : []),
        ...(discovered && !probe?.ok ? ['Codex executable exists, but non-mutating version/help probes failed.'] : []),
        ...(discovered ? ['Executable presence does not prove authentication or model availability.'] : []),
      ],
      metadata: {
        configuredCommand: Boolean(command),
        authentication: 'unknown',
        probeArgs: probe?.args ?? null,
      },
    });
  },
});