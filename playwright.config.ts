import { defineConfig, devices } from '@playwright/test';

/**
 * Accessibility (axe-core) gate. Tests run against the production build served
 * by `vite preview`, so what passes here is what actually ships to Pages.
 * Run `npm run build` first (CI does).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4222/crypto-lab-bb84/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4222 --strictPort',
    url: 'http://localhost:4222/crypto-lab-bb84/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
