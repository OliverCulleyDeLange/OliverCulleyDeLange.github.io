import type { Pt } from './constants';

/* A chain of quadratic bezier segments addressed by fraction of total
   length, matching the path library the original game used for its
   tailslide rails. pointAt(t) and angleAt(t) take t in [0, 1] as a share of
   the whole path's length; within a segment the remaining share maps
   straight onto the bezier parameter (the original made the same
   simplification, so keeping it keeps slides feeling identical). */

const CURVE_ACCURACY = 5;

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

class CurveSegment {
  readonly length: number;

  constructor(readonly start: Pt, readonly control: Pt, readonly end: Pt) {
    /* Coarse polyline estimate, exactly as coarse as the original's — the
       same estimate feeds slide speed, so it has to match. */
    let len = 0;
    let prev = start;
    for (let i = 1; i < CURVE_ACCURACY; i++) {
      const p = this.pointAt(i / CURVE_ACCURACY);
      len += dist(prev, p);
      prev = p;
    }
    this.length = len + dist(prev, end);
  }

  pointAt(t: number): Pt {
    const a = lerp(this.start, this.control, t);
    const b = lerp(this.control, this.end, t);
    return lerp(a, b, t);
  }

  angleAt(t: number): number {
    const a = lerp(this.start, this.control, t);
    const b = lerp(this.control, this.end, t);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}

export class Path {
  private segments: CurveSegment[] = [];
  private position: Pt = { x: 0, y: 0 };
  private cachedLength = -1;

  clear(): void {
    this.segments = [];
    this.position = { x: 0, y: 0 };
    this.cachedLength = -1;
  }

  moveTo(x: number, y: number): void {
    this.position = { x, y };
  }

  curveTo(cx: number, cy: number, x: number, y: number): void {
    const end = { x, y };
    this.segments.push(new CurveSegment(this.position, { x: cx, y: cy }, end));
    this.position = end;
    this.cachedLength = -1;
  }

  get length(): number {
    if (this.cachedLength < 0) {
      this.cachedLength = this.segments.reduce((sum, seg) => sum + seg.length, 0);
    }
    return this.cachedLength;
  }

  /* Out-of-range t wraps around the path, as the original's did. */
  private clean(t: number): number {
    if (Number.isNaN(t)) return 0;
    if (t < 0 || t > 1) {
      t %= 1;
      if (t < 0) t += 1;
    }
    return t;
  }

  pointAt(t: number): Pt {
    t = this.clean(t);
    const segs = this.segments;
    if (segs.length === 0) return { x: 0, y: 0 };
    if (t === 0) return { ...segs[0].start };
    if (t === 1) return { ...segs[segs.length - 1].end };
    const target = t * this.length;
    let acc = 0;
    let before = 0;
    for (const seg of segs) {
      if (seg.length === 0) continue;
      acc += seg.length;
      if (target <= acc) return seg.pointAt((target - before) / seg.length);
      before = acc;
    }
    return { ...segs[segs.length - 1].end };
  }

  angleAt(t: number): number {
    t = this.clean(t);
    const segs = this.segments;
    if (segs.length === 0) return 0;
    const target = t * this.length;
    let acc = 0;
    let before = 0;
    for (const seg of segs) {
      if (seg.length === 0) continue;
      acc += seg.length;
      if (target <= acc) return seg.angleAt((target - before) / seg.length);
      before = acc;
    }
    return segs[segs.length - 1].angleAt(1);
  }
}
