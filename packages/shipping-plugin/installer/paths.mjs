import path from 'node:path';
import os from 'node:os';
import { invariant } from '../../../src/core/errors.mjs';

/** @param {string} base @param {string} target @param {string} label */
export function assertContainedPath(base, target, label) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBase, resolvedTarget);
  invariant(relative !== '' || resolvedTarget === resolvedBase, 'ERR_PLUGIN_PATH', `${label} path validation failed`);
  invariant(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), 'ERR_PLUGIN_PATH_ESCAPE', `${label} escapes the allowed root`, { base: resolvedBase, target: resolvedTarget });
  return resolvedTarget;
}

/** @param {string} installRoot */
export function validateInstallRoot(installRoot) {
  invariant(typeof installRoot === 'string' && installRoot.trim().length > 0, 'ERR_PLUGIN_PATH', 'installRoot is required');
  const resolved = path.resolve(installRoot);
  invariant(resolved !== path.parse(resolved).root, 'ERR_PLUGIN_PATH', 'Installing at a filesystem root is forbidden');
  invariant(!resolved.includes('\0'), 'ERR_PLUGIN_PATH', 'installRoot contains a null byte');
  return resolved;
}

/** @param {string} installRoot */
export function pluginPaths(installRoot) {
  const root = validateInstallRoot(installRoot);
  const pluginHome = assertContainedPath(root, path.join(root, 'shipping-harness'), 'plugin home');
  return {
    installRoot: root,
    pluginHome,
    assets: path.join(pluginHome, 'assets'),
    manifest: path.join(pluginHome, 'assets', 'manifest', 'plugin.json'),
    skill: path.join(pluginHome, 'assets', 'skill', 'SKILL.md'),
    instructions: path.join(pluginHome, 'assets', 'agent-instructions', 'AGENT.md'),
    hooks: path.join(pluginHome, 'assets', 'hooks', 'lifecycle.json'),
    profiles: path.join(pluginHome, 'assets', 'host-profiles'),
    registration: path.join(pluginHome, 'registration.json'),
    receipt: path.join(pluginHome, 'install-receipt.json'),
    backup: path.join(pluginHome, 'registration-backup.json'),
    backups: path.join(pluginHome, 'backups'),
    upgradeHistory: path.join(pluginHome, 'upgrade-history.json'),
  };
}

/** @param {string|undefined|null} codexHome */
export function validateCodexHome(codexHome) {
  invariant(typeof codexHome === 'string' && codexHome.trim().length > 0, 'ERR_PLUGIN_CODEX_HOME', 'Applying a Codex registration requires an explicit codexHome');
  const resolved = path.resolve(codexHome);
  invariant(resolved !== path.parse(resolved).root, 'ERR_PLUGIN_CODEX_HOME', 'Codex home cannot be a filesystem root');
  invariant(resolved !== path.resolve(os.homedir()) || codexHome.includes('.codex'), 'ERR_PLUGIN_CODEX_HOME', 'Use the explicit Codex configuration directory, not the bare home directory');
  return resolved;
}
