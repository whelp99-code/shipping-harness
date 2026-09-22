import { writeFile } from 'node:fs/promises';
import { startProvider } from './fake-provider.mjs';
import { runFaults } from './faults.mjs';
let container, db, provider;
const report = { unit: 'H02', mode: 'fixture', status: 'BLOCKED', results: [], releaseDecision: false };
try {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const { Client } = await import('pg');
  const image = process.env.CORE5_POSTGRES_IMAGE;
  if (!/^postgres@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('CORE5_POSTGRES_IMAGE must pin a PostgreSQL digest');
  container = await new PostgreSqlContainer(image).start();
  db = new Client({ connectionString: container.getConnectionUri() });
  await db.connect();
  await db.query('CREATE TABLE effects(id text PRIMARY KEY); CREATE TABLE events(id text PRIMARY KEY, version integer NOT NULL)');
  provider = await startProvider(db);
  report.results = await runFaults(db, provider, container.getConnectionUri());
  report.status = 'PASS';
  report.image = image;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await provider?.close();
  await db?.end();
  await container?.stop();
  await writeFile(process.env.CORE5_REPORT ?? '/tmp/core5-h02.json', JSON.stringify(report, null, 2));
}
