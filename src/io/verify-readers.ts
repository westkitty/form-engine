/**
 * Minimal, dependency-free readers used ONLY for independent verification of
 * exported files (they do not share code with the Three.js exporters).
 */
export interface GlbMeshInfo { name?: string; positions: Float32Array; indexCount: number; hasNormals: boolean; hasUV: boolean; vertexCount: number }

export function readGlb(buf: ArrayBuffer): { json: any; meshes: GlbMeshInfo[] } {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  if (dv.getUint32(4, true) !== 2) throw new Error('unsupported glTF version');
  const total = dv.getUint32(8, true);
  if (total !== buf.byteLength) throw new Error(`GLB length mismatch ${total} vs ${buf.byteLength}`);
  let off = 12; let json: any = null; let bin: ArrayBuffer | null = null;
  while (off < total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB missing JSON chunk');
  const acc = (i: number): Float32Array => {
    const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126) throw new Error('POSITION not float');
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type as string]!;
    const stride = bv.byteStride ?? comps * 4;
    const out = new Float32Array(a.count * comps);
    const d = new DataView(bin!, (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
    for (let k = 0; k < a.count; k++) for (let c = 0; c < comps; c++) out[k * comps + c] = d.getFloat32(k * stride + c * 4, true);
    return out;
  };
  const meshes: GlbMeshInfo[] = [];
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    const positions = acc(p.attributes.POSITION);
    meshes.push({ name: m.name, positions, vertexCount: positions.length / 3, indexCount: p.indices !== undefined ? json.accessors[p.indices].count : 0, hasNormals: p.attributes.NORMAL !== undefined, hasUV: p.attributes.TEXCOORD_0 !== undefined });
  }
  return { json, meshes };
}

export function readBinaryStl(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf); const n = dv.getUint32(80, true);
  if (84 + n * 50 !== buf.byteLength) throw new Error('not a binary STL');
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
  return out;
}

export function readObjVertices(text: string): Float32Array {
  const v: number[] = [];
  for (const line of text.split('\n')) if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
  return new Float32Array(v);
}
