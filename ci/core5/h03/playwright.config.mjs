import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  use: { browserName: 'chromium', baseURL: process.env.CORE5_UI_BASE_URL, screenshot: 'only-on-failure' },
});
