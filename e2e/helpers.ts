import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const EVID = path.resolve('artifacts/evidence');
fs.mkdirSync(EVID, { recursive: true });

export async function boot(page: Page, query = 'fresh=1') {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto('./?' + query);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
  await page.waitForTimeout(300);
  return errors;
}
export const hash = (page: Page) => page.evaluate(() => (window as any).__FORM.selectedHash() as string);
export const positions = (page: Page) => page.evaluate(() => (window as any).__FORM.selectedPositions() as number[]);
export async function screenOf(page: Page, p: [number, number, number]) { return page.evaluate(([x, y, z]) => (window as any).__FORM.screenOf(x, y, z), p); }

/** Real mouse stroke across the selected mesh, between two mesh-local surface points. */
export async function stroke(page: Page, a: [number, number, number], b: [number, number, number], opts: { steps?: number; modifiers?: ('Shift' | 'Control')[] } = {}) {
  const A = await screenOf(page, a), B = await screenOf(page, b);
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  const n = opts.steps ?? 16;
  for (let i = 1; i <= n; i++) await page.mouse.move(A.x + ((B.x - A.x) * i) / n, A.y + ((B.y - A.y) * i) / n);
  await page.mouse.up();
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
  await page.waitForTimeout(50);
}
export function maxDelta(a: ArrayLike<number>, b: ArrayLike<number>) {
  expect(a.length).toBe(b.length);
  let m = 0; for (let i = 0; i < a.length; i += 3) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])); return m;
}
export async function menu(page: Page, testid: string) { await page.getByTestId('file-menu').click(); await page.getByTestId(testid).click(); }
export async function saveDownload(page: Page, testid: string, name: string) {
  const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, testid)]);
  const out = path.join(EVID, name); await dl.saveAs(out); return out;
}
export function record(key: string, value: unknown) {
  const f = path.join(EVID, 'e2e-results.json');
  const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  cur[key] = value; cur._updated = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(cur, null, 2));
}
