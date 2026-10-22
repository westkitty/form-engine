# FORM//ENGINE

A browser 3D sculpting studio. You sculpt real vertices on a WebGL2 canvas, import and export GLB, glTF, OBJ and STL files, save native `.formengine` projects, and use an Image Lab with a provider-neutral image-to-3D pipeline.

Stack: Vite 8, TypeScript 6, Three.js r186 (WebGL2), three-mesh-bvh 0.9, and fflate. Tests use Vitest 4 and Playwright 1.64. All runtime dependencies are MIT-licensed.

## Open it

**https://westkitty.github.io/form-engine/** works in Chrome, Samsung Internet, Edge and Safari. There's nothing to install and no account.

### On a tablet (Galaxy Tab S9 Ultra and any other tablet)

To run it full screen like an app, with no browser bars:

- **Chrome:** tap ⋮ → **Add to Home screen** → **Install**. Chrome may also show an **Install** button in the app's top-right corner.
- **Samsung Internet:** tap ≡ → **Add page to** → **Apps screen**.
- **Safari (iPad):** Share → **Add to Home Screen**.

Then open **FORM//ENGINE** from the new icon. It launches full screen in any orientation, and works offline once it has loaded.

You can also stay in the browser and tap the corner **⛶** button to go full screen. Or turn on **Menu › Settings › Go full screen on first touch**.

Earlier versions had no web-app manifest and no service worker, so "Add to Home screen" only made a bookmark that opened inside the browser. 0.2.0 ships both. Chrome's own installability check reports no errors (see EVIDENCE.md).

### S Pen and touch

| Input | What it does |
|---|---|
| S Pen tip | Sculpts. Pressure sets the depth, and can also set the size (Settings). Tilting the pen widens the brush |
| S Pen hover | Shows the brush ring where the tip will land |
| S Pen side button (hold) | Subtracts (carves) instead of adding. You can switch it to Smooth in Settings |
| Pen eraser end (on pens that have one) | Paints mask, or erases mask (Settings) |
| One finger | Orbits. Once a pen has been used, fingers never sculpt |
| Two fingers | Pinch to zoom, drag to pan |
| Palm on the screen | Ignored while the pen is touching or hovering, and for 300 ms after |

Before any pen is detected, a finger sculpts, so tablets without a stylus still work. **Settings › Sculpt with** can force pen-only or pen-or-finger.

The canvas blocks page scroll, pull-to-refresh, long-press menus and text selection, so strokes never fight the browser. On high-density panels, rendering resolution is capped to a pixel budget (**Settings › Render quality**), which keeps the 2960×1848 S9 Ultra screen fluid.

**Optional, an Android app package:** the installed web app already runs full screen. If you want a Play-Store-style APK, wrap the live URL with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (`bubblewrap init --manifest https://westkitty.github.io/form-engine/manifest.webmanifest`, then `bubblewrap build`). That creates a Trusted Web Activity. You sign it with your own key, and you need a Digital Asset Links file on the site to hide the URL bar. That isn't built or signed here.

## Run from source

```bash
npm install
npm run dev            # http://127.0.0.1:5180
npm test               # unit tests (Vitest)
npm run test:e2e       # browser tests (Playwright, headless Chromium + SwiftShader) against a fresh production build
npm run bench          # 10k / 100k / 500k triangle benchmark → artifacts/evidence/bench.json
npm run build          # production build → dist/ (relative base, works from any folder)
npm run build:pages    # GitHub Pages profile → dist-pages/ (base /form-engine/, override with FORM_BASE)
```

Set `FORM_CHROME=/path/to/chrome` if Chrome isn't at `/usr/bin/google-chrome`. To run the suite against a server that's already running, such as the live site, set `FORM_E2E_BASE=https://westkitty.github.io/form-engine/`.

## Using it

The screen is the model, plus a floating dock with these controls:

- **Draw · Clay · Smooth · Grab · Crease**, and **More** for Inflate, Flatten, Pinch, Mask and the mask Clear/Invert actions
- **Size** and **Strength**
- **Mirror** and **Subtract**
- **Undo** and **Redo**

Everything else is in **Menu** (top left), which has three tabs:

- **File:** new, open and save projects; import a model; export GLB, OBJ or STL; Image Lab
- **Scene:** Move, Rotate and Scale tools; the object list; position, rotation and scale fields
- **Settings:** pen and touch, mirror axes, display, and install

On a keyboard:

- `1`–`8` and `M` pick brushes.
- Shift smooths. Ctrl/Cmd subtracts.
- `[` `]` set the size. Esc cancels the current stroke.
- Ctrl/Cmd Z undoes. Ctrl/Cmd Shift Z redoes.
- `W` `E` `R` `S` pick Move, Rotate, Scale and Sculpt. `F` frames the model. F11 goes full screen.
- You can also drag files onto the window.

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
src/app/       viewport (renderer, adaptive pixel ratio, controls, gizmo, frame stats, context loss), document model,
               sculpt tool (pointer pipeline: pen pressure/tilt/twist, hover, side button, eraser, palm rejection)
src/app/pwa.ts install prompt, full screen, display mode, persisted settings
src/pwa/       service-worker template (precache list injected at build by vite.config.ts)
public/       manifest.webmanifest, icons (any + maskable 192/512), manifest screenshots
src/ui/        Image Lab
tools/         meshy-proxy.mjs (optional, user-run key-holding proxy)
```

Brushes run on a welded vertex space, and each change is written back to every duplicate render vertex. That keeps UV seams and hard-edge splits from tearing, and imported UVs and materials survive export.

BVH policy: the BVH is refit once per frame while a stroke is dirty. It's fully rebuilt when the topology changes, when one stroke moves more than 15% of the bounding radius, or after 400 refits.

## Status

See [FEATURE_MATRIX.md](FEATURE_MATRIX.md), [docs/design-critiques/](docs/design-critiques/), [EVIDENCE.md](EVIDENCE.md) and [PROJECT_STATE.md](PROJECT_STATE.md). Live image-to-3D is **UNVERIFIED** because no provider key was used. Setup is in [RECONSTRUCTION_SETUP.md](RECONSTRUCTION_SETUP.md).

## Deploying

Live at **https://westkitty.github.io/form-engine/**. `.github/workflows/pages.yml` typechecks, runs the unit tests, builds with base `/form-engine/`, and deploys on every push to `main` (Pages source: GitHub Actions).
