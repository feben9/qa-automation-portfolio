// Shared settings for every test. Override with env vars:
//   BASE_URL=http://localhost:3333   DURATION_SCALE=1 (2 = twice as long)   VU_SCALE=1
import { Trend, Counter, Rate } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';
const DURATION_SCALE = Number(__ENV.DURATION_SCALE || 1);
const VU_SCALE = Number(__ENV.VU_SCALE || 1);

// "10s" * 2 -> "20s"
export const dur = (s) => `${Math.max(1, Math.round(parseInt(s, 10) * DURATION_SCALE))}s`;
export const vus = (n) => Math.max(1, Math.round(n * VU_SCALE));

// Custom metrics
export const transferCreateTime = new Trend('transfer_create_time', true);
export const businessErrors = new Counter('business_errors');
export const reportDegraded = new Rate('report_degraded'); // report slower than 500 ms or shed with 503

export const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

// Thresholds for the normal (non-report) endpoints, shared by load and smoke.
export const normalThresholds = {
  http_req_failed: ['rate<0.01'],
  'http_req_duration{name:health}': ['p(95)<300'],
  'http_req_duration{name:rates}': ['p(95)<300'],
  'http_req_duration{name:create_transfer}': ['p(95)<300'],
  'http_req_duration{name:get_transfer}': ['p(95)<300'],
  business_errors: ['count==0'],
};

export function transferPayload() {
  const cur = ['USD', 'EUR', 'GBP', 'ETB', 'KES'];
  const from = cur[Math.floor(Math.random() * cur.length)];
  let to = cur[Math.floor(Math.random() * cur.length)];
  if (to === from) to = 'USD' === from ? 'EUR' : 'USD';
  return JSON.stringify({ amount: Math.round(Math.random() * 50000) / 100 + 1, from, to, recipient: `Recipient ${__VU}` });
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
// Writes performance/results/<name>.json and <name>.txt, and prints the text summary.
export function makeSummary(name) {
  return (data) => ({
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    [`results/${name}.json`]: JSON.stringify(data, null, 2),
    [`results/${name}.txt`]: textSummary(data, { indent: ' ', enableColors: false }),
  });
}

// ---- Shared traffic functions (each request is tagged so thresholds can target it) ----
import http from 'k6/http';
import { check } from 'k6';

export function health() {
  const r = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  check(r, { 'health 200': (x) => x.status === 200 && x.json('status') === 'ok' }) || businessErrors.add(1);
}

export function rates() {
  const r = http.get(`${BASE_URL}/rates`, { tags: { name: 'rates' } });
  check(r, { 'rates 200 with USD base': (x) => x.status === 200 && x.json('base') === 'USD' && x.json('rates.ETB') > 0 }) || businessErrors.add(1);
}

// Creates a transfer, then reads it back. Returns the id.
export function transfer() {
  const r = http.post(`${BASE_URL}/transfers`, transferPayload(), { ...JSON_HEADERS, tags: { name: 'create_transfer' } });
  transferCreateTime.add(r.timings.duration);
  const ok = check(r, { 'create 201 with id': (x) => x.status === 201 && !!x.json('id') && x.json('status') === 'pending' });
  if (!ok) { businessErrors.add(1); return null; }
  const id = r.json('id');
  const g = http.get(`${BASE_URL}/transfers/${id}`, { tags: { name: 'get_transfer' } });
  check(g, { 'get 200 same id': (x) => x.status === 200 && x.json('id') === id }) || businessErrors.add(1);
  return id;
}

export function invalidTransfer() {
  const r = http.post(`${BASE_URL}/transfers`, JSON.stringify({ amount: -5, from: 'XXX' }), { ...JSON_HEADERS, tags: { name: 'invalid_transfer' }, responseCallback: http.expectedStatuses(422) });
  check(r, { 'invalid body 422': (x) => x.status === 422 && Array.isArray(x.json('errors')) }) || businessErrors.add(1);
}

export function dailyReport() {
  const r = http.get(`${BASE_URL}/reports/daily`, { tags: { name: 'daily_report' } });
  reportDegraded.add(r.status !== 200 || r.timings.duration > 500);
  return r;
}
