/**
 * Native project format (.formengine): a ZIP container (fflate) holding
 *   manifest.json        scene graph, transforms, materials, camera, integrity table
 *   meshes/<id>.bin      lossless geometry: render positions, normals, uvs, index, per-vertex mask
 *   images/<id>.<ext>    reference images (stay local; never uploaded)
 * Every payload file is fingerprinted (FNV-1a 32 + byte length) in manifest.integrity
 * and verified on load, so a truncated or tampered file is rejected, never half-loaded.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { hashBytes } from '../core/topology';

export const PROJECT_FORMAT = 'formengine';
export const PROJECT_VERSION = 1;

export interface MeshData { positions: Float32Array; normals?: Float32Array; uvs?: Float32Array; index?: Uint32Array; mask?: Float32Array }
export interface NodeData {
  id: string; name: string; parent: string | null; kind: 'mesh' | 'group' | 'refplane';
  position: number[]; quaternion: number[]; scale: number[]; visible: boolean;
  material?: { color: string; roughness: number; metalness: number };
  mesh?: MeshData;
  image?: { mime: string; bytes: Uint8Array; opacity: number; aspect: number };
}
export interface ProjectData { name: string; nodes: NodeData[]; camera?: { position: number[]; target: number[] }; settings?: Record<string, unknown>; savedAt?: string; appVersion?: string }

const MAGIC = 0x534d4546; // 'FEMS'

function encodeMesh(m: MeshData): Uint8Array {
  const n = m.positions.length / 3;
  const flags = (m.normals ? 1 : 0) | (m.uvs ? 2 : 0) | (m.index ? 4 : 0) | (m.mask ? 8 : 0);
  const idxN = m.index ? m.index.length : 0;
  const size = 20 + n * 12 + (m.normals ? n * 12 : 0) + (m.uvs ? n * 8 : 0) + idxN * 4 + (m.mask ? n * 4 : 0);
  const out = new Uint8Array(size); const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, 1, true); dv.setUint32(8, n, true); dv.setUint32(12, idxN, true); dv.setUint32(16, flags, true);
  let o = 20;
  const put = (a: Float32Array | Uint32Array) => { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += a.byteLength; };
  put(m.positions); if (m.normals) put(m.normals); if (m.uvs) put(m.uvs); if (m.index) put(m.index); if (m.mask) put(m.mask);
  return out;
}

function decodeMesh(b: Uint8Array): MeshData {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new ProjectError('mesh payload has bad magic');
  const n = dv.getUint32(8, true), idxN = dv.getUint32(12, true), flags = dv.getUint32(16, true);
  const copy = b.slice(20); let o = 0;
  const take = <T extends Float32Array | Uint32Array>(C: { new(buf: ArrayBuffer, off: number, len: number): T }, count: number) => { const t = new C(copy.buffer, o, count); o += count * 4; return t.slice() as T; };
  const expected = n * 12 + (flags & 1 ? n * 12 : 0) + (flags & 2 ? n * 8 : 0) + (flags & 4 ? idxN * 4 : 0) + (flags & 8 ? n * 4 : 0);
  if (copy.byteLength !== expected) throw new ProjectError('mesh payload length mismatch');
  const m: MeshData = { positions: take(Float32Array, n * 3) };
  if (flags & 1) m.normals = take(Float32Array, n * 3);
  if (flags & 2) m.uvs = take(Float32Array, n * 2);
  if (flags & 4) m.index = take(Uint32Array, idxN);
  if (flags & 8) m.mask = take(Float32Array, n);
  return m;
}

export class ProjectError extends Error {}

export function serializeProject(p: ProjectData): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const integrity: Record<string, { fnv: string; bytes: number }> = {};
  const nodes = p.nodes.map(n => {
    const { mesh, image, ...rest } = n;
    const out: any = { ...rest };
    if (mesh) { const path = `meshes/${n.id}.bin`; files[path] = encodeMesh(mesh); out.mesh = path; }
    if (image) {
      const ext = image.mime.split('/')[1] ?? 'bin'; const path = `images/${n.id}.${ext}`;
      files[path] = image.bytes; out.image = { path, mime: image.mime, opacity: image.opacity, aspect: image.aspect };
    }
    return out;
  });
  for (const [k, v] of Object.entries(files)) integrity[k] = { fnv: hashBytes(v), bytes: v.byteLength };
  const manifest = { format: PROJECT_FORMAT, formatVersion: PROJECT_VERSION, name: p.name, appVersion: p.appVersion ?? '0.1.0', savedAt: p.savedAt ?? new Date().toISOString(), camera: p.camera, settings: p.settings ?? {}, nodes, integrity };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  return zipSync(files, { level: 6 });
}

export function deserializeProject(bytes: Uint8Array): ProjectData {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch (e) { throw new ProjectError('not a valid .formengine container: ' + (e as Error).message); }
  const mf = files['manifest.json'];
  if (!mf) throw new ProjectError('manifest.json missing');
  let manifest: any;
  try { manifest = JSON.parse(strFromU8(mf)); } catch { throw new ProjectError('manifest.json is not valid JSON'); }
  if (manifest.format !== PROJECT_FORMAT) throw new ProjectError('not a FORM//ENGINE project');
  if (manifest.formatVersion > PROJECT_VERSION) throw new ProjectError(`project version ${manifest.formatVersion} is newer than this app supports (${PROJECT_VERSION})`);
  for (const [path, info] of Object.entries<any>(manifest.integrity ?? {})) {
    const f = files[path];
    if (!f) throw new ProjectError(`payload missing: ${path}`);
    if (f.byteLength !== info.bytes || hashBytes(f) !== info.fnv) throw new ProjectError(`integrity check failed: ${path}`);
  }
  const nodes: NodeData[] = manifest.nodes.map((n: any) => {
    const out: NodeData = { ...n, mesh: undefined, image: undefined };
    if (n.mesh) out.mesh = decodeMesh(files[n.mesh]);
    if (n.image) out.image = { mime: n.image.mime, bytes: files[n.image.path], opacity: n.image.opacity, aspect: n.image.aspect };
    return out;
  });
  return { name: manifest.name, nodes, camera: manifest.camera, settings: manifest.settings, savedAt: manifest.savedAt, appVersion: manifest.appVersion };
}
