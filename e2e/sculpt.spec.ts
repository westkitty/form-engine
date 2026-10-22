import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { boot, hash, positions, stroke, maxDelta, saveDownload, record, EVID, tap, drawer, closeDrawer } from './helpers';
import { readGlb, readBinaryStl, readObjVertices } from '../src/io/verify-readers';

test.describe.configure({ mode: 'serial' });

test('boots to a WebGL2 viewport with no runtime errors', async ({ page }) => {
  const errors = await boot(page);
  const gl = await page.evaluate(() => { const r = (window as any).__FORM.vp.renderer; return { webgl2: r.capabilities.isWebGL2, renderer: (window as any).__FORM.vp.rendererInfo }; });
  expect(gl.webgl2).toBe(true);
  await expect(page.locator('#viewport canvas')).toBeVisible();
  expect(errors).toEqual([]);
  record('boot', gl);
});

test('every brush deforms real vertices through real pointer strokes, each differently', async ({ page }) => {
  await boot(page);
  const tools = ['draw', 'inflate', 'clay', 'smooth', 'grab', 'flatten', 'pinch', 'crease'];
  const results: Record<string, { changed: boolean; maxDelta: number; hash: string }> = {};
  for (const t of tools) {
    await page.getByTestId('act-new').evaluate(el => (el as HTMLElement).click());
    const before = await positions(page);
    if (t === 'smooth' || t === 'flatten') { await tap(page, 'brush-draw'); await stroke(page, [0.1, 0.4, 0.91], [0.3, 0.3, 0.9]); }
    await tap(page, `brush-${t}`);
    const mid = await positions(page);
    await stroke(page, [0.0, 0.35, 0.94], [0.35, 0.3, 0.89], { steps: 20 });
    const after = await positions(page);
    results[t] = { changed: maxDelta(mid, after) > 1e-4, maxDelta: maxDelta(before, after), hash: await hash(page) };
    expect(results[t].changed, `${t} changed geometry`).toBe(true);
  }
  expect(new Set(Object.values(results).map(r => r.hash)).size).toBe(tools.length);
  await page.screenshot({ path: `${EVID}/sculpt-crease-1440.png` });
  record('brushes', results);
});

test('X symmetry mirrors a real stroke; mask freezes vertices', async ({ page }) => {
  await boot(page);
  await tap(page, 'brush-draw');
  const p0 = await positions(page);
  await stroke(page, [0.45, 0.3, 0.84], [0.5, 0.1, 0.86]);
  const p1 = await positions(page);
  const res = await page.evaluate(([a, b]) => {
    const near = (p: number[], q: number[]) => { let bi = 0, bd = 1e9; for (let i = 0; i < p.length; i += 3) { const d = Math.hypot(p[i] - q[0], p[i + 1] - q[1], p[i + 2] - q[2]); if (d < bd) { bd = d; bi = i; } } return bi; };
    const i = near(a, [0.48, 0.2, 0.85]); const j = near(a, [-a[i], a[i + 1], a[i + 2]]);
    const di = Math.hypot(b[i] - a[i], b[i + 1] - a[i + 1], b[i + 2] - a[i + 2]); const dj = Math.hypot(b[j] - a[j], b[j + 1] - a[j + 1], b[j + 2] - a[j + 2]);
    return { di, dj, mirrorX: b[j] + b[i] };
  }, [p0, p1]);
  expect(res.di).toBeGreaterThan(1e-3);
  expect(Math.abs(res.di - res.dj)).toBeLessThan(1e-4);
  expect(Math.abs(res.mirrorX)).toBeLessThan(1e-4);
  await tap(page, 'sym-x'); // symmetry off
  await tap(page, 'brush-mask');
  for (let k = 0; k < 3; k++) await stroke(page, [-0.1, -0.3, 0.95], [0.1, -0.3, 0.95]);
  const m0 = await positions(page);
  await tap(page, 'brush-draw');
  await stroke(page, [-0.1, -0.3, 0.95], [0.1, -0.3, 0.95]);
  const m1 = await positions(page);
  const frozen = await page.evaluate(([a, b]) => { let bi = 0, bd = 1e9; for (let i = 0; i < a.length; i += 3) { const d = Math.hypot(a[i] - 0, a[i + 1] + 0.3, a[i + 2] - 0.95); if (d < bd) { bd = d; bi = i; } } return Math.hypot(b[bi] - a[bi], b[bi + 1] - a[bi + 1], b[bi + 2] - a[bi + 2]); }, [m0, m1]);
  expect(frozen).toBeLessThan(1e-4);
  await tap(page, 'mask-clear');
  await stroke(page, [-0.1, -0.3, 0.95], [0.1, -0.3, 0.95]);
  expect(maxDelta(m1, await positions(page))).toBeGreaterThan(1e-3);
  record('symmetryMask', { mirrorDisplacementDiff: Math.abs(res.di - res.dj), maskedVertexMove: frozen });
});

