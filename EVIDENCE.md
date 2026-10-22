# EVIDENCE — 2026-10-21 (America/Detroit)

Environment: Debian 13 cloud VM (box), 8 vCPU, 15 GB RAM, **no GPU**. Node 20.19.2, npm 11.21. Headless Chrome 155.0.8059.84 through Playwright 1.64.1. WebGL2 runs on ANGLE → Vulkan → **SwiftShader** (software).

## Commands and results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` (Vitest 4.1.12) | **31/31 passed** (4 files: core 19, project 4, recon 6, artifacts 2) |
| `npx playwright test` (dev server) | **18/18 passed** (sculpt 11, imagelab 2, responsive 4, bench 1) |
| `FORM_E2E_BASE=http://127.0.0.1:5181 npx playwright test e2e/sculpt.spec.ts e2e/imagelab.spec.ts e2e/responsive.spec.ts` (production `vite preview`) | **17/17 passed** |
| Pages profile served at `/form-engine/`: `-g "boots\|GLB export"` | **2/2 passed** |
| `node tools/meshy-proxy.mjs` route guards (fake key, no upstream call) | OPTIONS 204 · unknown route 404 · foreign asset host 400 · CORS origin pinned |

The detailed per-test numbers are in `artifacts/evidence/e2e-results.json`, written by the most recent run.

## Key measured facts

- Sculpt proof: a quad sphere with 49,152 tris was sculpted with real mouse strokes (Draw + Crease). The maxPositionDelta from the base sphere is **0.0842**. The exported GLB, parsed by an independent reader (`src/io/verify-readers.ts`), differs from the in-app positions by **0**. After re-import the delta is **0**, and the re-imported mesh accepts new strokes.
- The unit fixture `fixtures/stroke-recipe.json` reproduces maxPositionDelta **0.0484841** (tolerance 1e-5).
- `artifacts/sample-deformed.glb` measures maxPositionDelta **0.084199** from `quadSphere(64)` (`tests/artifacts.test.ts`).

## Performance (SwiftShader software rendering, 1440×900, `npm run bench`)

| Tris | rAF frame p50/p95 ms | render+sync p50/p95 ms | dab p50/p95 ms | BVH refit p50/p95 ms | BVH build ms | GLB export ms |
|---|---|---|---|---|---|---|
| 10,092 | 16.7 / 16.8 (60 fps) | 11.7 / 36.9 | 0.10 / 0.30 | 0.40 / 0.70 | 2.6 | 17 |
| 99,372 | 50.0 / 83.3 (~20 fps) | 40.9 / 127.2 | 1.20 / 2.40 | 3.70 / 4.30 | 38.4 | 31 |
| 499,392 | 150 / 300 (~6.7 fps) | 146.9 / 452.4 | 12.1 / 26.0 | 18.3 / 20.6 | 164.9 | 130 |

The frame times above are bound by CPU rasterisation in SwiftShader, so they're a worst case. Numbers on a real GPU are **UNVERIFIED**. Rendering is on demand (idle costs nothing). Dab and refit costs are CPU-side and scale with the vertices touched and the mesh size.

## Screenshots (supporting only)

They're in `artifacts/evidence/`: `sculpt-crease-1440.png`, `layout-{1440x900,1024x768,768x1024,390x844}.png`, `imagelab-dialog.png`, `imagelab-refplanes.png` and `context-restored.png`.

## Not proven

- Live Meshy job: no key, no account was created, and no paid call was made.
- Physical pen and touch hardware.
- Real-GPU performance.
- `.gltf` with external resources.
- Gizmo drag automation (numeric transform editing is proven).
