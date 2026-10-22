/** Procedural base meshes (pure). Quad-sphere gives near-uniform triangles: tris = 12·N². */
export interface RawMesh { positions: Float32Array; index: Uint32Array; normals?: Float32Array; uvs?: Float32Array }

export function quadSphere(N: number, radius = 1): RawMesh {
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const verts = new Map<string, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  const S = 1e6;
  const vid = (x: number, y: number, z: number) => {
    // spherify (cube->sphere mapping with better uniformity)
    const x2 = x * x, y2 = y * y, z2 = z * z;
    const sx = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
    const sy = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
    const sz = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
    const key = Math.round(x * S) + ',' + Math.round(y * S) + ',' + Math.round(z * S);
    let id = verts.get(key);
    if (id === undefined) { id = pos.length / 3; verts.set(key, id); pos.push(sx * radius, sy * radius, sz * radius); }
    return id;
  };
  for (const [n, u, v] of faces) {
    const grid: number[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const a = (i / N) * 2 - 1, b = (j / N) * 2 - 1;
      grid.push(vid(n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b));
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = grid[j * (N + 1) + i], b = grid[j * (N + 1) + i + 1];
      const c = grid[(j + 1) * (N + 1) + i], d = grid[(j + 1) * (N + 1) + i + 1];
      idx.push(a, b, d, a, d, c);
    }
  }
  const positions = new Float32Array(pos);
  const index = new Uint32Array(idx);
  // make winding outward-facing: check first triangle
  fixWinding(positions, index);
  return { positions, index };
}

function fixWinding(p: Float32Array, idx: Uint32Array) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const d = n[0] * (p[a] + p[b] + p[c]) + n[1] * (p[a + 1] + p[b + 1] + p[c + 1]) + n[2] * (p[a + 2] + p[b + 2] + p[c + 2]);
    if (d < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
}

/** Resolution that yields approximately `tris` triangles. */
export function quadSphereResForTris(tris: number) { return Math.max(2, Math.round(Math.sqrt(tris / 12))); }
