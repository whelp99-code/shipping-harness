import { readFile, writeFile } from 'node:fs/promises';
const dataset = JSON.parse(await readFile(process.env.CORE5_EVAL_DATASET ?? new URL('./dataset.json', import.meta.url), 'utf8'));
const results = dataset.cases.map(entry => ({ id: entry.id, passed: Boolean(entry.expected && entry.actual === entry.expected), ...(entry.actual !== entry.expected ? { reason: 'actual does not match expected' } : {}) }));
const report = { unit: 'H04', status: results.length > 0 && results.every(entry => entry.passed) ? 'PASS' : 'FAIL', testCount: results.length, datasetVersion: dataset.version, toolVersions: { runner: 'core5-h04-v1', promptfoo: 'external', fastCheck: 'external' }, results };
if (report.testCount === 0) { report.status = 'FAIL'; report.results = [{ id: 'NON_EMPTY_DATASET', passed: false, reason: 'test count 0 is forbidden' }]; }
await writeFile(process.env.CORE5_EVAL_REPORT ?? '/tmp/core5-h04.json', `${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'PASS') process.exitCode = 1;
