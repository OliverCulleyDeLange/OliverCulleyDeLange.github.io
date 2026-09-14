import type { Player } from './player';

/* Keyboard handling with the original's semantics: a key "goes down" once
   until it is released, each direction has a press and a release action,
   and while the controller is disabled (paused, crashed, game over) nothing
   is processed. Physically held keys are remembered across a disable so
   re-enabling picks them straight back up, the way Flash's key repeat did. */

export type GameKey = 'left' | 'right' | 'up' | 'down';

const KEY_MAP: Record<string, GameKey> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
};

export function gameKeyFor(event: KeyboardEvent): GameKey | null {
  return KEY_MAP[event.code] ?? null;
}

export class Controller {
  leftDown = false;
  rightDown = false;
  upDown = false;
  downDown = false;
  enabled = false;
  private readonly held = new Set<GameKey>();

  constructor(private readonly player: Player) {}

  keyDown(key: GameKey): void {
    this.held.add(key);
    if (!this.enabled) return;
    this.press(key);
    /* Up while tailsliding (and not also holding Down) pops you off the
       rail. Fires on key repeat too, but popSlide only acts once. */
    if (key === 'up' && this.player.sliding && !this.downDown) this.player.popSlide();
  }

  keyUp(key: GameKey): void {
    this.held.delete(key);
    if (!this.enabled) return;
    this.release(key);
  }

  private press(key: GameKey): void {
    const p = this.player;
    if (key === 'left' && !this.leftDown) {
      this.leftDown = true;
      if (!p.sliding) p.startTurn('left');
    } else if (key === 'up' && !this.upDown) {
      this.upDown = true;
      if (!this.downDown) p.startAccelerating();
    } else if (key === 'right' && !this.rightDown) {
      this.rightDown = true;
      if (!p.sliding) p.startTurn('right');
    } else if (key === 'down' && !this.downDown) {
      this.downDown = true;
      if (!p.sliding) p.slideReady = true;
      p.startRoll();
    }
  }

  private release(key: GameKey): void {
    const p = this.player;
    if (key === 'left') {
      this.leftDown = false;
      p.endTurn('left');
    } else if (key === 'right') {
      this.rightDown = false;
      p.endTurn('right');
    } else if (key === 'up') {
      this.upDown = false;
      p.accelerating = false;
    } else if (key === 'down') {
      this.downDown = false;
      p.slideReady = false;
      p.stopRoll();
    }
  }

  enable(): void {
    this.enabled = true;
    for (const key of this.held) this.press(key);
  }

  disable(): void {
    this.enabled = false;
    this.rightDown = this.leftDown = this.downDown = this.upDown = false;
    this.player.slideReady = false;
    this.player.stopRoll();
  }

  get heldKeys(): GameKey[] {
    return [...this.held];
  }
}
