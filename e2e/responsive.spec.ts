import { test, expect } from '@playwright/test';
import { boot, record, EVID } from './helpers';

// Tab S9 Ultra native (2960x1848 at DPR 1 and as Chrome reports it, 1480x924 @2x), small tablet landscape/portrait, phone.
const VIEWS = [[2960, 1848, 1], [1480, 924, 2], [1024, 768, 1], [768, 1024, 1], [390, 844, 1]] as const;
for (const [w, h, dpr] of VIEWS) {
  test(`layout ${w}x${h}@${dpr}: model first, dock reachable, 44px+ targets, nothing clipped`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true });
    const page = await ctx.newPage();
    const errors = await boot(page);
    const m = await page.evaluate(() => {
      const R = (e: Element) => e.getBoundingClientRect();
      const cv = R(document.querySelector('#viewport canvas')!); const dock = R(document.querySelector('#dock')!);
      const corners = [...document.querySelectorAll('.bar')].map(R);
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const targets = [...document.querySelectorAll('#dock button, .bar button:not([hidden])')].map(e => { const r = R(e); return { id: (e as HTMLElement).dataset.testid, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(t => t.w > 0);
      const small = targets.filter(t => t.w < 44 || t.h < 44);
      const clipped = [...document.querySelectorAll('#dock button span, #dock .sl span')].filter(e => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1).map(e => e.textContent);
      const visiblePanels = [...document.querySelectorAll('#drawer.open, #hud:not([hidden])')].length;
      return { canvas: [Math.round(cv.width), Math.round(cv.height)], docW: document.documentElement.scrollWidth, winW: innerWidth, dock: [Math.round(dock.left), Math.round(dock.top), Math.round(dock.right), Math.round(dock.bottom)], dockInView: dock.left >= 0 && dock.right <= innerWidth && dock.bottom <= innerHeight, dockHitsCorner: corners.some(c => hit(c, dock)), small, clipped, visiblePanels, dockAreaShare: (dock.width * dock.height) / (innerWidth * innerHeight) };
    });
    expect(m.canvas[0]).toBe(w); expect(m.canvas[1]).toBe(h);           // the model gets the whole screen
    expect(m.docW).toBeLessThanOrEqual(m.winW);
    expect(m.dockInView).toBe(true); expect(m.dockHitsCorner).toBe(false);
    expect(m.small).toEqual([]); expect(m.clipped).toEqual([]);
    expect(m.visiblePanels).toBe(0);                                     // no drawer or HUD by default
    expect(m.dockAreaShare).toBeLessThan(w < 500 ? 0.3 : w < 1100 ? 0.16 : 0.1);
    await page.getByTestId('brush-clay').click();
    await expect(page.getByTestId('radius')).toBeInViewport();
    await page.getByTestId('file-menu').click();
    await expect(page.getByTestId('act-save')).toBeInViewport();
    await page.getByTestId('drawer-close').click();
    await page.screenshot({ path: `${EVID}/layout-${w}x${h}${dpr > 1 ? '@' + dpr + 'x' : ''}.png` });
    expect(errors).toEqual([]);
    record(`layout_${w}x${h}@${dpr}`, m);
    await ctx.close();
  });
}
