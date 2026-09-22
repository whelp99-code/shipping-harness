import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Core5 review</title></head>
  <body>
    <h1>Review</h1>
    <p>Evidence and reason for this Core5 operation.</p>
    <button type="button" id="reject">Reject</button>
    <p id="status" hidden></p>
    <script>
      const status = document.getElementById('status');
      document.getElementById('reject').addEventListener('click', () => {
        status.hidden = false;
        status.textContent = 'Rejected';
      });
    </script>
  </body>
</html>
`;

const key = String(process.env.CORE5_REVIEW_ACCESS_KEY || '').trim();
if (!key) {
  process.stderr.write('CORE5_REVIEW_ACCESS_KEY is required\n');
  process.exit(1);
}
const expected = Buffer.from(`core5:${key}`, 'utf8');
const port = Number(process.env.CORE5_REVIEW_PORT || 4174);
const host = '127.0.0.1';

function authorized(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let got;
  try {
    got = Buffer.from(header.slice(6), 'base64');
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const server = http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Core5 review"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Core5 review access key required.');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
});

server.listen(port, host, () => {
  process.stdout.write(`Core5 review http://${host}:${port}/\n`);
});
