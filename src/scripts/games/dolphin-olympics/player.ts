import { deg, rad } from './constants';
import { ParticleManager, Shadow, Spark } from './particles';
import type { SlidePath } from './slide-path';

/* The dolphin. It never moves on screen — it sits at stage centre while
   the world scrolls under it — so "position" here is really velocity and
   heading. Units are pixels per frame and degrees; heading 0 points right,
   90 straight down (stage y grows downward).

   Two velocities coexist: the dolphin's own (vx, vy — with vz the scalar
   speed along its heading) and a "crash" velocity left over from a bad
   landing or a floor impact, which decays and then folds back into the
   main one. */

export type Anim =
  | 'moving'
  | 'accelerating'
  | 'turningLeft'
  | 'turningRight'
  | 'rolling'
  | 'tailslide'
  | 'crashingRight';

const V_MAX = 13;
const POWER = 1.4;
const TURN_RADIUS = 2;
const MAX_TURN = 10.5;
const MIN_TURN = 2;
const FALL_V_MAX = 120;
const SLIDE_HEIGHT = 15;
const ROLL_INTERVAL = 2;
const ROLL_FRAMES = 14;
const SPARK_SPREAD = 40;
const SHADOW_SPEED = 15;
const BASE_GLOW = 2;

/* Bounding box of the drawn dolphin before rotation, in stage pixels. */
export const PLAYER_W = 96.4;
export const PLAYER_H = 56.4;

export class Player {
  x = 320;
  y = 240;

  private _vx = 0;
  private _vy = 0;
  private _angle = 0;
  private _vBoost = 0;
  private _slideBoost = 0;
  private _crashVx = 0;
  private _crashVy = 0;
  crashAngle = 0;

  accelerating = false;
  moving = false;
  turningLeft = false;
  turningRight = false;
  upsideDown = false;
  slowingDown = false;
  jumping = false;
  sliding = false;
  landing = false;
  hitFloor = false;
  exhausted = false;
  rolling = false;
  swimming = true;
  betweenJumps = false;
  slideReady = false;
  kicked = false;
  stopped = false;

  spinDegs = 0;
  rollCount = 0;
  rollFrameCount = 0;
  private rollBuffer = 0;
  slideTime = 0;
  private slideDir: 'left' | 'right' | '' = '';
  private slideRatio = 0;
  private slidePath: SlidePath | null = null;

  /* Visuals: which animation is showing, a running frame counter for it,
     the glow while boosted, and sparkle bookkeeping. */
  anim: Anim = 'moving';
  animFrame = 0;
  glowAlpha = 0;
  glowBlur = 0;
  private glowing = false;
  private oldBoost = 0;
  private sparkCount = 0;
  private shadowCount = 0;
  private sparkling = false;
  private trailPending = 0;
  private trailAccMs = 0;

  pm: ParticleManager | null = null;
  bgY = 0;

  onRoll: () => void = () => {};
  onEndSlide: () => void = () => {};
  onVelocityChanged: () => void = () => {};

  /* --- velocity ---------------------------------------------------- */

  get vx(): number {
    return this._vx;
  }

  set vx(v: number) {
    this._vx = v;
  }

  get vy(): number {
    return this._vy;
  }

  set vy(v: number) {
    this._vy = v > FALL_V_MAX ? FALL_V_MAX : v;
  }

  get vz(): number {
    return Math.sqrt(this._vx * this._vx + this._vy * this._vy);
  }

  /* Setting the speed re-aims the velocity along the current heading —
     this is what makes turning underwater redirect your momentum. */
  set vz(v: number) {
    this.onVelocityChanged();
    this.vx = Math.cos((this._angle * Math.PI) / 180) * v;
    this.vy = Math.sin((this._angle * Math.PI) / 180) * v;
  }

  get angle(): number {
    return this._angle;
  }

  set angle(a: number) {
    this._angle = a;
  }

  get vBoost(): number {
    return this._vBoost;
  }

  set vBoost(v: number) {
    this._vBoost = v;
    this.onVelocityChanged();
  }

  get slideBoost(): number {
    return this._slideBoost;
  }

  set slideBoost(v: number) {
    this._slideBoost = v > 10 ? 10 : v;
  }

  get crashVx(): number {
    return this._crashVx;
  }

  set crashVx(v: number) {
    this._crashVx = v;
  }

  get crashVy(): number {
    return this._crashVy;
  }

  set crashVy(v: number) {
    this._crashVy = v;
  }

  get crashVz(): number {
    return Math.sqrt(this._crashVx * this._crashVx + this._crashVy * this._crashVy);
  }

  set crashVz(v: number) {
    this._crashVx = Math.cos((this.crashAngle * Math.PI) / 180) * v;
    this._crashVy = Math.sin((this.crashAngle * Math.PI) / 180) * v;
  }

  /* --- animation --------------------------------------------------- */

