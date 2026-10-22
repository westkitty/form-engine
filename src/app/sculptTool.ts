/** Pointer → surface → brush pipeline. Mouse, pen (pressure) and touch via Pointer Events. */
import * as THREE from 'three';
import type { Viewport } from './viewport';
import type { Doc, SculptState, FormNode } from './doc';
import type { BrushId, Symmetry, Vec3 } from '../core/brushes';
import { FrameStats } from './viewport';

export type Mode = 'sculpt' | 'translate' | 'rotate' | 'scale';
export interface BrushSettings { tool: BrushId; radiusPx: number; strength: number; symmetry: Symmetry; invertLatch: boolean; usePressure: boolean }

export class SculptTool {
  mode: Mode = 'sculpt';
  settings: BrushSettings = { tool: 'draw', radiusPx: 60, strength: 0.5, symmetry: { x: true, y: false, z: false }, invertLatch: false, usePressure: true };
  dabStats = new FrameStats();
  lastStroke = { dabs: 0, verts: 0, ms: 0, pointerType: '' };
  private ray = new THREE.Raycaster();
  private active: { st: SculptState; node: FormNode; pointerId: number; worldR: number; localR: number; last: THREE.Vector3 | null; tool: BrushId; invert: boolean; grabPlane?: THREE.Plane; grabLast?: THREE.Vector3; dabs: number; t0: number; pointerType: string } | null = null;
  private pointers = new Set<number>();
  private hover: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private keys = { shift: false, ctrl: false };
  onStrokeEnd: () => void = () => {};
  onModeChange: () => void = () => {};
  private gizmoBefore: THREE.Matrix4 | null = null;

  constructor(private vp: Viewport, private doc: Doc) {
    (this.ray as any).firstHitOnly = true;
    const host = vp.host;
    host.addEventListener('pointerdown', e => this.down(e), { capture: true });
    host.addEventListener('pointermove', e => this.move(e), { capture: true });
    host.addEventListener('pointerup', e => this.up(e), { capture: true });
    host.addEventListener('pointercancel', e => this.up(e, true), { capture: true });
    host.addEventListener('pointerleave', () => { this.hover = null; vp.cursor.visible = false; vp.needsRender = true; });
    window.addEventListener('keydown', e => { this.keys.shift = e.shiftKey; this.keys.ctrl = e.ctrlKey || e.metaKey; if (e.key === 'Escape') this.cancel(); });
    window.addEventListener('keyup', e => { this.keys.shift = e.shiftKey; this.keys.ctrl = e.ctrlKey || e.metaKey; });
    vp.gizmo.addEventListener('dragging-changed', (e: any) => {
      const n = doc.selectedNode; if (!n) return;
      if (e.value) this.gizmoBefore = n.obj.matrix.clone();
      else if (this.gizmoBefore) { n.obj.updateMatrix(); doc.pushTransform(n.id, this.gizmoBefore); this.gizmoBefore = null; }
    });
    vp.onFrame = () => this.frame();
  }

  setMode(m: Mode) {
    this.cancel(); this.mode = m;
    const n = this.doc.selectedNode;
    if (m === 'sculpt' || !n) this.vp.gizmo.detach(); else { this.vp.gizmo.attach(n.obj); this.vp.gizmo.setMode(m); }
    this.vp.cursor.visible = false; this.vp.needsRender = true; this.onModeChange();
  }
  syncGizmo() { this.setMode(this.mode); }

