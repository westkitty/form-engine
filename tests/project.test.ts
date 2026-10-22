import { describe, it, expect } from 'vitest';
import { serializeProject, deserializeProject, ProjectError, type ProjectData } from '../src/io/project';
import { quadSphere } from '../src/core/primitives';
import { hashBytes } from '../src/core/topology';

const sample = (): ProjectData => {
  const s = quadSphere(10);
  return { name: 'T', nodes: [
    { id: 'g1', name: 'Group', parent: null, kind: 'group', position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: true },
    { id: 'm1', name: 'Sphere', parent: 'g1', kind: 'mesh', position: [1, 2, 3], quaternion: [0, 0.7071, 0, 0.7071], scale: [2, 2, 2], visible: true,
      material: { color: '#b8b2a7', roughness: 0.6, metalness: 0 }, mesh: { positions: s.positions, index: s.index, mask: new Float32Array(s.positions.length / 3).fill(0.25) } },
    { id: 'r1', name: 'Ref', parent: null, kind: 'refplane', position: [0, 0, -2], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], visible: false,
      image: { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), opacity: 0.5, aspect: 1.5 } },
  ], camera: { position: [0, 1, 4], target: [0, 0, 0] } };
};

describe('.formengine project', () => {
  it('round-trips scene graph, transforms, geometry, mask and images losslessly', () => {
    const p = sample(); const out = deserializeProject(serializeProject(p));
    expect(out.nodes.map(n => n.id)).toEqual(['g1', 'm1', 'r1']);
    expect(out.nodes[1].parent).toBe('g1');
    expect(out.nodes[1].quaternion).toEqual([0, 0.7071, 0, 0.7071]);
    expect(hashBytes(out.nodes[1].mesh!.positions)).toBe(hashBytes(p.nodes[1].mesh!.positions));
    expect(hashBytes(out.nodes[1].mesh!.index!)).toBe(hashBytes(p.nodes[1].mesh!.index!));
    expect(out.nodes[1].mesh!.mask![5]).toBe(0.25);
    expect(Array.from(out.nodes[2].image!.bytes)).toEqual([137, 80, 78, 71, 1, 2, 3]);
    expect(out.nodes[2].visible).toBe(false);
    expect(out.camera?.position).toEqual([0, 1, 4]);
  });
  it('rejects a truncated file', () => {
    const b = serializeProject(sample());
    expect(() => deserializeProject(b.slice(0, b.length - 40))).toThrow(ProjectError);
  });
  it('rejects tampered payload via integrity table', async () => {
    const { unzipSync, zipSync } = await import('fflate');
    const files = unzipSync(serializeProject(sample()));
    files['meshes/m1.bin'][100] ^= 0xff;
    expect(() => deserializeProject(zipSync(files))).toThrow(/integrity/);
  });
  it('rejects foreign zip / future version', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    expect(() => deserializeProject(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/manifest/);
    expect(() => deserializeProject(zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'formengine', formatVersion: 99, nodes: [] })) }))).toThrow(/newer/);
  });
});
