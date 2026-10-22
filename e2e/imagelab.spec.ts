import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { boot, positions, hash, stroke, saveDownload, maxDelta, record, EVID, tap } from './helpers';
import { readGlb } from '../src/io/verify-readers';

async function makePng(page: Page, w: number, h: number, hue: number): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h, hue]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!; g.fillStyle = `hsl(${hue} 20% 22%)`; g.fillRect(0, 0, w, h); g.fillStyle = `hsl(${hue} 30% 70%)`; g.beginPath(); g.ellipse(w / 2, h / 2, w / 4, h / 2.6, 0, 0, Math.PI * 2); g.fill(); return c.toDataURL('image/png').split(',')[1]; }, [w, h, hue]);
  return Buffer.from(b64, 'base64');
}

test('Image Lab: intake validation, crop, reference planes, Meshy gated by config + consent', async ({ page }) => {
  await boot(page);
  await tap(page, 'open-imagelab');
  await expect(page.getByTestId('imagelab')).toBeVisible();
  await tap(page, 'slot-front');
  await page.getByTestId('file-image').setInputFiles({ name: 'x.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.locator('#status')).toContainText('not accepted');
  await tap(page, 'slot-front');
  await page.getByTestId('file-image').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: await makePng(page, 640, 480, 30) });
  await expect(page.getByTestId('slot-front')).toHaveClass(/has/);
  await page.waitForTimeout(200);
  const box = (await page.getByTestId('crop-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.1); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.9, { steps: 5 }); await page.mouse.up();
  await tap(page, 'crop-apply');
  await expect(page.locator('#crop-info')).toContainText(/front: 3\d\d×3\d\d/);
  const cropInfo = await page.locator('#crop-info').innerText();
  await tap(page, 'slot-left');
  await page.getByTestId('file-image').setInputFiles({ name: 'left.png', mimeType: 'image/png', buffer: await makePng(page, 400, 400, 200) });
  await page.screenshot({ path: `${EVID}/imagelab-dialog.png` });
  await tap(page, 'place-refs');
  await tap(page, 'lab-close');
  await expect(page.locator('#tree')).toContainText('Ref front');
  await expect(page.locator('#tree')).toContainText('Ref left');
  await page.screenshot({ path: `${EVID}/imagelab-refplanes.png` });
  await tap(page, 'open-imagelab');
  await expect(page.getByTestId('provider')).toHaveValue('meshy');
  await page.getByTestId('consent').check();
  await expect(page.getByTestId('submit-recon')).toBeDisabled();
  await page.getByTestId('meshy-mode').selectOption('byo');
  await expect(page.getByTestId('submit-recon')).toBeDisabled();
  await page.locator('#meshy-key').fill('placeholder-not-a-real-key');
  await expect(page.getByTestId('submit-recon')).toBeEnabled();
  await expect(page.locator('#consent-text')).toContainText('Meshy');
  await page.getByTestId('consent').uncheck();
  await expect(page.getByTestId('submit-recon')).toBeDisabled();
  await tap(page, 'lab-close');
  const bytes = await page.evaluate(async () => { const F = (window as any).__FORM; await F.autosaveNow(); return JSON.stringify(F.doc.toProject().nodes.map((n: any) => ({ ...n, mesh: undefined, image: undefined }))); });
  expect(bytes).not.toContain('placeholder-not-a-real-key');
  record('imageLab', { invalidTypeRejected: true, crop: cropInfo, refPlanes: 2, meshySubmitGatedBy: ['connection configured', 'explicit per-job consent'], keyNotPersisted: true, liveMeshyCall: 'NOT MADE (no key; requires user approval)' });
});

test('MOCK provider job → GLB import → sculpt the generated mesh → export proof', async ({ page }) => {
  await boot(page, 'fresh=1&mockProvider=1');
  await tap(page, 'open-imagelab');
  await tap(page, 'slot-front');
  await page.getByTestId('file-image').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: await makePng(page, 320, 320, 90) });
  await page.getByTestId('provider').selectOption('mock');
  await page.getByTestId('consent').check();
  await tap(page, 'submit-recon');
  await expect(page.getByTestId('joblog')).toContainText('ready', { timeout: 15_000 });
  const log = await page.getByTestId('joblog').innerText();
  await tap(page, 'lab-close');
  await expect(page.locator('#tree')).toContainText('MOCK Reconstruction');
  const p0 = await positions(page); const h0 = await hash(page);
  await tap(page, 'brush-draw');
  await stroke(page, [0, 0.3, 0.6], [0.2, 0.3, 0.55]);
  const p1 = await positions(page);
  expect(await hash(page)).not.toBe(h0);
  const vdelta = maxDelta(p0, p1);
  expect(vdelta).toBeGreaterThan(1e-3);
  const f = await saveDownload(page, 'act-export-sel-glb', 'mock-reconstruction-sculpted.glb');
  const b = fs.readFileSync(f); const g = readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const ex = maxDelta(p1, g.meshes[0].positions);
  expect(ex).toBeLessThan(1e-6);
  record('mockReconstruction', { label: 'MOCK provider — not real reconstruction', jobLog: log.split('\n').map(s => s.split(' ')[0]), vertexDeltaAfterSculpt: vdelta, exportVsInApp: ex });
});
