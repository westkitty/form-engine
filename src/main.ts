import './styles.css';
import * as THREE from 'three';
import { Viewport } from './app/viewport';
import { Doc, type FormNode } from './app/doc';
import { SculptTool, type Mode } from './app/sculptTool';
import { makeClayMatcap } from './app/matcap';
import { BRUSHES, type BrushId } from './core/brushes';
import { importFile, exportGLB, exportOBJ, exportSTL, IMPORT_ACCEPT } from './io/formats';
import { serializeProject, deserializeProject } from './io/project';
import { autosaveWrite, autosaveRecover, autosaveClear, autosaveCorruptHead } from './io/autosave';
import { ImageLab } from './ui/imageLab';
import { MockProvider } from './recon/mock';
import { quadSphere, quadSphereResForTris } from './core/primitives';
import { maxPositionDelta, hashBytes } from './core/topology';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

// ---------- core objects ----------
const vp = new Viewport($('viewport'));
const doc = new Doc(makeClayMatcap());
vp.scene.add(doc.root);
const tool = new SculptTool(vp, doc);

// ---------- status ----------
let statusT = 0;
function status(msg: string, err = false) {
  const s = $('status'); s.textContent = msg; s.className = 'status show' + (err ? ' err' : '');
  clearTimeout(statusT); statusT = window.setTimeout(() => (s.className = 'status'), err ? 6000 : 2600);
  (err ? console.warn : console.info)('[FORM]', msg);
}

// ---------- brush rail ----------
const GLYPH: Record<BrushId, string> = { draw: 'DR', inflate: 'IN', clay: 'CB', smooth: 'SM', grab: 'GR', flatten: 'FL', pinch: 'PI', crease: 'CR', mask: 'MK' };
function renderRail() {
  $('rail').innerHTML = BRUSHES.map(b => `<button data-brush="${b.id}" data-testid="brush-${b.id}" class="${tool.settings.tool === b.id ? 'on' : ''}" title="${b.label} (${b.key}) — ${b.hint}" aria-pressed="${tool.settings.tool === b.id}"><span class="glyph">${GLYPH[b.id]}</span><span class="lbl">${b.label.split(' ')[0]}</span></button>`).join('');
  const b = BRUSHES.find(x => x.id === tool.settings.tool)!;
  $('brush-name').textContent = b.label; $('brush-hint').textContent = b.hint + ' · Shift: smooth · Esc: cancel stroke · [ ]: radius';
}
$('rail').addEventListener('click', e => { const b = (e.target as HTMLElement).closest('[data-brush]') as HTMLElement | null; if (b) setBrush(b.dataset.brush as BrushId); });
function setBrush(id: BrushId) { tool.settings.tool = id; if (tool.mode !== 'sculpt') setMode('sculpt'); renderRail(); }

