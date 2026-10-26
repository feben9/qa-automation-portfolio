// Tiny remittance API used as the target for the k6 tests. In-memory, no dependencies.
// Run: node performance/api/server.js   (PORT env, default 3333)
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 3333);
const CURRENCIES = ['USD', 'EUR', 'GBP', 'ETB', 'KES'];
const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, ETB: 56.5, KES: 129.1 };
const transfers = new Map();

// The deliberate bottleneck: /reports/daily holds a shared "report worker" pool.
// Each concurrent report adds delay (contention), and past the limit it sheds load with 503.
let reportsInFlight = 0;
const REPORT_BASE_MS = 40;
const REPORT_PER_CONCURRENT_MS = 25;
const REPORT_MAX_IN_FLIGHT = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); }
    });
  });

function validateTransfer(b) {
  const errors = [];
  if (typeof b.amount !== 'number' || !(b.amount > 0) || b.amount > 100000) errors.push('amount must be a number in (0, 100000]');
  if (!CURRENCIES.includes(b.from)) errors.push('from must be a supported currency');
  if (!CURRENCIES.includes(b.to)) errors.push('to must be a supported currency');
  if (typeof b.recipient !== 'string' || b.recipient.trim().length < 2) errors.push('recipient is required');
  return errors;
}

// Moderate CPU work (~1-2 ms) standing in for fraud and fee checks.
function checkTransfer(seed) {
  let h = 0;
  for (let i = 0; i < 200000; i++) h = (h * 31 + i + seed) | 0;
  return h;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });

    if (req.method === 'GET' && path === '/rates') {
      return send(res, 200, { base: 'USD', rates: RATES, asOf: new Date().toISOString() });
    }

    if (req.method === 'POST' && path === '/transfers') {
      let body;
      try { body = await readJson(req); } catch { return send(res, 400, { errors: ['invalid json'] }); }
      const errors = validateTransfer(body);
      if (errors.length) return send(res, 422, { errors });
      checkTransfer(body.amount);
      const fee = Math.round(body.amount * 0.01 * 100) / 100;
      const transfer = {
        id: randomUUID(),
        amount: body.amount,
        from: body.from,
        to: body.to,
        recipient: body.recipient,
        fee,
        converted: Math.round(((body.amount - fee) * RATES[body.to]) / RATES[body.from] * 100) / 100,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      transfers.set(transfer.id, transfer);
      return send(res, 201, transfer);
    }

    const m = path.match(/^\/transfers\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const t = transfers.get(m[1]);
      return t ? send(res, 200, t) : send(res, 404, { error: 'not found' });
    }

    if (req.method === 'GET' && path === '/reports/daily') {
      if (reportsInFlight >= REPORT_MAX_IN_FLIGHT) return send(res, 503, { error: 'report workers saturated' });
      reportsInFlight++;
      try {
        await sleep(REPORT_BASE_MS + REPORT_PER_CONCURRENT_MS * reportsInFlight);
        let total = 0;
        for (const t of transfers.values()) total += t.amount;
        return send(res, 200, { date: new Date().toISOString().slice(0, 10), count: transfers.size, totalAmount: Math.round(total * 100) / 100 });
      } finally {
        reportsInFlight--;
      }
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, () => console.log(`remittance API listening on :${PORT}`));