  private gotoAndStop(anim: Anim): void {
    if (this.anim !== anim) this.animFrame = 0;
    this.anim = anim;
    this.stopped = true;
  }

  private gotoAndPlay(anim: Anim): void {
    if (this.anim !== anim) this.animFrame = 0;
    this.anim = anim;
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
  }

  clearState(): void {
    this.accelerating = false;
    this.turningLeft = false;
    this.turningRight = false;
    this.moving = false;
    this.upsideDown = false;
    this.slowingDown = false;
    this.sliding = false;
  }

  /* --- controls ---------------------------------------------------- */

  startTurn(dir: 'left' | 'right'): void {
    if (dir === 'left' && !this.turningLeft) {
      this.turningLeft = true;
      if (!this.rolling) this.gotoAndStop('turningLeft');
    } else if (dir === 'right' && !this.turningRight) {
      this.turningRight = true;
      if (!this.rolling) this.gotoAndStop('turningRight');
    }
  }

  endTurn(dir: 'left' | 'right'): void {
    if (dir === 'left') this.turningLeft = false;
    else if (dir === 'right') this.turningRight = false;
    if (!this.rolling && !this.sliding) {
      if (this.turningRight) this.gotoAndStop('turningRight');
      else if (this.turningLeft) this.gotoAndStop('turningLeft');
      else if (this.accelerating && !this.jumping) this.gotoAndPlay('accelerating');
      else this.gotoAndStop('moving');
    }
  }

  startAccelerating(): void {
    if (!this.accelerating && !this.sliding) {
      this.accelerating = true;
      if (!this.rolling && !this.turningLeft && !this.turningRight && !this.jumping) {
        this.gotoAndPlay('accelerating');
      }
    }
  }

  startRoll(): void {
    if (!this.rolling) {
      this.rolling = true;
      this.gotoAndStop('rolling');
    }
  }

  stopRoll(): void {
    this.rolling = false;
    this.rollFrameCount = 0;
    if (!this.sliding) {
      if (this.turningRight) this.gotoAndStop('turningRight');
      else if (this.turningLeft) this.gotoAndStop('turningLeft');
      else if (this.accelerating) this.gotoAndPlay('accelerating');
    }
  }

  /* --- per-frame physics ------------------------------------------- */

  update(): void {
    if (this.accelerating) this.accelerate();
    if (this.rolling) this.roll();
    if (this.turningLeft) this.turn('left');
    else if (this.turningRight) this.turn('right');
    this.animFrame++;
  }

  accelerate(): void {
    if (!this.exhausted && !this.jumping && !this.rolling) {
      if (this.vz < V_MAX + this.vBoost) this.vz = this.vz + POWER;
      /* Leftover crash momentum is worked off faster while accelerating. */
      if (this.crashVz > POWER) {
        this.crashVz = this.crashVz - POWER * 0.65;
        this.vz = this.vz + POWER * 0.65;
      }
    }
  }

  private turn(dir: 'left' | 'right'): void {
    const sign = dir === 'left' ? -1 : 1;
    let amount = this.vz / TURN_RADIUS + MIN_TURN;
    if (amount > MAX_TURN) amount = MAX_TURN;
    else if (amount < -MAX_TURN) amount = -MAX_TURN;
    if (this.jumping) {
      const airMin = 2.5;
      if (amount < airMin && amount > 0) amount = airMin;
      else if (amount > -airMin && amount < 0) amount = -airMin;
      if (this.rolling) amount /= 1.3;
      this.spinDegs += sign * amount;
      this._angle += sign * amount;
    } else {
      this._angle += sign * amount;
    }
    if (this._angle < 0) this._angle += 360;
    else if (this._angle > 360) this._angle -= 360;
  }

  private roll(): void {
    if (this.sliding) return;
    this.rollBuffer++;
    if (this.rollBuffer >= ROLL_INTERVAL) {
      this.rollBuffer = 0;
      this.rollFrameCount++;
      if (this.rollFrameCount >= ROLL_FRAMES) {
        this.gotoAndStop('rolling');
        this.rollFrameCount = 0;
        if (this.jumping) {
          this.rollCount++;
          this.onRoll();
        }
      }
    }
  }

  /* Fraction of a full barrel roll currently shown, for drawing. */
  get rollPhase(): number {
    return this.rolling ? this.rollFrameCount / ROLL_FRAMES : 0;
  }

  /* --- surface / slides ------------------------------------------- */

  land(): void {
    this.jumping = false;
    this.sliding = false;
    this.kicked = false;
    this.swimming = true;
    if (this.accelerating && !this.turningLeft && !this.turningRight) this.gotoAndPlay('accelerating');
    this.spinDegs = 0;
  }

