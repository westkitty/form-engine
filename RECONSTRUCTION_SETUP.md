# Image-to-3D setup

FORM//ENGINE never ships a shared key, never uploads an image without explicit consent for each job, and never stores a provider key.

## Pipeline

Images move through four steps: Image Lab intake (front, left, right, back), then crop, then an optional switch to reference planes, then a provider job.

Provider jobs go through a state machine (`src/recon/jobMachine.ts`). Illegal transitions throw.

```
draft → consented → submitting → queued ⇄ running → downloading → importing → ready
                         any non-terminal → failed | canceled
```

The returned GLB is imported as a normal sculptable mesh. It's welded, BVH-indexed, undoable and exportable.

## Meshy (real adapter: `src/recon/meshy.ts`)

The adapter was written against docs.meshy.ai, fetched 2026-10-21:

- One image: `POST /openapi/v1/image-to-3d` `{ image_url, ai_model, should_texture, target_formats:["glb"], should_remesh?, target_polycount? }`
- Two to four images: `POST /openapi/v1/multi-image-to-3d` `{ image_urls: [...] }`. The front view goes first.
- Polling: `GET /openapi/v1/{kind}/{id}` returns `status` (PENDING, IN_PROGRESS, SUCCEEDED, FAILED or CANCELED), `progress`, `model_urls.glb` and `task_error.message`.
- Limits: JPG, PNG or WebP, up to 20 MB per image. Creating tasks needs a paid plan (`402` otherwise), and every task consumes credits.

There are two ways to connect, chosen in Image Lab under Connection:

1. **Your own proxy (recommended).** Your key stays on your server.
   ```bash
   MESHY_API_KEY=msy_your_key ALLOW_ORIGIN=http://127.0.0.1:5180 node tools/meshy-proxy.mjs
   # Image Lab → Connection: "My proxy URL" → http://127.0.0.1:8787
   ```
   The proxy forwards only the four routes above, plus `/asset?u=` for `*.meshy.ai` GLB downloads. Its CORS is locked to `ALLOW_ORIGIN`.
2. **Bring your own key.** Paste the key into the password field. It's held in memory for that tab only, and it's never written to autosave, projects or exports (an e2e test checks this). Whether api.meshy.ai accepts direct browser (CORS) calls is **UNVERIFIED**.

Cancelling a job stops polling. A remote task that has already started keeps running and still uses credits, per Meshy's docs.

## MOCK provider (tests only)

It appears only with `?mockProvider=1`, and it's labelled **MOCK** everywhere. It makes no network calls and returns a fixed synthetic lumpy-sphere GLB built locally. It exists to prove the job, import, sculpt and export path end to end. It does **not** reconstruct anything.

## Verification status

| Item | Status |
|---|---|
| Adapter request shape and response handling | PASS: unit tests with responses copied from the docs (`tests/recon.test.ts`) |
| Job state machine, consent gate, validation | PASS: unit and e2e |
| Generated mesh is editable (MOCK) | PASS: e2e sculpts the imported GLB, exports it, and re-reads it with max delta 0 |
| Live Meshy job (real job ID, returned mesh) | **UNVERIFIED**: no key, and paid generation needs the owner's approval |
| Direct browser CORS to api.meshy.ai | **UNVERIFIED** |

Other providers were considered. Tripo's image-to-model API and self-hosted TRELLIS.2 (GPU required) would fit the same `ReconstructionProvider` interface. Neither is implemented.
