import {
  adapterConfiguration,
  capabilities,
  configuredCommand,
  normalizeCapabilityReport,
} from './sdk.mjs';

export const genericAdapter = Object.freeze({
  name: 'generic',
  aliases: ['command'],
  displayName: 'Generic Command',

  /** @param {{contract: Record<string, any>}} context */
  probe(context) {
    const config = adapterConfiguration(context.contract, 'generic');
    const command = configuredCommand(config);
    return normalizeCapabilityReport({
      name: 'generic',
      displayName: 'Generic Command',
      installed: true,
      executable: null,
      verificationLevel: 'live',
      version: null,
      capabilities: capabilities({
        execute: true,
        cancel: true,
        artifactCollection: Array.isArray(config.artifactPaths) && config.artifactPaths.length > 0,
      }),
      diagnostics: command ? [] : ['No default command is configured; pass --command at execution time.'],
      metadata: {
        builtIn: true,
        configuredCommand: Boolean(command),
      },
    });
  },
});