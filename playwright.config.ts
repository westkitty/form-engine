import { defineConfig } from '@playwright/test';
// FORM_E2E_BASE=http://127.0.0.1:5181 runs the suite against an already-running server (e.g. `npm run preview` of the production build).
const external = process.env.FORM_E2E_BASE;
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: external ?? 'http://127.0.0.1:5182',
    launchOptions: {
      executablePath: process.env.FORM_CHROME ?? '/usr/bin/google-chrome',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: external ? undefined : {
    command: 'npx vite --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
