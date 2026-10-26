// Stress: keep adding load past capacity to find where it breaks.
// The report endpoint degrades first (concurrency-dependent delay, then 503s); the rest of the API stays healthy.
// Thresholds here DOCUMENT the break point: they are expected to pass, i.e. the report endpoint
// is shown to exceed 600 ms and to start shedding load, while normal endpoints stay under 300 ms.
import { sleep } from 'k6';
import { dur, vus, makeSummary, health, rates, transfer, dailyReport } from './config.js';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      exec: 'normal',
      startRate: 10, timeUnit: '1s',
      preAllocatedVUs: vus(50), maxVUs: vus(300),
      stages: [
        { duration: dur('15s'), target: 40 },
        { duration: dur('15s'), target: 80 },
        { duration: dur('15s'), target: 160 },
        { duration: dur('15s'), target: 240 },
      ],
      tags: { test_type: 'stress' },
    },
    reports: {
      executor: 'ramping-vus',
      exec: 'reports',
      startVUs: 1,
      stages: [
        { duration: dur('15s'), target: vus(5) },
        { duration: dur('15s'), target: vus(15) },
        { duration: dur('15s'), target: vus(30) },
        { duration: dur('15s'), target: vus(60) },
      ],
      tags: { test_type: 'stress' },
    },
  },
  thresholds: {
    // Healthy side: normal endpoints keep their budget even while reports are drowning.
    'http_req_duration{name:rates}': ['p(95)<300'],
    'http_req_duration{name:create_transfer}': ['p(95)<300'],
    // Degradation: these are "the bottleneck is visible" assertions.
    'http_req_duration{name:daily_report}': ['p(95)>600'],
    report_degraded: ['rate>0.1'],
  },
};

export function normal() {
  const pick = Math.random();
  if (pick < 0.6) rates();
  else if (pick < 0.9) transfer();
  else health();
}

export function reports() {
  dailyReport();
  sleep(0.5);
}

export const handleSummary = makeSummary('stress');
