# FORM//ENGINE

A browser 3D sculpting studio. You sculpt real vertices on a WebGL2 canvas, import and export GLB, glTF, OBJ and STL files, save native `.formengine` projects, and use an Image Lab with a provider-neutral image-to-3D pipeline.

Stack: Vite 8, TypeScript 6, Three.js r186 (WebGL2), three-mesh-bvh 0.9, and fflate. Tests use Vitest 4 and Playwright 1.64. All runtime dependencies are MIT-licensed.

## Run

```bash
npm install
npm run dev            # http://127.0.0.1:5180
npm test               # unit tests (Vitest)
npm run test:e2e       # browser tests (Playwright, headless Chromium + SwiftShader)
npm run bench          # 10k / 100k / 500k triangle benchmark → artifacts/evidence/bench.json
npm run build          # production build → dist/ (relative base, works from any folder)
npm run build:pages    # GitHub Pages profile → dist-pages/ (base /form-engine/, override with FORM_BASE)
```

Set `FORM_CHROME=/path/to/chrome` if Chrome isn't at `/usr/bin/google-chrome`. To run the e2e suite against a server that's already running, such as `npm run preview`, set `FORM_E2E_BASE=http://127.0.0.1:5181`.

## Using it

| Action | Input |
|---|---|
| Sculpt | Left-drag on the mesh. Dragging off the mesh orbits. Right-drag orbits, middle-drag pans, the wheel zooms |
| Brushes | `1` Draw · `2` Inflate · `3` Clay Build · `4` Smooth · `5` Grab · `6` Flatten · `7` Pinch · `8` Crease · `M` Mask |
| Modifiers | Shift smooths with any brush. Ctrl/Cmd inverts. `[` `]` change the radius. Esc cancels the live stroke exactly |
| History | Ctrl/Cmd Z to undo, Ctrl/Cmd Shift Z or Ctrl Y to redo |
| Transform | `S` Sculpt · `W` Move · `E` Rotate · `R` Scale (gizmo), or type values in the Inspector |
| Files | File menu: New, Open/Save project, Import model, Export GLB/OBJ/STL. You can also drag files onto the viewport |
| Touch/pen | One finger or the pen sculpts, and pen pressure scales strength. A second finger cancels the stroke and the gesture navigates instead |

## Architecture

```
src/core/      pure geometry. No DOM and no Three.js. Unit-tested in Node
  topology.ts  SculptMesh: render↔welded vertex mapping, CSR adjacency, incremental normals
  grid.ts      spatial hash for brush neighbourhoods (stale-safe via slack radius)
  brushes.ts   StrokeEngine: 8 brushes + mask, symmetry, grab capture
  history.ts   stroke transactions (touched-vertex before/after), bounded undo stack
src/io/        formats (Three.js loaders/exporters), .formengine container, IndexedDB autosave,
               independent verify-readers (GLB/STL/OBJ parsers used only for proof)
src/recon/     provider contract, job state machine, Meshy adapter, MOCK provider (tests only), runner
src/app/       viewport (renderer, controls, gizmo, frame stats, context loss), document model, sculpt tool
src/ui/        Image Lab
tools/         meshy-proxy.mjs (optional, user-run key-holding proxy)
```

Brushes run on a welded vertex space, and each change is written back to every duplicate render vertex. That keeps UV seams and hard-edge splits from tearing, and imported UVs and materials survive export.

BVH policy: the BVH is refit once per frame while a stroke is dirty. It's fully rebuilt when the topology changes, when one stroke moves more than 15% of the bounding radius, or after 400 refits.

## Status

See [FEATURE_MATRIX.md](FEATURE_MATRIX.md), [EVIDENCE.md](EVIDENCE.md) and [PROJECT_STATE.md](PROJECT_STATE.md). Live image-to-3D is **UNVERIFIED** because no provider key was used. Setup is in [RECONSTRUCTION_SETUP.md](RECONSTRUCTION_SETUP.md).

## Deploying (not published)

`npm run build:pages` produces a static site for `https://<user>.github.io/form-engine/`. A ready-to-use workflow is in `docs/pages-workflow.yml.example`. It's deliberately **not** in `.github/workflows/`, and publishing needs the owner's approval. Status: **READY-NOT-PUBLISHED**.
