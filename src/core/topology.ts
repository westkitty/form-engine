/**
 * FORM//ENGINE geometry core — pure data, no DOM, no Three.js.
 * A SculptMesh separates the *render* vertex layout (which may duplicate a
 * position across UV/normal seams) from the *sculpt* (welded, unique) vertex
 * space that brushes operate on. Edits on unique vertices are written back to
 * every duplicated render vertex, so seams never tear and UVs are preserved.
 */
export interface SculptMesh {
  vertCount: number;
  triCount: number;
  /** unique positions xyz */
  pos: Float32Array;
  /** unique vertex normals xyz (normalized) */
  nrm: Float32Array;
  /** mask 0..1 per unique vertex (1 = fully frozen) */
  mask: Float32Array;
  /** triangles in unique index space */
  tris: Uint32Array;
  /** unnormalized (area-weighted) triangle normals */
  triNrm: Float32Array;
  /** render vertex -> unique vertex */
  renderToUniq: Uint32Array;
  renderCount: number;
  /** CSR unique -> render vertices */
  uniqRenderStart: Uint32Array;
  uniqRenderList: Uint32Array;
  /** CSR unique -> neighbour unique vertices */
  nbrStart: Uint32Array;
  nbrList: Uint32Array;
  /** CSR unique -> incident triangles */
  vtStart: Uint32Array;
  vtList: Uint32Array;
  /** scratch stamps for de-duplication */
  stamp: Uint32Array;
  stampId: number;
  /** mean edge length at build time (used for grid cell sizing) */
  meanEdge: number;
}

export function nextStamp(m: SculptMesh): number {
  m.stampId++;
  if (m.stampId >= 0xfffffff0) { m.stamp.fill(0); m.stampId = 1; }
  return m.stampId;
}

/**
 * Build a SculptMesh from render positions (+ optional index). Vertices whose
 * positions coincide within `weldEps` (relative to bbox diagonal) are welded.
 */
export function buildSculptMesh(renderPos: Float32Array, renderIndex: ArrayLike<number> | null, weldRel = 1e-6): SculptMesh {
  const renderCount = renderPos.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < renderCount; i++) {
    const x = renderPos[i * 3], y = renderPos[i * 3 + 1], z = renderPos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const eps = diag * weldRel;
  const inv = 1 / eps;
  const map = new Map<string, number>();
  const renderToUniq = new Uint32Array(renderCount);
  const uniqPosTmp: number[] = [];
  let u = 0;
  for (let i = 0; i < renderCount; i++) {
    const x = renderPos[i * 3], y = renderPos[i * 3 + 1], z = renderPos[i * 3 + 2];
    const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let id = map.get(key);
    if (id === undefined) { id = u++; map.set(key, id); uniqPosTmp.push(x, y, z); }
    renderToUniq[i] = id;
  }
  const vertCount = u;
  const pos = new Float32Array(uniqPosTmp);

  // triangles in unique space, dropping degenerate ones (collapsed by weld)
  const srcTriCount = renderIndex ? Math.floor(renderIndex.length / 3) : Math.floor(renderCount / 3);
  const trisTmp = new Uint32Array(srcTriCount * 3);
  let t = 0;
  for (let i = 0; i < srcTriCount; i++) {
    const r0 = renderIndex ? renderIndex[i * 3] : i * 3;
    const r1 = renderIndex ? renderIndex[i * 3 + 1] : i * 3 + 1;
    const r2 = renderIndex ? renderIndex[i * 3 + 2] : i * 3 + 2;
    const a = renderToUniq[r0], b = renderToUniq[r1], c = renderToUniq[r2];
    if (a === b || b === c || a === c) continue;
    trisTmp[t * 3] = a; trisTmp[t * 3 + 1] = b; trisTmp[t * 3 + 2] = c; t++;
  }
  const tris = trisTmp.slice(0, t * 3);
  const triCount = t;

  // unique -> render CSR
  const uniqRenderStart = new Uint32Array(vertCount + 1);
  for (let i = 0; i < renderCount; i++) uniqRenderStart[renderToUniq[i] + 1]++;
  for (let i = 0; i < vertCount; i++) uniqRenderStart[i + 1] += uniqRenderStart[i];
  const uniqRenderList = new Uint32Array(renderCount);
  const fill = uniqRenderStart.slice(0, vertCount);
  for (let i = 0; i < renderCount; i++) uniqRenderList[fill[renderToUniq[i]]++] = i;

  // vertex -> triangle CSR
  const vtStart = new Uint32Array(vertCount + 1);
  for (let i = 0; i < triCount * 3; i++) vtStart[tris[i] + 1]++;
  for (let i = 0; i < vertCount; i++) vtStart[i + 1] += vtStart[i];
  const vtList = new Uint32Array(triCount * 3);
  const vfill = vtStart.slice(0, vertCount);
  for (let i = 0; i < triCount; i++) for (let k = 0; k < 3; k++) vtList[vfill[tris[i * 3 + k]]++] = i;

  // neighbour CSR via per-vertex dedupe using stamps
  const stamp = new Uint32Array(vertCount);
  const nbrStart = new Uint32Array(vertCount + 1);
  const nbrTmp: number[] = [];
  let sid = 0;
  let edgeSum = 0, edgeN = 0;
  for (let v = 0; v < vertCount; v++) {
    sid++;
    stamp[v] = sid;
    for (let j = vtStart[v]; j < vtStart[v + 1]; j++) {
      const tri = vtList[j];
      for (let k = 0; k < 3; k++) {
        const w = tris[tri * 3 + k];
        if (stamp[w] !== sid) {
          stamp[w] = sid; nbrTmp.push(w);
          if (w > v) {
            edgeSum += Math.hypot(pos[w * 3] - pos[v * 3], pos[w * 3 + 1] - pos[v * 3 + 1], pos[w * 3 + 2] - pos[v * 3 + 2]);
            edgeN++;
          }
        }
      }
    }
    nbrStart[v + 1] = nbrTmp.length;
  }
  const nbrList = new Uint32Array(nbrTmp);
  stamp.fill(0);

  const m: SculptMesh = {
    vertCount, triCount, pos, nrm: new Float32Array(vertCount * 3), mask: new Float32Array(vertCount),
    tris, triNrm: new Float32Array(triCount * 3), renderToUniq, renderCount,
    uniqRenderStart, uniqRenderList, nbrStart, nbrList, vtStart, vtList,
    stamp, stampId: 0, meanEdge: edgeN ? edgeSum / edgeN : diag * 0.01,
  };
  recomputeAllNormals(m);
  return m;
}

