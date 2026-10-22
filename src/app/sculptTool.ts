/**
 * Pointer → surface → brush pipeline for mouse, pen (S Pen / any stylus) and touch, via Pointer Events.
 *
 * Tablet rules:
 *  - Pen pressure scales strength (and, optionally, size). Tilt can widen the brush. Twist is read and reported.
 *  - Once a pen has been seen ("auto"), only the pen sculpts; fingers navigate (one finger orbits, two pan/pinch).
 *  - Palm rejection: touches are dropped while the pen is down or hovering, and for `palmMs` after it lifts or leaves.
 *  - Pen hover (buttons = 0) drives the brush cursor; predicted events reduce cursor lag.
 *  - Side (barrel) button = buttons bit 2 → Subtract or Smooth. Eraser end = buttons bit 32 / button 5 → mask paint/erase.
 *  - A second contact during a touch stroke cancels the stroke (exact pre-stroke bytes) and becomes navigation.
 */
import * as THREE from 'three';
import type { Viewport } from './viewport';
import type { Doc, SculptState, FormNode } from './doc';
import type { BrushId, Symmetry, Vec3 } from '../core/brushes';
import { FrameStats } from './viewport';

export type Mode = 'sculpt' | 'translate' | 'rotate' | 'scale';
export interface BrushSettings { tool: BrushId; radiusPx: number; strength: number; symmetry: Symmetry; invertLatch: boolean; usePressure: boolean }
export interface InputSettings { penMode: 'auto' | 'pen' | 'any'; barrel: 'invert' | 'smooth'; eraser: 'mask' | 'unmask'; pressureSize: boolean; tiltWidens: boolean; palmMs: number }
export interface PenSample { pressure: number; tiltDeg: number; twist: number; azimuthDeg: number; buttons: number; hovering: boolean; t: number }

const BARREL = 2, ERASER = 32;

/** Tilt from vertical in degrees, from tiltX/tiltY (deg) or altitudeAngle (rad), whichever the browser gives. */
export function tiltFromVertical(e: { tiltX?: number; tiltY?: number; altitudeAngle?: number }) {
  if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0 && e.altitudeAngle < Math.PI / 2 && !(e.tiltX || e.tiltY)) return 90 - THREE.MathUtils.radToDeg(e.altitudeAngle);
  const tx = THREE.MathUtils.degToRad(e.tiltX ?? 0), ty = THREE.MathUtils.degToRad(e.tiltY ?? 0);
  return THREE.MathUtils.radToDeg(Math.atan(Math.sqrt(Math.tan(tx) ** 2 + Math.tan(ty) ** 2)));
}
/** Brush radius multiplier for a given tilt: 1 upright → 1.6 at 60°+ (like shading with the side of a pencil). */
export const tiltScale = (deg: number) => 1 + 0.6 * Math.min(1, Math.max(0, deg) / 60);

export class SculptTool {
  mode: Mode = 'sculpt';
  settings: BrushSettings = { tool: 'draw', radiusPx: 60, strength: 0.5, symmetry: { x: true, y: false, z: false }, invertLatch: false, usePressure: true };
  input: InputSettings = { penMode: 'auto', barrel: 'invert', eraser: 'mask', pressureSize: false, tiltWidens: true, palmMs: 300 };
  dabStats = new FrameStats();
  lastStroke = { dabs: 0, verts: 0, ms: 0, pointerType: '', tool: '' as string, invert: false, maxRadiusScale: 1, minPressure: 1, maxPressure: 0 };
  /** Live pen state, for the settings readout and tests. */
  pen = { seen: false, down: false, hovering: false, lastT: -1e9, last: null as PenSample | null, rejectedTouches: 0 };
  private ray = new THREE.Raycaster();
  private active: { st: SculptState; node: FormNode; pointerId: number; worldR: number; localR: number; last: THREE.Vector3 | null; tool: BrushId; invert: boolean; grabPlane?: THREE.Plane; grabLast?: THREE.Vector3; dabs: number; t0: number; pointerType: string } | null = null;
  private pointers = new Set<number>();
  private rejected = new Set<number>();
  private hover: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private hoverScale = 1;
  private keys = { shift: false, ctrl: false };
  onStrokeEnd: () => void = () => {};
  onModeChange: () => void = () => {};
  onPen: () => void = () => {};
  onFirstInteraction: (e: PointerEvent) => void = () => {};
  private gizmoBefore: THREE.Matrix4 | null = null;

