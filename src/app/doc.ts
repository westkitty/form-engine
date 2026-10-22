/** Scene document: hierarchy, sculpt state, history, project (de)serialisation. */
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { buildSculptMesh, recomputeNormalsFor, syncRender, syncAllRender, recomputeAllNormals, type SculptMesh } from '../core/topology';
import { StrokeEngine } from '../core/brushes';
import { History, type HistoryEntry } from '../core/history';
import { quadSphere } from '../core/primitives';
import type { NodeData, ProjectData } from '../io/project';
import { normaliseGeometry } from '../io/formats';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type NodeKind = 'mesh' | 'group' | 'refplane';

export interface BvhStats { builds: number; refits: number; lastBuildMs: number; lastRefitMs: number; policy: string }

/** Per-mesh sculpt state. BVH policy: refit once per frame while dirty; full rebuild after topology change, after a stroke whose displacement exceeds 15% of the bounding radius, or after 400 refits. */
export class SculptState {
  mesh: SculptMesh;
  engine: StrokeEngine;
  dirty = false;
  strokeDisp = 0;
  refitsSinceBuild = 0;
  stats: BvhStats = { builds: 0, refits: 0, lastBuildMs: 0, lastRefitMs: 0, policy: 'refit/frame · rebuild on >15% R or 400 refits' };
  constructor(public obj: THREE.Mesh) {
    const g = obj.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.getIndex()?.array ?? null;
    this.mesh = buildSculptMesh(pos, idx);
    if (!g.getAttribute('normal')) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    if (!g.getAttribute('color')) {
      const c = new Float32Array(pos.length).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    const maskAttr = obj.userData.pendingMask as Float32Array | undefined;
    if (maskAttr) { for (let r = 0; r < this.mesh.renderCount; r++) this.mesh.mask[this.mesh.renderToUniq[r]] = maskAttr[r]; delete obj.userData.pendingMask; }
    syncAllRender(this.mesh, pos, g.getAttribute('normal').array as Float32Array);
    this.syncMaskAll();
    g.getAttribute('position').needsUpdate = true; g.getAttribute('normal').needsUpdate = true;
    this.engine = new StrokeEngine(this.mesh);
    this.rebuildBvh();
  }
  get geometry() { return this.obj.geometry; }
  rebuildBvh() {
    const t = performance.now();
    const g = this.geometry as any;
    if (g.boundsTree) g.disposeBoundsTree();
    g.computeBoundsTree({ setBoundingBox: true });
    this.stats.lastBuildMs = performance.now() - t; this.stats.builds++; this.refitsSinceBuild = 0; this.dirty = false;
    g.computeBoundingSphere();
  }
  maintain() {
    if (!this.dirty) return;
    const t = performance.now();
    (this.geometry as any).boundsTree?.refit();
    this.stats.lastRefitMs = performance.now() - t; this.stats.refits++; this.refitsSinceBuild++; this.dirty = false;
  }
  endStroke() {
    this.maintain();
    const r = this.geometry.boundingSphere?.radius ?? 1;
    if (this.strokeDisp > r * 0.15 || this.refitsSinceBuild > 400) this.rebuildBvh();
    else this.geometry.computeBoundingSphere();
    this.strokeDisp = 0;
  }
  /** Push changed unique vertices to GPU buffers (positions, normals, mask colour). */
  apply(ids: ArrayLike<number>, count = ids.length) {
    if (!count) return;
    const g = this.geometry;
    const touched = recomputeNormalsFor(this.mesh, ids, count);
    const pa = g.getAttribute('position') as THREE.BufferAttribute, na = g.getAttribute('normal') as THREE.BufferAttribute;
    const [lo, hi] = syncRender(this.mesh, touched, touched.length, pa.array as Float32Array, na.array as Float32Array);
    this.syncMask(ids, count);
    if (hi >= lo) {
      for (const a of [pa, na, g.getAttribute('color') as THREE.BufferAttribute]) { a.clearUpdateRanges(); a.addUpdateRange(lo * 3, (hi - lo + 1) * 3); a.needsUpdate = true; }
    }
    this.dirty = true;
  }
  applyAll() {
    recomputeAllNormals(this.mesh);
    const g = this.geometry;
    syncAllRender(this.mesh, g.getAttribute('position').array as Float32Array, g.getAttribute('normal').array as Float32Array);
    this.syncMaskAll();
    for (const n of ['position', 'normal', 'color']) { const a = g.getAttribute(n) as THREE.BufferAttribute; a.clearUpdateRanges(); a.needsUpdate = true; }
    this.engine.invalidate();
    this.rebuildBvh();
  }
  private syncMask(ids: ArrayLike<number>, count: number) {
    const col = this.geometry.getAttribute('color').array as Float32Array; const m = this.mesh;
    for (let i = 0; i < count; i++) {
      const v = ids[i]; const k = 1 - 0.62 * m.mask[v];
      for (let j = m.uniqRenderStart[v]; j < m.uniqRenderStart[v + 1]; j++) { const r = m.uniqRenderList[j]; col[r * 3] = k; col[r * 3 + 1] = k * 0.93; col[r * 3 + 2] = k * 0.9; }
    }
  }
  private syncMaskAll() { const all = new Uint32Array(this.mesh.vertCount); for (let i = 0; i < all.length; i++) all[i] = i; this.syncMask(all, all.length); }
  /** Per-render-vertex mask, for saving. */
  renderMask(): Float32Array { const out = new Float32Array(this.mesh.renderCount); for (let r = 0; r < out.length; r++) out[r] = this.mesh.mask[this.mesh.renderToUniq[r]]; return out; }
}

export interface FormNode { id: string; name: string; kind: NodeKind; obj: THREE.Object3D; sculpt?: SculptState; image?: NodeData['image']; color: string }

let idSeq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export class Doc {
  root = new THREE.Group();
  nodes = new Map<string, FormNode>();
  selected: string | null = null;
  history = new History();
  name = 'Untitled';
  listeners = new Set<(why: string) => void>();
  displayMaterial: THREE.MeshMatcapMaterial;
  constructor(matcap: THREE.Texture) {
    this.root.name = 'FORM_ROOT';
    this.displayMaterial = new THREE.MeshMatcapMaterial({ matcap, vertexColors: true });
  }
  emit(why: string) { for (const l of this.listeners) l(why); }
  get selectedNode() { return this.selected ? this.nodes.get(this.selected) ?? null : null; }

  private register(n: FormNode, parent: THREE.Object3D) {
    n.obj.userData.formId = n.id; n.obj.name = n.name;
    parent.add(n.obj); this.nodes.set(n.id, n);
  }
  private meshNode(name: string, geo: THREE.BufferGeometry, color = '#b9b4aa', id = newId('m')): FormNode {
    const mesh = new THREE.Mesh(geo, this.displayMaterial);
    return { id, name, kind: 'mesh', obj: mesh, color };
  }

  addSphere(res = 64, name = 'Sphere'): FormNode {
    const raw = quadSphere(res, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
    g.setIndex(new THREE.BufferAttribute(raw.index, 1));
    const n = this.meshNode(name, g);
    this.addUndoable(n, this.root, `Add ${name}`);
    return n;
  }
  addGroup(name = 'Group'): FormNode {
    const n: FormNode = { id: newId('g'), name, kind: 'group', obj: new THREE.Group(), color: '#ffffff' };
    this.addUndoable(n, this.root, 'Add group'); return n;
  }

  /** Bring an imported Object3D tree in as editable nodes (meshes become sculptable). */
  addImported(src: THREE.Object3D, name: string): FormNode {
    const build = (o: THREE.Object3D): FormNode => {
      let n: FormNode;
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        const geo = m.geometry.getAttribute('normal') && m.geometry.getIndex() ? m.geometry : normaliseGeometry(m.geometry);
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        const color = (mat as any)?.color ? '#' + (mat as any).color.getHexString() : '#b9b4aa';
        n = this.meshNode(o.name || 'Mesh', geo, color);
        n.obj.userData.originalMaterial = m.material;
      } else n = { id: newId('g'), name: o.name || 'Group', kind: 'group', obj: new THREE.Group(), color: '#ffffff' };
      n.obj.position.copy(o.position); n.obj.quaternion.copy(o.quaternion); n.obj.scale.copy(o.scale); n.obj.visible = o.visible;
      for (const c of o.children) { const cn = build(c); this.register(cn, n.obj); }
      return n;
    };
    // collapse single-child wrapper groups with identity transforms (glTF scene → export root → mesh)
    while (!(src as THREE.Mesh).isMesh && src.children.length === 1 && src.position.lengthSq() === 0 && src.quaternion.w === 1 && src.scale.x === 1 && src.scale.y === 1 && src.scale.z === 1) src = src.children[0];
    const top = build(src); top.name = name;
    this.addUndoable(top, this.root, `Import ${name}`);
    return top;
  }

  addRefPlane(name: string, tex: THREE.Texture, aspect: number, image: NonNullable<FormNode['image']>, placement: { position: number[]; rotationY: number }): FormNode {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: image.opacity, side: THREE.DoubleSide, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), mat);
    plane.position.fromArray(placement.position); plane.rotation.y = placement.rotationY;
    plane.renderOrder = -1; plane.userData.isRef = true;
    const n: FormNode = { id: newId('r'), name, kind: 'refplane', obj: plane, image, color: '#ffffff' };
    this.addUndoable(n, this.root, `Add reference ${name}`);
    return n;
  }

  private addUndoable(n: FormNode, parent: THREE.Object3D, label: string) {
    this.register(n, parent);
    this.selected = n.id;
    const collect = (o: THREE.Object3D, acc: FormNode[] = []) => { const f = this.nodes.get(o.userData.formId); if (f) acc.push(f); o.children.forEach(c => collect(c, acc)); return acc; };
    const sub = collect(n.obj);
    this.history.push({ label, bytes: 64, undo: () => { parent.remove(n.obj); sub.forEach(s => this.nodes.delete(s.id)); if (this.selected === n.id) this.selected = null; this.emit('structure'); },
      redo: () => { parent.add(n.obj); sub.forEach(s => this.nodes.set(s.id, s)); this.emit('structure'); } });
    this.emit('structure');
  }

  remove(id: string) {
    const n = this.nodes.get(id); if (!n || !n.obj.parent) return;
    const parent = n.obj.parent;
    const sub: FormNode[] = []; n.obj.traverse(o => { const f = this.nodes.get(o.userData.formId); if (f) sub.push(f); });
    const doIt = () => { parent.remove(n.obj); sub.forEach(s => this.nodes.delete(s.id)); if (this.selected && sub.some(s => s.id === this.selected)) this.selected = null; this.emit('structure'); };
    doIt();
    this.history.push({ label: `Delete ${n.name}`, bytes: 64, undo: () => { parent.add(n.obj); sub.forEach(s => this.nodes.set(s.id, s)); this.emit('structure'); }, redo: doIt });
  }
  rename(id: string, name: string) {
    const n = this.nodes.get(id); if (!n || !name.trim()) return; const old = n.name;
    const set = (v: string) => { n.name = v; n.obj.name = v; this.emit('structure'); };
    set(name.trim()); this.history.push({ label: 'Rename', bytes: 64, undo: () => set(old), redo: () => set(name.trim()) });
  }
  setVisible(id: string, v: boolean) { const n = this.nodes.get(id); if (!n) return; n.obj.visible = v; this.emit('structure'); }
  /** Reparent keeping world transform; refuses cycles. */
  setParent(id: string, parentId: string | null) {
    const n = this.nodes.get(id); if (!n) return;
    const p = parentId ? this.nodes.get(parentId)?.obj : this.root; if (!p) return;
    let q: THREE.Object3D | null = p; while (q) { if (q === n.obj) throw new Error('Cannot parent a node to its own descendant'); q = q.parent; }
    const old = n.obj.parent!;
    const move = (to: THREE.Object3D) => { to.attach(n.obj); this.emit('structure'); };
    move(p); this.history.push({ label: 'Reparent', bytes: 64, undo: () => move(old), redo: () => move(p) });
  }
  /** Record a transform change already applied to obj (before matrix supplied). */
  pushTransform(id: string, before: THREE.Matrix4) {
    const n = this.nodes.get(id); if (!n) return;
    const after = n.obj.matrix.clone();
    if (after.equals(before)) return;
    const set = (m: THREE.Matrix4) => { m.decompose(n.obj.position, n.obj.quaternion, n.obj.scale); n.obj.updateMatrixWorld(true); this.emit('transform'); };
    this.history.push({ label: 'Transform', bytes: 128, undo: () => set(before), redo: () => set(after) });
    this.emit('transform');
  }
  setColor(id: string, c: string) { const n = this.nodes.get(id); if (n) { n.color = c; this.emit('material'); } }

  sculptOf(n: FormNode | null): SculptState | null {
    if (!n || n.kind !== 'mesh') return null;
    if (!n.sculpt) n.sculpt = new SculptState(n.obj as THREE.Mesh);
    return n.sculpt;
  }
  pushStroke(st: SculptState, e: HistoryEntry | null) { this.history.push(e); if (e) { st.endStroke(); this.emit('geometry'); } }
  undo() { const r = this.history.undo(); this.afterHistory(); return r; }
  redo() { const r = this.history.redo(); this.afterHistory(); return r; }
  private afterHistory() { for (const n of this.nodes.values()) if (n.sculpt) { n.sculpt.engine.invalidate(); n.sculpt.endStroke(); } this.emit('geometry'); }

  /** Export root: real materials (original if imported, standard otherwise), no display-only attributes. */
  buildExportRoot(onlyId?: string | null): THREE.Object3D {
    const mirror = (o: THREE.Object3D): THREE.Object3D | null => {
      const n = this.nodes.get(o.userData.formId);
      if (o !== this.root && !n) return null;
      if (n?.kind === 'refplane') return null;
      let out: THREE.Object3D;
      if (n?.kind === 'mesh') {
        const src = o as THREE.Mesh; const g = new THREE.BufferGeometry();
        for (const a of ['position', 'normal', 'uv']) { const at = src.geometry.getAttribute(a); if (at) g.setAttribute(a, (at as THREE.BufferAttribute).clone()); }
        if (src.geometry.index) g.setIndex(src.geometry.index.clone());
        for (const gr of src.geometry.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
        const mat = (o.userData.originalMaterial as THREE.Material | undefined) ?? new THREE.MeshStandardMaterial({ color: n.color, roughness: 0.62, metalness: 0 });
        out = new THREE.Mesh(g, mat);
      } else out = new THREE.Group();
      out.name = n?.name ?? 'FORM_ENGINE';
      out.position.copy(o.position); out.quaternion.copy(o.quaternion); out.scale.copy(o.scale); out.visible = o.visible;
      for (const c of o.children) { const m = mirror(c); if (m) out.add(m); }
      return out;
    };
    if (onlyId) {
      const n = this.nodes.get(onlyId); if (!n) throw new Error('nothing selected');
      const r = mirror(n.obj)!; n.obj.updateMatrixWorld(true); n.obj.matrixWorld.decompose(r.position, r.quaternion, r.scale); return r;
    }
    return mirror(this.root)!;
  }

  toProject(camera?: { position: number[]; target: number[] }): ProjectData {
    const nodes: NodeData[] = [];
    const walk = (o: THREE.Object3D, parent: string | null) => {
      for (const c of o.children) {
        const n = this.nodes.get(c.userData.formId); if (!n) continue;
        const d: NodeData = { id: n.id, name: n.name, parent, kind: n.kind, position: c.position.toArray(), quaternion: c.quaternion.toArray() as number[], scale: c.scale.toArray(), visible: c.visible, material: { color: n.color, roughness: 0.62, metalness: 0 } };
        if (n.kind === 'mesh') {
          const g = (c as THREE.Mesh).geometry;
          d.mesh = { positions: (g.getAttribute('position').array as Float32Array).slice(), normals: (g.getAttribute('normal')?.array as Float32Array)?.slice(), uvs: (g.getAttribute('uv')?.array as Float32Array | undefined)?.slice(), index: g.index ? Uint32Array.from(g.index.array) : undefined, mask: n.sculpt?.renderMask() };
        }
        if (n.kind === 'refplane' && n.image) d.image = { ...n.image, opacity: ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity };
        nodes.push(d); walk(c, n.id);
      }
    };
    walk(this.root, null);
    return { name: this.name, nodes, camera, appVersion: __APP_VERSION__ };
  }

  async loadProject(p: ProjectData, makeTexture: (bytes: Uint8Array, mime: string) => Promise<THREE.Texture>) {
    for (const c of [...this.root.children]) this.root.remove(c);
    this.nodes.clear(); this.selected = null; this.history.clear(); this.name = p.name || 'Untitled';
    const objs = new Map<string, THREE.Object3D>();
    for (const d of p.nodes) {
      let n: FormNode;
      if (d.kind === 'mesh' && d.mesh) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(d.mesh.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(d.mesh.normals ?? new Float32Array(d.mesh.positions.length), 3));
        if (d.mesh.uvs) g.setAttribute('uv', new THREE.BufferAttribute(d.mesh.uvs, 2));
        if (d.mesh.index) g.setIndex(new THREE.BufferAttribute(d.mesh.index, 1));
        n = this.meshNode(d.name, g, d.material?.color, d.id);
        if (d.mesh.mask && d.mesh.mask.some(x => x > 0)) n.obj.userData.pendingMask = d.mesh.mask;
      } else if (d.kind === 'refplane' && d.image) {
        const tex = await makeTexture(d.image.bytes, d.image.mime);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: d.image.opacity, side: THREE.DoubleSide, depthWrite: false });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * d.image.aspect, 2), mat); plane.userData.isRef = true; plane.renderOrder = -1;
        n = { id: d.id, name: d.name, kind: 'refplane', obj: plane, image: d.image, color: '#ffffff' };
      } else n = { id: d.id, name: d.name, kind: 'group', obj: new THREE.Group(), color: '#ffffff' };
      n.obj.position.fromArray(d.position); n.obj.quaternion.fromArray(d.quaternion); n.obj.scale.fromArray(d.scale); n.obj.visible = d.visible;
      this.register(n, (d.parent && objs.get(d.parent)) || this.root);
      objs.set(d.id, n.obj);
      if (n.obj.userData.pendingMask) this.sculptOf(n);
    }
    const firstMesh = [...this.nodes.values()].find(n => n.kind === 'mesh');
    this.selected = firstMesh?.id ?? null;
    this.emit('structure'); this.emit('loaded');
  }
}
