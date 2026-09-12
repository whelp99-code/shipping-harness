import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { walkFiles, text, relative } from './shared.mjs';
import { findLongFunctions } from './function-length.mjs';

const FUNCTION_LENGTH_LIMIT = 80;

// Functions/methods over FUNCTION_LENGTH_LIMIT lines that could not be reasonably split
// further, each with a one-line reason. Keep this empty whenever possible; see
// docs/planning/33-....md section 6 Phase B for the full audit that produced it.
const FUNCTION_LENGTH_ALLOWLIST = [
  { file: 'src/core/decision-package.mjs', startLine: 165, reason: 'composeDefaultDecision assembles one decision object field-by-field from evidence; splitting would pass many correlated intermediates between helpers with no gain in clarity' },
  { file: 'src/core/evidence.mjs', startLine: 20, reason: 'runAcceptance runs the locked contract acceptance commands in one audited sequence with shared budget/evidence accounting' },
  { file: 'src/core/hooks.mjs', startLine: 54, reason: 'decideStop is a single bounded lifecycle-decision table; the branches are mutually exclusive and share request/adapter context' },
  { file: 'src/core/plain-brief.mjs', startLine: 230, reason: 'buildBriefFactGraph constructs one bounded fact-graph object with many literal fields required by the plain-brief schema' },
  { file: 'src/core/process.mjs', startLine: 43, reason: 'runBoundedCommand is a single atomic spawn/timeout/output-cap/cleanup sequence; splitting it risks separating cleanup from the failure paths it must always run on' },
  { file: 'src/core/project-analysis.mjs', startLine: 244, reason: 'inspectWorkspace performs one filesystem inspection pass and assembles a single report object from it' },
  { file: 'src/mcp/protocol.mjs', startLine: 119, reason: 'createMcpProtocol is a small factory whose only real body is the handle() method (also allow-listed below)' },
  { file: 'src/mcp/protocol.mjs', startLine: 138, reason: 'handle() is the JSON-RPC method dispatch table for the nine shipping_* tools plus protocol methods; splitting it would fragment one already-linear dispatch' },
  { file: 'src/mcp/stdio.mjs', startLine: 7, reason: 'startStdioServer wires up the bounded queue/backpressure state machine over stdin/stdout in one place by design (see src/mcp/stdio.mjs module comment)' },
  { file: 'src/mcp/user-view.mjs', startLine: 33, reason: 'buildUserStatusView assembles one bounded user-facing view object from status fields' },
  { file: 'packages/internal-omo-bridge/bridge.mjs', startLine: 47, reason: 'executeShippingPrivateOmo is one sequential probe/promote/fallback authority decision flow that must stay auditable as a single sequence' },
  { file: 'packages/omp-main-harness/doctor.mjs', startLine: 14, reason: 'doctorOmpMainHarness aggregates one sequential set of independent doctor checks into a single report' },
  { file: 'packages/omp-main-harness/install.mjs', startLine: 80, reason: 'installOmpMainHarness is one sequential validate/stage/verify/activate pipeline with rollback-on-failure state that must not be separated from the steps it guards' },
];

/** @param {string} file @param {number} startLine */
function isAllowlisted(file, startLine) {
  return FUNCTION_LENGTH_ALLOWLIST.some((entry) => entry.file === file && entry.startLine === startLine);
}

const roots = ['src', 'bin', 'scripts', 'test'];
// scripts/archive/ holds one-off scripts from past versions (see scripts/archive/README.md);
// they are kept for historical reference only and are excluded from lint the same way
// eslint.config.mjs excludes them.
const isArchived = (file) => relative(file).startsWith('scripts/archive/');
const sourceFiles = (await Promise.all(
  roots.map((root) => walkFiles(path.resolve(root), (file) => /\.(?:mjs|js)$/u.test(file) && !isArchived(file))),
)).flat();

// Function-length check runs only over src/ and packages/ (the completion criterion in
// docs/planning/33-....md section 5), not bin/scripts/test.
const lengthCheckRoots = ['src', 'packages'];
const lengthCheckFiles = (await Promise.all(
  lengthCheckRoots.map((root) => walkFiles(path.resolve(root), (file) => /\.mjs$/u.test(file))),
)).flat();

const failures = [];
for (const filePath of sourceFiles) {
  const syntax = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8', timeout: 10000 });
  if (syntax.status !== 0) failures.push(`${relative(filePath)}: syntax error\n${syntax.stderr || syntax.stdout}`);
  const content = await text(filePath);
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (/[\t ]+$/u.test(line)) failures.push(`${relative(filePath)}:${index + 1}: trailing whitespace`);
    if (line.includes('\t')) failures.push(`${relative(filePath)}:${index + 1}: tab character`);
  }
}

for (const filePath of lengthCheckFiles) {
  const content = await text(filePath);
  const relPath = relative(filePath);
  for (const violation of findLongFunctions(content, FUNCTION_LENGTH_LIMIT)) {
    if (isAllowlisted(relPath, violation.startLine)) continue;
    failures.push(`${relPath}:${violation.startLine}: ${violation.label} spans ${violation.length} lines (limit ${FUNCTION_LENGTH_LIMIT}), ending at line ${violation.endLine}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`lint: ${sourceFiles.length} source files passed\n`);
}