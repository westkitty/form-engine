/**
 * Provider-neutral image-to-3D contract. The editor only talks to this
 * interface; Meshy (real) and Mock (tests only) implement it.
 */
export type ViewSlot = 'front' | 'back' | 'left' | 'right';
export interface ReconImage { slot: ViewSlot; mime: string; dataUrl: string; width: number; height: number; bytes: number }
export interface ReconRequest { images: ReconImage[]; options: { targetPolycount?: number; texture?: boolean; model?: string } }
export type RemoteStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export interface RemoteJob { id: string; status: RemoteStatus; progress: number; glbUrl?: string; error?: string; consumedCredits?: number; queueAhead?: number }

export interface ProviderCapabilities { maxImages: number; maxBytesPerImage: number; mimes: string[]; outputs: string[]; costNote: string; live: boolean }

export interface ReconstructionProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  /** True when a key/proxy has been configured so a job can actually be created. */
  isConfigured(): boolean;
  create(req: ReconRequest, signal?: AbortSignal): Promise<{ id: string }>;
  get(id: string, signal?: AbortSignal): Promise<RemoteJob>;
  /** Download the produced GLB. */
  fetchResult(job: RemoteJob, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export function validateRequest(p: ReconstructionProvider, req: ReconRequest): string[] {
  const errs: string[] = [];
  if (!req.images.length) errs.push('Add at least one image.');
  if (req.images.length > p.capabilities.maxImages) errs.push(`${p.label} accepts at most ${p.capabilities.maxImages} image(s).`);
  for (const im of req.images) {
    if (!p.capabilities.mimes.includes(im.mime)) errs.push(`${im.slot}: ${im.mime} not supported (${p.capabilities.mimes.join(', ')}).`);
    if (im.bytes > p.capabilities.maxBytesPerImage) errs.push(`${im.slot}: image exceeds ${(p.capabilities.maxBytesPerImage / 1048576).toFixed(0)} MB.`);
  }
  if (!req.images.some(i => i.slot === 'front')) errs.push('A FRONT view is required (it is sent first).');
  return errs;
}
