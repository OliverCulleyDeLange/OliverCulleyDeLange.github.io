import { H, W } from './constants';
import { gameKeyFor } from './controller';
import { DolphinGame, type GameMode, type GameStats } from './game';
import { Level } from './level';
import { layoutButtons, render, type RenderState, type Screen, type UIButton } from './render';

/* Dolphin Olympics: a port of the Flash game's mechanics to canvas.

   The simulation runs at the original's fixed 31 frames per second on an
   accumulator, drawn once per animation frame. The page provides only a
   canvas; menus, help, the HUD and the end-of-game summary are all drawn
   here so the whole thing stays a 640x480 stage, like the original. */

const BEST_KEY = 'odl-dolphin-olympics-best';
const STEP_MS = 1000 / 31;

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch (error) {}
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true;
}

export function createDolphinOlympics(canvas: HTMLCanvasElement): { destroy(): void } {
  const context = canvas.getContext('2d');
  if (!context) return { destroy() {} };
  const ctx: CanvasRenderingContext2D = context;

  const level = new Level();
  let game: DolphinGame | null = null;
  let screen: Screen = 'title';
  let help = false;
  let hover: string | null = null;
  let best = readBest();
  let stats: GameStats | null = null;
  let frame = 0;
  let buttons: UIButton[] = layoutButtons(screen, help, game);
  let lastTime = 0;
  let accumulator = 0;
  let animationFrame: number | null = null;

  function relayout(): void {
    buttons = layoutButtons(screen, help, game);
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const scale = (rect.width > 0 ? rect.width / W : 1) * ratio;
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(H * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  function startGame(mode: GameMode): void {
    if (game) game.exit();
    game = new DolphinGame(level, mode);
    game.onGameEnd = (result) => {
      stats = result;
      if (result.score > best) {
        best = result.score;
        writeBest(best);
      }
      screen = 'end';
      relayout();
    };
    game.enter();
    screen = 'game';
    help = false;
    relayout();
  }

  function goToTitle(): void {
    if (game) game.exit();
    game = null;
    level.reset();
    screen = 'title';
    help = false;
    stats = null;
    relayout();
  }

  function playAgain(): void {
    if (!game) return;
    game.startGame();
    screen = 'game';
    relayout();
  }

  function activate(id: string): void {
    switch (id) {
      case 'start':
        startGame('freestyle');
        break;
      case 'freeswim':
        startGame('freeswim');
        break;
      case 'help':
        help = true;
        relayout();
        break;
      case 'close-help':
        help = false;
        relayout();
        break;
      case 'resume':
        if (game && game.paused) game.pause();
        relayout();
        break;
      case 'restart':
        playAgain();
        break;
      case 'play-again':
        playAgain();
        break;
      case 'menu':
        goToTitle();
        break;
      case 'ingame-menu':
        if (help) help = false;
        else if (game && screen === 'game') game.pause();
        relayout();
        break;
    }
  }

  function toLogical(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  }

  function buttonAt(x: number, y: number): UIButton | null {
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  function onPointerDown(event: PointerEvent): void {
    canvas.focus({ preventScroll: true });
    const { x, y } = toLogical(event);
    const b = buttonAt(x, y);
    if (b) activate(b.id);
  }

  function onPointerMove(event: PointerEvent): void {
    const { x, y } = toLogical(event);
    const b = buttonAt(x, y);
    hover = b ? b.id : null;
    canvas.style.cursor = b ? 'pointer' : 'default';
  }

  function onKeydown(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const key = gameKeyFor(event);
    if (key || event.key === ' ') event.preventDefault();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (help) {
        help = false;
        relayout();
      } else if (screen === 'game' && game) {
        game.pause();
        relayout();
      }
      return;
    }
    if (event.key === 'Enter') {
      if (screen === 'title' && !help) startGame('freestyle');
      else if (screen === 'end' && !help) playAgain();
      else if (help) {
        help = false;
        relayout();
      }
      return;
    }
    if (!key || !game) return;
    /* Auto-repeat is passed through on purpose: the original relied on it,
       so holding Up pops you off a tailslide the moment Down is released. */
    if (screen === 'game' && !help) game.keyDown(key);
  }

  function onKeyup(event: KeyboardEvent): void {
    const key = gameKeyFor(event);
    if (key && game) game.keyUp(key);
  }

  function onBlur(): void {
    if (game) game.releaseAllKeys();
  }

  function tick(time: number): void {
    const dt = lastTime ? Math.min(time - lastTime, 250) : 0;
    lastTime = time;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < 4) {
      accumulator -= STEP_MS;
      steps++;
      frame++;
      if (game) game.frame();
    }
    if (accumulator > STEP_MS * 4) accumulator = 0;
    const state: RenderState = { screen, help, hover, game, level, best, stats, frame, buttons };
    render(ctx, state);
    animationFrame = requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onBlur);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(canvas);

  resize();
  /* The desktop shell opens this page inside an unfocused iframe; without
     grabbing focus here, key presses never reach the game. */
  canvas.tabIndex = 0;
  try {
    window.focus();
    canvas.focus({ preventScroll: true });
  } catch (error) {}
  animationFrame = requestAnimationFrame(tick);

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keyup', onKeyup);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      resizeObserver?.disconnect();
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
      if (game) game.exit();
    },
  };
}
