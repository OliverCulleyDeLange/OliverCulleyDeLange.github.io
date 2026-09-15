/* Shared constants and tiny helpers for the Dolphin Olympics port.

   Everything is in the original's units: a 640x480 stage, simulated at a
   fixed 31 frames per second, with distances in stage pixels and velocities
   in pixels per frame. Keeping the units means the physics constants can be
   used verbatim rather than re-tuned. */

export const W = 640;
export const H = 480;
export const CX = 320;
export const CY = 240;

export const FPS = 31;
export const GRAVITY = 0.45;
export const WATER_FRICTION = 0.2;
export const PIXELS_PER_METRE = 50;

/* Real-time timers in the original (ms) become frame counts here so the
   simulation stays deterministic regardless of the display refresh rate. */
export const frames = (ms: number): number => Math.max(1, Math.round((ms / 1000) * FPS));

/* Integer in [a, b) — the original's MathSG.randNum. */
export const randNum = (a: number, b: number): number => Math.floor(Math.random() * (b - a)) + a;

export const rad = (d: number): number => (d * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;

/* Single-step wrap into [0, 360] — deliberately not a full modulo, matching
   the original's MathSG.normalize. */
export function normalize(a: number): number {
  if (a < 0) a += 360;
  else if (a > 360) a -= 360;
  return a;
}

export function roundTo(n: number, places: number): number {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

export interface Pt {
  x: number;
  y: number;
}