// ---------- brush settings ----------
const radius = $('radius') as HTMLInputElement, strength = $('strength') as HTMLInputElement;
function renderBrushSettings() {
  radius.value = String(tool.settings.radiusPx); $('radius-o').textContent = `${tool.settings.radiusPx}px`;
  strength.value = String(tool.settings.strength); $('strength-o').textContent = tool.settings.strength.toFixed(2);
  for (const b of $('sym').querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', (tool.settings.symmetry as any)[b.dataset.axis!]);
  $('invert').classList.toggle('on', tool.settings.invertLatch); $('pressure').classList.toggle('on', tool.settings.usePressure);
}
radius.oninput = () => { tool.settings.radiusPx = +radius.value; renderBrushSettings(); };
strength.oninput = () => { tool.settings.strength = +strength.value; renderBrushSettings(); };
$('sym').onclick = e => { const a = (e.target as HTMLElement).dataset.axis as 'x' | 'y' | 'z' | undefined; if (a) { tool.settings.symmetry[a] = !tool.settings.symmetry[a]; renderBrushSettings(); } };
$('invert').onclick = () => { tool.settings.invertLatch = !tool.settings.invertLatch; renderBrushSettings(); };
$('pressure').onclick = () => { tool.settings.usePressure = !tool.settings.usePressure; renderBrushSettings(); };

function maskOp(kind: 'clear' | 'invert') {
  const st = doc.sculptOf(doc.selectedNode); if (!st) return status('Select a mesh first', true);
  const m = st.mesh; const all = new Uint32Array(m.vertCount).map((_, i) => i);
  st.engine.begin('mask');
  // record via a zero-radius trick is not possible; use recorder through engine internals
  (st.engine as any).rec.touch(all, all.length);
  for (let v = 0; v < m.vertCount; v++) m.mask[v] = kind === 'clear' ? 0 : 1 - m.mask[v];
  const e = st.engine.end(ids => st.apply(ids, ids.length));
  if (e) e.label = kind === 'clear' ? 'Clear mask' : 'Invert mask';
  st.apply(all, all.length); doc.pushStroke(st, e); vp.needsRender = true;
}

// ---------- modes ----------
function setMode(m: Mode) { tool.setMode(m); for (const b of $('modes').querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.mode === m); }
$('modes').onclick = e => { const m = (e.target as HTMLElement).dataset.mode as Mode | undefined; if (m) setMode(m); };

// ---------- scene tree + inspector ----------
function renderTree() {
  const ul = $('tree'); const rows: string[] = [];
  const walk = (o: THREE.Object3D, depth: number) => {
    for (const c of o.children) {
      const n = doc.nodes.get(c.userData.formId); if (!n) continue;
      const k = n.kind === 'mesh' ? 'MSH' : n.kind === 'group' ? 'GRP' : 'REF';
      rows.push(`<li role="treeitem" data-id="${n.id}" class="${doc.selected === n.id ? 'sel' : ''}" style="padding-left:${6 + depth * 14}px" data-testid="node-${n.name.replace(/\s+/g, '_')}"><span class="kind">${k}</span><span class="nm" title="Double-click to rename">${esc(n.name)}</span><button class="eye ${c.visible ? '' : 'off'}" data-eye="${n.id}" title="Toggle visibility">VIS</button><button class="del" data-del="${n.id}" title="Delete">DEL</button></li>`);
      walk(c, depth + 1);
    }
  };
  walk(doc.root, 0);
  ul.innerHTML = rows.join('') || '<li class="empty">Empty scene — add a sphere or import a model.</li>';
  $('scene-count').textContent = String(doc.nodes.size);
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
$('tree').addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (t.dataset.eye) { const n = doc.nodes.get(t.dataset.eye)!; doc.setVisible(n.id, !n.obj.visible); vp.needsRender = true; return; }
  if (t.dataset.del) { doc.remove(t.dataset.del); tool.syncGizmo(); vp.needsRender = true; return; }
  const li = t.closest('li[data-id]') as HTMLElement | null; if (li) select(li.dataset.id!);
});
$('tree').addEventListener('dblclick', e => {
  const li = (e.target as HTMLElement).closest('li[data-id]') as HTMLElement | null; if (!li) return;
  const n = doc.nodes.get(li.dataset.id!)!; const v = prompt('Rename', n.name); if (v) doc.rename(n.id, v);
});
function select(id: string | null) { doc.selected = id; tool.syncGizmo(); renderTree(); renderInspector(); vp.needsRender = true; }

