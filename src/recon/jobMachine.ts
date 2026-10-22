/**
 * Reconstruction job state machine. Transitions are explicit; an illegal
 * transition throws, so the UI can never show e.g. "importing" for a job that
 * was never consented or submitted.
 *
 *  draft ─consent→ consented ─submit→ submitting ─accepted→ queued ⇄ running ─succeeded→ downloading → importing → ready
 *     any non-terminal ─fail→ failed      any non-terminal ─cancel→ canceled
 */
export type JobState = 'draft' | 'consented' | 'submitting' | 'queued' | 'running' | 'downloading' | 'importing' | 'ready' | 'failed' | 'canceled';
const T: Record<JobState, JobState[]> = {
  draft: ['consented', 'canceled'],
  consented: ['submitting', 'draft', 'canceled'],
  submitting: ['queued', 'running', 'failed', 'canceled'],
  queued: ['queued', 'running', 'downloading', 'failed', 'canceled'],
  running: ['running', 'downloading', 'failed', 'canceled'],
  downloading: ['importing', 'failed', 'canceled'],
  importing: ['ready', 'failed'],
  ready: [], failed: [], canceled: [],
};
export const TERMINAL: JobState[] = ['ready', 'failed', 'canceled'];

export interface JobRecord {
  localId: string; provider: string; state: JobState; remoteId?: string; progress: number;
  log: { at: string; state: JobState; note?: string }[]; error?: string; consentAt?: string;
}

export function newJob(provider: string): JobRecord {
  return { localId: 'job-' + Math.random().toString(36).slice(2, 10), provider, state: 'draft', progress: 0, log: [{ at: new Date().toISOString(), state: 'draft' }] };
}

export function transition(j: JobRecord, to: JobState, note?: string): JobRecord {
  if (!T[j.state].includes(to)) throw new Error(`illegal job transition ${j.state} → ${to}`);
  const n: JobRecord = { ...j, state: to, log: [...j.log, { at: new Date().toISOString(), state: to, note }] };
  if (to === 'consented') n.consentAt = new Date().toISOString();
  if (to === 'failed') n.error = note;
  return n;
}
export const canTransition = (from: JobState, to: JobState) => T[from].includes(to);
