import path from 'node:path';
import { readText } from '../../src/core/fs.mjs';
import { readJson } from '../../src/core/fs.mjs';
import { hashFile } from '../../src/core/crypto.mjs';
import { runGit } from '../../src/core/git.mjs';
import { invariant } from '../../src/core/errors.mjs';

/** @param {string} root @param {string} [configPath] */
export async function loadPrivateOmoConfig(root, configPath = 'config/upstreams/omo-pin.json') {
  const absolute = path.resolve(root, configPath);
  const config = await readJson(absolute);
  invariant(config.schema === 'shipping-harness/private-omo-pin-v1', 'ERR_OMO_BRIDGE_CONFIG', 'Unsupported private OMO pin schema');
  invariant(config.internalOnly === true && config.publicPublish === false, 'ERR_OMO_BRIDGE_BOUNDARY', 'Private OMO runtime must remain internal-only and non-public');
  invariant(path.isAbsolute(config.runtimeProject) && path.isAbsolute(config.runtimeRoot) && path.isAbsolute(config.cliPath), 'ERR_OMO_BRIDGE_CONFIG', 'Private OMO paths must be absolute');
  invariant(Array.isArray(config.allowedRoots) && config.allowedRoots.length > 0 && config.allowedRoots.every(path.isAbsolute), 'ERR_OMO_BRIDGE_CONFIG', 'Private OMO project allowlist is required');
  return Object.freeze({ ...config, configPath: absolute });
}

/** @param {string} root @param {Record<string, any>} [provided] */
export async function verifyPrivateOmoPromotion(root, provided) {
  const config = provided ?? await loadPrivateOmoConfig(root);
  const manifest = await readJson(config.evidence.manifest);
  const verification = await readJson(config.evidence.verification);
  const installation = await readJson(config.evidence.isolatedInstall);
  const rollback = await readJson(config.evidence.rollback);
  invariant(manifest.runtimeVersion === config.expected.runtimeVersion, 'ERR_OMO_BRIDGE_VERSION', 'Private OMO runtime version does not match the pin');
  invariant(manifest.upstream.commit === config.expected.upstreamCommit, 'ERR_OMO_BRIDGE_PIN', 'Private OMO upstream commit does not match the pin');
  invariant(manifest.internalPatchCommit === config.expected.internalPatchCommit, 'ERR_OMO_BRIDGE_PIN', 'Private OMO internal patch commit does not match the pin');
  invariant(manifest.buildDigest === config.expected.buildDigest, 'ERR_OMO_BRIDGE_DIGEST', 'Private OMO build digest does not match the pin');
  invariant(manifest.compatibilityVersion === config.expected.compatibilityVersion, 'ERR_OMO_BRIDGE_COMPATIBILITY', 'Private OMO compatibility version does not match');
  invariant(manifest.upstream.publicPublish === false && manifest.upstream.useBoundary === 'personal-and-company-internal-only', 'ERR_OMO_BRIDGE_BOUNDARY', 'Private OMO manifest violates the internal-use boundary');
  invariant(manifest.boundedDefaults.parallelWorkers <= 2 && manifest.boundedDefaults.agentDepth <= 1 && manifest.boundedDefaults.continuations <= 3 && manifest.boundedDefaults.fixCycles <= 2, 'ERR_OMO_BRIDGE_BUDGET', 'Private OMO manifest exceeds bounded defaults');
  invariant(manifest.boundedDefaults.teamMode === false && manifest.boundedDefaults.dagMode === false && manifest.boundedDefaults.unlimitedValuesAllowed === false, 'ERR_OMO_BRIDGE_BUDGET', 'Private OMO manifest enables forbidden v0.7 features');
  invariant(verification.passed === true && installation.passed === true && rollback.passed === true, 'ERR_OMO_BRIDGE_UNVERIFIED', 'Private OMO runtime has not passed promotion evidence');
  invariant(installation.artifactSha256 === config.expected.artifactSha256, 'ERR_OMO_BRIDGE_ARTIFACT', 'Private OMO package digest does not match the pin');
  const artifactPath = path.resolve(config.runtimeProject, installation.artifact);
  invariant(await hashFile(artifactPath) === config.expected.artifactSha256, 'ERR_OMO_BRIDGE_ARTIFACT', 'Private OMO package bytes do not match the promoted digest');
  const releaseCommit = runGit(config.runtimeProject, ['rev-parse', 'HEAD']).stdout.trim();
  const tagCommit = runGit(config.runtimeProject, ['rev-list', '-n1', config.expected.tag]).stdout.trim();
  invariant(releaseCommit === config.expected.releaseCommit && tagCommit === releaseCommit, 'ERR_OMO_BRIDGE_TAG', 'Private OMO release tag is not pinned to the promoted commit');
  const license = await readText(config.evidence.license);
  const modifications = await readText(config.evidence.modifications);
  const notice = await readText(config.evidence.notice);
  invariant(license.includes('Sustainable Use License') && license.includes('internal business purposes'), 'ERR_OMO_BRIDGE_LICENSE', 'Upstream internal-use license notice is missing');
  invariant(modifications.includes('Shipping Harness') && notice.includes('internal'), 'ERR_OMO_BRIDGE_LICENSE', 'Internal modification or notice inventory is missing');
  return Object.freeze({
    schema: 'shipping-harness/private-omo-promotion-report-v1',
    healthy: true,
    internalOnly: true,
    publicPublish: false,
    runtimeVersion: manifest.runtimeVersion,
    upstreamCommit: manifest.upstream.commit,
    internalPatchCommit: manifest.internalPatchCommit,
    releaseCommit,
    buildDigest: manifest.buildDigest,
    compatibilityVersion: manifest.compatibilityVersion,
    artifactPath,
    artifactSha256: installation.artifactSha256,
    selectedTests: verification.selectedTests,
    canary: verification.canary,
    rollback: verification.rollbackProof,
    boundedDefaults: manifest.boundedDefaults,
  });
}
