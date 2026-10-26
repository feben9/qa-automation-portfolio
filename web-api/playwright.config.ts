import { defineConfig, devices } from '@playwright/test';

// Two projects: browser UI tests against Sauce Demo, and pure HTTP tests
// against the Restful-Booker API. Both are public practice systems.
export default defineConfig({
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'ui',
      testDir: './tests/ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://www.saucedemo.com',
        testIdAttribute: 'data-test', // the site tags elements with data-test
      },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: 'https://restful-booker.herokuapp.com' },
    },
  ],
});
