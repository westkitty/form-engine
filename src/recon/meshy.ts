/**
 * Meshy image-to-3D adapter, written against docs.meshy.ai (fetched 2026-10-21):
 *   POST {base}/openapi/v1/image-to-3d        body { image_url, ai_model, should_texture, target_formats, target_polycount?, should_remesh? } → { result: id }
 *   POST {base}/openapi/v1/multi-image-to-3d  body { image_urls[1..4], ... } (first image = front)            → { result: id }
 *   GET  {base}/openapi/v1/{kind}/{id}        → task { status PENDING|IN_PROGRESS|SUCCEEDED|FAILED|CANCELED, progress, model_urls.glb, task_error.message, consumed_credits, preceding_tasks }
 * Images: JPG/JPEG/PNG/WebP, ≤20 MB, public URL or base64 data URI.
 * Auth: Authorization: Bearer <key>. Paid plan required to create tasks (402 otherwise).
 *
 * Two connection modes — both are opt-in and user-controlled; there is NO shared key in the shipped app:
 *   • proxy  — base = user's own proxy URL (see tools/meshy-proxy.mjs) which injects the key server-side.
 *   • byo    — user pastes their own key; held in memory only (never persisted, never exported).
 * Whether api.meshy.ai allows direct browser (CORS) calls in BYO mode is UNVERIFIED; proxy mode avoids the question.
 */
import type { ReconstructionProvider, ReconRequest, RemoteJob, RemoteStatus } from './contract';

export interface MeshyConfig { mode: 'proxy' | 'byo' | 'off'; base: string; key?: string; model: string }
export const MESHY_DEFAULT: MeshyConfig = { mode: 'off', base: 'https://api.meshy.ai', model: 'latest' };

export class MeshyProvider implements ReconstructionProvider {
  readonly id = 'meshy';
  readonly label = 'Meshy';
  readonly capabilities = { maxImages: 4, maxBytesPerImage: 20 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'], outputs: ['glb'], costNote: 'Consumes Meshy credits (paid plan required). Images are uploaded to Meshy.', live: true };
  private kinds = new Map<string, 'image-to-3d' | 'multi-image-to-3d'>();
  constructor(public cfg: MeshyConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  isConfigured() { return this.cfg.mode === 'proxy' ? !!this.cfg.base : this.cfg.mode === 'byo' ? !!this.cfg.key : false; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.mode === 'byo' && this.cfg.key) h.Authorization = `Bearer ${this.cfg.key}`;
    return h;
  }
  private url(path: string) { return this.cfg.base.replace(/\/+$/, '') + path; }

  /** Pure: build the exact request body (exported for tests and for UI preview). */
  buildBody(req: ReconRequest): { kind: 'image-to-3d' | 'multi-image-to-3d'; body: Record<string, unknown> } {
    const ordered = [...req.images].sort((a, b) => (a.slot === 'front' ? -1 : b.slot === 'front' ? 1 : 0));
    const common: Record<string, unknown> = { ai_model: req.options.model ?? this.cfg.model, should_texture: req.options.texture ?? true, target_formats: ['glb'] };
    if (req.options.targetPolycount) { common.should_remesh = true; common.target_polycount = Math.max(100, Math.min(300000, Math.round(req.options.targetPolycount))); }
    if (ordered.length === 1) return { kind: 'image-to-3d', body: { image_url: ordered[0].dataUrl, ...common } };
    return { kind: 'multi-image-to-3d', body: { image_urls: ordered.map(i => i.dataUrl), ...common } };
  }

  private async check(r: Response) {
    if (r.ok) return r.json();
    let msg = `${r.status}`;
    try { const j = await r.json(); msg += ` ${j.message ?? JSON.stringify(j)}`; } catch { /* ignore */ }
    const hint = r.status === 401 ? ' (API key missing or invalid)' : r.status === 402 ? ' (insufficient credits or free plan)' : r.status === 429 ? ' (rate limited — retry later)' : '';
    throw new Error(`Meshy ${msg}${hint}`);
  }

  async create(req: ReconRequest, signal?: AbortSignal) {
    if (!this.isConfigured()) throw new Error('Meshy is not configured (choose proxy or bring-your-own key).');
    const { kind, body } = this.buildBody(req);
    const r = await this.fetchImpl(this.url(`/openapi/v1/${kind}`), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    const j = await this.check(r);
    if (typeof j.result !== 'string') throw new Error('Meshy: unexpected create response');
    this.kinds.set(j.result, kind);
    return { id: j.result };
  }

  async get(id: string, signal?: AbortSignal): Promise<RemoteJob> {
    const kind = this.kinds.get(id) ?? 'image-to-3d';
    const r = await this.fetchImpl(this.url(`/openapi/v1/${kind}/${encodeURIComponent(id)}`), { headers: this.headers(), signal });
    const t = await this.check(r);
    return { id: t.id ?? id, status: t.status as RemoteStatus, progress: t.progress ?? 0, glbUrl: t.model_urls?.glb, error: t.task_error?.message || undefined, consumedCredits: t.consumed_credits, queueAhead: t.preceding_tasks };
  }

  async fetchResult(job: RemoteJob, signal?: AbortSignal) {
    if (!job.glbUrl) throw new Error('Meshy task has no GLB output');
    // signed asset URL; in proxy mode route through the proxy's /asset passthrough to avoid CORS
    const url = this.cfg.mode === 'proxy' ? this.url(`/asset?u=${encodeURIComponent(job.glbUrl)}`) : job.glbUrl;
    const r = await this.fetchImpl(url, { signal });
    if (!r.ok) throw new Error(`GLB download failed: ${r.status}`);
    return r.arrayBuffer();
  }
}