function renderInspector() {
  const n = doc.selectedNode; const box = $('inspector');
  $('sel-kind').textContent = n ? n.kind : '';
  if (!n) { box.innerHTML = '<p class="hint">Nothing selected.</p>'; return; }
  const o = n.obj; const r = new THREE.Euler().setFromQuaternion(o.quaternion);
  const f = (v: number) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(4));
  const parents = [...doc.nodes.values()].filter(p => p.kind === 'group' && p.id !== n.id && !isDesc(p.obj, n.obj));
  const g = n.kind === 'mesh' ? (o as THREE.Mesh).geometry : null;
  const st = n.sculpt;
  box.innerHTML = `
    <label class="row"><span>Name</span><input type="text" id="i-name" value="${esc(n.name)}" data-testid="i-name" /></label>
    <div class="xf"><span>Position</span>${['x', 'y', 'z'].map(a => `<input type="number" step="0.05" data-xf="position" data-a="${a}" value="${f((o.position as any)[a])}" />`).join('')}</div>
    <div class="xf"><span>Rotation°</span>${['x', 'y', 'z'].map(a => `<input type="number" step="5" data-xf="rotation" data-a="${a}" value="${f(THREE.MathUtils.radToDeg((r as any)[a]))}" />`).join('')}</div>
    <div class="xf"><span>Scale</span>${['x', 'y', 'z'].map(a => `<input type="number" step="0.05" data-xf="scale" data-a="${a}" value="${f((o.scale as any)[a])}" />`).join('')}</div>
    <label class="row"><span>Parent</span><select id="i-parent" data-testid="i-parent"><option value="">(root)</option>${parents.map(p => `<option value="${p.id}" ${o.parent === p.obj ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${n.kind === 'mesh' ? `<label class="row"><span>Export colour</span><input type="color" id="i-color" value="${n.color}" /></label>` : ''}
    ${n.kind === 'refplane' ? `<label class="row"><span>Opacity</span><input type="range" min="0.05" max="1" step="0.05" id="i-op" value="${((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity}" /></label>` : ''}
    ${g ? `<div class="kv"><span>triangles</span><b>${(g.index ? g.index.count / 3 : g.getAttribute('position').count / 3).toLocaleString()}</b><span>render verts</span><b>${g.getAttribute('position').count.toLocaleString()}</b>${st ? `<span>sculpt verts</span><b>${st.mesh.vertCount.toLocaleString()}</b><span>BVH</span><b>${st.stats.builds}b / ${st.stats.refits}r</b>` : ''}</div>` : ''}
    <div class="chips" style="margin-top:8px"><button id="i-frame">Frame</button>${n.kind === 'mesh' ? '<button id="i-export">Export GLB</button>' : ''}</div>`;
  ($('i-name') as HTMLInputElement).onchange = ev => doc.rename(n.id, (ev.target as HTMLInputElement).value);
  for (const inp of box.querySelectorAll<HTMLInputElement>('[data-xf]')) inp.onchange = () => {
    const before = o.matrix.clone(); const a = inp.dataset.a as 'x' | 'y' | 'z'; const v = +inp.value;
    if (inp.dataset.xf === 'rotation') { const e2 = new THREE.Euler().setFromQuaternion(o.quaternion); (e2 as any)[a] = THREE.MathUtils.degToRad(v); o.quaternion.setFromEuler(e2); }
    else ((o as any)[inp.dataset.xf!] as THREE.Vector3)[a] = v;
    o.updateMatrix(); doc.pushTransform(n.id, before); vp.needsRender = true;
  };
  ($('i-parent') as HTMLSelectElement).onchange = ev => { try { doc.setParent(n.id, (ev.target as HTMLSelectElement).value || null); } catch (err) { status((err as Error).message, true); } };
  const col = document.getElementById('i-color') as HTMLInputElement | null; if (col) col.onchange = () => doc.setColor(n.id, col.value);
  const op = document.getElementById('i-op') as HTMLInputElement | null; if (op) op.oninput = () => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = +op.value; vp.needsRender = true; };
  $('i-frame').onclick = () => vp.frame(o);
  const ex = document.getElementById('i-export'); if (ex) ex.onclick = () => doExport('glb', true);
}
const isDesc = (a: THREE.Object3D, anc: THREE.Object3D) => { let q: THREE.Object3D | null = a; while (q) { if (q === anc) return true; q = q.parent; } return false; };

doc.listeners.add(why => {
  if (why === 'structure' || why === 'loaded') { renderTree(); renderInspector(); tool.syncGizmo(); }
  if (why === 'transform') renderInspector();
  vp.needsRender = true; scheduleAutosave();
  renderHistoryButtons();
});
function renderHistoryButtons() { (document.querySelector('[data-act=undo]') as HTMLButtonElement).disabled = !doc.history.canUndo; (document.querySelector('[data-act=redo]') as HTMLButtonElement).disabled = !doc.history.canRedo; }
doc.history.onChange = () => renderHistoryButtons();

// ---------- files ----------
function download(data: BlobPart, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const slug = () => (doc.name || 'form').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
async function doExport(kind: 'glb' | 'obj' | 'stl', selection = false) {
  try {
    if (!doc.nodes.size) throw new Error('Nothing to export');
    const root = doc.buildExportRoot(selection ? doc.selected : null);
    const t = performance.now();
    if (kind === 'glb') download(await exportGLB(root), `${slug()}.glb`, 'model/gltf-binary');
    else if (kind === 'obj') download(exportOBJ(root), `${slug()}.obj`, 'text/plain');
    else download(exportSTL(root), `${slug()}.stl`, 'model/stl');
    status(`Exported ${kind.toUpperCase()} in ${(performance.now() - t).toFixed(0)} ms`);
  } catch (e) { status('Export failed: ' + (e as Error).message, true); }
}
async function importBuffer(name: string, buf: ArrayBuffer, label?: string): Promise<FormNode | null> {
  try {
    const t = performance.now();
    const { root, warnings } = await importFile(name, buf);
    const n = doc.addImported(root, label ?? name.replace(/\.[^.]+$/, ''));
    const firstMesh = findFirstMesh(n);
    select(firstMesh?.id ?? n.id);
    if (firstMesh) doc.sculptOf(firstMesh);
    vp.frame(n.obj);
    status(`Imported ${name} in ${(performance.now() - t).toFixed(0)} ms${warnings.length ? ' — ' + warnings.join('; ') : ''}`);
    return n;
  } catch (e) { status('Import failed: ' + (e as Error).message, true); return null; }
}
function findFirstMesh(n: FormNode): FormNode | null { let r: FormNode | null = null; n.obj.traverse(o => { const f = doc.nodes.get(o.userData.formId); if (!r && f?.kind === 'mesh') r = f; }); return r; }

const camState = () => ({ position: vp.camera.position.toArray(), target: vp.controls.target.toArray() });
async function saveProject() {
  try { const bytes = serializeProject(doc.toProject(camState())); download(bytes as BlobPart, `${slug()}.formengine`, 'application/zip'); status(`Saved project (${(bytes.byteLength / 1024).toFixed(0)} KB)`); }
  catch (e) { status('Save failed: ' + (e as Error).message, true); }
}
const texFromBytes = async (bytes: Uint8Array, mime: string) => { const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })); const t = await new THREE.TextureLoader().loadAsync(url); t.colorSpace = THREE.SRGBColorSpace; return t; };
async function openProjectBytes(bytes: Uint8Array) {
  try {
    const p = deserializeProject(bytes);
    tool.cancel(); await doc.loadProject(p, texFromBytes);
    if (p.camera) { vp.camera.position.fromArray(p.camera.position); vp.controls.target.fromArray(p.camera.target); vp.controls.update(); }
    select(doc.selected); status(`Opened “${p.name}” — ${p.nodes.length} node(s)`);
    return true;
  } catch (e) { status('Open failed: ' + (e as Error).message, true); return false; }
}
function newScene() {
  tool.cancel();
  for (const c of [...doc.root.children]) doc.root.remove(c);
  doc.nodes.clear(); doc.history.clear(); doc.name = 'Untitled';
  const n = doc.addSphere(64); doc.history.clear(); select(n.id); doc.sculptOf(n); vp.frame(n.obj); renderTree();
}

($('file-import') as HTMLInputElement).accept = IMPORT_ACCEPT;
$('file-import').addEventListener('change', async e => { const i = e.target as HTMLInputElement; const f = i.files?.[0]; i.value = ''; if (f) await importBuffer(f.name, await f.arrayBuffer()); });
$('file-open').addEventListener('change', async e => { const i = e.target as HTMLInputElement; const f = i.files?.[0]; i.value = ''; if (f) await openProjectBytes(new Uint8Array(await f.arrayBuffer())); });
// drag & drop models/projects onto the stage
document.querySelector('.stage')!.addEventListener('dragover', e => e.preventDefault());
document.querySelector('.stage')!.addEventListener('drop', async e => {
  const de = e as DragEvent; de.preventDefault(); const f = de.dataTransfer?.files?.[0]; if (!f) return;
  if (f.name.endsWith('.formengine')) await openProjectBytes(new Uint8Array(await f.arrayBuffer())); else await importBuffer(f.name, await f.arrayBuffer());
});

// ---------- actions ----------
const menu = $('file-menu');
menu.querySelector('[data-testid=file-menu]')!.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
document.addEventListener('click', () => menu.classList.remove('open'));
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null; if (!b) return;
  const act = b.dataset.act!;
  menu.classList.remove('open');
  switch (act) {
    case 'new': newScene(); break;
    case 'open': $('file-open').click(); break;
    case 'save': saveProject(); break;
    case 'import': $('file-import').click(); break;
    case 'export-glb': doExport('glb'); break;
    case 'export-obj': doExport('obj'); break;
    case 'export-stl': doExport('stl'); break;
    case 'export-sel-glb': doExport('glb', true); break;
    case 'imagelab': lab.open(); break;
    case 'undo': if (!tool.cancel()) doc.undo(); break;
    case 'redo': doc.redo(); break;
    case 'panel': $('app').classList.toggle('panel-open'); break;
    case 'mask-clear': maskOp('clear'); break;
    case 'mask-invert': maskOp('invert'); break;
    case 'add-sphere': { const n = doc.addSphere(48); doc.sculptOf(n); select(n.id); break; }
    case 'add-group': { const n = doc.addGroup(); select(n.id); break; }
  }
});
window.addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else if (!tool.cancel()) doc.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doc.redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
  if (mod) return;
  const b = BRUSHES.find(x => x.key.toLowerCase() === e.key.toLowerCase()); if (b) { setBrush(b.id); return; }
  if (e.key === '[') { tool.settings.radiusPx = Math.max(6, Math.round(tool.settings.radiusPx / 1.15)); renderBrushSettings(); }
  if (e.key === ']') { tool.settings.radiusPx = Math.min(300, Math.round(tool.settings.radiusPx * 1.15)); renderBrushSettings(); }
  if (e.key === 's') setMode('sculpt'); if (e.key === 'w') setMode('translate'); if (e.key === 'e') setMode('rotate'); if (e.key === 'r') setMode('scale');
  if (e.key === 'f') vp.frame(doc.selectedNode?.obj ?? doc.root);
  if (e.key === 'Delete' && doc.selected) doc.remove(doc.selected);
});

// ---------- autosave ----------
let autosaveT = 0; let lastAutosave = { slot: '', seq: 0, at: '' };
function scheduleAutosave() { clearTimeout(autosaveT); autosaveT = window.setTimeout(autosaveNow, 2500); }
async function autosaveNow() {
  if (tool.stroking) { scheduleAutosave(); return; }
  try { const r = await autosaveWrite(serializeProject(doc.toProject(camState())), doc.name); lastAutosave = { ...r, at: new Date().toLocaleTimeString() }; }
  catch (e) { console.warn('[autosave] failed', e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosaveNow(); });

// ---------- context loss ----------
vp.onContext = lost => { $('ctxlost').hidden = !lost; if (!lost) { status('WebGL context restored'); vp.needsRender = true; } };

// ---------- HUD ----------
function hud() {
  const n = doc.selectedNode; const g = n?.kind === 'mesh' ? (n.obj as THREE.Mesh).geometry : null;
  const tris = g ? (g.index ? g.index.count / 3 : g.getAttribute('position').count / 3) : 0;
  const st = n?.sculpt; const info = vp.renderer.info;
  const p50 = vp.frameInterval.pct(0.5); const fps = p50 ? 1000 / p50 : 0;
  $('hud').innerHTML = `<b>${fps.toFixed(0).padStart(3)}</b> fps raf   cpu <b>${vp.frameCpu.pct(0.5).toFixed(2)}</b>/<b>${vp.frameCpu.pct(0.95).toFixed(2)}</b> ms p50/p95   dab <b>${tool.dabStats.pct(0.5).toFixed(2)}</b> ms\n` +
    `tris <b>${tris.toLocaleString()}</b>   verts <b>${(st?.mesh.vertCount ?? 0).toLocaleString()}</b>   draws <b>${info.render.calls}</b>   bvh <b>${st ? st.stats.lastRefitMs.toFixed(2) : '-'}</b> refit / <b>${st ? st.stats.lastBuildMs.toFixed(1) : '-'}</b> build ms\n` +
    `undo <b>${doc.history.depth}</b> ${(doc.history.bytes / 1048576).toFixed(1)} MB   autosave <b>${lastAutosave.at || '—'}</b>   ${vp.rendererInfo.replace(/ANGLE \(|\)$/g, '').slice(0, 56)}`;
}
setInterval(hud, 250);

// ---------- Image Lab ----------
const mockGlb = async () => {
  const raw = quadSphere(20, 1);
  for (let i = 0; i < raw.positions.length; i += 3) { const x = raw.positions[i], y = raw.positions[i + 1], z = raw.positions[i + 2]; const k = 1 + 0.18 * Math.sin(3 * x) * Math.cos(2 * y) + 0.1 * Math.sin(5 * z); raw.positions[i] *= k * 0.8; raw.positions[i + 1] *= k * 1.1; raw.positions[i + 2] *= k * 0.7; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3)); g.setIndex(new THREE.BufferAttribute(raw.index, 1)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9a8f80 })); m.name = 'mock_reconstruction';
  return exportGLB(m);
};
const lab = new ImageLab({
  addRefPlane: (name, tex, aspect, image, placement) => { doc.addRefPlane(name, tex, aspect, image, placement); vp.needsRender = true; },
  importReconstruction: async (glb, label) => { const n = await importBuffer('reconstruction.glb', glb, label); if (!n) throw new Error('reconstruction GLB could not be imported'); setMode('sculpt'); },
  status,
  extraProviders: params.get('mockProvider') === '1' ? [new MockProvider(mockGlb, 3)] : [],
});

// ---------- boot ----------
renderRail(); renderBrushSettings(); renderHistoryButtons();
(async () => {
  const fresh = params.get('fresh') === '1';
  const rec = fresh ? null : await autosaveRecover().catch(() => null);
  if (rec && rec.project.nodes.length) {
    await openProjectBytes(serializeProject(rec.project));
    const b = $('banner'); b.hidden = false;
    b.innerHTML = `<span>Recovered autosave from ${new Date(rec.savedAt).toLocaleString()}${rec.fellBack ? ' <b>(newest slot was damaged — used previous save)</b>' : ''}.</span><button class="tb" id="banner-new" data-testid="banner-new">Start new</button><button class="tb" id="banner-ok">OK</button>`;
    $('banner-ok').onclick = () => (b.hidden = true);
    $('banner-new').onclick = async () => { b.hidden = true; await autosaveClear(); newScene(); };
    (window as any).__FORM_RECOVERY = { slot: rec.slot, seq: rec.seq, fellBack: rec.fellBack, problems: rec.problems };
  } else newScene();
  document.body.dataset.ready = '1';
})();

// ---------- test / diagnostics API (read-mostly; used by e2e and the benchmark) ----------
(window as any).__FORM = {
  doc, vp, tool, lab, THREE,
  version: __APP_VERSION__,
  selectedPositions: () => { const n = doc.selectedNode; return n?.kind === 'mesh' ? Array.from(((n.obj as THREE.Mesh).geometry.getAttribute('position').array as Float32Array)) : null; },
  selectedHash: () => { const n = doc.selectedNode; return n?.kind === 'mesh' ? hashBytes((n.obj as THREE.Mesh).geometry.getAttribute('position').array as Float32Array) : null; },
  maxPositionDelta: (a: number[], b: number[]) => maxPositionDelta(new Float32Array(a), new Float32Array(b)),
  importBase64: async (name: string, b64: string) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return !!(await importBuffer(name, bin.buffer)); },
  openProjectBase64: async (b64: string) => openProjectBytes(Uint8Array.from(atob(b64), c => c.charCodeAt(0))),
  autosaveNow, autosaveCorruptHead, autosaveClear,
  lastAutosave: () => lastAutosave,
  screenOf: (x: number, y: number, z: number) => { const n = doc.selectedNode!; const p = n.obj.localToWorld(new THREE.Vector3(x, y, z)).project(vp.camera); const r = vp.renderer.domElement.getBoundingClientRect(); return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }; },
  /** Headless benchmark on a fresh quad sphere of ~`tris` triangles. */
  bench: async (tris: number, frames = 90) => {
    const res = quadSphereResForTris(tris);
    for (const c of [...doc.root.children]) doc.root.remove(c); doc.nodes.clear(); doc.history.clear();
    const t0 = performance.now(); const n = doc.addSphere(res, `Bench${tris}`); const st = doc.sculptOf(n)!; const prepMs = performance.now() - t0;
    select(n.id); vp.frame(n.obj);
    const g = (n.obj as THREE.Mesh).geometry; const triCount = g.index!.count / 3;
    const buildMs = st.stats.lastBuildMs;
    vp.frameCpu.reset(); vp.frameInterval.reset(); vp.continuous = true;
    await new Promise<void>(r => { let k = 0; const f = () => { if (++k >= frames) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    vp.continuous = false;
    const frame = { rafP50: vp.frameInterval.pct(0.5), rafP95: vp.frameInterval.pct(0.95), cpuP50: vp.frameCpu.pct(0.5), cpuP95: vp.frameCpu.pct(0.95) };
    // GPU-inclusive timing: render + gl.finish
    const gl = vp.renderer.getContext(); const fin: number[] = [];
    for (let i = 0; i < 20; i++) { const a = performance.now(); vp.renderer.render(vp.scene, vp.camera); gl.finish(); fin.push(performance.now() - a); }
    fin.sort((a, b) => a - b);
    const dabs: number[] = []; const refits: number[] = [];
    st.engine.begin('draw');
    for (let i = 0; i < 60; i++) { const a = performance.now(); const ch = st.engine.dab([0.2 * Math.sin(i / 6), 0.95, 0.2 * Math.cos(i / 6)], { radius: 0.25, strength: 0.4, invert: false, symmetry: { x: true, y: false, z: false } }); st.apply(ch, ch.length); dabs.push(performance.now() - a); const b = performance.now(); st.maintain(); refits.push(performance.now() - b); }
    const commitT = performance.now(); doc.pushStroke(st, st.engine.end(ids => st.apply(ids, ids.length))); const commitMs = performance.now() - commitT;
    dabs.sort((a, b) => a - b); refits.sort((a, b) => a - b);
    const e0 = performance.now(); const glb = await exportGLB(doc.buildExportRoot(null)); const exportMs = performance.now() - e0;
    const pick = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    return { tris: triCount, sculptVerts: st.mesh.vertCount, prepMs, bvhBuildMs: buildMs, frame, renderFinishP50: pick(fin, 0.5), renderFinishP95: pick(fin, 0.95), dabP50: pick(dabs, 0.5), dabP95: pick(dabs, 0.95), refitP50: pick(refits, 0.5), refitP95: pick(refits, 0.95), commitMs, exportMs, glbBytes: glb.byteLength, renderer: vp.rendererInfo };
  },
};
