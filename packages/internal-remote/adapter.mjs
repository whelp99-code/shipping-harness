import { callShippingTool } from '../../src/mcp/tools.mjs';
import { invariant } from './policy.mjs';

const ACTION_TOOL = Object.freeze({
  'shipping/status': ['shipping_status', () => ({})],
  'shipping/start': ['shipping_start', (params) => ({
    goal: params.goal,
    release: params.release,
    projectName: params.projectName,
    mode: params.mode,
  })],
  'shipping/approve': ['shipping_approve_scope', (params) => ({
    proposalId: params.proposalId,
    proposalHash: params.proposalHash,
    confirm: true,
  })],
  'shipping/execute': ['shipping_execute', () => ({ verifyAfter: false })],
  'shipping/pause': ['shipping_pause', (params) => ({ action: 'pause', reason: params.reason ?? 'remote user pause' })],
  'shipping/resume': ['shipping_pause', (params) => ({ action: 'resume', reason: params.reason ?? 'remote user resume' })],
  'shipping/abort': ['shipping_pause', (params) => ({ action: 'abort', reason: params.reason ?? 'remote user abort' })],
  'shipping/fix-blockers': ['shipping_fix_blockers', () => ({ verifyAfter: false })],
  'shipping/verify': ['shipping_verify', () => ({})],
  'shipping/close': ['shipping_close', () => ({})],
});

function structured(result) {
  return result?.structuredContent?.data ?? result?.structuredContent ?? result;
}

/**
 * ShippingRemoteAdapter.
 */
export class ShippingRemoteAdapter {
  constructor(projects) {
    this.projects = projects;
  }

  async call(projectId, action, params = {}) {
    const project = this.projects[projectId];
    invariant(project, 'ERR_REMOTE_PROJECT', 'Unknown remote project');

    if (action === 'evidence/summary') {
      const status = structured(await callShippingTool(project.root, 'shipping_status', {}));
      return {
        projectId,
        state: status.state?.state ?? status.state ?? 'UNKNOWN',
        issues: status.issues?.counts ?? null,
        evidenceFresh: status.evidenceFresh ?? false,
        release: status.contract?.release ?? status.state?.release ?? null,
        gitSha: status.git?.sha ?? null,
      };
    }

    const mapping = ACTION_TOOL[action];
    invariant(mapping, 'ERR_REMOTE_ACTION', 'Action is not mapped to a Shipping tool');
    return structured(await callShippingTool(project.root, mapping[0], mapping[1](params)));
  }
}
