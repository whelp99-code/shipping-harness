import { createServer } from 'node:http';

/** Start a loopback-only idempotent fixture provider backed by PostgreSQL. */
export async function startProvider(db) {
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) throw new Error('Provider input limit');
      }
      const { operationId, loseAck } = JSON.parse(body);
      if (typeof operationId !== 'string' || operationId.length > 100) throw new Error('Invalid operation');
      await db.query('INSERT INTO effects(id) VALUES($1) ON CONFLICT DO NOTHING', [operationId]);
      if (loseAck) return response.destroy();
      response.end(JSON.stringify({ operationId }));
    } catch {
      response.statusCode = 400;
      response.end('Rejected');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)) };
}
