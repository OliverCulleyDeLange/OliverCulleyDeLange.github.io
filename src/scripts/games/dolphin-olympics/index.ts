import {
  ANIM_NAMES,
  DEFAULT_ROOM,
  MAX_CHAT_LENGTH,
  sanitizeChat,
  type PlayerState,
  type Profile,
} from '../../../../workers/dolphin-multiplayer/src/protocol';
import { H, W } from './constants';
import { gameKeyFor } from './controller';
import { DolphinGame, type GameMode, type GameStats } from './game';
import { Level } from './level';
import { CHAT_FADE_MS, CHAT_HOLD_MS, RealtimeClient } from './multiplayer';
import { loadProfile, saveProfile } from './profile';
import { mountProfileUI, type ProfileUI } from './profile-ui';
import { layoutButtons, render, type RenderState, type Screen, type UIButton } from './render';
import { skinById } from './skins';
import { TouchControls } from './touch';

/* Dolphin Olympics: a port of the Flash game's mechanics to canvas.

   The simulation runs at the original's fixed 31 frames per second on an
   accumulator, drawn once per animation frame. The page provides only a
   canvas; menus, help, the HUD and the end-of-game summary are all drawn
   here so the whole thing stays a 640x480 stage, like the original.

   Multiplayer is a layer on top, and opt-in: "Play Online" on the title
   screen connects to a room on a Cloudflare Worker (see
   workers/dolphin-multiplayer), streams your dolphin's pose there and draws
   everyone else's as ghosts in your own world. The other modes never open
   the socket, so they cost nothing against the worker's free-plan limits.
   Rings, fish and scoring stay local to each player either way. */

const BEST_KEY = 'odl-dolphin-olympics-best';
const STEP_MS = 1000 / 31;
/* Send our pose every third simulation frame: roughly ten a second. */
const SEND_EVERY = 3;
const PRODUCTION_SERVER = 'https://dolphin-olympics-realtime.oliverdelange.workers.dev';

export interface DolphinOptions {
  /* Where to mount the name / flag / skin controls. */
  profileRoot?: HTMLElement | null;
  /* Origin of the realtime worker. Defaults to the deployed one, or a
     local `wrangler dev` when the site itself is running locally; either
     can be overridden with ?server=<origin> on the page URL. */
  server?: string;
  /* Room to join; ?room=<name> on the page URL also works. */
  room?: string;
}

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (error) {
    return null;
  }
}

function defaultServer(): string {
  const override = readParam('server');
  if (override) return override;
  if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) return 'http://localhost:8787';
  return PRODUCTION_SERVER;
}

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

/* Phones and tablets get the touch instructions from the start, rather
   than being told about arrow keys they do not have. */
function matchesCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (error) {
    return false;
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true;
}

