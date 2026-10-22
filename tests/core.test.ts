import { describe, it, expect } from 'vitest';
import { quadSphere } from '../src/core/primitives';
import { buildSculptMesh, recomputeNormalsFor, maxPositionDelta, hashBytes, syncAllRender } from '../src/core/topology';
import { StrokeEngine, type BrushId, type DabParams, type Vec3 } from '../src/core/brushes';
import { History } from '../src/core/history';

const mk = (N = 24) => { const r = quadSphere(N, 1); return { raw: r, m: buildSculptMesh(r.positions, r.index) }; };
const P: DabParams = { radius: 0.35, strength: 0.6, invert: false, symmetry: { x: false, y: false, z: false } };
const top: Vec3 = [0, 1, 0];
const len = (m: any, v: number) => Math.hypot(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
function nearest(m: any, c: Vec3) { let b = 0, bd = Infinity; for (let v = 0; v < m.vertCount; v++) { const d = Math.hypot(m.pos[v * 3] - c[0], m.pos[v * 3 + 1] - c[1], m.pos[v * 3 + 2] - c[2]); if (d < bd) { bd = d; b = v; } } return b; }
function stroke(m: any, eng: StrokeEngine, tool: BrushId, p = P, dabs = 6, c: Vec3 = top) {
  eng.begin(tool);
  for (let i = 0; i < dabs; i++) { const ch = eng.dab(c, p); recomputeNormalsFor(m, ch); }
  return eng.end(ids => recomputeNormalsFor(m, ids));
}
function roughness(m: any, ids: number[]) { // mean |p - avg(nbrs)|
  let s = 0; for (const v of ids) { let ax = 0, ay = 0, az = 0; const a = m.nbrStart[v], b = m.nbrStart[v + 1]; for (let j = a; j < b; j++) { const u = m.nbrList[j]; ax += m.pos[u * 3]; ay += m.pos[u * 3 + 1]; az += m.pos[u * 3 + 2]; } const k = b - a; s += Math.hypot(ax / k - m.pos[v * 3], ay / k - m.pos[v * 3 + 1], az / k - m.pos[v * 3 + 2]); } return s / ids.length;
}

describe('topology', () => {
  it('welds a quad sphere into a closed manifold (V - E + F = 2)', () => {
    const { m } = mk(16);
    expect(m.triCount).toBe(12 * 16 * 16);
    const E = m.nbrList.length / 2;
    expect(m.vertCount - E + m.triCount).toBe(2);
  });
  it('welds a non-indexed (triangle soup) mesh back to shared vertices', () => {
    const { raw } = mk(8);
    const soup = new Float32Array(raw.index.length * 3);
    for (let i = 0; i < raw.index.length; i++) for (let k = 0; k < 3; k++) soup[i * 3 + k] = raw.positions[raw.index[i] * 3 + k];
    const m = buildSculptMesh(soup, null);
    expect(m.vertCount).toBe(raw.positions.length / 3);
    expect(m.renderCount).toBe(raw.index.length);
  });
  it('normals point outward on a sphere', () => {
    const { m } = mk(8);
    for (let v = 0; v < m.vertCount; v += 17) {
      const d = m.nrm[v * 3] * m.pos[v * 3] + m.nrm[v * 3 + 1] * m.pos[v * 3 + 1] + m.nrm[v * 3 + 2] * m.pos[v * 3 + 2];
      expect(d).toBeGreaterThan(0.95);
    }
  });
});

describe('six+ distinct brushes', () => {
  it('Draw raises the surface along the area normal', () => {
    const { m } = mk(); const e = new StrokeEngine(m); const v = nearest(m, top);
    stroke(m, e, 'draw'); expect(len(m, v)).toBeGreaterThan(1.05);
  });
  it('Draw inverted (Ctrl) carves', () => {
    const { m } = mk(); const e = new StrokeEngine(m); const v = nearest(m, top);
    stroke(m, e, 'draw', { ...P, invert: true }); expect(len(m, v)).toBeLessThan(0.95);
  });
  it('Inflate moves vertices along their own normals (radially on a sphere)', () => {
    const { m } = mk(); const e = new StrokeEngine(m);
    const off = nearest(m, [0.2, 0.98, 0]); const before = [m.pos[off * 3], m.pos[off * 3 + 1], m.pos[off * 3 + 2]];
    stroke(m, e, 'inflate');
    const d = [m.pos[off * 3] - before[0], m.pos[off * 3 + 1] - before[1], m.pos[off * 3 + 2] - before[2]];
    const dl = Math.hypot(d[0], d[1], d[2]); const bl = Math.hypot(before[0], before[1], before[2]);
    expect(dl).toBeGreaterThan(1e-3);
    expect((d[0] * before[0] + d[1] * before[1] + d[2] * before[2]) / (dl * bl)).toBeGreaterThan(0.98);
  });
  it('Clay Build adds material that plateaus (centre rises less than Draw after many dabs)', () => {
    const a = mk(); const b = mk();
    stroke(a.m, new StrokeEngine(a.m), 'clay', P, 30); stroke(b.m, new StrokeEngine(b.m), 'draw', P, 30);
    const va = nearest(a.m, top);
    expect(len(a.m, va)).toBeGreaterThan(1.01);
    expect(len(a.m, va)).toBeLessThan(len(b.m, nearest(b.m, top)));
  });
  it('Smooth reduces local roughness of noisy geometry', () => {
    const { m } = mk(); const e = new StrokeEngine(m);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const ids: number[] = []; for (let v = 0; v < m.vertCount; v++) if (m.pos[v * 3 + 1] > 0.9) { ids.push(v); for (let k = 0; k < 3; k++) m.pos[v * 3 + k] += rnd() * 0.04; }
    e.invalidate(); const r0 = roughness(m, ids);
    stroke(m, e, 'smooth', { ...P, strength: 1 }, 8);
    expect(roughness(m, ids)).toBeLessThan(r0 * 0.6);
  });
  it('Grab translates the captured centre by the cursor delta', () => {
    const { m } = mk(); const e = new StrokeEngine(m); const v = nearest(m, top);
    const y0 = m.pos[v * 3 + 1];
    e.begin('grab'); e.grabBegin([m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]], P); e.grabMove([0, 0.3, 0]); e.end(() => {});
    expect(m.pos[v * 3 + 1] - y0).toBeGreaterThan(0.29);
  });
  it('Flatten reduces the distance of the patch from its average plane', () => {
    const { m } = mk(); const e = new StrokeEngine(m);
    const ids: number[] = []; for (let v = 0; v < m.vertCount; v++) if (m.pos[v * 3 + 1] > 0.97) ids.push(v);
    const spread = () => { const ys = ids.map(v => m.pos[v * 3 + 1]); return Math.max(...ys) - Math.min(...ys); };
    const s0 = spread(); stroke(m, e, 'flatten', { ...P, strength: 1 }, 10);
    expect(spread()).toBeLessThan(s0 * 0.5);
  });
  it('Pinch pulls neighbours tangentially toward the stroke centre', () => {
    const { m } = mk(); const e = new StrokeEngine(m); const v = nearest(m, [0.15, 0.99, 0]);
    const x0 = m.pos[v * 3]; stroke(m, e, 'pinch');
    expect(m.pos[v * 3]).toBeLessThan(x0 * 0.9);
  });
  it('Crease pinches AND cuts below the surface (distinct from Pinch)', () => {
    const a = mk(); const b = mk();
    stroke(a.m, new StrokeEngine(a.m), 'crease'); stroke(b.m, new StrokeEngine(b.m), 'pinch');
    expect(len(a.m, nearest(a.m, top))).toBeLessThan(len(b.m, nearest(b.m, top)) - 0.005);
  });
  it('all brushes produce pairwise-distinct results from the same input', () => {
    const tools: BrushId[] = ['draw', 'inflate', 'clay', 'smooth', 'flatten', 'pinch', 'crease'];
    const hashes = tools.map(t => { const { m } = mk(12); stroke(m, new StrokeEngine(m), t); return hashBytes(m.pos); });
    expect(new Set(hashes).size).toBe(tools.length);
  });
});

