/**
 * Corruption-safe autosave in IndexedDB.
 * Two alternating slots (A/B) + a head record written in a SEPARATE transaction
 * only after the slot write commits. Recovery validates the head slot's
 * fingerprint and parses it; if that fails it falls back to the other slot.
 * A crash mid-write therefore never destroys the last good save.
 */
import { hashBytes } from '../core/topology';
import { deserializeProject, type ProjectData } from './project';

const DB = 'form-engine';
const STORE = 'autosave';
interface Slot { bytes: Uint8Array; fnv: string; seq: number; savedAt: string; name: string }
interface Head { slot: 'A' | 'B'; seq: number }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode); const s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => res(req ? (req as IDBRequest).result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error('aborted'));
  });
}

export async function autosaveWrite(bytes: Uint8Array, name: string): Promise<{ slot: string; seq: number }> {
  const db = await open();
  try {
    const head = await tx<Head | undefined>(db, 'readonly', s => s.get('head'));
    const slot: 'A' | 'B' = head?.slot === 'A' ? 'B' : 'A';
    const seq = (head?.seq ?? 0) + 1;
    const rec: Slot = { bytes, fnv: hashBytes(bytes), seq, savedAt: new Date().toISOString(), name };
    await tx(db, 'readwrite', s => s.put(rec, slot));
    await tx(db, 'readwrite', s => s.put({ slot, seq } satisfies Head, 'head'));
    return { slot, seq };
  } finally { db.close(); }
}

export interface Recovery { project: ProjectData; slot: string; seq: number; savedAt: string; fellBack: boolean; problems: string[] }

export async function autosaveRecover(): Promise<Recovery | null> {
  const db = await open();
  try {
    const head = await tx<Head | undefined>(db, 'readonly', s => s.get('head'));
    const order: ('A' | 'B')[] = head?.slot === 'B' ? ['B', 'A'] : ['A', 'B'];
    const problems: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const rec = await tx<Slot | undefined>(db, 'readonly', s => s.get(order[i]));
      if (!rec) continue;
      try {
        if (hashBytes(rec.bytes) !== rec.fnv) throw new Error('fingerprint mismatch');
        const project = deserializeProject(rec.bytes);
        return { project, slot: order[i], seq: rec.seq, savedAt: rec.savedAt, fellBack: i > 0 || (!!head && order[i] !== head.slot), problems };
      } catch (e) { problems.push(`slot ${order[i]}: ${(e as Error).message}`); }
    }
    if (problems.length) console.warn('[autosave] no recoverable slot', problems);
    return null;
  } finally { db.close(); }
}

export async function autosaveClear() {
  const db = await open();
  try { await tx(db, 'readwrite', s => s.clear()); } finally { db.close(); }
}

/** Test hook: deliberately damage a slot to prove fallback. */
export async function autosaveCorruptHead() {
  const db = await open();
  try {
    const head = await tx<Head | undefined>(db, 'readonly', s => s.get('head'));
    if (!head) return false;
    const rec = await tx<Slot>(db, 'readonly', s => s.get(head.slot));
    const bad = rec.bytes.slice(0, Math.floor(rec.bytes.length / 2));
    await tx(db, 'readwrite', s => s.put({ ...rec, bytes: bad }, head.slot));
    return true;
  } finally { db.close(); }
}
