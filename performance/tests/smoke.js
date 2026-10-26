// Smoke: 1 VU, ~30 s. Does every endpoint answer with the right status and body shape?
import { check, sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, dur, businessErrors, makeSummary, health, rates, transfer, invalidTransfer, dailyReport } from './config.js';

export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 1, duration: dur('30s'), tags: { test_type: 'smoke' } },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    business_errors: ['count==0'],
    'http_req_duration{name:daily_report}': ['p(95)<500'],
  },
};

export default function () {
  health();
  rates();
  transfer();
  invalidTransfer();

  const missing = http.get(`${BASE_URL}/transfers/does-not-exist`, { tags: { name: 'get_transfer_404' }, responseCallback: http.expectedStatuses(404) });
  check(missing, { 'unknown transfer 404': (x) => x.status === 404 }) || businessErrors.add(1);

  const rep = dailyReport();
  check(rep, { 'report 200 with count': (x) => x.status === 200 && typeof x.json('count') === 'number' && typeof x.json('totalAmount') === 'number' }) || businessErrors.add(1);
  sleep(1);
}

export const handleSummary = makeSummary('smoke');