test('Esc cancels a live stroke exactly; undo/redo are byte-exact', async ({ page }) => {
  await boot(page);
  const h0 = await hash(page);
  const A = await page.evaluate(() => (window as any).__FORM.screenOf(0, 0.3, 0.95));
  await page.mouse.move(A.x, A.y); await page.mouse.down();
  for (let i = 1; i < 12; i++) await page.mouse.move(A.x + i * 6, A.y);
  expect(await hash(page)).not.toBe(h0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await hash(page)).toBe(h0);
  await stroke(page, [0, 0.3, 0.95], [0.3, 0.3, 0.9]); const h1 = await hash(page);
  await tap(page, 'brush-inflate');
  await stroke(page, [0, -0.2, 0.97], [0.2, -0.2, 0.95]); const h2 = await hash(page);
  await tap(page, 'undo'); expect(await hash(page)).toBe(h1);
  await page.keyboard.press('Control+z'); expect(await hash(page)).toBe(h0);
  await tap(page, 'redo'); await page.keyboard.press('Control+Shift+z'); expect(await hash(page)).toBe(h2);
  record('transactions', { h0, h1, h2, cancelExact: true, undoRedoExact: true });
});

test('GLB export → independent parse → re-import → still editable (maxPositionDelta proof)', async ({ page }) => {
  await boot(page);
  const orig = await positions(page);
  await tap(page, 'brush-draw');
  await stroke(page, [-0.2, 0.4, 0.89], [0.3, 0.35, 0.88]);
  await tap(page, 'brush-crease');
  await stroke(page, [-0.3, -0.1, 0.95], [0.3, -0.1, 0.95]);
  const sculpted = await positions(page);
  const deform = maxDelta(orig, sculpted);
  expect(deform).toBeGreaterThan(0.02);
  const file = await saveDownload(page, 'act-export-glb', 'sculpted.glb');
  const buf = fs.readFileSync(file);
  const glb = readGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  expect(glb.meshes.length).toBe(1);
  const exportedDelta = maxDelta(sculpted, glb.meshes[0].positions);
  expect(exportedDelta).toBeLessThan(1e-6);
  await page.getByTestId('file-import').setInputFiles(file);
  await expect(page.locator('#tree li[data-id]')).toHaveCount(2); // original sphere + imported mesh (wrapper groups collapsed)
  const re = await positions(page);
  const reimportDelta = maxDelta(sculpted, re);
  expect(reimportDelta).toBeLessThan(1e-6);
  const hRe = await hash(page);
  await tap(page, 'brush-draw');
  await stroke(page, [0, 0.0, 1.0], [0.2, 0.0, 0.98]);
  expect(await hash(page)).not.toBe(hRe);
  const objF = await saveDownload(page, 'act-export-obj', 'scene.obj');
  const stlF = await saveDownload(page, 'act-export-stl', 'scene.stl');
  const objV = readObjVertices(fs.readFileSync(objF, 'utf8'));
  const sb = fs.readFileSync(stlF); const stlTris = readBinaryStl(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength));
  expect(objV.length / 3).toBe(2 * sculpted.length / 3);
  expect(stlTris.length / 9).toBe(2 * 49152);
  const objDelta = maxDelta(sculpted, objV.subarray(0, sculpted.length));
  expect(objDelta).toBeLessThan(1e-5);
  await page.getByTestId('file-import').setInputFiles(objF);
  await expect(page.locator('#status')).toContainText('Imported scene.obj');
  await page.getByTestId('file-import').setInputFiles(stlF);
  await expect(page.locator('#status')).toContainText('Imported scene.stl');
  const stlWeld = await page.evaluate(() => { const F = (window as any).__FORM; const st = F.doc.sculptOf(F.doc.selectedNode); return { verts: st.mesh.vertCount, render: st.mesh.renderCount }; });
  expect(stlWeld.render).toBe(2 * 49152 * 3);
  const uniq = new Set<string>(); for (let i = 0; i < stlTris.length; i += 3) uniq.add(`${stlTris[i]},${stlTris[i + 1]},${stlTris[i + 2]}`);
  // triangle soup welded to the distinct positions (independently counted); weld tolerance 1e-6 × bbox diagonal may merge a few near-coincident points
  expect(stlWeld.verts).toBeLessThanOrEqual(uniq.size); expect(stlWeld.verts).toBeGreaterThan(uniq.size * 0.999);
  record('roundtrip', { deformFromSphere: deform, glbBytes: buf.byteLength, exportedVsInApp: exportedDelta, reimportVsInApp: reimportDelta, objVsInApp: objDelta, stlTriangles: stlTris.length / 9, stlWeld: { ...stlWeld, distinctPositionsInFile: uniq.size }, reimportedEditable: true });
});