  constructor(private vp: Viewport, private doc: Doc) {
    (this.ray as any).firstHitOnly = true;
    const host = vp.host;
    host.addEventListener('pointerdown', e => this.down(e), { capture: true });
    host.addEventListener('pointermove', e => this.move(e), { capture: true });
    host.addEventListener('pointerup', e => this.up(e), { capture: true });
    host.addEventListener('pointercancel', e => this.up(e, true), { capture: true });
    host.addEventListener('pointerleave', e => this.leave(e), { capture: true });
    host.addEventListener('pointerout', e => { if (e.pointerType === 'pen' && !this.active) this.leave(e); }, { capture: true });
    host.addEventListener('contextmenu', e => e.preventDefault());
    host.addEventListener('selectstart', e => e.preventDefault());
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

  /** True when touches should only navigate (a pen is the sculpting tool). */
  get penOnly() { return this.input.penMode === 'pen' || (this.input.penMode === 'auto' && this.pen.seen); }
  /** True when a touch right now would be treated as a resting palm. */
  palmBlocked(now = performance.now()) {
    const since = now - this.pen.lastT;
    // hover counts only while hover events keep arriving (some devices never send a hover-exit)
    return this.pen.down || (this.pen.hovering && since < 1500) || since < this.input.palmMs;
  }

  private notePen(e: PointerEvent, hovering: boolean) {
    const first = !this.pen.seen;
    this.pen.seen = true; this.pen.hovering = hovering; this.pen.lastT = performance.now();
    this.pen.last = { pressure: e.pressure, tiltDeg: tiltFromVertical(e), twist: e.twist ?? 0, azimuthDeg: typeof (e as any).azimuthAngle === 'number' ? THREE.MathUtils.radToDeg((e as any).azimuthAngle) : 0, buttons: e.buttons, hovering, t: this.pen.lastT };
    if (first) this.vp.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.onPen();
  }
  private reject(e: PointerEvent) {
    this.rejected.add(e.pointerId); this.pen.rejectedTouches++;
    e.stopImmediatePropagation(); e.preventDefault();
  }

  private pick(clientX: number, clientY: number, node: FormNode | null) {
    if (!node || node.kind !== 'mesh' || !node.obj.visible) return null;
    this.ray.setFromCamera(this.vp.ndc(clientX, clientY), this.vp.camera);
    const hit = this.ray.intersectObject(node.obj, false)[0];
    return hit ?? null;
  }
  private effectiveTool(e: PointerEvent | null): { tool: BrushId; invert: boolean } {
    const shift = e ? e.shiftKey : this.keys.shift, ctrl = e ? e.ctrlKey || e.metaKey : this.keys.ctrl;
    const buttons = e ? e.buttons : (this.pen.hovering && this.pen.last ? this.pen.last.buttons : 0);
    const isPen = e ? e.pointerType === 'pen' : this.pen.hovering;
    if (isPen && ((buttons & ERASER) || e?.button === 5)) return { tool: 'mask', invert: this.input.eraser === 'unmask' };
    const barrel = isPen && ((buttons & BARREL) !== 0 || e?.button === 2);
    if ((shift || (barrel && this.input.barrel === 'smooth')) && this.settings.tool !== 'mask') return { tool: 'smooth', invert: false };
    return { tool: this.settings.tool, invert: (ctrl || (barrel && this.input.barrel === 'invert')) !== this.settings.invertLatch };
  }
  private worldScale(o: THREE.Object3D) { const s = new THREE.Vector3(); o.updateMatrixWorld(); o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); return Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) || 1; }
  private toLocal(o: THREE.Object3D, p: THREE.Vector3): Vec3 { const l = o.worldToLocal(p.clone()); return [l.x, l.y, l.z]; }

  private down(e: PointerEvent) {
    const now = performance.now();
    if (e.pointerType === 'touch') {
      if (this.pen.seen && this.palmBlocked(now)) { this.reject(e); return; }
    }
    this.onFirstInteraction(e);
    if (e.pointerType === 'pen') {
      this.notePen(e, false); this.pen.down = true;
      // a palm that landed first and started a touch stroke: drop it, the pen wins
      if (this.active && this.active.pointerType === 'touch') this.cancel();
    }
    this.pointers.add(e.pointerId);
    if (this.pointers.size > 1 && this.active) { this.cancel(); return; } // second contact: navigate instead
    if (this.mode !== 'sculpt' || this.vp.contextLost) return;
    const penButtonOk = e.pointerType === 'pen' && (e.button === 0 || e.button === 2 || e.button === 5);
    if (e.button !== 0 && !penButtonOk) return;
    if (e.pointerType === 'touch' && this.penOnly) return; // fingers navigate once a pen is in use
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
    this.active = { st, node, pointerId: e.pointerId, worldR, localR, last: null, tool, invert, dabs: 0, t0: now, pointerType: e.pointerType };
    this.lastStroke = { dabs: 0, verts: 0, ms: 0, pointerType: e.pointerType, tool, invert, maxRadiusScale: 1, minPressure: 1, maxPressure: 0 };
    if (tool === 'grab') {
      const n = this.vp.camera.getWorldDirection(new THREE.Vector3());
      this.active.grabPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
      this.active.grabLast = hit.point.clone();
      st.engine.grabBegin(this.toLocal(node.obj, hit.point), this.params(e));
      this.active.dabs++;
    } else this.stamp(hit.point, e);
    e.preventDefault(); e.stopImmediatePropagation(); // the stroke owns this pointer; orbit must not see it
  }

  /** Per-dab brush parameters from the pointer sample (pressure → strength/size, tilt → size). */
  private params(e: PointerEvent) {
    const a = this.active!;
    const isPen = e.pointerType === 'pen';
    const p = isPen ? Math.max(0.05, Math.min(1, e.pressure || 0.5)) : 1;
    let rScale = 1;
    if (isPen && this.input.tiltWidens) rScale *= tiltScale(tiltFromVertical(e));
    if (isPen && this.input.pressureSize) rScale *= 0.35 + 0.65 * p;
    const ls = this.lastStroke; ls.maxRadiusScale = Math.max(ls.maxRadiusScale, rScale); ls.minPressure = Math.min(ls.minPressure, p); ls.maxPressure = Math.max(ls.maxPressure, p);
    return { radius: a.localR * rScale, strength: this.settings.strength, invert: a.invert, symmetry: this.settings.symmetry, pressure: this.settings.usePressure ? p : 1 };
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
    if (this.rejected.has(e.pointerId)) { e.stopImmediatePropagation(); return; }
    if (e.pointerType === 'pen') this.notePen(e, e.buttons === 0 && !this.pen.down);
    if (e.pointerType === 'touch' && this.pen.seen && !this.active && this.palmBlocked() && !this.pointers.has(e.pointerId)) { e.stopImmediatePropagation(); return; }
    // cursor follows the freshest (predicted) position when the browser offers one
    const pred = e.getPredictedEvents?.() ?? [];
    const c = pred.length ? pred[pred.length - 1] : e;
    if (e.pointerType !== 'touch' || !this.penOnly) { this.hover = { x: c.clientX, y: c.clientY }; this.hoverDirty = true; }
    if (e.pointerType === 'pen') this.hoverScale = this.input.tiltWidens ? tiltScale(tiltFromVertical(e)) : 1;
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    e.stopImmediatePropagation();
    const co = e.getCoalescedEvents?.() ?? [];
    const evs = co.length ? co : [e];
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

  private leave(e: PointerEvent) {
    if (e.pointerType === 'pen') { this.pen.hovering = false; this.pen.lastT = performance.now(); this.onPen(); }
    if (this.active) return;
    this.hover = null; this.vp.cursor.visible = false; this.vp.needsRender = true;
  }

  private up(e: PointerEvent, cancelled = false) {
    if (this.rejected.delete(e.pointerId)) { e.stopImmediatePropagation(); return; }
    if (e.pointerType === 'pen') { this.pen.down = false; this.pen.lastT = performance.now(); this.pen.hovering = !cancelled && e.type === 'pointerup'; this.onPen(); }
    this.pointers.delete(e.pointerId);
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) { if (!this.pointers.size) this.vp.controls.enabled = true; return; }
    e.stopImmediatePropagation();
    if (cancelled) { this.cancel(); return; }
    const entry = a.st.engine.end(ids => a.st.apply(ids, ids.length));
    Object.assign(this.lastStroke, { dabs: a.dabs, ms: performance.now() - a.t0 });
    a.st.strokeDisp = Math.max(a.st.strokeDisp, a.tool === 'draw' || a.tool === 'inflate' ? a.localR * this.lastStroke.maxRadiusScale * 0.08 * a.dabs * this.settings.strength : 0);
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
    vp.cursor.scale.setScalar(vp.pixelsToWorld(this.settings.radiusPx, hit.distance) * this.hoverScale);
    const col = this.effectiveTool(null);
    ((vp.cursor.material as THREE.MeshBasicMaterial).color).set(col.tool === 'mask' ? 0x8fb3c9 : col.invert ? 0xd77a58 : col.tool === 'smooth' ? 0xbfbab0 : 0xe2a03f);
    vp.cursor.visible = true; vp.needsRender = true;
  }
}
