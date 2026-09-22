import { Client } from 'pg';
const db = new Client({ connectionString: process.env.CORE5_DATABASE_URL });
await db.connect();
const response = await fetch(process.env.CORE5_PROVIDER_URL, {
  method: 'POST', body: JSON.stringify({ operationId: 'kill-operation' }),
});
if (!response.ok) throw new Error('Provider rejected operation');
process.send('effect-recorded');
await new Promise(() => {});