test('bad files fail loudly without damaging the scene', async ({ page }) => {
  await boot(page);
  const h = await hash(page);
  await page.getByTestId('file-import').setInputFiles({ name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('not a glb at all') });
  await expect(page.locator('#status')).toContainText('Import failed');
  await page.getByTestId('file-open').setInputFiles({ name: 'broken.formengine', mimeType: 'application/zip', buffer: Buffer.from('PK garbage') });
  await expect(page.locator('#status')).toContainText('Open failed');
  expect(await hash(page)).toBe(h);
});

test('native project: hierarchy, transforms, mask and geometry survive save/open', async ({ page }) => {
  await boot(page);
  await stroke(page, [0, 0.3, 0.95], [0.3, 0.3, 0.9]);
  await tap(page, 'brush-mask');
  await stroke(page, [0, -0.3, 0.95], [0.2, -0.3, 0.93]);
  const h = await hash(page);
  const sphereId = await page.evaluate(() => (window as any).__FORM.doc.selected);
  await tap(page, 'add-group');
  const groupId = await page.evaluate(() => (window as any).__FORM.doc.selected);
  await drawer(page, 'scene'); await page.locator(`#tree li[data-id="${sphereId}"]`).click();
  await page.getByTestId('i-parent').selectOption(groupId);
  await page.locator('[data-xf=position][data-a=x]').fill('0.75'); await page.locator('[data-xf=position][data-a=x]').dispatchEvent('change');
  await closeDrawer(page);
  const file = await saveDownload(page, 'act-save', 'sample.formengine');
  await tap(page, 'act-new');
  expect(await hash(page)).not.toBe(h);
  await page.getByTestId('file-open').setInputFiles(file);
  await expect(page.locator('#status')).toContainText('Opened');
  const st = await page.evaluate(([sid, gid]) => { const F = (window as any).__FORM; const n = F.doc.nodes.get(sid); const s = F.doc.sculptOf(n); let masked = 0; for (const v of s.mesh.mask) if (v > 0.5) masked++; return { parentIsGroup: n.obj.parent === F.doc.nodes.get(gid).obj, x: n.obj.position.x, masked, nodes: F.doc.nodes.size }; }, [sphereId, groupId]);
  await drawer(page, 'scene'); await page.locator(`#tree li[data-id="${sphereId}"]`).click();
  expect(await hash(page)).toBe(h);
  expect(st.parentIsGroup).toBe(true); expect(st.x).toBeCloseTo(0.75, 6); expect(st.masked).toBeGreaterThan(10);
  record('project', { bytes: fs.statSync(file).size, ...st, hashPreserved: true });
});

test('IndexedDB autosave recovers after reload, and falls back when the newest slot is corrupt', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__FORM.autosaveClear());
  await stroke(page, [0, 0.3, 0.95], [0.3, 0.3, 0.9]);
  await page.evaluate(() => (window as any).__FORM.autosaveNow()); const hA = await hash(page);
  await tap(page, 'brush-inflate');
  await stroke(page, [0, -0.3, 0.95], [0.3, -0.3, 0.9]);
  await page.evaluate(() => (window as any).__FORM.autosaveNow()); const hB = await hash(page);
  await boot(page, '');
  await expect(page.locator('#banner')).toBeVisible();
  expect(await hash(page)).toBe(hB);
  await page.evaluate(() => (window as any).__FORM.autosaveCorruptHead());
  await boot(page, '');
  const rec = await page.evaluate(() => (window as any).__FORM_RECOVERY);
  expect(rec.fellBack).toBe(true);
  expect(await hash(page)).toBe(hA);
  await expect(page.locator('#banner')).toContainText('damaged');
  record('autosave', { recoveredLatest: true, corruptFallback: rec });
});

