import type { SculptMesh } from './topology';
import { nextStamp } from './topology';

/**
 * Uniform spatial hash over unique vertices. Rebuilt in O(n) at stroke end;
 * during a stroke, queries are inflated by `slack` (max displacement since build)
 * so a stale grid can never miss a vertex.
 */
export class VertexGrid {
  cell = 1;
  slack = 0;
  private tableSize = 1;
  private start = new Uint32Array(1);
  private list = new Uint32Array(0);
  constructor(public mesh: SculptMesh, cellSize?: number) { this.rebuild(cellSize); }

  private h(ix: number, iy: number, iz: number) {
    return ((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0) & (this.tableSize - 1);
  }

  rebuild(cellSize?: number) {
    const m = this.mesh;
    this.cell = cellSize ?? Math.max(m.meanEdge * 4, 1e-6);
    let ts = 1; while (ts < m.vertCount * 2) ts <<= 1;
    this.tableSize = ts;
    const start = new Uint32Array(ts + 1);
    const keys = new Uint32Array(m.vertCount);
    const inv = 1 / this.cell;
    for (let v = 0; v < m.vertCount; v++) {
      const k = this.h(Math.floor(m.pos[v * 3] * inv), Math.floor(m.pos[v * 3 + 1] * inv), Math.floor(m.pos[v * 3 + 2] * inv));
      keys[v] = k; start[k + 1]++;
    }
    for (let i = 0; i < ts; i++) start[i + 1] += start[i];
    const fill = start.slice(0, ts);
    const list = new Uint32Array(m.vertCount);
    for (let v = 0; v < m.vertCount; v++) list[fill[keys[v]]++] = v;
    this.start = start; this.list = list; this.slack = 0;
  }

  /** Writes vertex ids within `r` of (cx,cy,cz) into out; returns count. */
  query(cx: number, cy: number, cz: number, r: number, out: Uint32Array): number {
    const m = this.mesh;
    const R = r + this.slack;
    const inv = 1 / this.cell;
    const x0 = Math.floor((cx - R) * inv), x1 = Math.floor((cx + R) * inv);
    const y0 = Math.floor((cy - R) * inv), y1 = Math.floor((cy + R) * inv);
    const z0 = Math.floor((cz - R) * inv), z1 = Math.floor((cz + R) * inv);
    const sid = nextStamp(m);
    const bucketSeen = new Set<number>();
    const r2 = r * r;
    let n = 0;
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.h(ix, iy, iz);
      if (bucketSeen.has(k)) continue;
      bucketSeen.add(k);
      for (let j = this.start[k]; j < this.start[k + 1]; j++) {
        const v = this.list[j];
        if (m.stamp[v] === sid) continue;
        m.stamp[v] = sid;
        const dx = m.pos[v * 3] - cx, dy = m.pos[v * 3 + 1] - cy, dz = m.pos[v * 3 + 2] - cz;
        if (dx * dx + dy * dy + dz * dz <= r2 && n < out.length) out[n++] = v;
      }
    }
    return n;
  }
}
