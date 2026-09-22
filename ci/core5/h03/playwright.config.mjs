import { defineConfig } from '@playwright/test';

const key = String(process.env.CORE5_REVIEW_ACCESS_KEY || '').trim();

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: 'chromium',
    baseURL: process.env.CORE5_UI_BASE_URL,
    screenshot: 'only-on-failure',
    httpCredentials: key ? { username: 'core5', password: key } : undefined,
  },
});
