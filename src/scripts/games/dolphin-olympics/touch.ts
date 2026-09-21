import { deg } from './constants';
import type { GameKey } from './controller';
import type { Player } from './player';

/* Touch controls: the same four keys, played with fingers.

   The first finger down is the stick. Where it lands is the anchor, and
   the direction from the anchor to the finger is where the dolphin points:
   drag down to dive, up to climb, back the way you came to turn around.
   Holding the screen at all accelerates, so a plain touch is "swim", and a
   second finger anywhere is Down — a roll in the air, a tailslide when you
   are surfacing. Lift the second finger to pop off the rail, because Up is
   still held the whole time.

   Nothing here touches the physics. Every frame it works out which of Left
   and Right brings the dolphin round to the finger's heading and holds it
   the way a key would, so tricks, animations and scoring stay exactly as
   they are on a keyboard. */

/* Stage pixels the finger has to travel before it means a direction. */
const DEAD_ZONE = 12;
/* Past this, the anchor follows, so turning back is instant rather than
   having to drag all the way across the stick first. The renderer draws
   the stick at this radius. */
export const STICK_REACH = 90;
/* Let go of the turn once the heading is within this much of one frame's
   worth of turning: any closer and the dolphin hunts around the heading. */
const ALIGNED = 0.9;

export interface TouchView {
  /* Anchor and finger, in stage coordinates, for the on-screen stick. */
  ax: number;
  ay: number;
  x: number;
  y: number;
  grinding: boolean;
}

export class TouchControls {
  private stick: number | null = null;
  private grind: number | null = null;
  private ax = 0;
  private ay = 0;
  private x = 0;
  private y = 0;
  /* Where the finger is pointing, in the player's own degrees: 0 is
     right, 90 is straight down. Null inside the dead zone. */
  private heading: number | null = null;
  private turning: 'left' | 'right' | null = null;

  constructor(
    private readonly press: (key: GameKey) => void,
    private readonly release: (key: GameKey) => void
  ) {}

  get active(): boolean {
    return this.stick !== null;
  }

  get view(): TouchView | null {
    if (this.stick === null) return null;
    return { ax: this.ax, ay: this.ay, x: this.x, y: this.y, grinding: this.grind !== null };
  }

  down(pointerId: number, x: number, y: number): void {
    if (this.stick === null) {
      this.stick = pointerId;
      this.ax = this.x = x;
      this.ay = this.y = y;
      this.heading = null;
      this.press('up');
      return;
    }
    if (this.grind === null && pointerId !== this.stick) {
      this.grind = pointerId;
      this.press('down');
    }
  }

  move(pointerId: number, x: number, y: number): void {
    if (pointerId !== this.stick) return;
    this.x = x;
    this.y = y;
    let dx = x - this.ax;
    let dy = y - this.ay;
    const distance = Math.hypot(dx, dy);
    if (distance < DEAD_ZONE) {
      this.heading = null;
      return;
    }
    if (distance > STICK_REACH) {
      const drag = (distance - STICK_REACH) / distance;
      this.ax += dx * drag;
      this.ay += dy * drag;
      dx = x - this.ax;
      dy = y - this.ay;
    }
    this.heading = deg(Math.atan2(dy, dx));
  }

  up(pointerId: number): void {
    if (pointerId === this.grind) {
      this.grind = null;
      this.release('down');
      /* Up never went up, so re-pressing it is what pops a tailslide —
         the same thing a keyboard player's thumb does. */
      if (this.stick !== null) this.press('up');
      return;
    }
    if (pointerId === this.stick) this.reset();
  }

  /* Once per simulation step: hold whichever turn closes the gap between
     the dolphin's heading and the finger's, and let go once it is there. */
  update(player: Player): void {
    if (this.stick === null || this.heading === null) {
      this.stopTurning();
      return;
    }
    let difference = this.heading - player.angle;
    while (difference > 180) difference -= 360;
    while (difference < -180) difference += 360;
    if (Math.abs(difference) < Math.abs(player.turnRate) * ALIGNED) {
      this.stopTurning();
      return;
    }
    const want = difference > 0 ? 'right' : 'left';
    if (this.turning === want) return;
    this.stopTurning();
    this.turning = want;
    this.press(want);
  }

  /* Fingers off: leaving the game, losing focus, or opening a menu. */
  reset(): void {
    this.stopTurning();
    if (this.grind !== null) {
      this.grind = null;
      this.release('down');
    }
    if (this.stick !== null) {
      this.stick = null;
      this.release('up');
    }
    this.heading = null;
  }

  private stopTurning(): void {
    if (!this.turning) return;
    this.release(this.turning);
    this.turning = null;
  }
}
