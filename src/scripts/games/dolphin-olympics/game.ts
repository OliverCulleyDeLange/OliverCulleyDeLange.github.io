import { CX, CY, FPS, GRAVITY, WATER_FRICTION, deg, frames, normalize, rad, roundTo } from './constants';
import { Controller, type GameKey } from './controller';
import { Fish, FrameTimer, type Collidable } from './creatures';
import { Level } from './level';
import { Player } from './player';
import type { SlidePath } from './slide-path';
import type { Pt } from './constants';

/* The rules of the game: swimming, jumping, tailslides, crashes, tricks,
   combos and the two-minute clock. This is a straight port of the original
   game state's per-frame logic, so the numbers here are the original's.

   Freestyle is the timed, scored mode; Free Swim is the same world with no
   clock and no score. */

export type GameMode = 'freestyle' | 'freeswim';

const QUANTIFIERS = ['', 'Double', 'Triple', 'Quadruple', 'Quintuple', 'Sextuple', 'Septuple', 'Octuple', 'Nonuple', 'Decuple'];

export class Trick {
  private _count = 0;
  private quantifier = '';

  constructor(private readonly baseName: string, public value = 0, public action: (() => void) | null = null) {}

  get name(): string {
    return this.quantifier + this.baseName;
  }

  get count(): number {
    return this._count;
  }

  /* Repeats within a combo rename the trick: "Double Front Flip". */
  set count(n: number) {
    this._count = n;
    let q = n < QUANTIFIERS.length ? QUANTIFIERS[Math.max(0, n - 1)] : `${n + 1}-Tuple`;
    if (n < 1) q = '';
    this.quantifier = n > 1 ? q + ' ' : q;
  }
}

export class HeightTrick extends Trick {
  done = false;

  constructor(name: string, value: number, public height: number, action: (() => void) | null = null) {
    super(name, value, action);
  }
}

export interface GameStats {
  score: number;
  longestJump: number;
  highestJump: number;
  biggestSplash: number;
  longestTailslide: number;
  highestSpeed: number;
  biggestCombo: number;
}

export class DolphinGame {
  readonly player: Player;
  readonly controller: Controller;

  paused = false;
  over = false;
  /* True once the end-of-game panel should be showing. */
  ended = false;
  onGameEnd: (stats: GameStats) => void = () => {};

  /* Records for the end screen. */
  private longestJump = 0;
  private highestJump = 0;
  private biggestSplash = 0;
  private longestTailslide = 0;
  private highestSpeed = 0;
  private biggestCombo = 0;

  /* Scoring. */
  score = 0;
  liveScoreText = '';
  comboNames: string[] = [];
  private gameTime = 120;
  private jumpTotal = 0;
  private multiplier = 0;
  private combo: Trick[] = [];
  private tricks!: Record<string, Trick>;
  private heightTricks: HeightTrick[] = [];
  private ticker = 0;
  private sinceJump = 0;
  private readonly comboGap = FPS;
  private lastFlip = '';
  private watchingSlide = false;
  private entryAng = 0;
  private lastAng = 0;
  private waterDegs = 0;
  private carouselReady = false;
  private startCarousel = false;
  private carouselRecord = 0;

  /* Jumping, sliding, crashing. */
  private jumpTimer = 0;
  private jumpXTotal = 0;
  private jumpYTotal = 0;
  private crashTimer = 0;
  private inSpace = false;
  private currentPath: SlidePath | null = null;
  private pathPoint = 0;
  private slideSpeed = 0;
  private onWater = false;
  private slideTimer = 0;
  private slideDistance = 0;
  private thisPoint: Pt = { x: 0, y: 0 };
  private lastPoint: Pt = { x: 0, y: 0 };
  private readonly dismountTimer = new FrameTimer(frames(500));
  private readonly endTimer: FrameTimer;
  private fireworkShots = 0;
  private fireworkCountdown = 0;
  private activeCreatures: Collidable[] = [];

