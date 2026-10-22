/** Interchange import/export (browser): GLB/glTF, OBJ, STL via Three.js loaders/exporters. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

export type ImportKind = 'glb' | 'gltf' | 'obj' | 'stl';
export const IMPORT_ACCEPT = '.glb,.gltf,.obj,.stl';
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

export function kindOf(name: string): ImportKind | null {
  const e = name.toLowerCase().split('.').pop();
  return e === 'glb' || e === 'gltf' || e === 'obj' || e === 'stl' ? e : null;
}

export interface ImportResult { root: THREE.Object3D; warnings: string[] }

/** Normalise any geometry into Float32 position/normal (+uv) with a Uint32 index. Interleaved/quantized attributes are expanded. */
export function normaliseGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos = g.getAttribute('position');
  if (!pos) throw new Error('mesh has no POSITION attribute');
  const n = pos.count;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const uv = g.getAttribute('uv');
  if (uv) { const U = new Float32Array(n * 2); for (let i = 0; i < n; i++) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i); } out.setAttribute('uv', new THREE.BufferAttribute(U, 2)); }
  const idx = g.getIndex();
  let I: Uint32Array;
  if (idx) { I = new Uint32Array(idx.count); for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i); }
  else { I = new Uint32Array(n); for (let i = 0; i < n; i++) I[i] = i; }
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  return out;
}

export async function importFile(name: string, data: ArrayBuffer): Promise<ImportResult> {
  const kind = kindOf(name);
  const warnings: string[] = [];
  if (!kind) throw new Error(`Unsupported file type: ${name} (use GLB, glTF, OBJ or STL)`);
  if (data.byteLength > MAX_IMPORT_BYTES) throw new Error('File exceeds 512 MB import limit');
  if (data.byteLength === 0) throw new Error('File is empty');
  let root: THREE.Object3D;
  if (kind === 'glb' || kind === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((res, rej) => loader.parse(data, '', res, (e: unknown) => rej(new Error('glTF parse failed: ' + ((e as Error)?.message ?? e)))));
    root = gltf.scene;
    if (gltf.animations?.length) warnings.push(`${gltf.animations.length} animation(s) ignored`);
    if (kind === 'gltf') warnings.push('.gltf with external .bin/textures: only embedded (data URI) resources load from a single file');
  } else if (kind === 'obj') {
    root = new OBJLoader().parse(new TextDecoder().decode(data));
  } else {
    const g = new STLLoader().parse(data);
    root = new THREE.Group();
    root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
  }
  let meshes = 0;
  root.traverse(o => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) warnings.push(`${o.name || 'skinned mesh'}: skinning ignored for sculpting (bind pose used)`);
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      if (m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) warnings.push(`${m.name || 'mesh'}: morph targets dropped`);
      m.geometry = normaliseGeometry(m.geometry);
      meshes++;
    }
    if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine) warnings.push(`${o.name || o.type}: non-triangle primitive skipped`);
  });
  if (!meshes) throw new Error('No triangle meshes found in file');
  return { root, warnings };
}

export async function exportGLB(root: THREE.Object3D): Promise<ArrayBuffer> {
  const res = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  return res as ArrayBuffer;
}
export function exportOBJ(root: THREE.Object3D): string { return new OBJExporter().parse(root); }
export function exportSTL(root: THREE.Object3D): ArrayBuffer {
  const dv = new STLExporter().parse(root, { binary: true }) as unknown as DataView;
  return dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength) as ArrayBuffer;
}
