import { GRAVITY, frames, randNum, type Pt } from './constants';
import { Bluefish, Fish, Greenfish, Orangefish, Seagull, type Collidable } from './creatures';
import { Firework, ParticleManager, WaterDrop } from './particles';
import { Ring } from './ring';
import { SlidePath, StarPath } from './slide-path';

/* The world. The dolphin stays put at (320, 240); the world scrolls past.

   Two coordinate spaces matter:
   - "background" space, whose origin is the water surface line (y grows
     downward into the sea, negative is sky). Its stage position is offset
     by bgY, so the surface is drawn at stage y = bgY. Scenery, star trails,
     particles and planets live here.
   - stage space, for creatures and rings, which are simply shifted every
     frame the world scrolls.

   Horizontal parallax layers scroll their tiles by a fraction of the
   dolphin's horizontal speed and wrap them, exactly as the original did. */

export type SkyMode = 'day' | 'evening' | 'night';

export interface Tile {
  x: number;
  kind: number;
}

export interface Layer {
  speed: number;
  tiles: Tile[];
  y: number;
}

export interface Cloud {
  type: number;
  x: number;
  y: number;
}

export interface StarDot {
  x: number;
  y: number;
  r: number;
  color: string;
  arm: number;
}

export interface StarField {
  y: number;
  layerCount: number;
  layer1: StarDot[];
  layer2: StarDot[];
  layer3: StarDot[];
}

export interface Planet {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LEFT_BOUND = -640;
const RIGHT_BOUND = 640;
const S_LEFT_BOUND = -5000;
const S_RIGHT_BOUND = 5000;

export const WATER_HEIGHT = 847.05;
export const WAVE_HEIGHT = 12.9;
export const FLOOR_Y = 815;
export const FLOOR_BASE_Y = 847;
export const REEF_Y = 762;
export const FLOOR2_Y = WATER_HEIGHT - 162.5;
export const FLOOR3_Y = WATER_HEIGHT - 402;
export const SKY_TOP = 2 - 2358.8;

const randomHex = (): string => '#' + Math.round(Math.random() * 0xffffff).toString(16).padStart(6, '0');

function wrapTile(x: number, lb: number, rb: number): number {
  if (x > rb) x = lb + (x - rb);
  if (x < lb) x = rb + (x - lb);
  return x;
}

export class Level {
  bgY = 0;
  readonly pm = new ParticleManager();

  collidables: Collidable[] = [];
  fish: Fish[] = [];
  birds: Seagull[] = [];
  paths: SlidePath[] = [];
  starPaths: StarPath[] = [];
  readonly surface: SlidePath;

  starHeight = -1500;
  readonly celebHeight = -1750;
  readonly moonHeight = -3500;
  readonly marsHeight = -6000;
  readonly nebulaHeight = -8000;
  readonly jupiterHeight = -11000;
  readonly saturnHeight = -14000;
  readonly uranusHeight = -20000;
  readonly neptuneHeight = -30000;
  readonly plutoHeight = -45000;
  readonly endHeight = -100000;

  readonly skyMode: SkyMode;
  readonly darkness: number;

  readonly ocean: Layer = { speed: 1, tiles: [{ x: 0, kind: 0 }, { x: -640, kind: 1 }], y: -WAVE_HEIGHT + 2 };
  readonly floor: Layer = { speed: 1, tiles: [{ x: 0, kind: 0 }, { x: -640, kind: 1 }], y: FLOOR_Y };
  readonly floor2: Layer = { speed: 0.125, tiles: [{ x: 0, kind: 0 }, { x: -640, kind: 1 }], y: FLOOR2_Y };
  readonly floor3: Layer = { speed: 0.05, tiles: [{ x: 0, kind: 0 }, { x: -640, kind: 1 }], y: FLOOR3_Y };
  readonly reef: Layer = { speed: 0.25, tiles: [{ x: 0, kind: 0 }, { x: -640, kind: 1 }], y: REEF_Y };
  readonly clouds: Cloud[] = [];
  readonly cloudSpeed = 0.5;
  readonly starFields: StarField[] = [];
  readonly planets: Planet[] = [];

