import { ShippingError } from '../core/errors.mjs';
import { genericAdapter } from './generic.mjs';
import { codexAdapter } from './codex.mjs';
import { gajaeAdapter } from './gajae.mjs';
import { ouroborosAdapter } from './ouroboros.mjs';
import { omoAdapter } from './omo.mjs';
import { collectConfiguredArtifacts } from './artifacts.mjs';

const adapters = [genericAdapter, codexAdapter, gajaeAdapter, ouroborosAdapter, omoAdapter];

/** @returns {ReadonlyArray<any>} */
export function listAdapters() {
  return adapters;
}

/** @param {string} requested */
export function resolveAdapter(requested) {
  const normalized = String(requested).trim().toLowerCase();
  const adapter = adapters.find((candidate) => candidate.name === normalized || candidate.aliases.includes(normalized));
  if (!adapter) throw new ShippingError('ERR_ADAPTER_UNKNOWN', `Unknown adapter: ${requested}`, {
    available: adapters.map((candidate) => candidate.name),
  });
  return adapter;
}

/** @param {string} requested @param {{contract: Record<string, any>, root?: string, env?: NodeJS.ProcessEnv}} context */
export function probeAdapter(requested, context) {
  return resolveAdapter(requested).probe(context);
}

/** @param {{contract: Record<string, any>, root?: string, env?: NodeJS.ProcessEnv}} context */
export function probeAllAdapters(context) {
  return adapters.map((adapter) => adapter.probe(context));
}

/** @param {string} requested @param {{contract: Record<string, any>, root: string}} context */
export async function collectAdapterArtifacts(requested, context) {
  const adapter = resolveAdapter(requested);
  return collectConfiguredArtifacts(context.root, adapter.name, context.contract);
}