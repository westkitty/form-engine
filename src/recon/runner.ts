import type { ReconstructionProvider, ReconRequest } from './contract';
import { validateRequest } from './contract';
import { newJob, transition, type JobRecord } from './jobMachine';

/** Drives one job through the state machine. Consent must be given explicitly before run(). */
export class JobRunner {
  job: JobRecord;
  private abort = new AbortController();
  onUpdate: (j: JobRecord) => void = () => {};
  constructor(public provider: ReconstructionProvider, public pollMs = 5000) { this.job = newJob(provider.id); }
  private set(to: JobRecord['state'], note?: string, progress?: number) {
    this.job = transition(this.job, to, note); if (progress !== undefined) this.job.progress = progress; this.onUpdate(this.job);
  }
  consent() { this.set('consented', `user consented to ${this.provider.label}: ${this.provider.capabilities.costNote}`); }
  cancel() { if (!['ready', 'failed', 'canceled', 'importing'].includes(this.job.state)) { this.abort.abort(); this.set('canceled', 'canceled by user (remote task may continue and consume credits)'); } }

  async run(req: ReconRequest, importGlb: (glb: ArrayBuffer) => Promise<void>, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))) {
    if (this.job.state !== 'consented') throw new Error('consent required before submission');
    const errs = validateRequest(this.provider, req);
    if (errs.length) { this.set('submitting'); this.set('failed', errs.join(' ')); return; }
    try {
      this.set('submitting');
      const { id } = await this.provider.create(req, this.abort.signal);
      this.job.remoteId = id;
      this.set('queued', `remote task ${id}`);
      for (;;) {
        if (this.abort.signal.aborted) return;
        const r = await this.provider.get(id, this.abort.signal);
        if (r.status === 'FAILED' || r.status === 'CANCELED') { this.set('failed', `remote ${r.status}: ${r.error ?? 'no message'}`); return; }
        if (r.status === 'SUCCEEDED') {
          this.set('downloading', undefined, 100);
          const glb = await this.provider.fetchResult(r, this.abort.signal);
          this.set('importing');
          await importGlb(glb);
          this.set('ready', `imported ${glb.byteLength} bytes`);
          return;
        }
        this.set(r.status === 'PENDING' ? 'queued' : 'running', undefined, r.progress);
        await sleep(this.pollMs);
      }
    } catch (e) {
      if (this.abort.signal.aborted) return;
      if (!['ready', 'failed', 'canceled'].includes(this.job.state)) this.set('failed', (e as Error).message);
    }
  }
}
