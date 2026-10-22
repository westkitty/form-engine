/**
 * Installable app ("wrapper") checks, run against the production build (sw.js only exists there).
 * Installability is judged by Chrome itself via DevTools Protocol Page.getInstallabilityErrors / Page.getAppManifest.
 */
import { test, expect, chromium } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { boot, record, drawer } from './helpers';

test('manifest + service worker: Chrome reports the app installable, and it opens offline', async ({ request, baseURL }) => {
  const root = baseURL!.endsWith('/') ? baseURL! : baseURL + '/';
  const sw = await request.get(root + 'sw.js');
  test.skip(!sw.ok(), 'service worker is only emitted by the production build');
  // a persistent (non-incognito) profile: Chrome never offers install from incognito, which is what default test contexts are
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-pwa-'));
  const context = await chromium.launchPersistentContext(dir, { executablePath: process.env.FORM_CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], baseURL: root, viewport: { width: 1480, height: 924 } });
  const page = context.pages()[0] ?? await context.newPage();
  await boot(page, 'fresh=1');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const cdp = await context.newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest') as any;
  expect(man.errors).toEqual([]);
  const m = JSON.parse(man.data);
  expect(m.display).toBe('fullscreen');
  expect(m.display_override).toEqual(['fullscreen', 'standalone']);
  expect(m.orientation).toBe('any');
  expect(m.start_url).toBe('./'); expect(m.scope).toBe('./'); expect(m.id).toBe('form-engine'); // resolves against the origin → <origin>/form-engine, unique per site
  const maskable = m.icons.filter((i: any) => i.purpose === 'maskable').map((i: any) => i.sizes).sort();
  expect(maskable).toEqual(['192x192', '512x512']);
  expect(m.screenshots.map((s: any) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
  for (const u of [...m.icons, ...m.screenshots].map((i: any) => new URL(i.src, man.url).toString())) expect((await page.request.get(u)).status(), u).toBe(200);

  const inst = await cdp.send('Page.getInstallabilityErrors') as any;
  expect(inst.installabilityErrors).toEqual([]);
  const ids = await cdp.send('Page.getAppId').catch(() => null) as any;

  // offline: the shell comes from the service worker cache
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector('body[data-ready="1"]', { state: 'attached', timeout: 30_000 });
  const offline = await page.evaluate(async () => ({ ready: document.body.dataset.ready, canvas: !!document.querySelector('#viewport canvas'), networkBlocked: await fetch('./not-cached-' + Date.now()).then(() => false, () => true) }));
  await context.setOffline(false);
  expect(offline.networkBlocked).toBe(true); expect(offline.ready).toBe('1'); expect(offline.canvas).toBe(true);
  await context.close(); fs.rmSync(dir, { recursive: true, force: true });
  record('pwa', { manifestUrl: man.url, installabilityErrors: inst.installabilityErrors, appId: ids?.appId ?? null, display: m.display, display_override: m.display_override, swControlled: true, offlineBoot: offline });
});

test('Install button appears on beforeinstallprompt and calls prompt(); hint otherwise', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('install')).toBeHidden();
  await drawer(page, 'settings');
  await expect(page.getByTestId('install-hint')).toContainText(/Install|install|Add to Home/);
  await page.getByTestId('drawer-close').click();
  // SIMULATED: headless Chromium does not fire a real beforeinstallprompt (it needs a user-engagement heuristic)
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as any;
    (window as any).__prompted = 0;
    e.prompt = async () => { (window as any).__prompted++; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(page.getByTestId('install')).toBeVisible();
  await page.getByTestId('install').click();
  await expect.poll(() => page.evaluate(() => (window as any).__prompted)).toBe(1);
  await expect(page.getByTestId('install')).toBeHidden();
  record('installButton', { simulatedEvent: true, promptCalled: true });
});
