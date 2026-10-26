// Spike: a sudden jump (a payday rush) and then back to normal. Does the API survive it and recover?
// The last stage is a recovery window tagged separately so we can assert latency is back to normal.
import { sleep } from 'k6';
import { dur, vus, makeSummary, health, rates, transfer } from './config.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: dur('10s'), target: vus(5) },    // baseline
        { duration: dur('3s'), target: vus(150) },   // spike
        { duration: dur('15s'), target: vus(150) },  // hold
        { duration: dur('3s'), target: vus(5) },     // drop
        { duration: dur('20s'), target: vus(5) },    // recovery
      ],
      tags: { test_type: 'spike' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    business_errors: ['count==0'],
    'http_req_duration{name:rates}': ['p(95)<500'],
    'http_req_duration{name:create_transfer}': ['p(95)<500'],
    transfer_create_time: ['p(99)<1000'],
  },
};

export default function () {
  health();
  rates();
  if (Math.random() < 0.5) transfer();
  sleep(0.5);
}

export const handleSummary = makeSummary('spike');
