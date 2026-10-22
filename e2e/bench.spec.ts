import { test } from '@playwright/test';
import fs from 'node:fs';
import { boot, EVID } from './helpers';

test('benchmark 10k / 100k / 500k triangles (headless Chromium, SwiftShader)', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  const out: any[] = [];
  for (const tris of [10_000, 100_000, 500_000]) {
    const r = await page.evaluate(t => (window as any).__FORM.bench(t, 90), tris);
    console.log(JSON.stringify(r));
    out.push(r);
  }
  const env = { date: new Date().toISOString(), ua: await page.evaluate(() => navigator.userAgent), hw: await page.evaluate(() => navigator.hardwareConcurrency), viewport: '1440x900 @1x', note: 'Software rasteriser (SwiftShader via ANGLE/Vulkan) on a cloud VM without a GPU. rAF interval is capped by the headless compositor; renderFinish = render()+gl.finish() is the GPU-inclusive cost.' };
  fs.writeFileSync(`${EVID}/bench.json`, JSON.stringify({ env, results: out }, null, 2));
});