  private readonly maxRings = 5;
  private ringCount = 0;
  private skyRingCount = 0;
  private waterRingCount = 0;
  private collCount = 0;
  private ringSwitch = 0;
  private waterRingBase: Pt | null = null;
  private skyRingBase: Pt | null = null;
  private ringTimerRunning = false;
  private ringTimerRemaining = 0;
  private readonly ringInterval = frames(10000);

  constructor() {
    const hour = new Date().getHours();
    if (hour >= 19 && hour < 22) {
      this.skyMode = 'evening';
      this.starHeight += 400;
      this.darkness = 50 / 255;
    } else if (hour >= 22 || hour <= 4) {
      this.skyMode = 'night';
      this.starHeight += 750;
      this.darkness = 90 / 255;
    } else {
      this.skyMode = 'day';
      this.darkness = 0;
    }

    /* The water surface is itself a rail: hold Down as you surface to
       tailslide along it. */
    this.surface = new SlidePath(0.2);
    this.surface.curveTo(0, 0, 640, 0);
    this.surface.drawPath();
    this.surface.draw();
    this.surface.y = -WAVE_HEIGHT;
    this.surface.name = 'surface';
    this.paths.push(this.surface);

    this.buildStars();
    this.addFish(25);
    this.addGulls(3);
    this.addClouds(randNum(2, 4));
  }

  get bottom(): number {
    return this.bgY + WATER_HEIGHT - 20;
  }

  get surfaceHeight(): number {
    return this.bgY;
  }

  /* --- construction ---------------------------------------------- */

