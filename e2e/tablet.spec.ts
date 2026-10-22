/**
 * Tablet / S Pen behaviour. Input here is SIMULATED: there is no physical pen or touchscreen in CI.
 * Pen and touch are injected through Chrome DevTools Protocol (Input.dispatchMouseEvent with pointerType "pen",
 * Input.dispatchTouchEvent) — these arrive as trusted PointerEvents through Chrome's real input pipeline,
 * with pressure, tiltX/tiltY and twist. The eraser end (button 5) cannot be expressed via CDP, so that one
 * case uses a synthetic PointerEvent and is labelled as such.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { boot, hash, positions, maxDelta, record, tap, drawer, closeDrawer } from './helpers';

test.use({ hasTouch: true, viewport: { width: 1480, height: 924 } });

type Pt = { x: number; y: number };
const arc = async (page: Page, y = 0.3, n = 12) => { const pts: Pt[] = []; for (let i = 0; i <= n; i++) pts.push(await page.evaluate(([i, y, n]) => (window as any).__FORM.screenOf(-0.25 + (i * 0.5) / n, y, 0.92), [i, y, n])); return pts; };
const F = <T,>(page: Page, fn: string) => page.evaluate(fn) as Promise<T>;
async function pen(cdp: CDPSession, pts: Pt[], o: { pressure?: number; tiltX?: number; tiltY?: number; twist?: number; button?: 'left' | 'right'; hoverOnly?: boolean } = {}) {
  const base = { pointerType: 'pen' as const, tiltX: o.tiltX ?? 0, tiltY: o.tiltY ?? 0, twist: o.twist ?? 0 };
  const btn = o.button ?? 'left'; const bits = btn === 'right' ? 2 : 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y, buttons: 0, force: 0, ...base });
  if (o.hoverOnly) { for (const p of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 0, force: 0, ...base }); return; }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: btn, buttons: bits, clickCount: 1, force: o.pressure ?? 0.5, ...base });
  for (const p of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: btn, buttons: bits, force: o.pressure ?? 0.5, ...base });
  const l = pts[pts.length - 1];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button: btn, buttons: 0, clickCount: 1, force: 0, ...base });
}
async function touch(cdp: CDPSession, frames: Pt[][]) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: frames[0].map((p, id) => ({ x: p.x, y: p.y, id })) });
  for (const f of frames.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: f.map((p, id) => ({ x: p.x, y: p.y, id })) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const camPos = (page: Page) => F<number[]>(page, '(() => { const F = window.__FORM; F.vp.controls.update(); return F.vp.camera.position.toArray(); })()');
const changedVerts = (a: number[], b: number[]) => { let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]) > 1e-6) n++; return n; };
const fresh = (page: Page) => page.getByTestId('act-new').evaluate(el => (el as HTMLElement).click());

test('SIMULATED S Pen: pressure scales depth, tilt widens the brush, twist is read', async ({ page }) => {
  await boot(page); const cdp = await page.context().newCDPSession(page);
  const pts = await arc(page);
  const a0 = await positions(page); await pen(cdp, pts, { pressure: 0.15 }); const a1 = await positions(page);
  const ls1 = await F<any>(page, 'window.__FORM.tool.lastStroke');
  await fresh(page); const b0 = await positions(page); await pen(cdp, pts, { pressure: 1 }); const b1 = await positions(page);
  const light = maxDelta(a0, a1), heavy = maxDelta(b0, b1);
  expect(ls1.pointerType).toBe('pen'); expect(ls1.maxPressure).toBeLessThan(0.3);
  expect(heavy).toBeGreaterThan(light * 2);
  // tilt: same stroke and pressure, pen laid over at ~60° → wider footprint
  await fresh(page); const c0 = await positions(page); await pen(cdp, pts, { pressure: 0.6 }); const c1 = await positions(page);
  await fresh(page); const d0 = await positions(page); await pen(cdp, pts, { pressure: 0.6, tiltX: 55, tiltY: 25, twist: 90 }); const d1 = await positions(page);
  const upright = changedVerts(c0, c1), tilted = changedVerts(d0, d1);
  const st = await F<any>(page, '({ ls: window.__FORM.tool.lastStroke, last: window.__FORM.tool.pen.last })');
  expect(st.ls.maxRadiusScale).toBeGreaterThan(1.4);
  expect(tilted).toBeGreaterThan(upright * 1.4);
  expect(st.last.twist).toBe(90);
  // readout in Settings shows live pen data
  await drawer(page, 'settings'); await expect(page.getByTestId('pen-readout')).toContainText('Pen detected');
  record('tablet_pen', { simulated: 'CDP Input.dispatchMouseEvent pointerType=pen', lightDelta: light, heavyDelta: heavy, uprightVerts: upright, tiltedVerts: tilted, tiltRadiusScale: st.ls.maxRadiusScale, twistRead: st.last.twist });
});

test('SIMULATED pen hover shows the brush cursor without sculpting', async ({ page }) => {
  await boot(page); const cdp = await page.context().newCDPSession(page);
  const h0 = await hash(page); const pts = await arc(page, 0.1, 4);
  await pen(cdp, pts, { hoverOnly: true }); await page.waitForTimeout(120);
  const s = await F<any>(page, '({ cursor: window.__FORM.vp.cursor.visible, hovering: window.__FORM.tool.pen.hovering, seen: window.__FORM.tool.pen.seen })');
  expect(s).toEqual({ cursor: true, hovering: true, seen: true });
  expect(await hash(page)).toBe(h0);
  record('tablet_hover', s);
});

test('SIMULATED palm rejection: touches during/just after the pen are ignored; later touches navigate, never sculpt', async ({ page }) => {
  await boot(page); const cdp = await page.context().newCDPSession(page);
  const pts = await arc(page);
  await pen(cdp, pts, { pressure: 0.5 }); const h1 = await hash(page); const cam1 = await camPos(page);
  // palm lands right after the pen lifts (pen still hovering): no sculpt, no orbit
  await touch(cdp, [[pts[2]], [pts[6]], [pts[10]]]);
  await page.waitForTimeout(100);
  expect(await hash(page)).toBe(h1);
  expect(maxDelta(cam1, await camPos(page))).toBeLessThan(1e-6);
  const rejected = await F<number>(page, 'window.__FORM.tool.pen.rejectedTouches');
  expect(rejected).toBeGreaterThan(0);
  // once the pen has been away for a while, one finger orbits — and still never sculpts (pen-only mode)
  await page.waitForTimeout(1700);
  const start = { x: 300, y: 450 }; const frames: Pt[][] = []; for (let i = 0; i <= 10; i++) frames.push([{ x: start.x + i * 25, y: start.y }]);
  await touch(cdp, frames); await page.waitForTimeout(400);
  const cam2 = await camPos(page);
  expect(maxDelta(cam1, cam2)).toBeGreaterThan(0.05);
  // finger dragged straight across the model: still no sculpt
  await touch(cdp, pts.map(p => [p])); await page.waitForTimeout(200);
  expect(await hash(page)).toBe(h1);
  record('tablet_palm', { rejectedTouches: rejected, orbitAfterPenAway: maxDelta(cam1, cam2), sculptByFinger: false });
});

test('SIMULATED S Pen side button subtracts (or smooths, per setting)', async ({ page }) => {
  await boot(page); const cdp = await page.context().newCDPSession(page);
  const pts = await arc(page);
  const radial = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i += 3) s += Math.hypot(b[i], b[i + 1], b[i + 2]) - Math.hypot(a[i], a[i + 1], a[i + 2]); return s; };
  const p0 = await positions(page); await pen(cdp, pts, { pressure: 0.8, button: 'right' }); const p1 = await positions(page);
  const ls = await F<any>(page, 'window.__FORM.tool.lastStroke');
  expect(ls.invert).toBe(true); expect(radial(p0, p1)).toBeLessThan(0); // carved inward
  await fresh(page); const q0 = await positions(page); await pen(cdp, pts, { pressure: 0.8 }); const q1 = await positions(page);
  expect(radial(q0, q1)).toBeGreaterThan(0); // normal stroke builds outward
  await drawer(page, 'settings'); await page.getByTestId('set-barrel').selectOption('smooth'); await closeDrawer(page);
  await pen(cdp, pts, { pressure: 0.8, button: 'right' });
  expect((await F<any>(page, 'window.__FORM.tool.lastStroke')).tool).toBe('smooth');
  record('tablet_sidebutton', { invertRadialSum: radial(p0, p1), normalRadialSum: radial(q0, q1), smoothSetting: true });
});

test('SIMULATED (synthetic PointerEvent) eraser end paints mask', async ({ page }) => {
  await boot(page);
  const pts = await arc(page);
  await page.evaluate(pts => {
    const cv = document.querySelector('#viewport canvas')!;
    const ev = (t: string, p: { x: number; y: number }) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: 41, pointerType: 'pen', pressure: 0.7, clientX: p.x, clientY: p.y, button: t === 'pointerdown' ? 5 : t === 'pointerup' ? 5 : -1, buttons: t === 'pointerup' ? 0 : 32 }));
    ev('pointerdown', pts[0]); for (const p of pts.slice(1)) ev('pointermove', p); ev('pointerup', pts[pts.length - 1]);
  }, pts);
  const r = await F<any>(page, '(() => { const F = window.__FORM; const s = F.doc.sculptOf(F.doc.selectedNode); let m = 0; for (const v of s.mesh.mask) if (v > 0.1) m++; return { masked: m, tool: F.tool.lastStroke.tool }; })()');
  expect(r.tool).toBe('mask'); expect(r.masked).toBeGreaterThan(10);
  record('tablet_eraser', r);
});

test('SIMULATED two-finger pinch/pan navigates and never sculpts', async ({ page }) => {
  await boot(page); const cdp = await page.context().newCDPSession(page);
  const h0 = await hash(page); const c0 = await camPos(page);
  const pts = await arc(page);
  const mid = pts[6]; const frames: Pt[][] = [];
  for (let i = 0; i <= 10; i++) frames.push([{ x: mid.x - 40 - i * 12, y: mid.y }, { x: mid.x + 40 + i * 12, y: mid.y + i * 3 }]);
  await touch(cdp, frames); await page.waitForTimeout(400);
  expect(await hash(page)).toBe(h0);
  const c1 = await camPos(page);
  expect(maxDelta(c0, c1)).toBeGreaterThan(0.02);
  record('tablet_twofinger', { sculpted: false, cameraMoved: maxDelta(c0, c1) });
});

test('page is locked for drawing: touch-action, overscroll, context menu, adaptive pixel ratio', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 924 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage(); await boot(page);
  const r = await F<any>(page, `(() => { const cv = document.querySelector('#viewport canvas'); const cs = getComputedStyle(cv);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); cv.dispatchEvent(ev);
    const F = window.__FORM; return { touchAction: cs.touchAction, bodyTouch: getComputedStyle(document.body).touchAction, overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY, ctxPrevented: ev.defaultPrevented,
      dpr: devicePixelRatio, pr: F.vp.pixelRatio, buf: [cv.width, cv.height] }; })()`);
  expect(r.touchAction).toBe('none'); expect(r.bodyTouch).not.toBe('none');
  expect(r.overscroll).toBe('none'); expect(r.ctxPrevented).toBe(true);
  expect(r.pr).toBeGreaterThan(1); expect(r.pr).toBeLessThan(2);
  expect(r.buf[0] * r.buf[1]).toBeLessThanOrEqual(3.3e6);
  await drawer(page, 'settings'); await page.getByTestId('set-quality').selectOption('sharp');
  const sharp = await F<number>(page, 'window.__FORM.vp.pixelRatio'); expect(sharp).toBe(2);
  record('tablet_lock', { ...r, sharpPixelRatio: sharp });
  await ctx.close();
});

test('full screen toggle enters and leaves full screen; auto full screen on first touch', async ({ page }) => {
  await boot(page);
  await tap(page, 'fullscreen');
  await expect.poll(() => F<boolean>(page, '!!document.fullscreenElement')).toBe(true);
  await expect(page.getByTestId('fullscreen')).toHaveAttribute('aria-pressed', 'true');
  await tap(page, 'fullscreen');
  await expect.poll(() => F<boolean>(page, '!!document.fullscreenElement')).toBe(false);
  await expect(page.getByTestId('fullscreen')).toHaveAttribute('aria-pressed', 'false');
  // auto: enable, reload (setting persists), first finger tap → full screen
  await drawer(page, 'settings'); await page.getByTestId('set-autofs').check();
  await page.reload(); await page.waitForSelector('body[data-ready="1"]', { state: 'attached' });
  expect(await F<boolean>(page, 'window.__FORM.settings.autoFullscreen')).toBe(true);
  await page.touchscreen.tap(200, 300);
  await expect.poll(() => F<boolean>(page, '!!document.fullscreenElement')).toBe(true);
  record('fullscreen', { toggle: true, autoOnFirstTouch: true, note: 'headless Chromium Fullscreen API' });
});
