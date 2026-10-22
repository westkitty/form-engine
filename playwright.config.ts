import { defineConfig } from '@playwright/test';
// Default: builds and previews the production bundle on :5182. FORM_E2E_BASE=<url> runs against an already-running server (e.g. the live Pages site).
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
    // the shipped artefact: production build + preview (service worker and manifest included)
    command: 'npx vite build --outDir dist-e2e --emptyOutDir --logLevel warn && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
