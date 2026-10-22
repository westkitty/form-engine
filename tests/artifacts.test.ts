import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { readGlb } from '../src/io/verify-readers';
import { deserializeProject } from '../src/io/project';
import { quadSphere } from '../src/core/primitives';
import { maxPositionDelta } from '../src/core/topology';

const buf = (p: string) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

describe('shipped sample artifacts', () => {
  it('artifacts/sample-deformed.glb is a valid GLB whose vertices were really sculpted', () => {
    const g = readGlb(buf('artifacts/sample-deformed.glb'));
    expect(g.json.asset.generator).toMatch(/THREE\.GLTFExporter/);
    const m = g.meshes[0];
    expect(m.indexCount / 3).toBe(49152);
    expect(m.hasNormals).toBe(true);
    const base = quadSphere(64, 1).positions;
    const d = maxPositionDelta(base, m.positions);
    expect(d).toBeGreaterThan(0.02);   // deformed
    expect(d).toBeLessThan(1.0);       // not garbage
    console.log('sample-deformed.glb maxPositionDelta vs base sphere =', d.toFixed(6));
  });
  it('artifacts/sample-project.formengine opens with hierarchy, transform and mask', () => {
    const p = deserializeProject(new Uint8Array(buf('artifacts/sample-project.formengine')));
    const mesh = p.nodes.find(n => n.kind === 'mesh')!;
    const group = p.nodes.find(n => n.kind === 'group')!;
    expect(mesh.parent).toBe(group.id);
    expect(mesh.mesh!.mask!.some(v => v > 0.5)).toBe(true);
    expect(maxPositionDelta(quadSphere(64, 1).positions, mesh.mesh!.positions)).toBeGreaterThan(0.01);
  });
});