  private pick(clientX: number, clientY: number, node: FormNode | null) {
    if (!node || node.kind !== 'mesh' || !node.obj.visible) return null;
    this.ray.setFromCamera(this.vp.ndc(clientX, clientY), this.vp.camera);
    const hit = this.ray.intersectObject(node.obj, false)[0];
    return hit ?? null;
  }
  private effectiveTool(e: PointerEvent | null): { tool: BrushId; invert: boolean } {
    const shift = e ? e.shiftKey : this.keys.shift, ctrl = e ? e.ctrlKey || e.metaKey : this.keys.ctrl;
    if (shift && this.settings.tool !== 'mask') return { tool: 'smooth', invert: false };
    return { tool: this.settings.tool, invert: ctrl !== this.settings.invertLatch };
  }
  private worldScale(o: THREE.Object3D) { const s = new THREE.Vector3(); o.updateMatrixWorld(); o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); return Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) || 1; }
  private toLocal(o: THREE.Object3D, p: THREE.Vector3): Vec3 { const l = o.worldToLocal(p.clone()); return [l.x, l.y, l.z]; }

  private down(e: PointerEvent) {
    this.pointers.add(e.pointerId);
    if (this.pointers.size > 1 && this.active) { this.cancel(); return; } // second finger: navigate instead
    if (this.mode !== 'sculpt' || e.button !== 0 || this.vp.contextLost) return;
    const node = this.doc.selectedNode;
    const hit = this.pick(e.clientX, e.clientY, node);
    if (!hit || !node) return;
    const st = this.doc.sculptOf(node)!;
    this.vp.controls.enabled = false;
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    const { tool, invert } = this.effectiveTool(e);
    const worldR = this.vp.pixelsToWorld(this.settings.radiusPx, hit.distance);
    const localR = worldR / this.worldScale(node.obj);
    st.engine.begin(tool);
    this.active = { st, node, pointerId: e.pointerId, worldR, localR, last: null, tool, invert, dabs: 0, t0: performance.now(), pointerType: e.pointerType };
    if (tool === 'grab') {
      const n = this.vp.camera.getWorldDirection(new THREE.Vector3());
      this.active.grabPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
      this.active.grabLast = hit.point.clone();
      st.engine.grabBegin(this.toLocal(node.obj, hit.point), this.params(e));
      this.active.dabs++;
    } else this.stamp(hit.point, e);
    e.preventDefault();
  }

  private params(e: PointerEvent) {
    const a = this.active!;
    const pressure = this.settings.usePressure && e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1;
    return { radius: a.localR, strength: this.settings.strength, invert: a.invert, symmetry: this.settings.symmetry, pressure };
  }

  private stamp(world: THREE.Vector3, e: PointerEvent) {
    const a = this.active!;
    const t = performance.now();
    const ch = a.st.engine.dab(this.toLocal(a.node.obj, world), this.params(e));
    a.st.apply(ch, ch.length);
    a.dabs++;
    this.dabStats.push(performance.now() - t);
    this.vp.needsRender = true;
  }

  private move(e: PointerEvent) {
    this.hover = { x: e.clientX, y: e.clientY }; this.hoverDirty = true;
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    const evs = (e.getCoalescedEvents?.() ?? []).length ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      if (a.tool === 'grab') {
        this.ray.setFromCamera(this.vp.ndc(ev.clientX, ev.clientY), this.vp.camera);
        const p = this.ray.ray.intersectPlane(a.grabPlane!, new THREE.Vector3()); if (!p) continue;
        const l0 = a.node.obj.worldToLocal(a.grabLast!.clone()), l1 = a.node.obj.worldToLocal(p.clone());
        const ch = a.st.engine.grabMove([l1.x - l0.x, l1.y - l0.y, l1.z - l0.z]);
        a.st.apply(ch, ch.length); a.grabLast = p; a.dabs++; a.st.strokeDisp += l1.distanceTo(l0);
        this.vp.needsRender = true;
        continue;
      }
      const hit = this.pick(ev.clientX, ev.clientY, a.node);
      if (!hit) { a.last = null; continue; }
      const spacing = a.worldR * 0.22;
      if (!a.last) { this.stamp(hit.point, ev); a.last = hit.point.clone(); continue; }
      const d = a.last.distanceTo(hit.point);
      if (d < spacing) continue;
      const steps = Math.min(64, Math.floor(d / spacing));
      for (let i = 1; i <= steps; i++) this.stamp(a.last.clone().lerp(hit.point, i / steps), ev);
      a.last = hit.point.clone();
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) { if (!this.pointers.size) this.vp.controls.enabled = true; return; }
    if (cancelled) { this.cancel(); return; }
    const entry = a.st.engine.end(ids => a.st.apply(ids, ids.length));
    this.lastStroke = { dabs: a.dabs, verts: 0, ms: performance.now() - a.t0, pointerType: a.pointerType };
    a.st.strokeDisp = Math.max(a.st.strokeDisp, a.tool === 'draw' || a.tool === 'inflate' ? a.localR * 0.08 * a.dabs * this.settings.strength : 0);
    this.active = null;
    this.vp.controls.enabled = true;
    this.doc.pushStroke(a.st, entry);
    this.onStrokeEnd();
  }

  /** Abort the in-flight stroke; geometry returns to its exact pre-stroke bytes. */
  cancel() {
    const a = this.active; if (!a) return false;
    const ids = a.st.engine.cancel();
    a.st.apply(ids, ids.length); a.st.endStroke();
    this.active = null; this.vp.controls.enabled = true; this.vp.needsRender = true;
    this.doc.emit('geometry');
    return true;
  }
  get stroking() { return !!this.active; }

  private frame() {
    this.active?.st.maintain();
    const vp = this.vp;
    if (!this.hoverDirty && !this.active) return;
    this.hoverDirty = false;
    if (this.mode !== 'sculpt' || !this.hover) { if (vp.cursor.visible) { vp.cursor.visible = false; vp.needsRender = true; } return; }
    const node = this.doc.selectedNode;
    const hit = this.pick(this.hover.x, this.hover.y, node);
    if (!hit || !hit.face) { if (vp.cursor.visible) { vp.cursor.visible = false; vp.needsRender = true; } return; }
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    vp.cursor.position.copy(hit.point).addScaledVector(n, 0.002);
    vp.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    vp.cursor.scale.setScalar(vp.pixelsToWorld(this.settings.radiusPx, hit.distance));
    const col = this.effectiveTool(null);
    ((vp.cursor.material as THREE.MeshBasicMaterial).color).set(col.tool === 'mask' ? 0x8fb3c9 : col.invert ? 0xc96a4a : col.tool === 'smooth' ? 0xbfbab0 : 0xe2a03f);
    vp.cursor.visible = true; vp.needsRender = true;
  }
}
