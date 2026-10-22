# PROJECT_STATE — FORM//ENGINE

Updated 2026-10-21 22:20 ET.

- Repo: https://github.com/westkitty/form-engine (PRIVATE), branch `main`.
- Workspace: `/workspace/FORM_ENGINE` on the box.
- Dev server: `npx vite --host 127.0.0.1 --port 5180 --strictPort` (left running in the background). Production preview runs on :5181.

## Slices

1. Sphere, 8 brushes, symmetry, mask, transactions, cancel, undo/redo, GLB round-trip proof: **DONE**
2. GLB/glTF/OBJ/STL import, OBJ/STL export, `.formengine`, IndexedDB autosave and recovery, hierarchy and transforms: **DONE**
3. Image Lab (intake, crop, planes, slots), provider contract, Meshy adapter, proxy, MOCK, job machine: **DONE** (live Meshy UNVERIFIED)
4. BVH policy, HUD, benchmarks, context loss, 4 responsive layouts: **DONE** (SwiftShader numbers only)
5. README, FEATURE_MATRIX, RECONSTRUCTION_SETUP, builds, sample GLB and project, source ZIP: **DONE**

## Resume

`npm install && npm test && npx playwright test`

## Known defects / limits

- An autosave started just before page navigation logs `AbortError: The connection was closed`. It's harmless, because the previous slot stays valid by design.
- Imported hard-edged meshes get smooth (welded) normals once they're sculpted.
- Draco/meshopt glTF isn't supported. A `.gltf` with external .bin or textures doesn't resolve from a single-file pick.
- Skinning and morph targets are dropped when importing for sculpting.
- No dynamic topology, remeshing or multires: the vertex count is fixed per mesh.
- The JS bundle is about 1.0 MB (271 kB gzip), in a single chunk.
- Per-dab cost at 500k tris has a p95 of about 26 ms (CPU). A worker/SIMD path isn't implemented.

## Pending owner approvals

- Public deploy (GitHub Pages: copy `docs/pages-workflow.yml.example`, enable Pages, make the site public).
- Any live Meshy job: needs a key/proxy, credits, and uploading images to Meshy.
