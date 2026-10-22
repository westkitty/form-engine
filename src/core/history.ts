import type { SculptMesh } from './topology';

/** A reversible operation. Geometry strokes, mask edits and transforms all implement it. */
export interface HistoryEntry {
  label: string;
  bytes: number;
  undo(): void;
  redo(): void;
}

/** Records the before-state of every vertex a stroke touches (position xyz + mask), once. */
export class StrokeRecorder {
  private seen: Uint8Array;
  private idx: number[] = [];
  private before: number[] = [];
  constructor(public mesh: SculptMesh, public label: string) { this.seen = new Uint8Array(mesh.vertCount); }

  touch(verts: ArrayLike<number>, count: number) {
    const m = this.mesh;
    for (let i = 0; i < count; i++) {
      const v = verts[i];
      if (this.seen[v]) continue;
      this.seen[v] = 1;
      this.idx.push(v);
      this.before.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2], m.mask[v]);
    }
  }
  get touchedCount() { return this.idx.length; }
  touched(): Uint32Array { return Uint32Array.from(this.idx); }

  /** Restore every touched vertex to its before-state. Returns touched ids (for normal/BVH refresh). */
  cancel(): Uint32Array {
    const m = this.mesh;
    for (let i = 0; i < this.idx.length; i++) {
      const v = this.idx[i];
      m.pos[v * 3] = this.before[i * 4]; m.pos[v * 3 + 1] = this.before[i * 4 + 1]; m.pos[v * 3 + 2] = this.before[i * 4 + 2];
      m.mask[v] = this.before[i * 4 + 3];
    }
    return this.touched();
  }

  /** Produce a compact history entry; `apply` is called after state is written (refresh normals/render/BVH). */
  commit(apply: (verts: Uint32Array) => void): HistoryEntry | null {
    const m = this.mesh;
    const n = this.idx.length;
    if (!n) return null;
    const idx = Uint32Array.from(this.idx);
    const before = Float32Array.from(this.before);
    const after = new Float32Array(n * 4);
    let changed = false;
    for (let i = 0; i < n; i++) {
      const v = idx[i];
      after[i * 4] = m.pos[v * 3]; after[i * 4 + 1] = m.pos[v * 3 + 1]; after[i * 4 + 2] = m.pos[v * 3 + 2]; after[i * 4 + 3] = m.mask[v];
      for (let k = 0; k < 4; k++) if (after[i * 4 + k] !== before[i * 4 + k]) changed = true;
    }
    if (!changed) return null;
    const write = (src: Float32Array) => {
      for (let i = 0; i < n; i++) {
        const v = idx[i];
        m.pos[v * 3] = src[i * 4]; m.pos[v * 3 + 1] = src[i * 4 + 1]; m.pos[v * 3 + 2] = src[i * 4 + 2]; m.mask[v] = src[i * 4 + 3];
      }
      apply(idx);
    };
    return { label: this.label, bytes: idx.byteLength + before.byteLength + after.byteLength, undo: () => write(before), redo: () => write(after) };
  }
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  bytes = 0;
  onChange: () => void = () => {};
  constructor(public maxBytes = 256 * 1024 * 1024, public maxEntries = 200) {}

  push(e: HistoryEntry | null) {
    if (!e) return;
    this.undoStack.push(e);
    this.bytes += e.bytes;
    for (const r of this.redoStack) this.bytes -= r.bytes;
    this.redoStack = [];
    while ((this.bytes > this.maxBytes || this.undoStack.length > this.maxEntries) && this.undoStack.length > 1) {
      const old = this.undoStack.shift()!; this.bytes -= old.bytes;
    }
    this.onChange();
  }
  undo() { const e = this.undoStack.pop(); if (!e) return false; e.undo(); this.redoStack.push(e); this.onChange(); return true; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; e.redo(); this.undoStack.push(e); this.onChange(); return true; }
  clear() { this.undoStack = []; this.redoStack = []; this.bytes = 0; this.onChange(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get depth() { return this.undoStack.length; }
  peekLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? ''; }
}
