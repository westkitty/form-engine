# FEATURE MATRIX — FORM//ENGINE 0.1.0 (2026-10-21)

PASS means an executed, reproducible check exists (the command is named). UNVERIFIED means the runtime, service or hardware wasn't available. Screenshots are supporting evidence only.

| Area | Feature | Status | Proof |
|---|---|---|---|
| Viewport | WebGL2 canvas, orbit, pan, zoom, framing, matcap clay shading | PASS | e2e `boots…`, real mouse strokes in every sculpt test |
| Sculpt | Draw, Inflate, Clay Build, Smooth, Grab, Flatten, Pinch, Crease (8), each distinct | PASS | `tests/core.test.ts` (per-brush geometric assertions + pairwise-distinct hashes); e2e `every brush…` (real pointer strokes, 8 distinct hashes) |
| Sculpt | Symmetry X/Y/Z | PASS | unit + e2e: mirrored displacement diff 2.3e-8 |
| Sculpt | Mask paint/erase/clear/invert, masked verts frozen | PASS | unit + e2e: masked vertex move 0 |
| Sculpt | Stroke transactions, Esc cancel byte-exact, undo/redo byte-exact | PASS | unit + e2e `Esc cancels…` (FNV hash equality) |
| Sculpt | Pen pressure | PASS (SIMULATED) | e2e: synthetic `pointerType:'pen'` events; pressure 0.2 gives 0.0135 vs 1.0 gives 0.0668 max delta. No physical pen |
| Sculpt | Touch stroke / second finger cancels | PASS (SIMULATED) | e2e synthetic touch PointerEvents. No physical device |
| Interchange | GLB export → independent parse → re-import → sculpt again | PASS | e2e: exported vs in-app delta 0, re-import delta 0, re-imported mesh edits |
| Interchange | OBJ export/import, STL (binary) export/import with welding | PASS | e2e: OBJ delta 0; STL 98,304 tris welded to 25,430 verts (25,447 distinct; tolerance 1e-6·diag) |
| Interchange | glTF (.gltf) with embedded data URIs | Implemented, UNVERIFIED | no .gltf fixture tested; external .bin/texture files are not resolved from a single-file pick |
| Interchange | Draco / meshopt-compressed glTF | NOT SUPPORTED | no decoder bundled; the import fails with a message |
| Interchange | Skinned/morph meshes | Partial | bind pose is sculpted; skin and morphs are dropped with a warning |
| Project | `.formengine` (ZIP: manifest + lossless mesh bins + images + integrity table) | PASS | `tests/project.test.ts` (round-trip, truncation, tamper, version); e2e save→New→open: hash, hierarchy, transform and 387 masked verts kept |
| Project | IndexedDB autosave, A/B slots + head, corruption fallback | PASS | e2e: reload recovers the latest; corrupted head slot falls back to the previous (`slot B: fingerprint mismatch`) |
| Scene | Hierarchy, groups, reparent (cycle-safe), rename, visibility, delete (undoable), transforms (gizmo + numeric, undoable) | PASS (numeric, reparent, undo) | e2e `transform edits…`, `native project…`; gizmo dragging not automated |
| Image Lab | Intake (PNG/JPEG/WebP, ≤20 MB, decode check), 4 view slots | PASS | e2e: GIF rejected, PNG accepted |
| Image Lab | Crop (real drag on canvas, re-encode) | PASS | e2e: 640×480 → 320×384 |
| Image Lab | Reference planes (local only, opacity, saved in project) | PASS | e2e: 2 planes placed; screenshot `imagelab-refplanes.png` |
| Recon | Provider-neutral contract + job state machine + consent gate | PASS | `tests/recon.test.ts`; e2e submit disabled without connection and consent |
| Recon | Meshy adapter (single + multi-image, from current docs) | PASS (fixtures) / **Live UNVERIFIED** | unit tests with response shapes from the docs; no real call made |
| Recon | User-run key proxy | PASS (local route guards) | curl: OPTIONS 204, unknown route 404, non-meshy asset host 400 |
| Recon | Generated mesh editable | PASS (MOCK only) | e2e: MOCK GLB imported, sculpted (Δ 0.0687), exported (delta 0) |
| Perf | BVH refit/rebuild policy, HUD (fps, cpu p50/p95, dab, refit/build, tris, draws, GPU) | PASS | `npm run bench`; HUD visible in screenshots |
| Perf | 10k / 100k / 500k tris benchmark | MEASURED (SwiftShader) | `artifacts/evidence/bench.json`. Real-GPU numbers UNVERIFIED |
| Robustness | WebGL context loss/restore, CPU geometry intact | PASS | e2e: overlay shown, restored, hash unchanged, centre luma 126, sculpting works after |
| Layout | 1440×900, 1024×768, 768×1024, 390×844 | PASS | e2e: no overflow, no clipped top-bar controls, canvas >200 px, panel reachable; screenshots |
| Build | Production build (`dist/`, relative base) | PASS | 17/17 e2e against `vite preview` |
| Build | GitHub Pages profile (`dist-pages/`, base `/form-engine/`) | PASS locally, **READY-NOT-PUBLISHED** | boot + GLB round-trip e2e served from `/form-engine/` |
| Devices | Real iPad/iPhone/pen hardware, real GPU | UNVERIFIED | headless cloud VM only |