  constructor(readonly level: Level, readonly mode: GameMode) {
    this.player = new Player();
    this.player.pm = level.pm;
    this.controller = new Controller(this.player);
    this.player.onEndSlide = () => this.endSlide();
    this.player.onVelocityChanged = () => this.checkSpeed();
    this.player.onRoll = () => this.addToCombo(this.tricks.corkscrew);
    this.endTimer = new FrameTimer(frames(1000), () => this.endTimerComplete());
    this.buildTricks();
  }

  private buildTricks(): void {
    const level = this.level;
    this.tricks = {
      frontFlip: new Trick('Front Flip', 500),
      backFlip: new Trick('Back Flip', 500),
      niceEntry: new Trick('Nice Entry', 50),
      frontRewind: new Trick('Frontside Rewind', 750),
      backRewind: new Trick('Backside Rewind', 750),
      tailslide: new Trick('Tailslide', 150),
      starslide: new Trick('Starslide', 1500),
      corkscrew: new Trick('Corkscrew', 150),
      reversal: new Trick('Reversal', 300),
      wraparound: new Trick('Wraparound', 600),
      carousel: new Trick('Carnival', 1500),
      schooled: new Trick('Schooled', 150),
      celebration: new HeightTrick('Firecracker!', 1000, level.celebHeight, () => this.onCelebration()),
      moon: new HeightTrick('Apollo 18!', 2500, level.moonHeight),
      mars: new HeightTrick('Mission to Mars!', 5000, level.marsHeight),
      nebulous: new HeightTrick('Nebulous!', 10000, level.nebulaHeight),
      jupiter: new HeightTrick('Wandering Star!', 20000, level.jupiterHeight),
      saturn: new HeightTrick('Ringer!', 50000, level.saturnHeight),
      neptune: new HeightTrick("Wizard's Eye!", 500000, level.neptuneHeight),
      uranus: new HeightTrick('Passing Gas!', 250000, level.uranusHeight),
      pluto: new HeightTrick('New Horizons!', 750000, level.plutoHeight),
      restaurant: new HeightTrick('So long and thanks for all the flips!', 1000000, level.endHeight),
      extension: new Trick('Extension', 250),
      schoolsOut: new Trick("School's Out!", 15000),
    };
    this.heightTricks = Object.values(this.tricks).filter((t): t is HeightTrick => t instanceof HeightTrick);
  }

  /* --- lifecycle --------------------------------------------------- */

  enter(): void {
    this.startGame();
  }

  exit(): void {
    this.controller.disable();
    this.player.endSparkle();
  }

  startGame(): void {
    const p = this.player;
    p.clearState();
    p.anim = 'moving';
    p.stopped = true;
    p.vz = 0;
    p.crashVz = 0;
    p.vBoost = 0;
    p.slideBoost = 0;
    p.angle = 0;
    p.jumping = false;
    p.sliding = false;
    p.hitFloor = false;
    p.betweenJumps = false;
    p.y = CY;
    this.crashTimer = 0;
    this.level.reset();
    p.startSparkle();
    this.controller.enable();
    this.over = false;
    this.ended = false;
    this.paused = false;
    this.score = 0;
    this.liveScoreText = '';
    this.multiplier = 0;
    this.gameTime = 120;
    this.ticker = 0;
    this.jumpTotal = 0;
    p.spinDegs = 0;
    this.combo = [];
    this.comboNames = [];
    this.biggestCombo = 0;
    this.longestJump = 0;
    this.highestJump = 0;
    this.biggestSplash = 0;
    this.longestTailslide = 0;
    this.highestSpeed = 0;
    this.endTimer.reset();
    this.fireworkShots = 0;
    this.currentPath = null;
    this.onWater = false;
    this.pathPoint = 0;
    this.inSpace = false;
    this.jumpTimer = 0;
    this.activeCreatures = [];
    for (const t of Object.values(this.tricks)) t.count = 0;
    this.level.startRings();
  }

