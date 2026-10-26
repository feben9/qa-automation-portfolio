// Load: the traffic we expect on a normal busy day. Ramp to a steady level, hold, ramp down.
// Mix: mostly reads of /rates, some transfers, a trickle of reports.
import { sleep } from 'k6';
import { dur, vus, makeSummary, normalThresholds, health, rates, transfer, dailyReport } from './config.js';

export const options = {
  scenarios: {
    customers: {
      executor: 'ramping-vus',
      exec: 'customer',
      startVUs: 0,
      stages: [
        { duration: dur('20s'), target: vus(40) },
        { duration: dur('60s'), target: vus(40) },
        { duration: dur('10s'), target: 0 },
      ],
      tags: { test_type: 'load' },
    },
    finance: {
      // Back-office reports: a few at a time, constant.
      executor: 'constant-vus',
      exec: 'finance',
      vus: vus(3),
      duration: dur('90s'),
      tags: { test_type: 'load' },
    },
  },
  thresholds: {
    ...normalThresholds,
    // The report endpoint is slower by nature, so it gets its own, looser budget.
    'http_req_duration{name:daily_report}': ['p(95)<600'],
    'http_req_failed{name:daily_report}': ['rate<0.01'],
    transfer_create_time: ['p(95)<300', 'avg<150'],
  },
};

export function customer() {
  health();
  rates();
  if (Math.random() < 0.4) transfer();
  sleep(1);
}

export function finance() {
  dailyReport();
  sleep(2);
}

export const handleSummary = makeSummary('load');