  private buildStars(): void {
    for (let i = 0; i < 3; i++) this.starFields.push(this.buildStarField(this.starHeight - 480 * i, 25));

    this.planets.push({ name: 'moon', x: 0, y: this.moonHeight, w: 325, h: 300 });
    this.planets.push({ name: 'mars', x: 600 - 256, y: this.marsHeight, w: 256, h: 299 });
    this.planets.push({ name: 'nebula', x: 0, y: this.nebulaHeight, w: 623, h: 702 });
    this.planets.push({ name: 'jupiter', x: 640 - 350, y: this.jupiterHeight, w: 350, h: 497 });
    this.planets.push({ name: 'saturn', x: 100, y: this.saturnHeight, w: 500, h: 350 });
    this.planets.push({ name: 'neptune', x: 0, y: this.neptuneHeight, w: 250, h: 250 });
    this.planets.push({ name: 'uranus', x: 340, y: this.uranusHeight, w: 210, h: 210 });
    this.planets.push({ name: 'pluto', x: 170, y: this.plutoHeight, w: 200, h: 200 });
    this.planets.push({ name: 'diner', x: -15, y: this.endHeight, w: 625, h: 479 });

    const add = (curves: number[][], x: number, y: number): void => {
      const p = new StarPath();
      for (const [cx, cy, ex, ey] of curves) p.curveTo(cx, cy, ex, ey);
      p.drawPath();
      p.draw();
      p.x = x;
      p.y = y;
      this.paths.push(p);
      this.starPaths.push(p);
    };

    add([[408, 288, 884, -4], [1368, -348, 1820, 0]], 0, this.moonHeight - 300);
    add(
      [
        [288, 84, 546, -18], [852, -138, 984, -402], [1134, -702, 1032, -936], [834, -1320, 354, -1236],
        [6, -1104, 24, -738], [66, -402, 432, -234], [840, -60, 1308, -42], [1980, -6, 2190, 252],
        [2394, 636, 2112, 942], [1686, 1170, 1428, 738], [1350, 390, 1668, 294], [2088, 192, 2508, 276],
        [2778, 300, 2934, 204],
      ],
      4950,
      this.marsHeight + 200
    );
    add([[456, 444, 1278, 330], [2184, 180, 2628, 414], [3300, 702, 3666, 300]], -4950, this.nebulaHeight + 450);
    add(
      [
        [260, -128, 484, -4], [808, 164, 1052, -12], [1376, -252, 1248, -640], [1136, -884, 804, -868],
        [464, -820, 484, -520], [516, -216, 868, -200], [1400, -220, 1576, -32], [1824, 228, 2124, 12],
        [2456, -228, 1900, -476], [1612, -632, 1708, -800], [1844, -1024, 2264, -696],
      ],
      500,
      this.nebulaHeight - 250
    );
    add([[904, 32, 1044, -456], [1496, -1132, 596, -1232], [28, -1304, 184, -1692], [372, -1992, 752, -1892]], 3500, this.jupiterHeight + 300);
    add([[4, -484, 664, -424], [1296, -356, 1772, -560], [2260, -780, 2420, -456]], 4500, this.saturnHeight - 300);
    add(
      [
        [776, -68, 932, -232], [1100, -368, 936, -436], [640, -540, -76, -460], [-420, -388, -100, -284],
        [452, -220, 736, -384], [1016, -544, 740, -592], [472, -676, 12, -636], [-140, -588, -12, -524],
        [412, -464, 576, -580], [732, -700, 564, -760], [468, -808, 296, -808], [140, -768, 276, -716],
        [476, -708, 504, -900], [492, -1060, 408, -1044],
      ],
      -2000,
      this.neptuneHeight + 300
    );
    add(
      [[138, 612, 768, 408], [2076, -66, 2682, 300], [2976, 492, 2994, 732], [2964, 1056, 2640, 1190], [1974, 1368, 1805, 888]],
      -1000,
      this.saturnHeight - 1300
    );
    add(
      [
        [628, -4, 684, -556], [676, -1060, 0, -1164], [-660, -1080, -628, -544], [-536, -136, -124, -188],
        [416, -216, 376, -588], [376, -924, 24, -948], [-300, -880, -284, -624], [-236, -360, 4, -372],
        [221, -404, 208, -600], [204, -788, 4, -782],
      ],
      -4950,
      this.neptuneHeight
    );
    add(
      [
        [165, -195, 475, -185], [775, -190, 910, -30], [1030, 190, 915, 345], [765, 520, 560, 530],
        [260, 485, 245, 245], [295, 15, 545, 25], [910, 15, 1345, 345], [1640, 550, 1980, 460],
        [2415, 360, 2535, 20], [2710, -535, 2015, -760], [1530, -815, 1455, -435], [1410, -125, 1905, -80],
        [2185, -35, 2415, -290],
      ],
      0,
      this.uranusHeight + 250
    );
    add(
      [
        [540, 268, 1204, 20], [1828, -296, 1636, -792], [1392, -1192, 772, -1044], [292, -820, 540, -360],
        [804, 52, 2112, -204], [2676, -280, 2976, -592], [3252, -880, 3704, -688],
      ],
      4000,
      this.plutoHeight - 2000
    );
  }

  private buildStarField(y: number, density: number): StarField {
    const layer1: StarDot[] = [];
    const layer2: StarDot[] = [];
    const layer3: StarDot[] = [];
    for (let i = 0; i < density; i++) {
      layer1.push({ x: Math.random() * 640, y: Math.random() * 480, r: 1, color: '#ffffff', arm: 0 });
    }
    for (let i = 0; i < density; i++) {
      layer2.push({ x: Math.random() * 640, y: Math.random() * 480, r: Math.random() * 2 + 1, color: randomHex(), arm: 0 });
    }
    for (let i = 0; i < density / 2; i++) {
      layer3.push({ x: Math.random() * 640, y: Math.random() * 480, r: Math.random() * 3 + 1, color: randomHex(), arm: randNum(5, 15) });
    }
    return { y, layerCount: 1, layer1, layer2, layer3 };
  }

