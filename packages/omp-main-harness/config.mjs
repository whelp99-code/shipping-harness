import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  OMP_AGENT_BLOCK,
  OMP_AGENT_BLOCK_END,
  OMP_AGENT_BLOCK_START,
  OMP_MCP_TIMEOUT_MS,
  OMP_SERVER_NAME,
  OMP_TOOL_APPROVAL,
} from './constants.mjs';
import {
  exists,
  invariant,
  parseJsonOutput,
  readJson,
  runCommand,
  sha256,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.mjs';
import { packageRoot } from './paths.mjs';

/** @param {unknown} value */
function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {Record<string, any>} paths */
export function ompCommandEnvironment(paths) {
  return {
    ...process.env,
    HOME: paths.home,
    PI_CODING_AGENT_DIR: paths.agentDir,
  };
}

/** @param {string} command @param {string} key @param {Record<string, any>} paths @param {unknown} fallback */
export function readOmpConfigValue(command, key, paths, fallback = undefined) {
  try {
    const result = runCommand(command, ['config', 'get', key, '--json'], {
      env: ompCommandEnvironment(paths),
      timeoutMs: 60000,
    });
    const parsed = parseJsonOutput(result.stdout, `OMP config get ${key}`);
    return Object.hasOwn(parsed, 'value') ? parsed.value : fallback;
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

/** @param {string} command @param {string} key @param {unknown} value @param {Record<string, any>} paths */
export function writeOmpConfigValue(command, key, value, paths) {
  const encoded = typeof value === 'string' ? value : JSON.stringify(value);
  runCommand(command, ['config', 'set', key, encoded, '--json'], {
    env: ompCommandEnvironment(paths),
    timeoutMs: 60000,
  });
  const observed = readOmpConfigValue(command, key, paths);
  invariant(JSON.stringify(observed) === JSON.stringify(value), 'ERR_OMP_CONFIG_VERIFY', `OMP config value did not persist exactly: ${key}`, {
    expected: value,
    observed,
  });
  return observed;
}

/** @param {unknown} input @param {string} shippingMcp */
export function mergeMcpConfiguration(input, shippingMcp) {
  const config = plainObject(input) ? structuredClone(input) : {};
  invariant(plainObject(config), 'ERR_OMP_MCP_CONFIG', 'OMP mcp.json root must be an object');
  if (!plainObject(config.mcpServers)) config.mcpServers = {};
  config.mcpServers[OMP_SERVER_NAME] = {
    type: 'stdio',
    command: path.resolve(shippingMcp),
    enabled: true,
    timeout: OMP_MCP_TIMEOUT_MS,
  };
  return config;
}

/** @param {string} existing */
export function mergeAgentRules(existing) {
  const hasStart = existing.includes(OMP_AGENT_BLOCK_START);
  const hasEnd = existing.includes(OMP_AGENT_BLOCK_END);
  invariant(hasStart === hasEnd, 'ERR_OMP_AGENT_BLOCK', 'OMP AGENTS.md contains an incomplete Shipping managed block');
  if (!hasStart) return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${OMP_AGENT_BLOCK}\n`;
  const before = existing.slice(0, existing.indexOf(OMP_AGENT_BLOCK_START)).trimEnd();
  const after = existing.slice(existing.indexOf(OMP_AGENT_BLOCK_END) + OMP_AGENT_BLOCK_END.length).trimStart();
  return [before, OMP_AGENT_BLOCK, after].filter(Boolean).join('\n\n').trimEnd() + '\n';
}

/** @param {Record<string, any>} paths @param {Record<string, any>} commands */
export async function desiredOmpConfiguration(paths, commands) {
  const existingMcp = await readJson(paths.mcpConfig, {});
  const existingAgents = (await exists(paths.agents)) ? await readFile(paths.agents, 'utf8') : '';
  const sourceSkill = path.join(packageRoot(), 'packages', 'shipping-plugin', 'skill', 'SKILL.md');
  const skillText = await readFile(sourceSkill, 'utf8');
  const approval = readOmpConfigValue(commands.omp, 'tools.approval', paths, {});
  invariant(plainObject(approval), 'ERR_OMP_APPROVAL_CONFIG', 'OMP tools.approval must be an object');
  const mergedApproval = { ...approval, ...OMP_TOOL_APPROVAL };
  return {
    mcp: mergeMcpConfiguration(existingMcp, commands.shippingMcp),
    approvalMode: 'always-ask',
    approval: mergedApproval,
    agents: mergeAgentRules(existingAgents),
    skill: skillText.endsWith('\n') ? skillText : `${skillText}\n`,
  };
}

/** @param {Record<string, any>} paths @param {Record<string, any>} commands @param {{dryRun?: boolean}} [options] */
export async function applyOmpConfiguration(paths, commands, options = {}) {
  const desired = await desiredOmpConfiguration(paths, commands);
  const dryRun = options.dryRun !== false;
  if (!dryRun) {
    await writeJsonAtomic(paths.mcpConfig, desired.mcp, 0o600);
    writeOmpConfigValue(commands.omp, 'tools.approvalMode', desired.approvalMode, paths);
    writeOmpConfigValue(commands.omp, 'tools.approval', desired.approval, paths);
    await writeTextAtomic(paths.agents, desired.agents, 0o600);
    await writeTextAtomic(paths.skill, desired.skill, 0o600);
  }
  return {
    dryRun,
    server: desired.mcp.mcpServers[OMP_SERVER_NAME],
    approvalMode: desired.approvalMode,
    approval: desired.approval,
    approvalHash: sha256(JSON.stringify(desired.approval)),
    agentsHash: sha256(desired.agents),
    skillHash: sha256(desired.skill),
  };
}

/** @param {Record<string, any>} paths @param {Record<string, any>} commands */
export async function inspectOmpConfiguration(paths, commands) {
  const mcp = await readJson(paths.mcpConfig, {});
  const server = plainObject(mcp?.mcpServers) ? mcp.mcpServers[OMP_SERVER_NAME] : null;
  const approvalMode = readOmpConfigValue(commands.omp, 'tools.approvalMode', paths, null);
  const approval = readOmpConfigValue(commands.omp, 'tools.approval', paths, {});
  const agents = (await exists(paths.agents)) ? await readFile(paths.agents, 'utf8') : '';
  const skill = (await exists(paths.skill)) ? await readFile(paths.skill, 'utf8') : '';
  const sourceSkill = await readFile(path.join(packageRoot(), 'packages', 'shipping-plugin', 'skill', 'SKILL.md'), 'utf8');
  const checks = {
    mcpServer: plainObject(server)
      && server.type === 'stdio'
      && path.resolve(server.command ?? '') === path.resolve(commands.shippingMcp)
      && server.enabled === true
      && server.timeout === OMP_MCP_TIMEOUT_MS,
    approvalMode: approvalMode === 'always-ask',
    approval: plainObject(approval)
      && Object.entries(OMP_TOOL_APPROVAL).every(([name, policy]) => approval[name] === policy),
    agents: agents.includes(OMP_AGENT_BLOCK_START)
      && agents.includes(OMP_AGENT_BLOCK_END)
      && agents.split(OMP_AGENT_BLOCK_START).length === 2,
    skill: sha256(skill.endsWith('\n') ? skill : `${skill}\n`) === sha256(sourceSkill.endsWith('\n') ? sourceSkill : `${sourceSkill}\n`),
  };
  return {
    checks,
    healthy: Object.values(checks).every(Boolean),
    server,
    approvalMode,
    approvalHash: sha256(JSON.stringify(approval)),
    agentsHash: sha256(agents),
    skillHash: sha256(skill),
  };
}
