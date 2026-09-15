import { defineConfig, devices } from '@playwright/test';

// Сквозные тесты гоняются против ТЕСТОВОЙ площадки: тестовая база, настоящие пользователи не задеты.
// Другой адрес: E2E_BASE_URL=... npm run test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://staging-ovora-cargo.saburov.workers.dev',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