  private addFish(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = randNum(S_LEFT_BOUND, S_RIGHT_BOUND);
      const y = randNum(100, 600);
      let fish: Fish;
      switch (randNum(1, 5)) {
        case 1:
          fish = new Orangefish(this.bgY, WATER_HEIGHT);
          break;
        case 2:
          fish = new Fish(this.bgY, WATER_HEIGHT);
          break;
        case 3:
          fish = new Greenfish(this.bgY, WATER_HEIGHT);
          break;
        default:
          fish = new Bluefish(this.bgY, WATER_HEIGHT);
      }
      fish.x = x;
      fish.y = y;
      fish.name = 'fish' + i;
      this.collidables.push(fish);
      this.fish.push(fish);
    }
  }

  private addGulls(count: number): void {
    for (let i = 0; i < count; i++) {
      const gull = new Seagull(-200, 200);
      gull.x = randNum(S_LEFT_BOUND, S_RIGHT_BOUND);
      gull.y = randNum(-350, -450);
      gull.name = 'gull' + i;
      this.collidables.push(gull);
      this.birds.push(gull);
    }
  }

  private addClouds(count: number): void {
    for (let i = 0; i < count; i++) {
      let x = randNum(LEFT_BOUND, RIGHT_BOUND);
      if (randNum(0, 2) === 1) x = -x;
      this.clouds.push({ type: randNum(0, 3), x, y: randNum(-600, -400) });
    }
  }

  /* --- rings ------------------------------------------------------- */

  startRings(): void {
    if (!this.ringTimerRunning) {
      this.ringTimerRunning = true;
      this.ringTimerRemaining = this.ringInterval;
    }
  }

  stopRings(): void {
    this.ringTimerRunning = false;
  }

  private addRing(): void {
    if (this.ringCount >= this.maxRings) return;
    let base: Pt;
    if (randNum(0, 2) === 1) {
      if (this.skyRingCount === 0 || this.skyRingBase === null) {
        if (this.skyRingBase === null) {
          this.skyRingBase = { x: randNum(LEFT_BOUND, RIGHT_BOUND), y: randNum(-650, -200) };
        } else {
          this.skyRingBase.x += 4000;
          this.skyRingBase.y = randNum(-650, -200);
        }
      }
      base = this.skyRingBase;
    } else {
      if (this.waterRingCount === 0 || this.waterRingBase === null) {
        if (this.waterRingBase === null) {
          this.waterRingBase = { x: randNum(LEFT_BOUND, RIGHT_BOUND), y: randNum(200, 600) };
        } else {
          this.waterRingBase.x += 4000;
          this.waterRingBase.y = randNum(200, 600);
        }
      }
      base = this.waterRingBase;
    }
    let ring: Ring;
    if (base.y < 0) {
      ring = new Ring(0xff0000);
      this.skyRingCount++;
    } else {
      ring = new Ring();
      this.waterRingCount++;
    }
    ring.x = base.x + this.ringCount * 600;
    ring.y = base.y + 150 * Math.sin(this.ringSwitch) + this.bgY;
    this.ringSwitch += Math.PI / 2;
    this.collCount++;
    ring.name = 'ring' + this.collCount;
    ring.onDead = (dead) => this.killColl(dead);
    this.collidables.push(ring);
    this.ringCount++;
  }

  private killColl(ring: Ring): void {
    const index = this.collidables.indexOf(ring);
    if (index !== -1) {
      this.collidables.splice(index, 1);
      if (ring.y < 0) this.skyRingCount--;
      else this.waterRingCount--;
      this.ringCount--;
    }
  }

  /* Advance the level's own timers by one frame. */
  tick(): void {
    if (this.ringTimerRunning) {
      this.ringTimerRemaining--;
      if (this.ringTimerRemaining <= 0) {
        this.ringTimerRemaining = this.ringInterval;
        this.addRing();
      }
    }
    for (const c of this.collidables) c.tickTimers();
  }

  /* --- effects ----------------------------------------------------- */

  splash(x: number, y: number, v: number, bounded = false): void {
    const size = Math.abs(v);
    for (let i = 0; i < size * 2; i++) {
      const drop = new WaterDrop();
      if (!bounded) drop.bounded = false;
      let dir = Math.floor(Math.random() * 2);
      if (dir === 0) dir = -1;
      drop.vx = dir * (Math.random() + size / 200);
      drop.vy = Math.random() * 5 * -Math.random() - size / 6;
      drop.x = x - this.pm.x - (Math.random() * v) / 2;
      drop.y = y;
      this.pm.add(drop);
    }
  }

