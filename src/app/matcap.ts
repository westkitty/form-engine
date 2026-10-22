import * as THREE from 'three';
/** Procedural clay matcap (no external asset): warm-neutral key, cool rim, soft cavity falloff. */
export function makeClayMatcap(size = 256): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const L = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
  const R = new THREE.Vector3(0.7, -0.2, 0.2).normalize();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x / (size - 1)) * 2 - 1, ny = 1 - (y / (size - 1)) * 2;
    const r2 = nx * nx + ny * ny; const i = (y * size + x) * 4;
    if (r2 > 1) { img.data[i + 3] = 255; continue; }
    const nz = Math.sqrt(1 - r2);
    const d = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
    const spec = Math.pow(Math.max(0, d), 40) * 0.18;
    const rim = Math.pow(1 - nz, 3) * Math.max(0, nx * R.x + ny * R.y) * 0.5;
    const base = 0.22 + 0.66 * Math.pow(d, 1.0);
    img.data[i] = Math.min(255, (base * 0.86 + spec + rim * 0.55) * 255);
    img.data[i + 1] = Math.min(255, (base * 0.83 + spec + rim * 0.62) * 255);
    img.data[i + 2] = Math.min(255, (base * 0.78 + spec + rim * 0.75) * 255);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
