import type { SculptMesh } from './topology';
import { VertexGrid } from './grid';
import { StrokeRecorder, type HistoryEntry } from './history';

export type BrushId = 'draw' | 'inflate' | 'clay' | 'smooth' | 'grab' | 'flatten' | 'pinch' | 'crease' | 'mask';
export const BRUSHES: { id: BrushId; label: string; key: string; hint: string }[] = [
  { id: 'draw', label: 'Draw', key: '1', hint: 'Raise along the area normal (Ctrl: carve)' },
  { id: 'inflate', label: 'Inflate', key: '2', hint: 'Push each vertex along its own normal (Ctrl: deflate)' },
  { id: 'clay', label: 'Clay Build', key: '3', hint: 'Build up toward an offset plane, flat-topped (Ctrl: dig)' },
  { id: 'smooth', label: 'Smooth', key: '4', hint: 'Laplacian relax (hold Shift with any brush)' },
  { id: 'grab', label: 'Grab', key: '5', hint: 'Move a captured region with the cursor' },
  { id: 'flatten', label: 'Flatten', key: '6', hint: 'Project toward the average plane' },
  { id: 'pinch', label: 'Pinch', key: '7', hint: 'Pull vertices toward the stroke (Ctrl: spread)' },
  { id: 'crease', label: 'Crease', key: '8', hint: 'Pinch + cut a groove (Ctrl: ridge)' },
  { id: 'mask', label: 'Mask', key: 'M', hint: 'Paint freeze mask (Ctrl: erase)' },
];

export type Vec3 = [number, number, number];
export interface Symmetry { x: boolean; y: boolean; z: boolean }
export interface DabParams { radius: number; strength: number; invert: boolean; symmetry: Symmetry; pressure?: number }

/** Smooth bell falloff, 1 at center, 0 at the rim, zero slope at both ends. */
export function falloff(t: number) { if (t >= 1) return 0; const u = 1 - t * t; return u * u; }

function mirrors(sym: Symmetry): Vec3[] {
  const out: Vec3[] = [[1, 1, 1]];
  if (sym.x) for (const m of [...out]) out.push([-m[0], m[1], m[2]]);
  if (sym.y) for (const m of [...out]) out.push([m[0], -m[1], m[2]]);
  if (sym.z) for (const m of [...out]) out.push([m[0], m[1], -m[2]]);
  return out;
}

/**
 * Imperative stroke engine. One instance per mesh; a stroke is begin → dab* → end|cancel.
 * Every dab returns the unique vertex ids it changed so the host can refresh normals,
 * render buffers and the BVH for exactly that region.
 */
export class StrokeEngine {
  grid: VertexGrid;
  private ids: Uint32Array;
  private w: Float32Array;
  private tmp: Float32Array;
  private rec: StrokeRecorder | null = null;
  private tool: BrushId = 'draw';
  private grabSets: { ids: Uint32Array; w: Float32Array; mirror: Vec3 }[] = [];
  private changed: Uint32Array;
  constructor(public mesh: SculptMesh) {
    this.grid = new VertexGrid(mesh);
    this.ids = new Uint32Array(mesh.vertCount);
    this.w = new Float32Array(mesh.vertCount);
    this.tmp = new Float32Array(mesh.vertCount * 3);
    this.changed = new Uint32Array(mesh.vertCount);
  }
  get active() { return !!this.rec; }
  get activeTool() { return this.tool; }

  begin(tool: BrushId) {
    if (this.rec) this.cancel();
    this.tool = tool;
    this.rec = new StrokeRecorder(this.mesh, BRUSHES.find(b => b.id === tool)?.label ?? tool);
    this.grabSets = [];
  }

  /** Apply one dab at `c` (mesh-local). Returns changed ids view (valid until next call). */
  dab(c: Vec3, p: DabParams): Uint32Array {
    if (!this.rec) throw new Error('dab outside stroke');
    let total = 0;
    const seen = new Set<number>();
    for (const m of mirrors(p.symmetry)) {
      const cc: Vec3 = [c[0] * m[0], c[1] * m[1], c[2] * m[2]];
      const n = this.dabOne(cc, p);
      for (let i = 0; i < n; i++) { const v = this.ids[i]; if (!seen.has(v)) { seen.add(v); this.changed[total++] = v; } }
    }
    return this.changed.subarray(0, total);
  }