  fireworks(x: number, y: number, count = 3, vx = 0, vy = 0): void {
    const perBurst = 50;
    const step = 360 / perBurst;
    const colors = [0x00ffff, 0x0000ff, 0xffff00, 0x00ff00, 0xff0000, 0xff00ff];
    for (let i = 0; i < count; i++) {
      const spread = 100;
      const ox = randNum(-spread, spread);
      const oy = randNum(-spread, spread);
      const color = colors[randNum(0, 6)];
      const speed = randNum(13, 20);
      for (let j = 0; j < perBurst; j++) {
        const fw = new Firework(speed + Math.random() * 2, j * step, 20, color);
        fw.x = x - this.pm.x + ox + vx * 8;
        fw.y = y + oy + vy * 8;
        this.pm.add(fw);
      }
    }
  }

  /* --- scrolling --------------------------------------------------- */

  private scrollLayer(layer: Layer, dx: number): void {
    const d = dx * layer.speed;
    for (const tile of layer.tiles) tile.x = wrapTile(tile.x - d, LEFT_BOUND, RIGHT_BOUND);
  }

  scrollLevel(dx: number, dy: number): void {
    for (const c of this.collidables) {
      c.x -= dx;
      c.y -= dy;
      if (c.x < S_LEFT_BOUND) c.x = S_RIGHT_BOUND - c.width;
      else if (c.x > S_RIGHT_BOUND) c.x = S_LEFT_BOUND + c.width;
    }
    this.bgY -= dy;
    this.scrollLayer(this.ocean, dx);
    this.scrollLayer(this.floor, dx);
    this.scrollLayer(this.floor2, dx);
    this.scrollLayer(this.floor3, dx);
    this.scrollLayer(this.reef, dx);
    for (const cloud of this.clouds) cloud.x = wrapTile(cloud.x - dx * this.cloudSpeed, LEFT_BOUND, RIGHT_BOUND);
    for (const p of this.starPaths) p.x = wrapTile(p.x - dx, S_LEFT_BOUND, S_RIGHT_BOUND);
    this.scrollStars(dy);
    this.pm.update(this.bgY);
    this.pm.x -= dx;
  }

  moveBG(dy: number): void {
    this.bgY += dy;
  }

  /* Starfields recycle upward as you climb, revealing denser layers the
     higher you get, and fall back into place on the way down. */
  private scrollStars(dy: number): void {
    if (dy < 0 && this.bgY > -this.starHeight - 480) {
      for (const f of this.starFields) {
        if (this.bgY > -(f.y - 480)) {
          f.y -= 1440;
          f.layerCount++;
        }
      }
    } else if (dy > 0 && this.bgY > -this.starHeight + 480) {
      for (const f of this.starFields) {
        if (this.bgY < -(f.y + 480)) {
          f.y += 1440;
          f.layerCount = Math.max(1, f.layerCount - 1);
        }
      }
    }
  }

  /* Wind the world back to the surface one pixel at a time (which also
     lets everything else scroll back into place), then re-seed. */
  reset(): void {
    this.bgY = Math.floor(this.bgY);
    let guard = 0;
    while (this.bgY !== 0 && guard++ < 200000) {
      if (this.bgY > 0) this.scrollLevel(0, 1);
      else this.scrollLevel(0, -1);
    }
    this.bgY = 0;
    this.refresh();
    this.ocean.tiles[0].x = 0;
    this.ocean.tiles[1].x = -640;
    this.waterRingBase = null;
    this.skyRingBase = null;
  }

  private refresh(): void {
    for (const p of this.paths) p.slideBoost = 1;
    for (const f of this.fish) f.x = randNum(S_LEFT_BOUND, S_RIGHT_BOUND);
    this.surface.slideBoost = 0;
  }
}

export { GRAVITY };
