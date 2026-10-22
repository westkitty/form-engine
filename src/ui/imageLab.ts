/** Image Lab: intake (4 view slots) → crop → reference planes → provider-neutral reconstruction job. */
import * as THREE from 'three';
import type { ReconImage, ReconstructionProvider, ViewSlot } from '../recon/contract';
import { validateRequest } from '../recon/contract';
import { MeshyProvider, MESHY_DEFAULT } from '../recon/meshy';
import { JobRunner } from '../recon/runner';
import type { JobRecord } from '../recon/jobMachine';

const SLOTS: ViewSlot[] = ['front', 'left', 'right', 'back'];
const MAX_BYTES = 20 * 1024 * 1024;
const MIMES = ['image/png', 'image/jpeg', 'image/webp'];

interface SlotData { name: string; mime: string; bytes: Uint8Array; dataUrl: string; w: number; h: number; original?: SlotData }

export interface LabHost {
  addRefPlane(name: string, tex: THREE.Texture, aspect: number, image: { mime: string; bytes: Uint8Array; opacity: number; aspect: number }, placement: { position: number[]; rotationY: number }): void;
  importReconstruction(glb: ArrayBuffer, label: string): Promise<void>;
  status(msg: string, err?: boolean): void;
  extraProviders: ReconstructionProvider[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadImage(url: string) { return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image could not be decoded')); i.src = url; }); }
function toDataUrl(bytes: Uint8Array, mime: string) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return `data:${mime};base64,${btoa(s)}`; }

export class ImageLab {
  slots: Partial<Record<ViewSlot, SlotData>> = {};
  sel: ViewSlot | null = null;
  crop: { x: number; y: number; w: number; h: number } | null = null;
  meshy = new MeshyProvider({ ...MESHY_DEFAULT });
  providers: ReconstructionProvider[];
  runner: JobRunner | null = null;
  private targetSlot: ViewSlot = 'front';
  private dlg = $('imagelab') as HTMLDialogElement;

  constructor(private host: LabHost) {
    this.providers = [this.meshy, ...host.extraProviders];
    this.renderSlots(); this.renderProviders(); this.bindCrop();
    $('file-image').addEventListener('change', async e => {
      const inp = e.target as HTMLInputElement; const f = inp.files?.[0]; inp.value = '';
      if (f) await this.intake(this.targetSlot, f.name, f.type, new Uint8Array(await f.arrayBuffer()));
    });
    $('place-refs').addEventListener('click', () => this.placeRefs());
    $('consent').addEventListener('change', () => this.refreshSubmit());
    $('provider').addEventListener('change', () => { this.renderProviderCfg(); this.refreshSubmit(); });
    $('submit-recon').addEventListener('click', () => this.submit());
    $('cancel-recon').addEventListener('click', () => this.runner?.cancel());
  }
  open() { if (!this.dlg.open) this.dlg.showModal(); }
  get provider() { return this.providers.find(p => p.id === ($('provider') as HTMLSelectElement).value) ?? this.meshy; }

  /** Validate and store an image in a slot. Rejects wrong type/size/undecodable data. */
  async intake(slot: ViewSlot, name: string, mime: string, bytes: Uint8Array) {
    try {
      if (!MIMES.includes(mime)) throw new Error(`${name}: ${mime || 'unknown type'} not accepted (PNG, JPEG, WebP)`);
      if (bytes.byteLength > MAX_BYTES) throw new Error(`${name}: larger than 20 MB`);
      const dataUrl = toDataUrl(bytes, mime);
      const img = await loadImage(dataUrl);
      this.slots[slot] = { name, mime, bytes, dataUrl, w: img.naturalWidth, h: img.naturalHeight };
      this.select(slot);
      this.host.status(`${slot}: ${img.naturalWidth}×${img.naturalHeight} ${mime.split('/')[1].toUpperCase()} ${(bytes.byteLength / 1024).toFixed(0)} KB`);
    } catch (e) { this.host.status((e as Error).message, true); }
    this.renderSlots(); this.refreshSubmit();
  }

  private renderSlots() {
    const box = $('slots'); box.innerHTML = '';
    for (const s of SLOTS) {
      const d = this.slots[s];
      const el = document.createElement('div');
      el.className = 'slot' + (d ? ' has' : '') + (this.sel === s ? ' sel' : '');
      el.dataset.testid = `slot-${s}`; el.setAttribute('data-testid', `slot-${s}`); el.tabIndex = 0;
      el.innerHTML = `<span class="tag">${s}${s === 'front' ? ' · req' : ''}</span>${d ? '' : 'Tap to add'}`;
      if (d) { el.style.backgroundImage = `url(${d.dataUrl})`; const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove ' + s + ' image'); x.onclick = ev => { ev.stopPropagation(); delete this.slots[s]; if (this.sel === s) this.sel = null; this.renderSlots(); this.drawCrop(); this.refreshSubmit(); }; el.appendChild(x); }
      el.onclick = () => { if (d) this.select(s); else { this.targetSlot = s; $('file-image').click(); } };
      el.ondragover = ev => ev.preventDefault();
      el.ondrop = async ev => { ev.preventDefault(); const f = ev.dataTransfer?.files?.[0]; if (f) await this.intake(s, f.name, f.type, new Uint8Array(await f.arrayBuffer())); };
      box.appendChild(el);
    }
    ($('place-refs') as HTMLButtonElement).disabled = !Object.keys(this.slots).length;
  }

  private select(s: ViewSlot) { this.sel = s; this.crop = null; this.renderSlots(); this.drawCrop(); }

  private cropImg: HTMLImageElement | null = null;
  private async drawCrop() {
    const cv = $('crop-canvas') as HTMLCanvasElement; const g = cv.getContext('2d')!;
    const d = this.sel ? this.slots[this.sel] : null;
    ($('crop-apply') as HTMLButtonElement).disabled = !d || !this.crop;
    ($('crop-reset') as HTMLButtonElement).disabled = !d?.original;
    if (!d) { cv.width = 1; cv.height = 1; this.cropImg = null; $('crop-info').textContent = 'Select a slot with an image to crop.'; return; }
    if (!this.cropImg || this.cropImg.src !== d.dataUrl) this.cropImg = await loadImage(d.dataUrl);
    cv.width = d.w; cv.height = d.h;
    g.drawImage(this.cropImg, 0, 0);
    if (this.crop) {
      const c = this.crop; g.fillStyle = 'rgba(10,10,12,.62)';
      g.fillRect(0, 0, d.w, c.y); g.fillRect(0, c.y + c.h, d.w, d.h - c.y - c.h); g.fillRect(0, c.y, c.x, c.h); g.fillRect(c.x + c.w, c.y, d.w - c.x - c.w, c.h);
      g.strokeStyle = '#e2a03f'; g.lineWidth = Math.max(1, d.w / 400); g.strokeRect(c.x, c.y, c.w, c.h);
      $('crop-info').textContent = `${this.sel}: crop ${Math.round(c.w)}×${Math.round(c.h)} at ${Math.round(c.x)},${Math.round(c.y)} of ${d.w}×${d.h}`;
    } else $('crop-info').textContent = `${this.sel}: ${d.w}×${d.h} — drag on the image to set a crop`;
  }

  private bindCrop() {
    const cv = $('crop-canvas') as HTMLCanvasElement;
    let start: { x: number; y: number } | null = null;
    const pt = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height }; };
    cv.addEventListener('pointerdown', e => { if (!this.sel || !this.slots[this.sel]) return; start = pt(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!start) return; const p = pt(e); this.setCrop(Math.min(start.x, p.x), Math.min(start.y, p.y), Math.abs(p.x - start.x), Math.abs(p.y - start.y)); });
    cv.addEventListener('pointerup', () => { start = null; });
    $('crop-apply').addEventListener('click', () => this.applyCrop());
    $('crop-reset').addEventListener('click', () => { const d = this.sel && this.slots[this.sel]; if (d && d.original) { this.slots[this.sel!] = d.original; this.crop = null; this.renderSlots(); this.drawCrop(); } });
  }
  setCrop(x: number, y: number, w: number, h: number) {
    const d = this.sel && this.slots[this.sel]; if (!d) return;
    x = Math.max(0, Math.min(d.w - 1, x)); y = Math.max(0, Math.min(d.h - 1, y));
    w = Math.max(1, Math.min(d.w - x, w)); h = Math.max(1, Math.min(d.h - y, h));
    this.crop = { x, y, w, h }; this.drawCrop();
  }
  async applyCrop() {
    const s = this.sel; const d = s && this.slots[s]; const c = this.crop; if (!s || !d || !c || !this.cropImg) return;
    const out = document.createElement('canvas'); out.width = Math.round(c.w); out.height = Math.round(c.h);
    out.getContext('2d')!.drawImage(this.cropImg, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
    const mime = d.mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob: Blob = await new Promise((res, rej) => out.toBlob(b => (b ? res(b) : rej(new Error('crop encode failed'))), mime, 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    this.slots[s] = { name: d.name, mime, bytes, dataUrl: toDataUrl(bytes, mime), w: out.width, h: out.height, original: d.original ?? d };
    this.crop = null; this.cropImg = null; this.renderSlots(); this.drawCrop(); this.refreshSubmit();
    this.host.status(`${s}: cropped to ${out.width}×${out.height}`);
  }

  async placeRefs() {
    const opacity = +($('ref-opacity') as HTMLInputElement).value;
    const place: Record<ViewSlot, { position: number[]; rotationY: number }> = {
      front: { position: [0, 0, -1.6], rotationY: 0 }, back: { position: [0, 0, 1.6], rotationY: Math.PI },
      left: { position: [1.6, 0, 0], rotationY: -Math.PI / 2 }, right: { position: [-1.6, 0, 0], rotationY: Math.PI / 2 },
    };
    let n = 0;
    for (const s of SLOTS) {
      const d = this.slots[s]; if (!d) continue;
      const tex = await new THREE.TextureLoader().loadAsync(d.dataUrl); tex.colorSpace = THREE.SRGBColorSpace;
      const aspect = d.w / d.h;
      this.host.addRefPlane(`Ref ${s}`, tex, aspect, { mime: d.mime, bytes: d.bytes, opacity, aspect }, place[s]); n++;
    }
    this.host.status(`Placed ${n} reference plane(s). Images remain local.`);
  }

  private renderProviders() {
    const sel = $('provider') as HTMLSelectElement;
    sel.innerHTML = this.providers.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
    this.renderProviderCfg();
  }
  private renderProviderCfg() {
    const p = this.provider; const box = $('provider-cfg');
    if (p === this.meshy) {
      const c = this.meshy.cfg;
      box.innerHTML = `
        <label class="row"><span>Connection</span><select id="meshy-mode" data-testid="meshy-mode">
          <option value="off">Off (no network)</option><option value="proxy">My proxy URL</option><option value="byo">My API key (this tab only)</option></select></label>
        <label class="row" id="meshy-base-row"><span>Proxy URL</span><input type="url" id="meshy-base" placeholder="https://your-proxy.example" autocomplete="off" /></label>
        <label class="row" id="meshy-key-row"><span>API key</span><input type="password" id="meshy-key" placeholder="msy_…" autocomplete="off" spellcheck="false" /></label>
        <p class="hint">Key is held in memory for this tab only — never saved, autosaved or exported. Proxy mode keeps it server-side (tools/meshy-proxy.mjs). Live Meshy calls from this build are <b>UNVERIFIED</b>.</p>`;
      const mode = $('meshy-mode') as HTMLSelectElement, base = $('meshy-base') as HTMLInputElement, key = $('meshy-key') as HTMLInputElement;
      mode.value = c.mode; base.value = c.mode === 'proxy' ? c.base : ''; key.value = c.key ?? '';
      const vis = () => { $('meshy-base-row').hidden = mode.value !== 'proxy'; $('meshy-key-row').hidden = mode.value !== 'byo'; };
      const upd = () => { this.meshy.cfg = { ...this.meshy.cfg, mode: mode.value as any, base: mode.value === 'proxy' ? base.value.trim() : MESHY_DEFAULT.base, key: mode.value === 'byo' ? key.value.trim() : undefined }; vis(); this.refreshSubmit(); };
      mode.onchange = upd; base.oninput = upd; key.oninput = upd; vis();
    } else box.innerHTML = `<p class="hint"><span class="badge mock">MOCK</span> Test-only provider. Produces a fixed synthetic mesh without any network call. It does not reconstruct your images.</p>`;
  }

  request() {
    const images: ReconImage[] = SLOTS.filter(s => this.slots[s]).map(s => { const d = this.slots[s]!; return { slot: s, mime: d.mime, dataUrl: d.dataUrl, width: d.w, height: d.h, bytes: d.bytes.byteLength }; });
    return { images, options: { targetPolycount: +($('polys') as HTMLInputElement).value || undefined, texture: true } };
  }

  private refreshSubmit() {
    const p = this.provider; const req = this.request();
    const mb = req.images.reduce((a, i) => a + i.bytes, 0) / 1048576;
    const dest = p === this.meshy ? (this.meshy.cfg.mode === 'proxy' ? `my proxy (${this.meshy.cfg.base || 'not set'}) → Meshy` : 'Meshy (api.meshy.ai)') : 'nowhere (local mock)';
    $('consent-text').innerHTML = `I approve sending <b>${req.images.length}</b> image(s) (${mb.toFixed(2)} MB) to <b>${dest}</b>. ${p.capabilities.costNote}`;
    const errs = validateRequest(p, req);
    const busy = !!this.runner && !['ready', 'failed', 'canceled', 'draft'].includes(this.runner.job.state);
    const ok = p.isConfigured() && ($('consent') as HTMLInputElement).checked && !errs.length && !busy;
    const btn = $('submit-recon') as HTMLButtonElement; btn.disabled = !ok;
    btn.title = !p.isConfigured() ? 'Configure a connection first' : errs.join(' ') || (!($('consent') as HTMLInputElement).checked ? 'Consent required' : '');
  }

  async submit() {
    const p = this.provider; const req = this.request();
    if (!($('consent') as HTMLInputElement).checked) return;
    const runner = new JobRunner(p, p.id === 'mock' ? 150 : 5000); this.runner = runner;
    runner.onUpdate = j => this.renderJob(j);
    runner.consent();
    ($('consent') as HTMLInputElement).checked = false; // consent is per job
    $('cancel-recon').hidden = false; this.refreshSubmit();
    await runner.run(req, glb => this.host.importReconstruction(glb, `${p.id === 'mock' ? 'MOCK ' : ''}Reconstruction ${runner.job.remoteId ?? ''}`.trim()));
    $('cancel-recon').hidden = true; this.refreshSubmit();
    if (runner.job.state === 'ready') this.host.status('Reconstruction imported as an editable mesh.');
    else if (runner.job.state === 'failed') this.host.status('Reconstruction failed: ' + runner.job.error, true);
  }
  private renderJob(j: JobRecord) {
    $('joblog').innerHTML = j.log.map(l => `<li class="${l.state}"><b>${l.state}</b> ${new Date(l.at).toLocaleTimeString()}${l.note ? ' — ' + l.note.replace(/</g, '&lt;') : ''}</li>`).join('') + (j.progress ? `<li>progress ${j.progress}%</li>` : '');
  }
}
