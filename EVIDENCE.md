# EVIDENCE — 0.2.0, 2026-10-22 (America/Detroit)

Environment: Debian 13 cloud VM (box), 8 vCPU, 15 GB RAM, **no GPU**. Node 20.19.2, npm 11.21. Headless Chrome 155.0.8059.84 through Playwright 1.64.1. WebGL2 runs on ANGLE → Vulkan → **SwiftShader** (softw## Commands and results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` (Vitest 4.1.12) | **35/35 passed** (5 files: core 19, project 4, recon 6, artifacts 2, tablet 4) |
| `npx playwright test` (fresh production build + `vite preview`, so the service worker and manifest are the shipped ones) | **29/29 passed** (sculpt 11, tablet 8, responsive 5, pwa 2, imagelab 2, bench 1) |
| Live, after deploy of `16f0c81`: `FORM_E2E_BASE=https://westkitty.github.io/form-engine/ npx playwright test e2e/{sculpt,imagelab,responsive,tablet,pwa}.spec.ts` | **28/28 passed** against the live site (all but bench) |
| `node tools/meshy-proxy.mjs` route guards (fake key, no upstream call) | OPTIONS 204 · unknown route 404 · foreign asset host 400 · CORS origin pinned |

The detailed per-test numbers are in `artifacts/evidence/e2e-results.json`, written by the most recent run.

## Tablet, S Pen and app checks (0.2.0)

All pen and touch input is **SIMULATED**. It's injected through Chrome DevTools Protocol (`Input.dispatchMouseEvent` with `pointerType:"pen"` and pressure/tilt/twist, and `Input.dispatchTouchEvent`), so it arrives as trusted PointerEvents. The eraser case uses a synthetic `PointerEvent`, because CDP can't send button 5. No physical Galaxy Tab S9 Ultra, S Pen or Samsung Internet was available.

| Check | Measured |
|---|---|
| Pen pressure | 0.15 → max Δ 0.0083, 1.0 → 0.0550 |
| Tilt (55°/25°) vs upright | 1,499 vs 794 vertices changed (radius ×1.56) |
| Twist | read as 90°; shown in Settings › Pen and touch |
| Hover | cursor visible, mesh unchanged |
| Palm rejection | touch right after the pen was rejected (no sculpt, camera unchanged). Once the pen had left, one finger orbited and still didn't sculpt |
| Side button | carves inward (radial sum < 0) vs a normal stroke building outward. The Smooth setting switches the brush |
| Two-finger gesture | camera moved, mesh hash unchanged |
| Canvas lock | `touch-action:none` on the canvas only, `overscroll-behavior:none`, contextmenu prevented |
| Pixel ratio | 1480×924 @ DPR 2 → 1.53 (2263×1413 buffer, under the 3.2 MP budget); Sharp → 2 |
| Manifest | Chrome `Page.getAppManifest` has no errors. display fullscreen, display_override [fullscreen, standalone], orientation any, maskable 192/512, wide + narrow screenshots |
| Installability | Chrome `Page.getInstallabilityErrors` → **[]** (persistent profile; incognito contexts always report `in-incognito`) |
| Offline | service worker controls the page. With the network blocked, a reload boots the studio from cache |
| Install button | shown on `beforeinstallprompt` (SIMULATED event), and `prompt()` is called |
| Full screen | Fullscreen API enter/exit via the corner button. Auto full screen fired on the first touch tap when enabled |

Not provable here:

- An actual "Add to Home screen" on the tablet
- Samsung Internet's install flow
- S Pen hardware event quirks (for example, whether hover-exit events are sent; the code times hover out after 1.5 s)
- Real-GPU frame rate on the Adreno 740

 run.

## Live verification (2026-10-22, about 00:30 ET)

- Actions run 39722524551: build ✓, deploy ✓.
- `https://westkitty.github.io/form-engine/` returns 200. The new assets `assets/index-DKpk-yHJ.js` (application/javascript) and `assets/index-dA29-t0L.css` (text/css) return 200; 0.1.0 shipped `index-NqqIslh5.js` and `index-CGYYA6OS.css`.
- `sw.js` (version `0.2.0-32d79fad7297`), `manifest.webmanifest` (application/manifest+json), the icons and the screenshots all return 200.
- Live Chrome installability check: `Page.getInstallabilityErrors` → []; manifest `id` "form-engine" gives the app id `https://westkitty.github.io/form-engine` (a bare "./" resolved to the origin root, so it was changed before the final deploy). Offline reload boots from the service worker.
- The live run includes the sculpt → GLB export → independent parse → re-import → still-editable journey.
- `artifacts/evidence/e2e-results.json` holds the numbers from this live run.

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

- Before/after the redesign, same strokes: `artifacts/evidence/ux/before-*.png` and `after-*.png` at 2960×1848, 1480×924@2x, 1024×768, 768×1024 and 390×844. Plus `after-1480x924@2x-menu.png`, `after-1480x924@2x-settings.png` and `after-768x1024-more.png`.
- From the tests: `layout-*.png`, `imagelab-dialog.png`, `imagelab-refplanes.png`, `context-restored.png` and `sculpt-crease-1440.png`.
- The design critique is `docs/design-critiques/2026-10-21-studio-v0.1.md`.

## Not proven

- Live Meshy job: no key, no account was created, and no paid call was made.
- Physical pen and touch hardware (Galaxy Tab S9 Ultra, S Pen), Samsung Internet, and a real home-screen install.
- Real-GPU performance.
- `.gltf` with external resources.
- Gizmo drag automation (numeric transform editing is proven).
