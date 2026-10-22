# FEATURE MATRIX — FORM//ENGINE 0.2.0 (2026-10-22)

PASS means an executed, reproducible check exists (the command is named). UNVERIFIED means the runtime, service or hardware wasn't available. Screenshots are supporting evidence only.

| Area | Feature | Status | Proof |
|---|---|---|---|
| Viewport | WebGL2 canvas, orbit, pan, zoom, framing, matcap clay shading | PASS | e2e `boots…`, real mouse strokes in every sculpt test |
| Sculpt | Draw, Inflate, Clay Build, Smooth, Grab, Flatten, Pinch, Crease (8), each distinct | PASS | `tests/core.test.ts` (per-brush geometric assertions + pairwise-distinct hashes); e2e `every brush…` (real pointer strokes, 8 distinct hashes) |
| Sculpt | Symmetry X/Y/Z | PASS | unit + e2e: mirrored displacement diff 2.3e-8 |
| Sculpt | Mask paint/erase/clear/invert, masked verts frozen | PASS | unit + e2e: masked vertex move 0 |
| Sculpt | Stroke transactions, Esc cancel byte-exact, undo/redo byte-exact | PASS | unit + e2e `Esc cancels…` (FNV hash equality) |
| Pen | Pressure → strength (optional → size) | PASS (SIMULATED) | `e2e/tablet.spec.ts`: CDP pen input; pressure 0.15 → max Δ 0.0083, 1.0 → 0.0550. Also synthetic-event test in `sculpt.spec.ts`. **No physical S Pen** |
| Pen | Tilt widens the brush; twist read | PASS (SIMULATED) | tablet.spec: tilt 55°/25° → 1,499 verts changed vs 794 upright (radius ×1.56); twist 90° read; unit tests for the tilt math |
| Pen | Hover shows the brush cursor, no sculpt | PASS (SIMULATED) | tablet.spec: CDP pen moves with buttons=0 → cursor visible, mesh hash unchanged |
| Pen | Side button → Subtract (or Smooth) | PASS (SIMULATED) | tablet.spec: barrel stroke carves inward (radial sum < 0), normal builds outward; Smooth setting switches the brush |
| Pen | Eraser end (button 5 / buttons 32) → mask | PASS (SIMULATED, synthetic event) | CDP can't express button 5, so this uses a synthetic PointerEvent |
| Touch | Palm rejection (pen down/hover + 300 ms) | PASS (SIMULATED) | tablet.spec: touch right after the pen is rejected (no sculpt, camera unchanged); after the pen leaves, one finger orbits and still never sculpts |
| Touch | Two-finger pinch/pan navigates, never sculpts | PASS (SIMULATED) | tablet.spec: CDP two-point touch; hash unchanged, camera moved |
| Touch | Finger sculpts when no pen is present; second finger cancels exactly | PASS (SIMULATED) | sculpt.spec synthetic touch PointerEvents |
| Touch | touch-action:none on the canvas only; no overscroll, pull-to-refresh, long-press menu or selection | PASS | tablet.spec computed styles + contextmenu defaultPrevented |
| Display | Adaptive pixel ratio (3.2 MP budget; Sharp/Fast setting) | PASS | unit + tablet.spec: 1480×924@2 → DPR 1.53 (2263×1413 buffer); Sharp → 2 |
| App | Web app manifest (fullscreen, display_override, any orientation, maskable 192/512, wide + narrow screenshots, id/scope) | PASS | `e2e/pwa.spec.ts`: Chrome `Page.getAppManifest` errors [] |
| App | Installable | PASS (Chrome headless check) | pwa.spec: Chrome `Page.getInstallabilityErrors` → [] in a persistent profile. Real install on a Tab S9 Ultra is **UNVERIFIED** |
| App | Service worker, offline app shell | PASS | pwa.spec: page controlled; network blocked → reload still boots the studio |
| App | Install button (beforeinstallprompt) + fallback hint | PASS (SIMULATED event) | pwa.spec: synthetic beforeinstallprompt → button shown → prompt() called; hint text otherwise |
| App | Full screen toggle; auto full screen on first touch (setting) | PASS | tablet.spec: Fullscreen API enter and exit in headless Chromium; CDP touch tap triggers auto full screen |
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
| Perf | BVH refit/rebuild policy, HUD (fps, cpu p50/p95, dab, refit/build, tris, draws, DPR, pen, GPU) | PASS | `npm run bench`; HUD now off by default (Settings › Show performance readout, or `?hud=1`) |
| Perf | 10k / 100k / 500k tris benchmark | MEASURED (SwiftShader) | `artifacts/evidence/bench.json`. Real-GPU numbers UNVERIFIED |
| Robustness | WebGL context loss/restore, CPU geometry intact | PASS | e2e: overlay shown, restored, hash unchanged, centre luma 126, sculpting works after |
| Layout | Tablet-first: 2960×1848, 1480×924@2x, 1024×768, 768×1024, 390×844 | PASS | `e2e/responsive.spec.ts`: canvas is the full window, dock in view, no corner overlap, every dock/corner target ≥ 44 px, nothing clipped, no panel open by default, menu reachable; before/after screenshots in `artifacts/evidence/ux/` |
| UX | Simplified UI (dock + single menu), critique | DONE | `docs/design-critiques/2026-10-21-studio-v0.1.md` |
| Build | Production build (`dist/`, relative base) | PASS | the whole e2e suite now runs against a production build + `vite preview` |
| Build | GitHub Pages (`/form-engine/`) | PASS, **LIVE** | https://westkitty.github.io/form-engine/ — live e2e run after deploy (see EVIDENCE.md) |
| Devices | Physical Galaxy Tab S9 Ultra / S Pen / Samsung Internet, real GPU | UNVERIFIED | headless cloud VM only; all pen/touch input above is injected |
