import { describe, it, expect } from 'vitest';
import { transition, newJob } from '../src/recon/jobMachine';
import { MeshyProvider } from '../src/recon/meshy';
import { MockProvider } from '../src/recon/mock';
import { JobRunner } from '../src/recon/runner';
import type { ReconRequest } from '../src/recon/contract';

const img = (slot: any, mime = 'image/png') => ({ slot, mime, dataUrl: `data:${mime};base64,AAAA`, width: 10, height: 10, bytes: 3 });
const req: ReconRequest = { images: [img('left'), img('front')], options: { targetPolycount: 20000 } };

describe('job state machine', () => {
  it('rejects illegal transitions', () => {
    const j = newJob('x');
    expect(() => transition(j, 'submitting')).toThrow(/illegal/);
    expect(() => transition(j, 'ready')).toThrow(/illegal/);
    const c = transition(j, 'consented'); expect(c.consentAt).toBeTruthy();
  });
});

describe('Meshy adapter (fixture responses copied from docs.meshy.ai, no network)', () => {
  it('builds single and multi-image bodies per current docs (front first, polycount clamped)', () => {
    const p = new MeshyProvider({ mode: 'byo', base: 'https://api.meshy.ai', key: 'k', model: 'latest' });
    const multi = p.buildBody(req);
    expect(multi.kind).toBe('multi-image-to-3d');
    expect((multi.body.image_urls as string[]).length).toBe(2);
    expect(multi.body.target_formats).toEqual(['glb']);
    expect(multi.body.should_remesh).toBe(true);
    const single = p.buildBody({ images: [img('front')], options: { targetPolycount: 9e9 } });
    expect(single.kind).toBe('image-to-3d'); expect(single.body.image_url).toMatch(/^data:image\/png;base64/);
    expect(single.body.target_polycount).toBe(300000);
  });
  it('drives create → poll → download with Bearer auth only in BYO mode', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let polls = 0;
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return new Response(JSON.stringify({ result: '018a210d-8ba4-705c-b111-1f1776f7f578' }), { status: 200 });
      if (url.includes('/openapi/v1/multi-image-to-3d/')) { polls++; return new Response(JSON.stringify(polls < 2 ? { id: 'x', status: 'IN_PROGRESS', progress: 40 } : { id: 'x', status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://assets.meshy.ai/t/model.glb?Expires=1' }, consumed_credits: 30, task_error: { message: '' } }), { status: 200 }); }
      if (url.startsWith('https://assets.meshy.ai')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return new Response('nf', { status: 404 });
    }) as unknown as typeof fetch;
    const p = new MeshyProvider({ mode: 'byo', base: 'https://api.meshy.ai', key: 'sk-test', model: 'latest' }, f);
    const run = new JobRunner(p, 0); run.consent();
    let got = 0; await run.run(req, async g => { got = g.byteLength; }, async () => {});
    expect(run.job.state).toBe('ready'); expect(got).toBe(3);
    expect(calls[0].url).toBe('https://api.meshy.ai/openapi/v1/multi-image-to-3d');
    expect((calls[0].init!.headers as any).Authorization).toBe('Bearer sk-test');
    const proxy = new MeshyProvider({ mode: 'proxy', base: 'https://my-proxy.example', model: 'latest' }, f);
    expect((proxy as any).headers().Authorization).toBeUndefined();
  });
  it('surfaces 402 with an actionable message and ends in failed', async () => {
    const f = (async () => new Response(JSON.stringify({ message: 'Insufficient credits' }), { status: 402 })) as unknown as typeof fetch;
    const run = new JobRunner(new MeshyProvider({ mode: 'byo', base: 'https://api.meshy.ai', key: 'k', model: 'latest' }, f), 0); run.consent();
    await run.run(req, async () => {}, async () => {});
    expect(run.job.state).toBe('failed'); expect(run.job.error).toMatch(/402.*insufficient credits/i);
  });
  it('refuses to submit without consent, and validation blocks bad input', async () => {
    const run = new JobRunner(new MockProvider(async () => new ArrayBuffer(4)), 0);
    await expect(run.run(req, async () => {})).rejects.toThrow(/consent/);
    run.consent(); await run.run({ images: [img('left', 'image/gif')], options: {} }, async () => {}, async () => {});
    expect(run.job.state).toBe('failed'); expect(run.job.error).toMatch(/FRONT/);
  });
  it('mock provider walks queued → running → downloading → importing → ready', async () => {
    const run = new JobRunner(new MockProvider(async () => new ArrayBuffer(8), 3), 0); run.consent();
    await run.run(req, async () => {}, async () => {});
    expect(run.job.log.map(l => l.state)).toEqual(['draft', 'consented', 'submitting', 'queued', 'queued', 'running', 'downloading', 'importing', 'ready']);
  });
});
