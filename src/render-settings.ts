export interface RenderSettings { glowEnabled: boolean; glowStrength: number; autoPerformance: boolean }
export interface RenderStatus { glowActive: boolean; reduced: boolean }
export const defaultRenderSettings: RenderSettings = { glowEnabled: true, glowStrength: 0.72, autoPerformance: true };
const key = 'sourcefield.render-settings.v1';
export function readRenderSettings(): RenderSettings {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && typeof value.glowEnabled === 'boolean' && typeof value.autoPerformance === 'boolean' && Number.isFinite(value.glowStrength))
      return { glowEnabled: value.glowEnabled, glowStrength: Math.max(0, Math.min(2.5, value.glowStrength)), autoPerformance: value.autoPerformance };
  } catch { /* Defaults work even when local settings are unavailable. */ }
  return { ...defaultRenderSettings };
}
export function saveRenderSettings(value: RenderSettings) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* optional settings persistence */ } }

/** Detect sustained slow rendering, excluding startup and background throttling. */
export class PerformanceMonitor {
  private warmUntil = 0;
  private start = 0;
  private frames = 0;
  private elapsed = 0;
  reset(now: number) { this.warmUntil = now + 2000; this.start = 0; this.frames = 0; this.elapsed = 0; }
  sample(frameMs: number, now: number, eligible: boolean): boolean {
    if (!eligible || frameMs <= 0 || frameMs > 1500) { this.reset(now); return false; }
    if (now < this.warmUntil) return false;
    if (!this.start) this.start = now;
    this.frames++; this.elapsed += frameMs;
    if (now - this.start < 3000) return false;
    const slow = this.frames >= 3 && this.elapsed / this.frames > 48; // sustained <21 FPS
    this.start = now; this.frames = 0; this.elapsed = 0;
    return slow;
  }
}
