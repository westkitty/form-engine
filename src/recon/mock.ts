/**
 * MOCK provider — FOR AUTOMATED TESTS ONLY. It never contacts a network and
 * produces a deterministic GLB built locally (a lumpy quad sphere). It is
 * only reachable with ?mockProvider=1 and is always labelled MOCK in the UI.
 */
import type { ReconstructionProvider, ReconRequest, RemoteJob } from './contract';

export class MockProvider implements ReconstructionProvider {
  readonly id = 'mock';
  readonly label = 'MOCK (tests only — not reconstruction)';
  readonly capabilities = { maxImages: 4, maxBytesPerImage: 20 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'], outputs: ['glb'], costNote: 'No network, no cost. Output is a fixed synthetic mesh.', live: false };
  private jobs = new Map<string, { polls: number }>();
  constructor(private makeGlb: () => Promise<ArrayBuffer>, private pollsToFinish = 3, private failWith?: string) {}
  isConfigured() { return true; }
  async create(_req: ReconRequest) { const id = 'mock-' + (this.jobs.size + 1); this.jobs.set(id, { polls: 0 }); return { id }; }
  async get(id: string): Promise<RemoteJob> {
    const j = this.jobs.get(id); if (!j) throw new Error('unknown mock job');
    j.polls++;
    if (this.failWith && j.polls >= this.pollsToFinish) return { id, status: 'FAILED', progress: 0, error: this.failWith };
    if (j.polls >= this.pollsToFinish) return { id, status: 'SUCCEEDED', progress: 100, glbUrl: 'mock://result.glb' };
    return { id, status: j.polls === 1 ? 'PENDING' : 'IN_PROGRESS', progress: Math.round((j.polls / this.pollsToFinish) * 100) };
  }
  fetchResult(_job: RemoteJob) { return this.makeGlb(); }
}