  pause(): void {
    this.paused = !this.paused;
    if (this.paused) {
      this.controller.disable();
      this.player.endSparkle();
      this.level.stopRings();
    } else {
      this.controller.enable();
      this.player.startSparkle();
      this.level.startRings();
    }
  }

  keyDown(key: GameKey): void {
    this.controller.keyDown(key);
    if (key === 'left' || key === 'right') this.carouselReady = true;
  }

  /* The window lost focus: treat every held key as released so nothing
     stays stuck down. */
  releaseAllKeys(): void {
    for (const key of this.controller.heldKeys) this.keyUp(key);
  }

  keyUp(key: GameKey): void {
    this.controller.keyUp(key);
    if (key === 'left' || key === 'right') {
      this.startCarousel = false;
      this.carouselReady = false;
      this.carouselRecord = 0;
    }
  }

  get timeText(): string {
    const t = Math.max(0, this.gameTime);
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  get stats(): GameStats {
    return {
      score: this.score,
      longestJump: roundTo(this.longestJump / 50, 2),
      highestJump: roundTo(this.highestJump / 50, 2),
      biggestSplash: roundTo(this.biggestSplash / 4, 2),
      longestTailslide: roundTo(this.longestTailslide / 50, 2),
      highestSpeed: roundTo((this.highestSpeed * FPS) / 50, 2),
      biggestCombo: this.biggestCombo,
    };
  }

  /* --- per frame --------------------------------------------------- */

  frame(): void {
    if (this.paused) return;
    this.dismountTimer.tick();
    this.endTimer.tick();
    if (this.fireworkShots > 0) {
      this.fireworkCountdown--;
      if (this.fireworkCountdown <= 0) {
        this.fireworkCountdown = frames(100);
        this.fireworkShots--;
        this.level.fireworks(CX, CY - this.level.bgY, 1, this.player.vx, this.player.vy);
      }
    }
    this.player.bgY = this.level.bgY;
    this.player.effects();
    this.update();
  }

  private update(): void {
    const p = this.player;
    const level = this.level;
    if (this.over) return;
    this.checkPaths();
    if (p.y < level.surfaceHeight) {
      p.swimming = false;
      if (!p.jumping && !p.sliding) {
        this.launchPlayer();
      } else if (p.sliding) {
        this.continueSlide();
        this.watchSlide();
      } else if (p.jumping) {
        this.continueJump();
        this.watchJump();
      }
    } else if (p.jumping) {
      this.landPlayer();
    } else if (p.y > level.bottom) {
      this.crashPlayer();
    } else if (p.hitFloor) {
      this.continueCrash();
    } else {
      this.applyFriction();
      if (p.betweenJumps) {
        let d = Math.abs(p.angle - this.lastAng);
        if (d > 20) d = 20;
        this.waterDegs += d;
        this.lastAng = p.angle;
      }
    }
    this.ticker++;
    if (this.ticker >= FPS) {
      this.ticker = 0;
      this.tick();
    }
    if (p.betweenJumps) {
      if (!p.rolling && !p.sliding) this.sinceJump++;
      if (this.sinceJump > this.comboGap) {
        this.sinceJump = 0;
        this.endCombo();
      }
    }
    if (!p.sliding) this.scroll(p.vx + p.crashVx, p.vy + p.crashVy);
    this.checkHeightTricks();
    this.updateObjs();
    this.level.tick();
    p.update();
  }

  private tick(): void {
    if (this.mode === 'freeswim') return;
    this.gameTime--;
    if (this.gameTime <= 0) {
      this.ticker = FPS;
      if (this.player.swimming) this.endGame();
    }
  }

  /* --- movement ---------------------------------------------------- */

  private scroll(dx: number, dy: number): void {
    const level = this.level;
    level.scrollLevel(dx, dy);
    if (!this.inSpace) {
      if (level.bgY > -level.moonHeight) this.inSpace = true;
    } else if (level.bgY < -level.moonHeight) {
      this.inSpace = false;
    }
  }

  /* Underwater drag: speed bleeds off along the heading each frame, a
     near-stationary dolphin sinks slowly, and leftover crash momentum
     decays and then merges back into the main velocity. */
  private applyFriction(): void {
    const p = this.player;
    const vz = p.vz;
    if (vz > 1) p.vz = vz - WATER_FRICTION;
    else if (vz < -1) p.vz = vz + WATER_FRICTION;
    else if (this.level.bottom > 275) p.vy = GRAVITY;
    else p.vy = 0;
    const cvz = p.crashVz;
    if (cvz > WATER_FRICTION) {
      p.crashVz = cvz - WATER_FRICTION;
    } else if (cvz < -WATER_FRICTION) {
      p.crashVz = cvz + WATER_FRICTION;
    } else if (cvz < vz && cvz !== 0) {
      p.vz = vz + cvz;
      p.crashVz = 0;
      p.crashAngle = p.angle;
    }
  }

  private launchPlayer(): void {
    const p = this.player;
    p.jumping = true;
    this.jumpXTotal = 0;
    this.jumpYTotal = 0;
    if (p.crashVx !== 0) {
      p.vx += p.crashVx;
      p.crashVx = 0;
    }
    if (p.crashVy !== 0) {
      p.vy += p.crashVy;
      p.crashVy = 0;
    }
    this.level.splash(CX, 0, p.vz);

    /* Freestyle: what did the swim between jumps earn? */
    this.sinceJump = 0;
    if ((this.controller.leftDown || this.controller.rightDown) && !this.carouselReady) this.carouselReady = true;
    if (this.carouselReady) {
      this.carouselReady = false;
      this.startCarousel = true;
    }
    if (p.betweenJumps) {
      const a = p.angle;
      const exitDir = a > 90 && a < 270 ? 'left' : 'right';
      const entryDir = this.entryAng > 90 && this.entryAng < 270 ? 'left' : 'right';
      if (exitDir !== entryDir) this.addToCombo(this.tricks.reversal);
      else if (this.waterDegs >= 200) this.addToCombo(this.tricks.wraparound);
    }
    p.betweenJumps = false;
    if (this.activeCreatures.length >= 7) {
      this.addToCombo(this.tricks.schoolsOut);
    }
    for (let i = 0; i < this.activeCreatures.length; i++) {
      this.addToCombo(this.tricks.schooled);
      p.vBoost += 0.25;
    }
  }

  private continueJump(): void {
    const p = this.player;
    p.vy += GRAVITY;
    this.jumpXTotal += Math.abs(p.vx);
    if (p.vy < 0) this.jumpYTotal -= p.vy;
    this.jumpTimer++;
  }

  /* Re-entry: compare the dolphin's facing with its direction of travel.
     Nose-first (within 28 degrees) after a decent hang time is a Nice
     Entry that banks a speed boost; anything else is a crash landing that
     ends the combo. */
  private landPlayer(): void {
    const p = this.player;
    this.jumpXTotal = Math.abs(this.jumpXTotal);
    if (this.jumpXTotal > this.longestJump) this.longestJump = this.jumpXTotal;
    if (this.jumpYTotal > this.highestJump) this.highestJump = this.jumpYTotal;
    this.jumpYTotal = 0;
    this.jumpXTotal = 0;
    const vx = p.vx;
    let travel = deg(Math.atan2(p.vy, Math.abs(vx)));
    if (vx < 0) travel = 180 - travel;
    let facing = p.angle;
    if (facing > travel + 180) facing -= 360;
    let diff = Math.abs(facing - travel);
    let backwards = false;
    if (diff > 90) {
      diff = 180 - diff;
      backwards = true;
    }
    const splashSize = ((p.vy * diff) / 100) * 2.5;
    if (splashSize > this.biggestSplash) this.biggestSplash = splashSize;
    this.level.splash(CX, 0, splashSize);
    if (backwards || diff > 28) {
      const loss = diff / 100;
      p.crashAngle = travel;
      p.crashVx = p.vx * (1 - loss);
      p.vx = 0;
      p.crashVy = p.vy * (1 - loss);
      if (backwards) {
        p.crashVx /= 2;
        p.crashVy /= 2;
      }
      p.vy = 0;
      p.slideBoost = 0;
      this.niceEntry(false);
    } else if (this.jumpTimer > 40) {
      this.niceEntry(true);
    }
    this.jumpTimer = 0;
    p.land();
    if (this.controller.upDown) p.startAccelerating();

    p.betweenJumps = true;
    this.entryAng = p.angle;
    this.lastAng = this.entryAng;
    this.waterDegs = 0;
    this.lastFlip = '';
    this.watchingSlide = false;
    for (const t of this.heightTricks) t.done = false;
    p.swimming = true;
  }

  private niceEntry(good: boolean): void {
    const p = this.player;
    if (good) {
      p.vBoost += 2 + this.combo.length / 3;
      this.addToCombo(this.tricks.niceEntry);
      if (this.startCarousel) {
        this.addToCombo(this.tricks.carousel);
        this.carouselRecord++;
        this.carouselReady = true;
      } else if (this.carouselReady) {
        this.carouselReady = false;
        this.startCarousel = true;
      }
    } else {
      p.vBoost = 0;
      this.endCombo();
    }
  }

  /* Hitting the sea floor: a short, uncontrollable bounce. */
  private crashPlayer(): void {
    const p = this.player;
    p.clearState();
    this.controller.disable();
    if (p.crashVy === 0) {
      p.crashAngle = 360 - p.angle;
      this.level.moveBG(p.vy);
    } else {
      p.crashAngle = 360 - p.crashAngle;
      this.level.moveBG(p.crashVy);
    }
    p.crashVy = -7;
    p.crashVx = p.vx / 4;
    p.anim = 'crashingRight';
    p.animFrame = 0;
    p.stopped = false;
    p.vy = 0;
    p.vx = 0;
    p.hitFloor = true;
  }

  private continueCrash(): void {
    const p = this.player;
    if (this.crashTimer >= 40) {
      p.hitFloor = false;
      p.crashVy = 0;
      p.vx = p.crashVx;
      p.crashVx = 0;
      p.vBoost = 0;
      p.slideBoost = 0;
      this.controller.enable();
      p.anim = 'accelerating';
      p.animFrame = 0;
      p.stopped = false;
      this.crashTimer = 0;
    } else {
      this.crashTimer++;
      this.applyFriction();
      this.level.scrollLevel(p.crashVx, p.crashVy);
    }
  }

  /* --- tailslides -------------------------------------------------- */

  /* Look a little way ahead of the dolphin for a rail (the surface, or a
     star trail); on contact snap the world so the contact point sits
     under the dolphin and start sliding. */
  private checkPaths(): void {
    const p = this.player;
    const level = this.level;
    if (!(p.slideReady && !p.sliding && p.vy < 50)) return;
    let hit = false;
    for (const path of level.paths) {
      const px = path.x;
      const py = level.bgY + path.y;
      if (level.bgY <= 400 && p.vy > 0) break;
      if (px >= -path.width && px < 640 + path.width && py > -path.height && py < path.height + 480) {
        const vz = p.vz;
        const a = rad(p.angle);
        let d = 0;
        while (d < vz) {
          const sx = Math.cos(a) * d + CX;
          const sy = Math.sin(a) * d + CY;
          if (path.hitTestPoint(sx, sy, level.bgY)) {
            hit = true;
            path.x -= sx - CX;
            level.moveBG(-(sy - CY));
            break;
          }
          d += 15;
        }
      }
      if (hit && Math.abs(p.vx) > 2 && !this.dismountTimer.running) {
        this.pathPoint = path.findCollisionPoint(p.bounds(), level.bgY);
        this.currentPath = path;
        this.startSlide();
        break;
      }
    }
  }

  private startSlide(): void {
    const p = this.player;
    const path = this.currentPath!;
    this.thisPoint = path.path.pointAt(this.pathPoint);
    const dirAngle = normalize((path.path.angleAt(this.pathPoint) * 180) / Math.PI);
    if (dirAngle > 90 && dirAngle < 270) p.vx = -p.vx;
    p.angle = dirAngle - 90;
    this.slideSpeed = 1 / (path.length / p.vx);
    this.onWater = this.level.bgY <= 300;
    p.startSlide(p.vx > 0 ? 'right' : 'left', path);
    this.sinceJump = 0;
    p.betweenJumps = false;
    this.lastFlip = '';
    this.level.moveBG(10);
  }

  private continueSlide(): void {
    const p = this.player;
    const path = this.currentPath!;
    p.slide();
    this.slideDistance += p.vx;
    const friction = path.friction;
    if (p.vx > 1) p.vx -= friction;
    else if (p.vx < -1) p.vx += friction;
    else p.vx = 0;
    this.slideSpeed = 1 / (path.length / p.vx);
    const dirAngle = normalize((path.path.angleAt(this.pathPoint) * 180) / Math.PI);
    p.angle = dirAngle - 90;
    if (this.onWater) {
      this.level.scrollLevel(p.vx, 0);
      this.slideTimer++;
      if (this.slideTimer === 3) {
        this.level.splash(CX, 0, p.vx, true);
        this.slideTimer = 0;
      }
    } else {
      this.lastPoint = this.thisPoint;
      this.thisPoint = path.path.pointAt(this.pathPoint);
      this.level.scrollLevel(this.thisPoint.x - this.lastPoint.x, this.thisPoint.y - this.lastPoint.y);
      this.pathPoint += this.slideSpeed;
    }
    if ((p.vx < 1 && p.vx >= 0) || (p.vx > -1 && p.vx <= 0) || this.pathPoint >= 1 || this.pathPoint < 0) {
      if (dirAngle > 90 && dirAngle < 270) p.vx = -p.vx;
      p.endSlide();
      this.onWater = false;
      this.pathPoint = 0;
      this.dismountTimer.start();
    }
  }

  private endSlide(): void {
    const p = this.player;
    const path = this.currentPath;
    if (path) {
      p.slideBoost += path.slideBoost;
      path.slideBoost /= 2;
    }
    this.currentPath = null;
    this.onWater = false;
    if (this.slideDistance > this.longestTailslide) this.longestTailslide = this.slideDistance;
    this.slideDistance = 0;
  }

  private watchSlide(): void {
    const p = this.player;
    if (!this.watchingSlide) {
      this.watchingSlide = true;
      this.addToCombo(this.onWater ? this.tricks.tailslide : this.tricks.starslide);
    }
    if (this.onWater) this.jumpTotal += Math.floor(p.slideTime * 2);
    else this.jumpTotal += Math.floor(p.slideTime * 3.5);
    this.setLiveScore(this.jumpTotal);
  }

  /* --- tricks ------------------------------------------------------ */

  private watchJump(): void {
    const p = this.player;
    const spin = p.spinDegs;
    let trick: Trick | null = null;
    if (spin >= 360) {
      if (this.lastFlip === 'Back Flip') {
        trick = this.tricks.backRewind;
        this.lastFlip = '';
      } else {
        trick = this.tricks.frontFlip;
        this.lastFlip = 'Front Flip';
      }
    } else if (spin <= -360) {
      if (this.lastFlip === 'Front Flip') {
        trick = this.tricks.frontRewind;
        this.lastFlip = '';
      } else {
        trick = this.tricks.backFlip;
        this.lastFlip = 'Back Flip';
      }
    }
    if (trick) {
      this.addToCombo(trick);
      p.spinDegs = 0;
    }
  }

  private checkHeightTricks(): void {
    for (const t of this.heightTricks) {
      if (!t.done && this.level.bgY > -t.height) {
        t.done = true;
        this.addToCombo(t);
      }
    }
  }

  private onCelebration(): void {
    this.fireworkShots = 5;
    this.fireworkCountdown = frames(100);
  }

  private onRing(): void {
    const p = this.player;
    if (!p.jumping) {
      p.vz = p.vz + 12.5;
      p.betweenJumps = true;
    } else {
      p.vy -= 17.5;
    }
    for (const c of this.activeCreatures) {
      if (c instanceof Fish && c.chaseSpeed) {
        c.chaseSpeed += 12.5;
        c.vBoost += 0.5;
      }
    }
    p.vBoost += 0.5;
    this.sinceJump = 0;
    p.speedTrail();
    this.gameTime++;
    this.addToCombo(this.tricks.extension);
  }

  /* A trick joins the current combo; repeats are worth their full points
     but add less and less to the multiplier (1, then 1/2, 1/3...). */
  private addToCombo(trick: Trick): void {
    if (!this.combo.includes(trick)) this.combo.push(trick);
    trick.count++;
    this.jumpTotal += trick.value;
    this.multiplier += 1 / trick.count;
    this.comboNames = this.combo.map((t) => t.name);
    this.setLiveScore(this.jumpTotal);
    if (trick.action) trick.action();
  }

  private endCombo(): void {
    this.jumpTotal *= this.multiplier;
    this.score += Math.round(this.jumpTotal);
    let total = 0;
    for (const t of this.combo) {
      total += t.count;
      t.count = 0;
    }
    if (total > this.biggestCombo) this.biggestCombo = total;
    this.combo = [];
    this.comboNames = [];
    this.liveScoreText = '';
    this.jumpTotal = 0;
    this.player.spinDegs = 0;
    this.multiplier = 0;
    this.player.betweenJumps = false;
    this.watchingSlide = false;
    for (const t of Object.values(this.tricks)) t.count = 0;
  }

  private setLiveScore(value: number): void {
    if (value === 0) return;
    let text = value.toLocaleString('en-GB');
    if (this.multiplier > 1) text += ' x ' + roundTo(this.multiplier, 2);
    this.liveScoreText = text;
  }

  private checkSpeed(): void {
    const v = this.player.vz + this.player.vBoost;
    if (v > this.highestSpeed) this.highestSpeed = v;
  }

  /* --- creatures --------------------------------------------------- */

  private updateObjs(): void {
    const p = this.player;
    const level = this.level;
    for (const c of level.collidables) {
      c.update();
      const half = c.hitHalf;
      if (!p.sliding && !c.activated && c.y > CY - half && c.y < CY + half) {
        if (c.x > CX - half && c.x < CX + half) {
          c.activate(p);
          if (c.kind === 'ring') {
            this.onRing();
          } else if (!p.jumping) {
            this.activeCreatures.push(c);
          }
        }
      }
    }
    for (const fish of level.fish) {
      if (fish.y < level.bgY && !fish.jumping) fish.startJump();
      else if (fish.y > level.bgY && fish.jumping) fish.endJump();
    }
    for (let i = 0; i < this.activeCreatures.length; i++) {
      if (!this.activeCreatures[i].activated) this.activeCreatures.splice(i, 1);
    }
  }

  /* --- ending ------------------------------------------------------ */

  private endGame(): void {
    this.controller.disable();
    this.over = true;
    this.player.stop();
    this.player.vBoost = 0;
    this.player.vz = 0;
    this.endTimer.start();
  }

  private endTimerComplete(): void {
    this.endCombo();
    this.ended = true;
    this.onGameEnd(this.stats);
  }
}
