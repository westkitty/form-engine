import { test, expect } from '@playwright/test';
import { boot, record, EVID } from './helpers';

const VIEWS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]] as const;
for (const [w, h] of VIEWS) {
  test(`layout ${w}x${h}: canvas live, no overflow, controls reachable`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors = await boot(page);
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const cv = r('#viewport canvas'); const seg = r('#modes'); const rail = r('#rail');
      const tops = [...document.querySelectorAll('.topbar > *')].map(e => e.getBoundingClientRect()).filter(b => b.width > 0);
      let overlap = false; for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) { const a = tops[i], b = tops[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true; }
      return { canvas: [Math.round(cv.width), Math.round(cv.height)], docW: document.documentElement.scrollWidth, winW: innerWidth, topOverlap: overlap, segRight: seg.right, railVisible: rail.width > 0 && rail.height > 0 };
    });
    expect(m.canvas[0]).toBeGreaterThan(200); expect(m.canvas[1]).toBeGreaterThan(200);
    expect(m.docW).toBeLessThanOrEqual(m.winW);
    expect(m.topOverlap).toBe(false);
    expect(m.segRight).toBeLessThanOrEqual(w);
    expect(m.railVisible).toBe(true);
    await page.getByTestId('brush-clay').click();
    if (w <= 820) { await page.getByTestId('toggle-panel').click(); await page.waitForTimeout(300); }
    await expect(page.getByTestId('radius')).toBeInViewport();
    await page.screenshot({ path: `${EVID}/layout-${w}x${h}.png` });
    expect(errors).toEqual([]);
    record(`layout_${w}x${h}`, m);
  });
}
