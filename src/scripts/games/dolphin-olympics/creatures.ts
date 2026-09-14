import { GRAVITY, WATER_FRICTION, deg, frames, randNum } from './constants';

/* Things in the water and sky the dolphin can interact with. They live in
   stage space and are moved directly as the world scrolls. */

export interface ChaseTarget {
  x: number;
  y: number;
  vz: number;
  vBoost: number;
}

/* A one-shot timer with the original's Timer(delay, 1) semantics: "running"
   from start() until it fires once. */
export class FrameTimer {
  private remaining = 0;
  running = false;

  constructor(private readonly duration: number, private readonly onComplete: () => void = () => {}) {}

  start(): void {
    this.running = true;
    this.remaining = this.duration;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.running = false;
    this.remaining = this.duration;
  }

  tick(): void {
    if (!this.running) return;
    this.remaining--;
    if (this.remaining <= 0) {
      this.running = false;
      this.onComplete();
    }
  }
}

export type CollidableKind = 'fish' | 'gull' | 'ring';

export abstract class Collidable {
  x = 0;
  y = 0;
  name = '';
  width = 20;
  abstract readonly kind: CollidableKind;
  /* Half the hit zone's height — the game uses it for both axes. */
  hitHalf = 100;
  protected activeTimer: FrameTimer;

  constructor() {
    this.activeTimer = new FrameTimer(frames(5000), () => this.onActiveTimer());
  }

  protected onActiveTimer(): void {}

  get activated(): boolean {
    return this.activeTimer.running;
  }

  activate(_target: ChaseTarget): void {
    this.activeTimer.start();
  }

  deactivate(): void {
    this.activeTimer.stop();
    this.activeTimer.reset();
  }

  tickTimers(): void {
    this.activeTimer.tick();
  }

  update(): void {}
}

export abstract class Creature extends Collidable {
  protected _scalar = 0.65;
  protected _vBoost = 0;
  protected _speed = 10;
  protected _vx = 0;
  protected _vy = 0;
  protected _angle = 0;
  protected _chaseSpeed = 14;
  protected _vMax = 14;
  protected dirAdjust: number;
  /* Drawing: rotation in degrees, and whether the sprite is flipped so it
     never swims belly-up. */
  rotation = 0;
  flipY = false;

  constructor() {
    super();
    this.dirAdjust = randNum(0, 2) === 0 ? Math.PI : 0;
  }

  get angle(): number {
    return this._angle;
  }

  set angle(a: number) {
    this.rotation = deg(a);
    this.flipY = a > Math.PI / 2 && a < Math.PI * 1.5;
    this._angle = a;
  }

  get scale(): number {
    return this._scalar;
  }

  get speed(): number {
    return this._speed;
  }

  set speed(v: number) {
    this._speed = v;
  }

  get vBoost(): number {
    return this._vBoost;
  }

  set vBoost(v: number) {
    this._vBoost = v;
  }

  get chaseSpeed(): number {
    return this._chaseSpeed;
  }

  set chaseSpeed(v: number) {
    this._chaseSpeed = v;
  }
}

export type FishVariant = 'yellow' | 'orange' | 'green' | 'blue';

/* Fish wander until the dolphin swims close, then chase it for a while
   (a school following you scores "Schooled" on your next launch). Any fish
   carried above the surface arcs back down under gravity. */
export class Fish extends Creature {
  readonly kind = 'fish';
  variant: FishVariant = 'yellow';
  protected turnSpeed = 0.175;
  protected target: ChaseTarget | null = null;
  protected followRand = 0;
  protected _jumping = false;
  protected landTimer = new FrameTimer(frames(1000));
  protected turnCounter = 0;
  protected readonly bottom: number;
  /* Animation state for drawing. */
  animFrame = 0;
  playing = true;

  constructor(_top = 0, bottom = 0) {
    super();
    this.bottom = bottom;
    if (randNum(1, 10) === 1) this.angle = Math.PI;
    this._speed = randNum(6, 8);
    this.width = 22;
  }

  get jumping(): boolean {
    return this._jumping;
  }

  override activate(target: ChaseTarget): void {
    if (this._jumping) return;
    this._vBoost += target.vBoost * 0.75;
    this.activeTimer.start();
    this.target = target;
  }

  override deactivate(): void {
    super.deactivate();
    this._vBoost = 0;
    this.target = null;
  }

  /* After five seconds of chasing: give up if the dolphin got away,
     otherwise keep going for another five. */
  protected override onActiveTimer(): void {
    const t = this.target;
    if (!t) return;
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    if (Math.sqrt(dx * dx + dy * dy) > 300) {
      this.deactivate();
    } else {
      this.activeTimer.reset();
      this.activeTimer.start();
    }
  }

  override tickTimers(): void {
    super.tickTimers();
    this.landTimer.tick();
  }

  override update(): void {
    if (this.playing) {
      if (this.x < 0 || this.x > 640) this.playing = false;
    } else if (this.x >= 0 && this.x <= 640) {
      this.playing = true;
    }
    if (this.playing) this.animFrame++;
    if (!this._jumping) this.swim();
    else this.jump();
  }

  protected swim(): void {
    this.updateSpeed();
    if (!this.activated) {
      if (this.y > this.bottom) {
        /* Too deep: bend back up towards the surface. */
        if (this._angle > Math.PI / 2 && this._angle < Math.PI * 1.5) this._angle += 0.1;
        else this._angle -= 0.1;
      } else {
        this.wander();
      }
    } else {
      this.follow();
    }
    this.x += this._vx;
    this.y += this._vy;
  }