function triNormal(m: SculptMesh, t: number) {
  const p = m.pos, tr = m.tris, n = m.triNrm;
  const a = tr[t * 3] * 3, b = tr[t * 3 + 1] * 3, c = tr[t * 3 + 2] * 3;
  const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
  n[t * 3] = e1y * e2z - e1z * e2y;
  n[t * 3 + 1] = e1z * e2x - e1x * e2z;
  n[t * 3 + 2] = e1x * e2y - e1y * e2x;
}

function vertNormal(m: SculptMesh, v: number) {
  let x = 0, y = 0, z = 0;
  for (let j = m.vtStart[v]; j < m.vtStart[v + 1]; j++) {
    const t = m.vtList[j] * 3;
    x += m.triNrm[t]; y += m.triNrm[t + 1]; z += m.triNrm[t + 2];
  }
  const l = Math.hypot(x, y, z) || 1;
  m.nrm[v * 3] = x / l; m.nrm[v * 3 + 1] = y / l; m.nrm[v * 3 + 2] = z / l;
}

export function recomputeAllNormals(m: SculptMesh) {
  for (let t = 0; t < m.triCount; t++) triNormal(m, t);
  for (let v = 0; v < m.vertCount; v++) vertNormal(m, v);
}

/** Recompute normals for triangles touching `verts`, then for every vertex of those triangles. */
export function recomputeNormalsFor(m: SculptMesh, verts: ArrayLike<number>, count = verts.length) {
  const triStamp = nextStamp(m);
  // stamp is per-vertex sized; use a separate pass for triangles via a local set when needed
  const triSeen = new Set<number>();
  const vSet: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = verts[i];
    for (let j = m.vtStart[v]; j < m.vtStart[v + 1]; j++) {
      const t = m.vtList[j];
      if (!triSeen.has(t)) {
        triSeen.add(t);
        triNormal(m, t);
        for (let k = 0; k < 3; k++) {
          const w = m.tris[t * 3 + k];
          if (m.stamp[w] !== triStamp) { m.stamp[w] = triStamp; vSet.push(w); }
        }
      }
    }
  }
  for (const v of vSet) vertNormal(m, v);
  return vSet;
}

/** Write unique positions/normals back into render arrays for the given unique vertices. Returns [minRender, maxRender]. */
export function syncRender(m: SculptMesh, verts: ArrayLike<number>, count: number, renderPos: Float32Array, renderNrm: Float32Array | null): [number, number] {
  let lo = Infinity, hi = -1;
  for (let i = 0; i < count; i++) {
    const v = verts[i];
    const px = m.pos[v * 3], py = m.pos[v * 3 + 1], pz = m.pos[v * 3 + 2];
    const nx = m.nrm[v * 3], ny = m.nrm[v * 3 + 1], nz = m.nrm[v * 3 + 2];
    for (let j = m.uniqRenderStart[v]; j < m.uniqRenderStart[v + 1]; j++) {
      const r = m.uniqRenderList[j];
      renderPos[r * 3] = px; renderPos[r * 3 + 1] = py; renderPos[r * 3 + 2] = pz;
      if (renderNrm) { renderNrm[r * 3] = nx; renderNrm[r * 3 + 1] = ny; renderNrm[r * 3 + 2] = nz; }
      if (r < lo) lo = r; if (r > hi) hi = r;
    }
  }
  return [lo, hi];
}

export function syncAllRender(m: SculptMesh, renderPos: Float32Array, renderNrm: Float32Array | null) {
  for (let r = 0; r < m.renderCount; r++) {
    const v = m.renderToUniq[r];
    renderPos[r * 3] = m.pos[v * 3]; renderPos[r * 3 + 1] = m.pos[v * 3 + 1]; renderPos[r * 3 + 2] = m.pos[v * 3 + 2];
    if (renderNrm) { renderNrm[r * 3] = m.nrm[v * 3]; renderNrm[r * 3 + 1] = m.nrm[v * 3 + 1]; renderNrm[r * 3 + 2] = m.nrm[v * 3 + 2]; }
  }
}

export function maxPositionDelta(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    if (d > m) m = d;
  }
  return m;
}

/** FNV-1a over the raw bytes of a typed array — deterministic geometry fingerprint. */
export function hashBytes(arr: ArrayBufferView): string {
  const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