describe('symmetry, mask, transactions', () => {
  it('X symmetry produces mirrored displacement', () => {
    const { m } = mk(); const e = new StrokeEngine(m);
    const c: Vec3 = [0.6, 0.8, 0]; stroke(m, e, 'draw', { ...P, symmetry: { x: true, y: false, z: false } }, 4, c);
    const a = nearest(m, c), b = nearest(m, [-0.6, 0.8, 0]);
    expect(len(m, a)).toBeGreaterThan(1.03);
    expect(Math.abs(len(m, a) - len(m, b))).toBeLessThan(1e-3);
  });
  it('masked vertices do not move', () => {
    const { m } = mk(); const e = new StrokeEngine(m); const v = nearest(m, top);
    stroke(m, e, 'mask', { ...P, strength: 1 }, 4);
    expect(m.mask[v]).toBeGreaterThan(0.99);
    const before = len(m, v); stroke(m, e, 'draw');
    expect(Math.abs(len(m, v) - before)).toBeLessThan(1e-4);
  });
  it('cancel restores exact bytes; undo/redo are exact', () => {
    const { m } = mk(); const e = new StrokeEngine(m); const h = new History();
    const h0 = hashBytes(m.pos);
    e.begin('draw'); e.dab(top, P); e.dab(top, P); e.cancel();
    expect(hashBytes(m.pos)).toBe(h0);
    h.push(stroke(m, e, 'draw')); const h1 = hashBytes(m.pos);
    h.push(stroke(m, e, 'inflate')); const h2 = hashBytes(m.pos);
    expect(h1).not.toBe(h0); expect(h2).not.toBe(h1);
    h.undo(); expect(hashBytes(m.pos)).toBe(h1);
    h.undo(); expect(hashBytes(m.pos)).toBe(h0);
    h.redo(); h.redo(); expect(hashBytes(m.pos)).toBe(h2);
  });
  it('a no-op stroke creates no history entry', () => {
    const { m } = mk(); const e = new StrokeEngine(m);
    e.begin('draw'); expect(e.end(() => {})).toBeNull();
  });
  it('render sync propagates welded edits to all duplicated render vertices', () => {
    const { raw } = mk(8);
    const soup = new Float32Array(raw.index.length * 3);
    for (let i = 0; i < raw.index.length; i++) for (let k = 0; k < 3; k++) soup[i * 3 + k] = raw.positions[raw.index[i] * 3 + k];
    const m = buildSculptMesh(soup, null); stroke(m, new StrokeEngine(m), 'draw', { ...P, radius: 0.6 });
    const rp = new Float32Array(soup.length); syncAllRender(m, rp, null);
    const reb = buildSculptMesh(rp, null);
    expect(reb.vertCount).toBe(m.vertCount); // no tears
  });
});

describe('maxPositionDelta fixture', () => {
  it('deterministic recipe reproduces the recorded fingerprint', async () => {
    const fx = (await import('../fixtures/stroke-recipe.json')).default as any;
    const raw = quadSphere(fx.sphereRes, 1); const m = buildSculptMesh(raw.positions, raw.index); const orig = m.pos.slice();
    const e = new StrokeEngine(m);
    for (const s of fx.strokes) { e.begin(s.tool); for (const c of s.dabs) { const ch = e.dab(c, { ...s.params }); recomputeNormalsFor(m, ch); } e.end(ids => recomputeNormalsFor(m, ids)); }
    const d = maxPositionDelta(orig, m.pos);
    expect(d).toBeGreaterThan(fx.expect.minMaxPositionDelta);
    expect(Math.abs(d - fx.expect.maxPositionDelta)).toBeLessThan(fx.expect.tolerance);
  });
});
