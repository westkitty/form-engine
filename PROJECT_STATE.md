# PROJECT_STATE — FORM//ENGINE

Updated 2026-10-22 00:30 ET (0.2.0: tablet/S Pen, installable app, simplified UI).

- Repo: https://github.com/westkitty/form-engine (PUBLIC), branch `main`. Live: https://westkitty.github.io/form-engine/ (GitHub Actions → Pages).
- Workspace: `/workspace/FORM_ENGINE` on the box.
- Dev server: `npx vite --host 127.0.0.1 --port 5180 --strictPort` (left running in the background). Production preview runs on :5181.

## Slices

1. Sphere, 8 brushes, symmetry, mask, transactions, cancel, undo/redo, GLB round-trip proof: **DONE**
2. GLB/glTF/OBJ/STL import, OBJ/STL export, `.formengine`, IndexedDB autosave and recovery, hierarchy and transforms: **DONE**
3. Image Lab (intake, crop, planes, slots), provider contract, Meshy adapter, proxy, MOCK, job machine: **DONE** (live Meshy UNVERIFIED)
4. BVH policy, HUD, benchmarks, context loss, 4 responsive layouts: **DONE** (SwiftShader numbers only)
5. README, FEATURE_MATRIX, RECONSTRUCTION_SETUP, builds, sample GLB and project, source ZIP: **DONE**
6. Public Pages deploy, with live e2e: **DONE**
7. 0.2.0: S Pen/touch pipeline (pressure, tilt, twist, hover, side button, eraser, palm rejection, pen-only navigation), adaptive DPR, PWA (manifest, icons, service worker, install, full screen), tablet-first UI (dock + single menu), critique, before/after screenshots: **DONE** (hardware UNVERIFIED)

## Resume

`npm install && npm test && npx playwright test`

## Known defects / limits

- An autosave started just before page navigation logs `AbortError: The connection was closed`. It's harmless, because the previous slot stays valid by design.
- Imported hard-edged meshes get smooth (welded) normals once they're sculpted.
- Draco/meshopt glTF isn't supported. A `.gltf` with external .bin or textures doesn't resolve from a single-file pick.
- Skinning and morph targets are dropped when importing for sculpting.
- No dynamic topology, remeshing or multires: the vertex count is fixed per mesh.
- The JS bundle is about 1.0 MB (about 275 kB gzip), in a single chunk. The service worker precaches it, so later launches are offline-capable.
- Pen behaviour is tuned from the Pointer Events spec and Chrome's documented S Pen mapping (barrel = buttons 2, eraser = buttons 32). It hasn't been tried on a real S Pen. If the side button arrives as a contextmenu-only event on some firmware, it's suppressed but won't invert.
- With a finger stroke in progress (no pen mode), a second finger cancels the stroke, but OrbitControls only sees the second finger, so that gesture rotates rather than pinches.
- Per-dab cost at 500k tris has a p95 of about 26 ms (CPU). A worker/SIMD path isn't implemented.

## Pending owner approvals

- Any live Meshy job: needs a key/proxy, credits, and uploading images to Meshy.
