import { Collidable, type ChaseTarget } from './creatures';
import { Particle, ParticleManager } from './particles';

/* A ring of orbiting sparks. Swim or fly through it for a speed boost and
   an "Extension" trick; the sparks scatter, and the ring is gone five
   seconds later. Water rings are gold, sky rings red. */

const RAD_X = 26;
const RAD_Y = 85;
const ORBIT_SPEED = 0.1;
const MAX_SPARKS = 15;

export class Ring extends Collidable {
  readonly kind = 'ring';
  readonly pm = new ParticleManager();
  readonly sparks: Particle[] = [];
  private sparkCount = 0;
  private sparkBuffer = 0;
  private flip = 0;
  private spawning = true;
  onDead: (ring: Ring) => void = () => {};

  constructor(readonly offColor = 0xffcc00) {
    super();
    /* 65px radius plus a margin; the game takes half its height as the
       reach on both axes. */
    this.hitHalf = 75;
    this.width = 2 * RAD_X;
  }

  protected override onActiveTimer(): void {
    this.onDead(this);
  }

  private addSpark(): void {
    if (this.sparkCount <= MAX_SPARKS) {
      if (this.sparkBuffer >= 3) {
        let color = 0xffffff;
        if (this.flip === 1) {
          color = this.offColor;
          this.flip = 0;
        } else {
          this.flip++;
        }
        const spark = new Particle(0, 0, 20, color);
        spark.bounded = false;
        spark.x = RAD_X;
        this.pm.add(spark);
        this.sparks.push(spark);
        this.sparkCount++;
        this.sparkBuffer = 0;
      } else {
        this.sparkBuffer++;
      }
    } else {
      this.spawning = false;
    }
  }

  override update(): void {
    if (this.spawning) this.addSpark();
    if (!this.activated) {
      for (const s of this.sparks) {
        s.x = Math.sin(s.angle) * RAD_X;
        s.y = Math.cos(s.angle) * RAD_Y;
        s.angle += ORBIT_SPEED;
      }
    } else {
      this.pm.update(0);
    }
  }

  override activate(_target: ChaseTarget): void {
    this.activeTimer.start();
    for (const s of this.sparks) {
      s.vx = Math.cos(s.angle) * 10;
      s.vy = Math.sin(s.angle) * 10;
    }
  }
}
