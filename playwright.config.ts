import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5182',
    launchOptions: {
      executablePath: process.env.FORM_CHROME ?? '/usr/bin/google-chrome',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