  startSlide(dir: 'left' | 'right', path: SlidePath): void {
    this.slidePath = path;
    this.kicked = false;
    this.clearState();
    this.sliding = true;
    this.slideTime = 0;
    this.gotoAndPlay('tailslide');
    this.y -= SLIDE_HEIGHT;
    this.slideDir = dir;
    this.vy = 0;
    this.slideRatio = 90 / this.vx;
  }

  slide(): void {
    this.slideTime++;
  }

  endSlide(): void {
    if (this.slideDir === 'right') {
      this.gotoAndStop('turningRight');
      this.angle = 180 + this.vx * this.slideRatio * 2;
    } else if (this.slideDir === 'left') {
      this.gotoAndStop('turningLeft');
      this.angle = 360 - this.vx * this.slideRatio * 2;
    }
    this.slideTime = 0;
    this.sliding = false;
    this.jumping = true;
    this.crashVz = 0;
    this.slideReady = false;
    this.y = 240;
    this.vy = this.vy - 2;
    this.onEndSlide();
  }

  /* Kick off a rail early: the slide's speed becomes upward launch speed,
     scaled up by any star-trail bonus banked so far. */
  popSlide(): void {
    if (this.kicked || !this.slidePath) return;
    this.kicked = true;
    this.gotoAndStop('moving');
    this.vy = -Math.abs(this.vx / 1.5) * this.slidePath.popMult + this.slideBoost;
    if (this.slideBoost > 0) this.vy = this.vy * (1 + this.slideBoost / 4);
    if (this.angle > 0 && this.angle < 180) this.vx = -this.vx;
    const launch = 360 + deg(Math.atan2(this.vy, this.vx));
    if (this.slideDir === 'right') this.angle = launch;
    else this.angle = 180 + Math.abs(launch);
    this.endSlide();
  }

  /* --- effects ----------------------------------------------------- */

  startSparkle(): void {
    this.sparkling = true;
  }

  endSparkle(): void {
    this.sparkling = false;
  }

  speedTrail(): void {
    this.trailPending = 12;
    this.trailAccMs = 0;
  }

  /* Called once per frame; runs the original's 15ms sparkle timer and 50ms
     trail timer at their equivalent frame rates. */
  effects(): void {
    if (this.sparkling) {
      this.sparkle();
      this.sparkle();
    }
    if (this.trailPending > 0) {
      this.trailAccMs += 1000 / 31;
      while (this.trailAccMs >= 50 && this.trailPending > 0) {
        this.trailAccMs -= 50;
        this.trailPending--;
        this.leaveTrail();
      }
    }
  }

  private sparkle(): void {
    const pm = this.pm;
    if (this.vBoost > 0) {
      if (this.vBoost !== this.oldBoost) {
        this.glowBlur = BASE_GLOW + this.vBoost * 0.5;
        this.glowAlpha = Math.max(0, 0.6 - 1.5 / this.vBoost);
        this.glowing = true;
      }
      this.oldBoost = this.vBoost;
      const threshold = 2 / this.vBoost;
      if (this.sparkCount >= threshold) {
        if (pm) {
          const spark = new Spark(0, 0, 50);
          spark.x = 320 - pm.x + Math.random() * SPARK_SPREAD + Math.random() * -SPARK_SPREAD;
          spark.y = 240 - this.bgY + Math.random() * SPARK_SPREAD + Math.random() * -SPARK_SPREAD;
          pm.add(spark);
        }
        this.sparkCount = 0;
      } else {
        this.sparkCount += 0.1;
      }
      if (this.slideBoost > 0) {
        if (this.shadowCount > SHADOW_SPEED) {
          if (pm) {
            const shadow = new Shadow(this.angle, this.rollPhase);
            shadow.x = 320 - pm.x;
            shadow.y = 240 - this.bgY;
            if (this.sliding) shadow.y -= 10;
            pm.add(shadow);
          }
          this.shadowCount = 0;
        } else {
          this.shadowCount += this.slideBoost;
        }
      }
    } else if (this.glowing) {
      if (this.glowAlpha > 0) {
        this.glowAlpha -= 0.075;
      } else {
        this.glowing = false;
        this.glowAlpha = 0;
      }
    }
  }

  private leaveTrail(): void {
    const pm = this.pm;
    if (!pm) return;
    const shadow = new Shadow(this.angle, this.rollPhase, false, 70);
    shadow.x = 320 - pm.x;
    shadow.y = 240 - this.bgY;
    if (this.sliding) shadow.y -= 10;
    pm.add(shadow);
  }

  /* Axis-aligned stage bounds of the rotated dolphin. */
  bounds(): { left: number; top: number; right: number; bottom: number } {
    const a = rad(this.angle);
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    const hw = (PLAYER_W * c + PLAYER_H * s) / 2;
    const hh = (PLAYER_W * s + PLAYER_H * c) / 2;
    return { left: this.x - hw, top: this.y - hh, right: this.x + hw, bottom: this.y + hh };
  }
}