export function createDolphinOlympics(canvas: HTMLCanvasElement, options: DolphinOptions = {}): { destroy(): void } {
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

  /* Fingers drive the same four keys as the arrows; see touch.ts. The
     screens explain themselves in whichever language the player is
     speaking, so a laptop with a touchscreen switches when they touch it. */
  const touch = new TouchControls(
    (key) => game?.keyDown(key),
    (key) => game?.keyUp(key)
  );
  let touchInput = matchesCoarsePointer();

  /* --- multiplayer ------------------------------------------------- */

  /* True from "Play Online" until the player returns to the title. Only
     then is the socket open, chat enabled and the roster drawn. */
  let online = false;
  let profile: Profile = loadProfile();
  let skin = skinById(profile.skin);
  let profileUI: ProfileUI | null = null;
  let chatDraft = '';
  let chatText = '';
  let chatUpdatedAt = 0;
  let chatClearTimer: number | null = null;
  const client = new RealtimeClient({
    server: options.server ?? defaultServer(),
    room: options.room ?? readParam('room') ?? DEFAULT_ROOM,
    profile,
    onChange: () => profileUI?.setStatus(client.status, client.onlineCount, client.room),
  });
  if (options.profileRoot) {
    profileUI = mountProfileUI(options.profileRoot, profile, (next) => {
      profile = next;
      skin = skinById(next.skin);
      saveProfile(next);
      client.setProfile(next);
    });
    profileUI.setStatus(client.status, client.onlineCount, client.room);
  }

  function updateChat(text: string): void {
    chatText = sanitizeChat(text);
    chatUpdatedAt = performance.now();
    client.sendChat(chatText);
  }

  function clearChat(): void {
    if (chatClearTimer != null) window.clearTimeout(chatClearTimer);
    chatClearTimer = null;
    chatDraft = '';
    updateChat('');
  }

  function refreshChatTimer(): void {
    if (chatClearTimer != null) window.clearTimeout(chatClearTimer);
    chatClearTimer = window.setTimeout(clearChat, CHAT_HOLD_MS + CHAT_FADE_MS);
  }

  function appendChat(character: string): void {
    if (Array.from(chatDraft).length >= MAX_CHAT_LENGTH) return;
    chatDraft += character;
    updateChat(chatDraft);
    refreshChatTimer();
  }

  function deleteChatCharacter(): void {
    const characters = Array.from(chatDraft);
    characters.pop();
    chatDraft = characters.join('');
    updateChat(chatDraft);
    refreshChatTimer();
  }

  /* Our dolphin's pose in world space: it sits at a fixed stage position
     while the level scrolls, so undo the scroll. `at` is the wall-clock
     moment this pose is true for: the simulation step that produced it,
     not whenever the send happens to run. */
  function localState(playing: boolean, at: number): PlayerState {
    const ts = Math.round(at);
    const p = game?.player;
    if (!p || !game) return { x: 0, y: 0, a: 0, an: 0, f: 0, r: 0, g: 0, s: 0, p: 0, ts };
    return {
      x: Math.round(p.x - level.pm.x),
      y: Math.round(p.y - level.bgY),
      a: Math.round(p.angle * 10) / 10,
      an: Math.max(0, ANIM_NAMES.indexOf(p.anim)),
      f: p.stopped ? 0 : p.animFrame,
      r: Math.round(p.rollPhase * 100) / 100,
      g: Math.round(p.glowAlpha * 100) / 100,
      s: game.score,
      p: playing ? 1 : 0,
      ts,
    };
  }

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

  function startGame(mode: GameMode, playOnline = false): void {
    clearChat();
    touch.reset();
    online = playOnline;
    if (online) client.connect();
    else client.disconnect();
    if (game) game.exit();
    game = new DolphinGame(level, mode);
    game.onGameEnd = (result) => {
      touch.reset();
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
    clearChat();
    touch.reset();
    /* Leaving the game leaves the room too; the server tells the others. */
    client.disconnect();
    online = false;
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
    touch.reset();
    game.startGame();
    screen = 'game';
    relayout();
  }

  function activate(id: string): void {
    switch (id) {
      case 'start':
        startGame('freestyle');
        break;
      case 'online':
        startGame('freestyle', true);
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

  /* Swimming, as opposed to sitting on a menu: when fingers steer. */
  function inPlay(): boolean {
    return screen === 'game' && game !== null && !help && !game.paused;
  }

  function onPointerDown(event: PointerEvent): void {
    canvas.focus({ preventScroll: true });
    if (event.pointerType === 'touch') touchInput = true;
    const { x, y } = toLogical(event);
    const b = buttonAt(x, y);
    if (b) {
      /* A menu tap with a second finger ends the swim rather than
         leaving a key held down behind the pause screen. */
      touch.reset();
      activate(b.id);
      return;
    }
    if (event.pointerType !== 'touch' || !inPlay()) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {}
    touch.down(event.pointerId, x, y);
  }

  function onPointerMove(event: PointerEvent): void {
    const { x, y } = toLogical(event);
    if (event.pointerType === 'touch') {
      if (touch.active) {
        event.preventDefault();
        touch.move(event.pointerId, x, y);
      }
      return;
    }
    const b = buttonAt(x, y);
    hover = b ? b.id : null;
    canvas.style.cursor = b ? 'pointer' : 'default';
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    touch.up(event.pointerId);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (isTyping(event.target)) return;
    const key = gameKeyFor(event);
    if (key) event.preventDefault();
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
      event.preventDefault();
      if (screen === 'title' && !help) startGame('freestyle');
      else if (screen === 'end' && !help) playAgain();
      else if (help) {
        help = false;
        relayout();
      } else if (screen === 'game' && game && !game.paused && chatDraft) {
        clearChat();
      }
      return;
    }
    /* Typing is chat, which only exists in an online game. */
    if (online && screen === 'game' && game && !help && !game.paused) {
      if (event.key === 'Backspace') {
        event.preventDefault();
        deleteChatCharacter();
        return;
      }
      const characters = Array.from(event.key);
      if (!event.ctrlKey && !event.metaKey && !event.altKey && characters.length === 1) {
        event.preventDefault();
        appendChat(event.key);
        return;
      }
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
    touch.reset();
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
      if (game) {
        if (touch.active && !game.paused) touch.update(game.player);
        game.frame();
        /* The accumulator is how far wall time has run ahead of the
           simulation, so this stamp is when the step just taken landed.
           Stamping with the send time instead would wobble by up to a
           step between packets and other players would see it as judder. */
        if (frame % SEND_EVERY === 0) client.sendState(localState(true, time - accumulator));
      }
    }
    if (accumulator > STEP_MS * 4) accumulator = 0;
    const state: RenderState = {
      screen,
      help,
      hover,
      game,
      level,
      best,
      stats,
      frame,
      buttons,
      skin,
      touch: inPlay() ? touch.view : null,
      touchInput,
      multiplayer: online
        ? {
            status: client.status,
            room: client.room,
            self: { profile, score: game?.score ?? 0, chatText, chatUpdatedAt },
            others: client.others,
          }
        : null,
    };
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
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
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
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      resizeObserver?.disconnect();
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
      if (game) game.exit();
      if (chatClearTimer != null) window.clearTimeout(chatClearTimer);
      client.destroy();
      profileUI?.destroy();
    },
  };
}