  /* The base fish only occasionally nudges its heading. */
  protected wander(): void {
    if (randNum(1, 10) === 1) this.changeDir();
  }

  protected changeDir(): void {
    this.angle += 0.1 * randNum(-1, 2);
  }

  protected updateSpeed(): void {
    if (!this.activated) {
      this._vx = Math.cos(this._angle) * (this.speed + this.vBoost);
      this._vy = Math.sin(this._angle) * (this.speed + this.vBoost);
    } else {
      const t = this.target!;
      let v = this.chaseSpeed + this.vBoost;
      if (v > t.vz) v = t.vz + 0.5;
      if (v <= 2) v = 7;
      this._vx = Math.cos(this._angle) * v;
      this._vy = Math.sin(this._angle) * v;
      if (this.chaseSpeed > this._vMax) this.chaseSpeed -= WATER_FRICTION;
    }
  }

  protected follow(): void {
    const t = this.target!;
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    const want = Math.atan2(dy, dx);
    const diff = want - this.angle;
    if (diff > Math.PI || diff < -Math.PI) {
      if (this.angle > 0) this.angle = -2 * Math.PI + this.angle;
      else this.angle = Math.PI * 2 + this.angle;
      return;
    }
    this.angle += diff * this.turnSpeed + Math.sin(this.followRand) / 10;
    this.followRand += 0.01;
  }

  protected jump(): void {
    this._vy += GRAVITY;
    this.x += this._vx;
    this.y += this._vy;
    this.angle = Math.atan2(this._vy, this._vx);
  }

  startJump(): void {
    this.deactivate();
    this._jumping = true;
    this.dirAdjust = this.angle > Math.PI / 2 && this.angle < Math.PI * 1.5 ? Math.PI : 0;
  }

  endJump(): void {
    this._vy = this.speed;
    this._jumping = false;
    this.turnCounter = Math.sin(this.angle);
    this.landTimer.start();
  }
}

export class Greenfish extends Fish {
  constructor(top = 0, bottom = 0) {
    super(top, bottom);
    this.variant = 'green';
    this._scalar = Math.random() / 6 + 0.25;
    this.width = 85 * this._scalar;
  }

  protected override wander(): void {
    this.changeDir();
  }

  protected override changeDir(): void {
    if (!this.landTimer.running) {
      this.angle = Math.sin(this.turnCounter) + this.dirAdjust;
      this.turnCounter += 0.1;
    }
  }
}

export class Orangefish extends Fish {
  constructor(top = 0, bottom = 0) {
    super(top, bottom);
    this.variant = 'orange';
    this.turnSpeed = 0.15;
    this.angle = randNum(0, Math.PI * 2);
    this.width = 18;
  }

  protected override jump(): void {
    super.jump();
    this.angle += 0.2;
  }

  protected override wander(): void {
    this.changeDir();
  }

  protected override changeDir(): void {
    if (!this.landTimer.running) {
      this.angle += 0.25 * Math.sin(this.turnCounter);
      this.turnCounter += 0.1;
    }
  }
}

export class Bluefish extends Fish {
  constructor(top = 0, bottom = 0) {
    super(top, bottom);
    this.variant = 'blue';
    this._scalar = Math.random() / 6 + 0.35;
    this.width = 136 * this._scalar;
  }

  protected override jump(): void {
    super.jump();
    this.angle += 0.2;
  }

  protected override wander(): void {
    this.changeDir();
  }

  protected override changeDir(): void {
    if (!this.landTimer.running) {
      this.angle = Math.sin(this.turnCounter) * Math.cos(this.turnCounter / 4) + this.dirAdjust;
      this.turnCounter += 0.05;
      if (this.turnCounter > 2 * Math.PI) this.turnCounter = -2 * Math.PI;
    }
  }
}

/* Gulls drift along above the waves, flapping now and then to stay within
   a band of altitude. */
export class Seagull extends Creature {
  readonly kind = 'gull';
  private readonly flapPower = 1;
  private readonly maxVY = 2;
  private dy = 0;
  flapFrame = -1;

  constructor(private readonly maxAlt = 0, private readonly minAlt = 0) {
    super();
    this._speed = 2;
    this._vx = this._speed;
    this.width = 34;
  }

  private flap(): void {
    this.flapFrame = 0;
    this._vy -= this.flapPower;
    if (this._vy > this.maxVY) this._vy = this.maxVY;
  }

  override update(): void {
    this.x += this._vx;
    this.y += this._vy;
    this.dy += this._vy;
    if (this.dy > this.minAlt) {
      const over = this.dy - this.minAlt;
      this.y -= over;
      this.dy -= over;
      this._vy = 0;
    } else if (this.dy < this.maxAlt) {
      const over = Math.abs(this.dy - this.maxAlt);
      this.y += over;
      this.dy += over;
      this._vy = 0;
    }
    this._vy += GRAVITY / 25;
    if (this._vy < -this.maxVY) this._vy = -this.maxVY;
    if (randNum(0, 40) === 0) this.flap();
    if (this.flapFrame >= 0) {
      this.flapFrame++;
      if (this.flapFrame > 13) this.flapFrame = -1;
    }
  }
}
