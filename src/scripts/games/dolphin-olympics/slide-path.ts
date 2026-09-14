import { randNum, type Pt } from './constants';
import { Path } from './path';

/* A rail the dolphin can tailslide along: the water surface, or one of the
   star trails up in space. The rail is a bezier path with a 35px-wide
   invisible hit stroke; the game samples points ahead of the dolphin each
   frame to see whether it has reached one. */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CurvePoint {
  cx: number;
  cy: number;
  x: number;
  y: number;
}

const PATH_WIDTH = 35;
const HIT_RADIUS = PATH_WIDTH / 2;

export class SlidePath {
  x = 0;
  y = 0;
  name = '';
  popMult = 1;
  slideBoost = 0;
  readonly path = new Path();
  /* Length as the original measured it (100 chord samples) — this, not the
     path's own length, sets how fast the dolphin progresses along a rail. */
  length = 0;
  width = 0;
  height = 0;

  protected curvePoints: CurvePoint[] = [];
  private poly: Pt[] = [];
  private minX = 0;
  private minY = 0;

  constructor(public friction = 0) {}

  curveTo(cx: number, cy: number, x: number, y: number): void {
    this.curvePoints.push({ cx, cy, x, y });
  }

  drawPath(): void {
    this.path.clear();
    this.path.moveTo(0, 0);
    for (const cp of this.curvePoints) this.path.curveTo(cp.cx, cp.cy, cp.x, cp.y);
    this.calculateLength();
    this.buildPolyline();
  }

  /* Hook for subclasses that decorate the rail once its shape is known. */
  draw(): void {}

  private calculateLength(): void {
    let t = 0;
    this.length = 0;
    while (t < 0.99) {
      const a = this.path.pointAt(t);
      t += 0.01;
      const b = this.path.pointAt(t);
      this.length += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  private buildPolyline(): void {
    /* Dense enough that a point-to-polyline distance is a faithful stand-in
       for Flash's stroke hit test. */
    const steps = Math.max(8, Math.ceil(this.path.length / 6));
    this.poly = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i <= steps; i++) {
      const p = this.path.pointAt(i / steps);
      this.poly.push(p);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.minX = minX - HIT_RADIUS;
    this.minY = minY - HIT_RADIUS;
    this.width = maxX - minX + PATH_WIDTH;
    this.height = maxY - minY + PATH_WIDTH;
  }

  get polyline(): readonly Pt[] {
    return this.poly;
  }

  /* Does a stage-space point lie on the rail's hit stroke? The rail sits in
     background space, so its stage position is (x, bgY + y). */
  hitTestPoint(sx: number, sy: number, bgY: number): boolean {
    const px = sx - this.x;
    const py = sy - (bgY + this.y);
    if (px < this.minX || px > this.minX + this.width || py < this.minY || py > this.minY + this.height) return false;
    const r2 = HIT_RADIUS * HIT_RADIUS;
    const poly = this.poly;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const ex = a.x + dx * t - px;
      const ey = a.y + dy * t - py;
      if (ex * ex + ey * ey <= r2) return true;
    }
    return false;
  }

  /* Walk along the rail until a 10px circle on it overlaps the dolphin's
     bounding box; that fraction is where the slide starts. */
  findCollisionPoint(bounds: Bounds, bgY: number): number {
    let t = 0;
    while (t < 1) {
      const p = this.path.pointAt(t);
      const cx = p.x + this.x;
      const cy = p.y + bgY + this.y;
      if (cx + 10 >= bounds.left && cx - 10 <= bounds.right && cy + 10 >= bounds.top && cy - 10 <= bounds.bottom) break;
      t += 0.0025;
    }
    return t;
  }
}

export interface StarSprite {
  x: number;
  y: number;
  scale: number;
}

/* The star trails in space: same rail, less friction, a slightly stronger
   pop, and a speed bonus for riding one — plus a scatter of stars along it
   so you can see where it runs. */
export class StarPath extends SlidePath {
  stars: StarSprite[] = [];

  constructor(friction = 0.075) {
    super(friction);
    this.popMult = 1.05;
    this.slideBoost = 1;
  }

  override draw(): void {
    const spread = 25;
    const density = 20 / this.path.length;
    this.stars = [];
    let t = 0;
    while (t < 1) {
      const p = this.path.pointAt(t);
      this.stars.push({
        x: p.x + randNum(-spread, spread),
        y: p.y + randNum(-spread, spread),
        scale: 0.8 + randNum(-spread, spread) / 35,
      });
      t += density;
    }
  }
}