  private gather(c: Vec3, r: number, useMask: boolean) {
    const m = this.mesh;
    const n = this.grid.query(c[0], c[1], c[2], r, this.ids);
    for (let i = 0; i < n; i++) {
      const v = this.ids[i];
      const d = Math.hypot(m.pos[v * 3] - c[0], m.pos[v * 3 + 1] - c[1], m.pos[v * 3 + 2] - c[2]);
      this.w[i] = falloff(d / r) * (useMask ? 1 - m.mask[v] : 1);
    }
    return n;
  }

  private area(n: number) {
    const m = this.mesh;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, ws = 0;
    for (let i = 0; i < n; i++) {
      const v = this.ids[i], w = this.w[i] + 1e-6;
      nx += m.nrm[v * 3] * w; ny += m.nrm[v * 3 + 1] * w; nz += m.nrm[v * 3 + 2] * w;
      cx += m.pos[v * 3] * w; cy += m.pos[v * 3 + 1] * w; cz += m.pos[v * 3 + 2] * w; ws += w;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return { N: [nx / l, ny / l, nz / l] as Vec3, C: [cx / ws, cy / ws, cz / ws] as Vec3 };
  }

  private dabOne(c: Vec3, p: DabParams): number {
    const m = this.mesh, P = m.pos;
    const r = p.radius;
    const s = Math.max(0, Math.min(1, p.strength * (p.pressure ?? 1)));
    const sign = p.invert ? -1 : 1;
    const tool = this.tool;
    if (tool === 'grab') return 0;
    const n = this.gather(c, r, tool !== 'mask');
    if (!n) return 0;
    this.rec!.touch(this.ids, n);
    let maxMove = 0;
    const move = (v: number, dx: number, dy: number, dz: number) => {
      P[v * 3] += dx; P[v * 3 + 1] += dy; P[v * 3 + 2] += dz;
      const d = Math.hypot(dx, dy, dz); if (d > maxMove) maxMove = d;
    };
    if (tool === 'mask') {
      for (let i = 0; i < n; i++) { const v = this.ids[i]; m.mask[v] = Math.max(0, Math.min(1, m.mask[v] + this.w[i] * s * sign)); }
      return n;
    }
    const { N, C } = this.area(n);
    switch (tool) {
      case 'draw': {
        const k = r * s * 0.08 * sign;
        for (let i = 0; i < n; i++) { const w = this.w[i] * k; move(this.ids[i], N[0] * w, N[1] * w, N[2] * w); }
        break;
      }
      case 'inflate': {
        const k = r * s * 0.06 * sign;
        for (let i = 0; i < n; i++) { const v = this.ids[i], w = this.w[i] * k; move(v, m.nrm[v * 3] * w, m.nrm[v * 3 + 1] * w, m.nrm[v * 3 + 2] * w); }
        break;
      }
      case 'clay': {
        const off = r * 0.12 * sign;
        const P0: Vec3 = [C[0] + N[0] * off, C[1] + N[1] * off, C[2] + N[2] * off];
        for (let i = 0; i < n; i++) {
          const v = this.ids[i];
          const d = (P[v * 3] - P0[0]) * N[0] + (P[v * 3 + 1] - P0[1]) * N[1] + (P[v * 3 + 2] - P0[2]) * N[2];
          if (d * sign >= 0) continue;
          const w = -d * this.w[i] * s * 0.5;
          move(v, N[0] * w, N[1] * w, N[2] * w);
        }
        break;
      }
      case 'smooth': {
        for (let i = 0; i < n; i++) {
          const v = this.ids[i];
          let ax = 0, ay = 0, az = 0;
          const a = m.nbrStart[v], b = m.nbrStart[v + 1];
          for (let j = a; j < b; j++) { const u = m.nbrList[j]; ax += P[u * 3]; ay += P[u * 3 + 1]; az += P[u * 3 + 2]; }
          const k = b - a || 1;
          this.tmp[i * 3] = ax / k; this.tmp[i * 3 + 1] = ay / k; this.tmp[i * 3 + 2] = az / k;
        }
        for (let i = 0; i < n; i++) {
          const v = this.ids[i], w = Math.min(1, this.w[i] * s);
          move(v, (this.tmp[i * 3] - P[v * 3]) * w, (this.tmp[i * 3 + 1] - P[v * 3 + 1]) * w, (this.tmp[i * 3 + 2] - P[v * 3 + 2]) * w);
        }
        break;
      }
      case 'flatten': {
        for (let i = 0; i < n; i++) {
          const v = this.ids[i];
          const d = (P[v * 3] - C[0]) * N[0] + (P[v * 3 + 1] - C[1]) * N[1] + (P[v * 3 + 2] - C[2]) * N[2];
          const w = -d * this.w[i] * s * 0.5 * (sign < 0 ? -0.5 : 1);
          move(v, N[0] * w, N[1] * w, N[2] * w);
        }
        break;
      }
      case 'pinch':
      case 'crease': {
        const pk = (tool === 'pinch' ? 0.3 : 0.2) * s * (tool === 'pinch' ? sign : 1);
        const dk = tool === 'crease' ? -r * s * 0.05 * sign : 0;
        for (let i = 0; i < n; i++) {
          const v = this.ids[i];
          let tx = c[0] - P[v * 3], ty = c[1] - P[v * 3 + 1], tz = c[2] - P[v * 3 + 2];
          const dn = tx * N[0] + ty * N[1] + tz * N[2];
          tx -= N[0] * dn; ty -= N[1] * dn; tz -= N[2] * dn;
          const w = this.w[i];
          move(v, tx * w * pk + N[0] * w * dk, ty * w * pk + N[1] * w * dk, tz * w * pk + N[2] * w * dk);
        }
        break;
      }
    }
    this.grid.slack += maxMove;
    return n;
  }

  /** Grab: capture region at stroke start. */
  grabBegin(c: Vec3, p: DabParams) {
    if (!this.rec) throw new Error('grab outside stroke');
    this.grabSets = [];
    for (const mir of mirrors(p.symmetry)) {
      const cc: Vec3 = [c[0] * mir[0], c[1] * mir[1], c[2] * mir[2]];
      const n = this.gather(cc, p.radius, true);
      const s = Math.max(0, Math.min(1, p.strength * (p.pressure ?? 1)));
      void s; // grab follows the cursor 1:1 at the centre; falloff shapes the rim
      const w = this.w.slice(0, n);
      this.grabSets.push({ ids: this.ids.slice(0, n), w, mirror: mir });
      this.rec.touch(this.ids, n);
    }
  }
  /** Grab: translate captured region by mesh-local delta. */
  grabMove(delta: Vec3): Uint32Array {
    const P = this.mesh.pos;
    let total = 0; const seen = new Set<number>();
    let maxMove = 0;
    for (const g of this.grabSets) {
      const dx = delta[0] * g.mirror[0], dy = delta[1] * g.mirror[1], dz = delta[2] * g.mirror[2];
      for (let i = 0; i < g.ids.length; i++) {
        const v = g.ids[i], w = g.w[i];
        P[v * 3] += dx * w; P[v * 3 + 1] += dy * w; P[v * 3 + 2] += dz * w;
        if (!seen.has(v)) { seen.add(v); this.changed[total++] = v; }
      }
      maxMove = Math.max(maxMove, Math.hypot(dx, dy, dz));
    }
    this.grid.slack += maxMove;
    return this.changed.subarray(0, total);
  }

  /** Finish the stroke; returns a history entry (null if nothing changed). */
  end(apply: (verts: Uint32Array) => void): HistoryEntry | null {
    if (!this.rec) return null;
    const e = this.rec.commit(apply);
    this.rec = null; this.grabSets = [];
    this.grid.rebuild();
    return e;
  }
  /** Abort the stroke and restore exact before-state. Returns restored ids. */
  cancel(): Uint32Array {
    if (!this.rec) return new Uint32Array(0);
    const ids = this.rec.cancel();
    this.rec = null; this.grabSets = [];
    this.grid.rebuild();
    return ids;
  }
  /** Mesh positions changed externally (undo/redo/import): rebuild spatial index. */
  invalidate() { this.grid.rebuild(); }
}
