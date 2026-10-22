/** Install (PWA), full screen, display-mode detection and persisted user settings. */

export type DisplayMode = 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';
export function displayMode(): DisplayMode {
  for (const m of ['fullscreen', 'standalone', 'minimal-ui'] as const) if (matchMedia(`(display-mode: ${m})`).matches) return m;
  return 'browser';
}

// ---------- full screen ----------
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (o?: unknown) => Promise<void> };
export const fullscreenSupported = () => !!(document.fullscreenEnabled || (document.documentElement as FsEl).webkitRequestFullscreen);
export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);
export async function enterFullscreen() {
  const el = document.documentElement as FsEl;
  if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  else throw new Error('Full screen is not available in this browser');
  // tablets: keep the current orientation once full screen (best-effort; unsupported is fine)
  try { await (screen.orientation as any)?.lock?.(screen.orientation.type); } catch { /* not allowed or not supported */ }
}
export async function exitFullscreen() {
  const d = document as FsDoc;
  if (document.exitFullscreen && document.fullscreenElement) await document.exitFullscreen();
  else if (d.webkitExitFullscreen && d.webkitFullscreenElement) await d.webkitExitFullscreen();
}
export async function toggleFullscreen() { if (isFullscreen()) await exitFullscreen(); else await enterFullscreen(); return isFullscreen(); }

// ---------- install ----------
interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BIPEvent | null = null;
export const installState = { available: false, installed: false, swRegistered: false, swError: '' };
export function setupInstall(onChange: () => void) {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIPEvent; installState.available = true; onChange(); });
  window.addEventListener('appinstalled', () => { deferred = null; installState.available = false; installState.installed = true; onChange(); });
}
/** Shows the browser's install prompt when it offered one. Returns 'unavailable' when the browser hasn't (use the hint instead). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const d = deferred; deferred = null; installState.available = false;
  await d.prompt(); const { outcome } = await d.userChoice; return outcome;
}
export function installHint(ua = navigator.userAgent): string {
  if (displayMode() !== 'browser') return 'Running as an installed app.';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet: tap the ≡ menu, then “Add page to” → “Apps screen”. Open it from the new icon to run full screen.';
  if (/Android/i.test(ua)) return 'Chrome: tap the ⋮ menu, then “Add to Home screen” → “Install”. Open it from the new icon to run full screen.';
  if (/iPad|iPhone/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'Safari: tap Share, then “Add to Home Screen”.';
  return 'Chrome or Edge: use the install icon at the right of the address bar.';
}
export async function registerServiceWorker(url = './sw.js') {
  if (!('serviceWorker' in navigator)) { installState.swError = 'Service workers unavailable'; return null; }
  try { const r = await navigator.serviceWorker.register(url, { scope: './' }); installState.swRegistered = true; return r; }
  catch (e) { installState.swError = (e as Error).message; return null; }
}

// ---------- settings ----------
export interface AppSettings {
  penMode: 'auto' | 'pen' | 'any'; barrel: 'invert' | 'smooth'; eraser: 'mask' | 'unmask';
  usePressure: boolean; pressureSize: boolean; tiltWidens: boolean;
  autoFullscreen: boolean; showHud: boolean; quality: 'balanced' | 'sharp' | 'fast';
}
export const DEFAULT_SETTINGS: AppSettings = { penMode: 'auto', barrel: 'invert', eraser: 'mask', usePressure: true, pressureSize: false, tiltWidens: true, autoFullscreen: false, showHud: false, quality: 'balanced' };
const KEY = 'form-engine:settings:v1';
export function loadSettings(): AppSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: AppSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