test('transform edits are undoable', async ({ page }) => {
  await boot(page);
  await tap(page, 'mode-translate');
  await expect(page.getByTestId('mode-done')).toBeVisible();
  await drawer(page, 'scene');
  const inp = page.locator('[data-xf=scale][data-a=y]'); await inp.fill('2'); await inp.dispatchEvent('change');
  expect(await page.evaluate(() => (window as any).__FORM.doc.selectedNode.obj.scale.y)).toBe(2);
  await tap(page, 'undo');
  expect(await page.evaluate(() => (window as any).__FORM.doc.selectedNode.obj.scale.y)).toBe(1);
});

test('WebGL context loss: overlay, restore, geometry intact, sculpting resumes', async ({ page }) => {
  await boot(page);
  await stroke(page, [0, 0.3, 0.95], [0.3, 0.3, 0.9]); const h = await hash(page);
  await page.evaluate(() => { const gl = (window as any).__FORM.vp.renderer.getContext(); (window as any).__lc = gl.getExtension('WEBGL_lose_context'); (window as any).__lc.loseContext(); });
  await expect(page.locator('#ctxlost')).toBeVisible();
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__lc.restoreContext());
  await expect(page.locator('#ctxlost')).toBeHidden();
  expect(await hash(page)).toBe(h);
  const lit = await page.evaluate(() => { const F = (window as any).__FORM; F.vp.renderer.render(F.vp.scene, F.vp.camera); const c = F.vp.renderer.domElement as HTMLCanvasElement; const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const g = t.getContext('2d')!; g.drawImage(c, 0, 0); const d = g.getImageData(c.width / 2 - 20, c.height / 2 - 20, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); });
  expect(lit).toBeGreaterThan(40);
  await stroke(page, [0, -0.3, 0.95], [0.3, -0.3, 0.9]);
  expect(await hash(page)).not.toBe(h);
  await page.screenshot({ path: `${EVID}/context-restored.png` });
  record('contextLoss', { overlayShown: true, restored: true, geometryIntact: true, centreLuma: lit, sculptAfterRestore: true });
});

test('SIMULATED pen pressure scales displacement; SIMULATED touch strokes; second finger cancels', async ({ page }) => {
  await boot(page);
  const fire = async (type: string, pointerType: string, pressure: number, pts: { x: number; y: number }[], id = 7) => page.evaluate(({ type, pointerType, pressure, pts, id }) => {
    const cv = document.querySelector('#viewport canvas')!;
    const ev = (t: string, p: { x: number; y: number }, pid = id) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerId: pid, pointerType, pressure, clientX: p.x, clientY: p.y, button: t === 'pointermove' ? -1 : 0, buttons: t === 'pointerup' ? 0 : 1, isPrimary: pid === id }));
    if (type === 'stroke') { ev('pointerdown', pts[0]); for (const p of pts.slice(1)) ev('pointermove', p); ev('pointerup', pts[pts.length - 1]); }
    if (type === 'twofinger') { ev('pointerdown', pts[0]); ev('pointermove', pts[1]); ev('pointerdown', pts[2], id + 1); ev('pointerup', pts[2], id + 1); ev('pointerup', pts[1]); }
  }, { type, pointerType, pressure, pts, id });
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 10; i++) pts.push(await page.evaluate(i => (window as any).__FORM.screenOf(-0.2 + i * 0.04, 0.3, 0.93), i));
  // fingers first: before any pen is seen, a finger sculpts (tablets without a stylus)
  const t0 = await hash(page);
  await fire('stroke', 'touch', 0.5, pts, 20); const t1 = await hash(page);
  expect(t1).not.toBe(t0);
  await fire('twofinger', 'touch', 0.5, [pts[0], pts[3], pts[8]], 30);
  expect(await hash(page)).toBe(t1);
  await page.getByTestId('act-new').evaluate(el => (el as HTMLElement).click());
  const p0 = await positions(page);
  await fire('stroke', 'pen', 0.2, pts); const p1 = await positions(page);
  await page.getByTestId('act-new').evaluate(el => (el as HTMLElement).click());
  const q0 = await positions(page);
  await fire('stroke', 'pen', 1.0, pts); const q1 = await positions(page);
  const light = maxDelta(p0, p1), heavy = maxDelta(q0, q1);
  expect(light).toBeGreaterThan(1e-4); expect(heavy).toBeGreaterThan(light * 2);
  record('inputSimulated', { note: 'SIMULATED via synthetic PointerEvents in headless Chromium; no physical pen/touch hardware', penLowPressureDelta: light, penFullPressureDelta: heavy, touchStroke: true, twoFingerCancels: true });
});
