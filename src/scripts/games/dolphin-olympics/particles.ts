import { GRAVITY, rad } from './constants';

/* Particles live in the level's scrolling "background" space: the manager
   itself scrolls horizontally with the world (its x), and vertically via
   the background's y, so a particle's stage position is
   (manager.x + p.x, bgY + p.y). */

export type ParticleKind = 'dot' | 'drop' | 'spark' | 'firework' | 'shadow';

export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  dead = false;
  bounded = true;
  age = 0;
  kind: ParticleKind = 'dot';
  protected _angle: number;
  protected _vz: number;

  constructor(vz = 0, angle = 0, public life = 10, public color = 0xffffff) {
    this._angle = angle;
    this._vz = 0;
    this.vz = vz;
  }

  /* Angle is in degrees; setting the scalar speed re-aims the velocity. */
  get angle(): number {
    return this._angle;
  }

  set angle(a: number) {
    this._angle = a;
  }

  get vz(): number {
    return this._vz;
  }

  set vz(v: number) {
    this.vx = Math.cos(rad(this._angle)) * v;
    this.vy = Math.sin(rad(this._angle)) * v;
    this._vz = v;
  }

  die(): void {
    this.dead = true;
  }

  update(): void {
    if (this.dead) return;
    this.x += this.vx;
    this.y += this.vy;
    this.age++;
    if (this.age > this.life) this.die();
  }
}

/* Spray thrown up when the dolphin breaks the surface. y=0 is the surface;
   the drop dies as soon as it falls back below it. */
export class WaterDrop extends Particle {
  constructor(vz = 0, angle = 0, life = 100) {
    super(vz, angle, life);
    this.kind = 'drop';
    const pick = Math.floor(Math.random() * 3) + 1;
    this.color = pick === 1 ? 0xc7fcfc : pick === 2 ? 0xfffefc : 0xe7fffd;
  }

  override update(): void {
    if (this.dead) return;
    this.vy += GRAVITY / 2;
    this.x += this.vx;
    this.y += this.vy;
    if (this.y > 0) this.die();
  }
}

/* A twinkle shed by a boosted dolphin. */
export class Spark extends Particle {
  constructor(vz = 0, angle = 0, life = 100) {
    super(vz, angle, life);
    this.kind = 'spark';
  }
}

export class Firework extends Particle {
  private readonly airFriction = 0.9;

  constructor(vz = 0, angle = 0, life = 100, public glowColor = 0xff00ff) {
    super(vz, angle, life);
    this.kind = 'firework';
    this.bounded = false;
  }

  override update(): void {
    this.vz = this.vz * this.airFriction;
    this.vy += GRAVITY / 2;
    super.update();
  }
}

/* A fading after-image of the dolphin: rainbow-tinted for a star-trail
   speed bonus, whitened for a ring's speed trail. */
export class Shadow extends Particle {
  readonly tint: string;

  constructor(public dolphinAngle: number, public roll: number, colored = true, life = 70) {
    super(0, 0, life);
    this.kind = 'shadow';
    if (colored) {
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      this.tint = `rgb(${r},${g},${b})`;
    } else {
      this.tint = 'rgb(236,244,252)';
    }
  }

  /* Alpha drops by 15/255 a frame, so it is gone well before its life is. */
  get alpha(): number {
    return Math.max(0, 1 - (this.age * 15) / 255);
  }
}

export class ParticleManager {
  x = 0;
  particles: Particle[] = [];

  add(p: Particle): void {
    this.particles.push(p);
  }

  /* parentY is the background's y — needed to cull against the stage. */
  update(parentY: number): void {
    const list = this.particles;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.update();
      if (p.bounded) {
        const sx = p.x + this.x;
        if (sx < 0 || sx > 640) {
          p.dead = true;
        } else {
          const sy = parentY + p.y;
          if (sy > 480 || sy < 0) p.dead = true;
        }
      }
      if (p.dead) {
        list.splice(i, 1);
        i--;
      }
    }
  }

  clear(): void {
    this.particles = [];
  }
}
