import type { Profile } from '../../../../workers/dolphin-multiplayer/src/protocol';
import { CX, CY, H, PIXELS_PER_METRE, W, rad } from './constants';
import type { Fish, Seagull } from './creatures';
import { flagEmoji } from './flags';
import type { DolphinGame, GameStats } from './game';
import { FLOOR2_Y, FLOOR3_Y, FLOOR_BASE_Y, FLOOR_Y, REEF_Y, SKY_TOP, WATER_HEIGHT, type Level, type Planet } from './level';
import { AFK_AFTER_MS, CHAT_FADE_MS, CHAT_HOLD_MS, type ConnectionStatus, type RemotePlayer, type RemotePose } from './multiplayer';
import type { Firework, Shadow } from './particles';
import type { Anim, Player } from './player';
import type { Ring } from './ring';
import { CLASSIC_SKIN, skinById, type DolphinSkin } from './skins';
import { STICK_REACH, type TouchView } from './touch';

/* Everything drawn to the canvas: the scrolling world, the creatures, the
   dolphin, the in-game HUD and the menus. All art here is drawn in code. */

export type Screen = 'title' | 'game' | 'end';

export interface UIButton {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/* What the renderer needs to know about the other players. */
export interface MultiplayerView {
  status: ConnectionStatus;
  room: string;
  self: { profile: Profile; score: number; chatText: string; chatUpdatedAt: number };
  others: RemotePlayer[];
}

export interface RenderState {
  screen: Screen;
  help: boolean;
  hover: string | null;
  game: DolphinGame | null;
  level: Level;
  best: number;
  stats: GameStats | null;
  frame: number;
  buttons: UIButton[];
  skin: DolphinSkin;
  multiplayer: MultiplayerView | null;
  /* The finger currently steering, if any, so the stick can be drawn. */
  touch: TouchView | null;
  /* Whether to explain the controls as fingers rather than arrow keys. */
  touchInput: boolean;
}

const FONT = '"Verdana", "Geneva", "DejaVu Sans", sans-serif';
const SKY_STOPS: Record<Level['skyMode'], [number, string][]> = {
  day: [[0, '#02021a'], [0.3, '#0a2a6e'], [0.62, '#0b6fbf'], [0.86, '#06d1e8'], [0.985, '#c9f3fb'], [1, '#fafeff']],
  evening: [[0, '#000000'], [0.55, '#0a1f5e'], [0.88, '#026fdb'], [0.97, '#e8894a'], [1, '#f7c37c']],
  night: [[0, '#000000'], [0.8, '#020a2a'], [1, '#0b1f4a']],
};

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

/* Small deterministic PRNG so scenery decorations are stable frame to
   frame without storing them. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, points = 4): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill = '#ffffff', stroke = 'rgba(0,20,60,0.85)', width = 3): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* --- the dolphin ---------------------------------------------------- */

export interface DolphinPose {
  anim: Anim;
  frame: number;
  roll: number;
  glowAlpha: number;
  glowBlur: number;
}

/* A tint flattens the whole dolphin to one colour (used for shadows); a
   skin recolours it while keeping the belly, fins and eye. */
export function drawDolphin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleDeg: number,
  pose: DolphinPose,
  tint: string | null = null,
  alpha = 1,
  skin: DolphinSkin = CLASSIC_SKIN
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad(angleDeg));
  const rollScale = Math.cos(pose.roll * Math.PI * 2);
  ctx.scale(0.9, 0.9 * (Math.abs(rollScale) < 0.08 ? 0.08 * Math.sign(rollScale || 1) : rollScale));
  ctx.globalAlpha = alpha;

  let wag = 0;
  let shake = 0;
  switch (pose.anim) {
    case 'accelerating':
      wag = Math.sin(pose.frame * 0.55) * 6;
      break;
    case 'tailslide':
      wag = Math.sin(pose.frame * 0.9) * 5;
      break;
    case 'crashingRight':
      shake = Math.sin(pose.frame * 1.3) * 2;
      wag = Math.sin(pose.frame * 0.8) * 4;
      break;
    case 'rolling':
      wag = Math.sin(pose.frame * 0.4) * 3;
      break;
    default:
      wag = Math.sin(pose.frame * 0.18) * 3;
  }
  ctx.translate(0, shake);

  if (pose.glowAlpha > 0 && !tint) {
    ctx.shadowColor = `rgba(255,255,255,${Math.min(1, pose.glowAlpha + 0.2)})`;
    ctx.shadowBlur = pose.glowBlur * 2.5;
  }

  const body = tint ?? skin.body;
  const back = tint ?? skin.back;
  const belly = tint ?? skin.belly;
  const line = tint ?? skin.line;

  const bodyPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(52, 3);
    ctx.quadraticCurveTo(44, -5, 28, -9);
    ctx.quadraticCurveTo(4, -17, -20, -10);
    ctx.quadraticCurveTo(-34, -6, -40, -2);
    ctx.quadraticCurveTo(-48, -9 + wag, -52, -16 + wag);
    ctx.quadraticCurveTo(-46, -4 + wag * 0.5, -44, 0 + wag * 0.3);
    ctx.quadraticCurveTo(-46, 4 + wag * 0.5, -52, 16 + wag);
    ctx.quadraticCurveTo(-48, 9 + wag, -40, 2);
    ctx.quadraticCurveTo(-34, 8, -20, 12);
    ctx.quadraticCurveTo(4, 19, 28, 13);
    ctx.quadraticCurveTo(44, 9, 52, 3);
    ctx.closePath();
  };

  /* Fins first so the body overlaps their roots. */
  ctx.fillStyle = back;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-2, -11);
  ctx.quadraticCurveTo(-4, -27, -16, -24);
  ctx.quadraticCurveTo(-12, -17, -18, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  bodyPath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  if (!tint) {
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.moveTo(46, 5);
    ctx.quadraticCurveTo(26, 16, 2, 16);
    ctx.quadraticCurveTo(-18, 14, -34, 6);
    ctx.quadraticCurveTo(-16, 5, 2, 5);
    ctx.quadraticCurveTo(28, 6, 46, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = back;
    ctx.globalAlpha = alpha * 0.55;
    ctx.beginPath();
    ctx.moveTo(30, -8);
    ctx.quadraticCurveTo(4, -16, -20, -9);
    ctx.quadraticCurveTo(-4, -10, 12, -7);
    ctx.quadraticCurveTo(24, -6, 30, -8);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.restore();
  }

  bodyPath();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* Pectoral fin over the body. */
  ctx.fillStyle = tint ?? skin.fin;
  ctx.beginPath();
  ctx.moveTo(12, 8);
  ctx.quadraticCurveTo(8, 24, -2, 22);
  ctx.quadraticCurveTo(0, 13, -6, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (!tint) {
    ctx.beginPath();
    ctx.moveTo(52, 3);
    ctx.quadraticCurveTo(44, 5, 36, 6);
    ctx.stroke();
    /* Darker skins get a pale ring so the eye still reads. */
    if (skin !== CLASSIC_SKIN) {
      ctx.fillStyle = skin.belly;
      ctx.beginPath();
      ctx.arc(33, -3, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1b2330';
    ctx.beginPath();
    ctx.arc(33, -3, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(33.8, -3.8, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin === CLASSIC_SKIN ? '#3b4a60' : skin.line;
    ctx.beginPath();
    ctx.ellipse(12, -12, 2.2, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* --- other players -------------------------------------------------- */

/* Flag and name, centred on x. The flag is an emoji, so it is filled
   without the outline that would smear it. */
function drawNameTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  profile: Profile,
  align: 'left' | 'center' | 'right',
  color = '#ffffff',
  suffix = ''
): number {
  const flag = flagEmoji(profile.flag);
  const label = profile.name + suffix;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const nameWidth = ctx.measureText(label).width;
  const flagWidth = flag ? ctx.measureText(flag).width + 4 : 0;
  const total = flagWidth + nameWidth;
  let start = x;
  if (align === 'center') start = x - total / 2;
  else if (align === 'right') start = x - total;
  if (flag) {
    ctx.fillStyle = '#ffffff';
    ctx.fillText(flag, start, y);
  }
  outlinedText(ctx, label, start + flagWidth, y, color);
  return total;
}

function chatAlpha(text: string, updatedAt: number, now: number): number {
  if (!text) return 0;
  const age = Math.max(0, now - updatedAt);
  if (age <= CHAT_HOLD_MS) return 1;
  return Math.max(0, 1 - (age - CHAT_HOLD_MS) / CHAT_FADE_MS);
}

function formatAfkDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function wrapChatLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of Array.from(text)) {
    const next = line + character;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line.trim());
      line = character.trimStart();
    } else {
      line = next;
    }
  }
  if (line) lines.push(line.trim());
  return lines.filter(Boolean);
}

function drawChatBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  alpha: number
): void {
  if (!text || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold 12px ${FONT}`;
  const lines = wrapChatLines(ctx, text, 220);
  if (!lines.length) {
    ctx.restore();
    return;
  }
  const padX = 10;
  const padY = 7;
  const lineHeight = 15;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2;
  const height = lines.length * lineHeight + padY * 2;
  const above = y - height - 12 >= 8;
  const bx = Math.min(W - width - 8, Math.max(8, x - width / 2));
  const by = above ? y - height - 12 : Math.min(H - height - 8, y + 12);
  const tailX = Math.min(bx + width - 12, Math.max(bx + 12, x));

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(4,22,64,0.85)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (above) {
    ctx.moveTo(tailX - 5, by + height - 1);
    ctx.lineTo(x, y);
    ctx.lineTo(tailX + 5, by + height - 1);
  } else {
    ctx.moveTo(tailX - 5, by + 1);
    ctx.lineTo(x, y);
    ctx.lineTo(tailX + 5, by + 1);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#061d45';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, bx + padX, by + padY + i * lineHeight));
  ctx.restore();
}

function drawRemoteDolphin(ctx: CanvasRenderingContext2D, level: Level, pose: RemotePose, player: RemotePlayer, now: number): void {
  const profile = player.profile;
  const sx = level.pm.x + pose.x;
  const sy = level.bgY + pose.y;
  const skin = skinById(profile.skin);
  const inactiveFor = Math.max(0, now - player.lastSeen);
  const isAfk = inactiveFor >= AFK_AFTER_MS;
  const afkText = `AFK · ${formatAfkDuration(inactiveFor)}`;
  const margin = 70;
  if (sx > -margin && sx < W + margin && sy > -margin && sy < H + margin) {
    drawDolphin(
      ctx,
      sx,
      sy,
      pose.angle,
      { anim: pose.anim, frame: pose.frame, roll: pose.roll, glowAlpha: pose.glow, glowBlur: 2 + pose.glow * 6 },
      isAfk ? '#8793a1' : null,
      /* Opaque while active: the dolphin is many overlapping fills and
         strokes, each drawn at the context alpha, so anything less lets
         the layers show through one another and the edges read as a blur. */
      isAfk ? 0.62 : 1,
      skin
    );
    ctx.font = `bold 11px ${FONT}`;
    drawNameTag(ctx, sx, sy - 40, profile, 'center', isAfk ? '#c4ccd5' : '#ffffff');
    if (isAfk) drawChatBubble(ctx, sx, sy - 48, afkText, 0.9);
    else drawChatBubble(ctx, sx, sy - 48, player.chatText, chatAlpha(player.chatText, player.chatUpdatedAt, now));
    return;
  }
  /* Off the stage: a marker pinned to the nearest edge so you can see
     where everyone else is. */
  ctx.save();
  ctx.globalAlpha = isAfk ? 0.6 : 0.85;
  const mx = Math.min(W - 14, Math.max(14, sx));
  const my = Math.min(H - 50, Math.max(30, sy));
  ctx.fillStyle = isAfk ? '#8793a1' : skin.body;
  ctx.strokeStyle = isAfk ? '#4f5965' : skin.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx, my, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = `bold 10px ${FONT}`;
  const distance = Math.round(Math.hypot(sx - CX, sy - CY) / PIXELS_PER_METRE);
  const suffix = ` · ${distance}m`;
  if (mx > W / 2) drawNameTag(ctx, mx - 9, my + 4, profile, 'right', '#e8f1ff', suffix);
  else drawNameTag(ctx, mx + 9, my + 4, profile, 'left', '#e8f1ff', suffix);
  /* Only chat follows a player off the stage: the grey marker already
     says they are away. */
  drawChatBubble(ctx, mx, my - 8, player.chatText, chatAlpha(player.chatText, player.chatUpdatedAt, now));
  ctx.restore();
}

function drawRemotePlayers(ctx: CanvasRenderingContext2D, level: Level, others: RemotePlayer[]): void {
  if (!others.length) return;
  const now = performance.now();
  for (const other of others) {
    const pose = other.sample(now);
    if (pose) drawRemoteDolphin(ctx, level, pose, other, now);
  }
}

/* Top-right corner: connection state, then everyone in the room by score. */
function drawRoster(ctx: CanvasRenderingContext2D, view: MultiplayerView, inGame: boolean): void {
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 11px ${FONT}`;
  const right = W - 12;
  let y = 20;
  if (view.status !== 'online') {
    const label = view.status === 'connecting' ? 'connecting…' : 'offline';
    outlinedText(ctx, `○ ${label}`, right, y, '#bfe3ff');
    return;
  }
  const count = view.others.length + 1;
  outlinedText(ctx, `● ${count} dolphin${count === 1 ? '' : 's'} online · ${view.room}`, right, y, '#8ff0a4');
  if (!inGame || !view.others.length) return;
  const rows: { profile: Profile; score: number; self: boolean; playing: boolean }[] = [
    { profile: view.self.profile, score: view.self.score, self: true, playing: true },
    ...view.others.map((o) => ({ profile: o.profile, score: o.score, self: false, playing: o.playing })),
  ];
  rows.sort((a, b) => b.score - a.score);
  for (const row of rows.slice(0, 8)) {
    y += 16;
    const color = row.self ? '#ffe27a' : row.playing ? '#ffffff' : '#9fb6cc';
    const score = row.playing ? row.score.toLocaleString('en-GB') : 'menu';
    ctx.font = `bold 11px ${FONT}`;
    const scoreWidth = ctx.measureText(score).width;
    ctx.textAlign = 'right';
    outlinedText(ctx, score, right, y, color);
    drawNameTag(ctx, right - scoreWidth - 8, y, row.profile, 'right', color);
  }
}

/* --- world ---------------------------------------------------------- */

function drawSky(ctx: CanvasRenderingContext2D, level: Level): void {
  const top = level.bgY + SKY_TOP;
  const bottom = level.bgY + 2;
  if (bottom < 0 || top > H) return;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [stop, color] of SKY_STOPS[level.skyMode]) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.max(0, top), W, Math.min(H, bottom) - Math.max(0, top));

  if (level.skyMode === 'day') {
    const sy = level.bgY - 380;
    if (sy > -120 && sy < H + 120) {
      const glow = ctx.createRadialGradient(540, sy, 20, 540, sy, 140);
      glow.addColorStop(0, 'rgba(255,250,200,0.9)');
      glow.addColorStop(0.3, 'rgba(255,240,160,0.35)');
      glow.addColorStop(1, 'rgba(255,240,160,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(400, sy - 140, 280, 280);
      ctx.fillStyle = '#fff6c4';
      ctx.beginPath();
      ctx.arc(540, sy, 42, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (level.skyMode === 'evening') {
    const sy = level.bgY - 70;
    if (sy > -120 && sy < H + 120) {
      const glow = ctx.createRadialGradient(130, sy, 10, 130, sy, 170);
      glow.addColorStop(0, 'rgba(255,170,90,0.9)');
      glow.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-40, sy - 170, 340, 340);
      ctx.fillStyle = '#ffb060';
      ctx.beginPath();
      ctx.arc(130, sy, 38, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawStarFields(ctx: CanvasRenderingContext2D, level: Level): void {
  for (const f of level.starFields) {
    const fy = level.bgY + f.y;
    if (fy + 480 < 0 || fy > H) continue;
    ctx.fillStyle = '#ffffff';
    for (const s of f.layer1) {
      ctx.beginPath();
      ctx.arc(s.x, fy + s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (f.layerCount >= 3) {
      for (const s of f.layer2) {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, fy + s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (f.layerCount >= 6) {
      ctx.lineWidth = 1;
      for (const s of f.layer3) {
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(s.x, fy + s.y - s.arm);
        ctx.lineTo(s.x, fy + s.y + s.arm);
        ctx.moveTo(s.x - s.arm, fy + s.y);
        ctx.lineTo(s.x + s.arm, fy + s.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, fy + s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawWater(ctx: CanvasRenderingContext2D, level: Level, frame: number): void {
  const top = level.bgY;
  const bottom = level.bgY + WATER_HEIGHT;
  if (bottom < 0 || top > H) return;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#6dcef8');
  g.addColorStop(1, '#2f2fc8');
  ctx.fillStyle = g;
  const y0 = Math.max(0, top);
  const y1 = Math.min(H, bottom);
  ctx.fillRect(0, y0, W, y1 - y0);

  if (level.skyMode === 'day' && top < H) {
    /* Shafts of light near the surface. */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, W, Math.min(H, top + 420) - y0);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    const drift = (frame * 0.4) % 160;
    for (let i = -1; i < 6; i++) {
      const x = i * 160 + drift;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + 60, top);
      ctx.lineTo(x + 150, top + 420);
      ctx.lineTo(x + 30, top + 420);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* The wave band along the surface, scrolling with the ocean layer. */
  const waveTop = level.bgY - 10.9;
  if (waveTop < H && waveTop + 14 > 0) {
    const offset = ((level.ocean.tiles[0].x % 40) + 40) % 40;
    const wg = ctx.createLinearGradient(0, waveTop, 0, waveTop + 13);
    wg.addColorStop(0, '#c7fcfc');
    wg.addColorStop(1, '#6dcef8');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(-40, waveTop + 13);
    for (let x = -40; x <= W + 40; x += 4) {
      const y = waveTop + 6 + Math.sin(((x - offset) / 40) * Math.PI * 2) * 4 + Math.sin(((x - offset) / 13) * Math.PI * 2 + frame * 0.2) * 1.2;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 40, waveTop + 13);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFarHills(ctx: CanvasRenderingContext2D, level: Level): void {
  const y = level.bgY + FLOOR3_Y;
  if (y > H || y + 402 < 0) return;
  ctx.fillStyle = '#037ac9';
  level.floor3.tiles.forEach((tile) => {
    const x = tile.x;
    ctx.beginPath();
    ctx.moveTo(x, y + 402);
    ctx.lineTo(x, y + 240);
    if (tile.kind === 0) {
      ctx.quadraticCurveTo(x + 120, y + 30, x + 260, y + 120);
      ctx.quadraticCurveTo(x + 360, y + 190, x + 460, y + 90);
      ctx.quadraticCurveTo(x + 560, y + 0, x + 640, y + 240);
    } else {
      ctx.quadraticCurveTo(x + 80, y + 120, x + 200, y + 160);
      ctx.quadraticCurveTo(x + 330, y + 210, x + 420, y + 60);
      ctx.quadraticCurveTo(x + 520, y - 40, x + 640, y + 240);
    }
    ctx.lineTo(x + 640, y + 402);
    ctx.closePath();
    ctx.fill();
  });
}

function drawDunes(ctx: CanvasRenderingContext2D, level: Level): void {
  const y = level.bgY + FLOOR2_Y;
  if (y > H || y + 200 < 0) return;
  const g = ctx.createLinearGradient(0, y, 0, y + 190);
  g.addColorStop(0, '#03719e');
  g.addColorStop(1, '#02407d');
  ctx.fillStyle = g;
  level.floor2.tiles.forEach((tile) => {
    const x = tile.x;
    ctx.beginPath();
    ctx.moveTo(x, y + 200);
    ctx.lineTo(x, y + 110);
    if (tile.kind === 0) {
      ctx.quadraticCurveTo(x + 90, y + 20, x + 200, y + 70);
      ctx.quadraticCurveTo(x + 300, y + 115, x + 400, y + 40);
      ctx.quadraticCurveTo(x + 520, y - 20, x + 640, y + 110);
    } else {
      ctx.quadraticCurveTo(x + 110, y + 60, x + 230, y + 30);
      ctx.quadraticCurveTo(x + 360, y + 0, x + 470, y + 80);
      ctx.quadraticCurveTo(x + 560, y + 140, x + 640, y + 110);
    }
    ctx.lineTo(x + 640, y + 200);
    ctx.closePath();
    ctx.fill();
  });
}

const REEF_PALETTE = ['#346d5e', '#282425', '#473b29', '#7f8183', '#6ca133', '#e0c2a7', '#467727', '#9c9da0', '#b81239', '#8bcc3f', '#c5e22e', '#fce9cb'];

interface ReefPiece {
  x: number;
  w: number;
  h: number;
  color: string;
  shape: number;
}

const REEF_TILES: ReefPiece[][] = [0, 1].map((kind) => {
  const rnd = seeded(1234 + kind * 77);
  const pieces: ReefPiece[] = [];
  for (let i = 0; i < 26; i++) {
    pieces.push({
      x: rnd() * 640,
      w: 18 + rnd() * 70,
      h: 20 + rnd() * 120,
      color: REEF_PALETTE[Math.floor(rnd() * REEF_PALETTE.length)],
      shape: Math.floor(rnd() * 3),
    });
  }
  return pieces;
});

function drawReef(ctx: CanvasRenderingContext2D, level: Level): void {
  const y = level.bgY + REEF_Y;
  if (y > H || y + 160 < 0) return;
  const base = y + 159;
  level.reef.tiles.forEach((tile) => {
    for (const piece of REEF_TILES[tile.kind]) {
      const x = tile.x + piece.x;
      if (x + piece.w < 0 || x > W) continue;
      ctx.fillStyle = piece.color;
      ctx.beginPath();
      if (piece.shape === 0) {
        /* Rock: a lumpy mound. */
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + piece.w * 0.1, base - piece.h * 0.8, x + piece.w * 0.5, base - piece.h);
        ctx.quadraticCurveTo(x + piece.w * 0.9, base - piece.h * 0.7, x + piece.w, base);
      } else if (piece.shape === 1) {
        /* Branching coral: a fan of tapered fingers. */
        const fingers = 3 + Math.floor(piece.w / 22);
        for (let i = 0; i < fingers; i++) {
          const fx = x + (piece.w * (i + 0.5)) / fingers;
          const fh = piece.h * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
          ctx.moveTo(fx - 5, base);
          ctx.quadraticCurveTo(fx - 8, base - fh * 0.6, fx + (i % 2 ? 6 : -6), base - fh);
          ctx.quadraticCurveTo(fx + 8, base - fh * 0.5, fx + 5, base);
        }
      } else {
        /* Kelp: a wavy ribbon. */
        const fw = Math.min(14, piece.w * 0.3);
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x + 18, base - piece.h * 0.5, x + 2, base - piece.h);
        ctx.lineTo(x + fw, base - piece.h);
        ctx.quadraticCurveTo(x + fw + 18, base - piece.h * 0.5, x + fw, base);
      }
      ctx.closePath();
      ctx.fill();
    }
  });
}

function drawSeaFloor(ctx: CanvasRenderingContext2D, level: Level): void {
  const y = level.bgY + FLOOR_Y;
  if (y > H) return;
  const baseTop = level.bgY + FLOOR_BASE_Y;
  if (baseTop < H) {
    const g = ctx.createLinearGradient(0, baseTop, 0, baseTop + 250);
    g.addColorStop(0, '#d9d885');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, baseTop, W, Math.min(250, H - baseTop));
    if (baseTop + 250 < H) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, baseTop + 250, W, H - baseTop - 250);
    }
  }
  if (y + 32 < 0) return;
  /* Rippled sand: two 640px tiles with slightly different bumps. */
  ctx.fillStyle = '#e8e2a0';
  level.floor.tiles.forEach((tile) => {
    const x = tile.x;
    ctx.beginPath();
    ctx.moveTo(x, y + 32);
    for (let i = 0; i <= 640; i += 8) {
      const bump = Math.sin((i / 640) * Math.PI * (tile.kind === 0 ? 12 : 9)) * 5 + Math.sin((i / 640) * Math.PI * 3) * 4;
      ctx.lineTo(x + i, y + 14 + bump);
    }
    ctx.lineTo(x + 640, y + 32);
    ctx.closePath();
    ctx.fill();
  });
  ctx.strokeStyle = 'rgba(160,140,70,0.35)';
  ctx.lineWidth = 1;
  level.floor.tiles.forEach((tile) => {
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      for (let i = 0; i <= 640; i += 10) {
        const yy = y + 20 + r * 4 + Math.sin((i / 640) * Math.PI * (10 + r)) * 2;
        if (i === 0) ctx.moveTo(tile.x + i, yy);
        else ctx.lineTo(tile.x + i, yy);
      }
      ctx.stroke();
    }
  });
}

function drawClouds(ctx: CanvasRenderingContext2D, level: Level): void {
  for (const c of level.clouds) {
    const y = level.bgY + c.y;
    const [w, h] = c.type === 0 ? [300, 148] : c.type === 1 ? [190, 134] : [270, 152];
    if (y > H || y + h < 0 || c.x > W || c.x + w < 0) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    const puffs = c.type === 1 ? 4 : 6;
    for (let i = 0; i < puffs; i++) {
      const px = c.x + (w * (i + 0.5)) / puffs;
      const r = h * (0.28 + 0.14 * Math.abs(Math.sin(i * 2.3 + c.type)));
      ctx.beginPath();
      ctx.arc(px, y + h * 0.6, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(c.x + w / 2, y + h * 0.72, w * 0.47, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlanet(ctx: CanvasRenderingContext2D, p: Planet, level: Level, frame: number): void {
  const y = level.bgY + p.y;
  if (y > H || y + p.h < 0) return;
  const cx = p.x + p.w / 2;
  const cy = y + p.h / 2;
  const r = Math.min(p.w, p.h) / 2;
  ctx.save();
  switch (p.name) {
    case 'moon': {
      ctx.fillStyle = '#d9dbe0';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b9bcc6';
      for (const [dx, dy, cr] of [[-0.35, -0.2, 0.16], [0.25, 0.25, 0.13], [0.1, -0.45, 0.09], [-0.1, 0.5, 0.08], [0.45, -0.3, 0.07]]) {
        ctx.beginPath();
        ctx.arc(cx + dx * r, cy + dy * r, cr * r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'mars': {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#f2a06a');
      g.addColorStop(1, '#a4381c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,40,20,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.2, cy + r * 0.1, r * 0.45, r * 0.2, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 0.9, r * 0.3, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'nebula': {
      for (const [dx, dy, rr, color] of [[0, 0, 0.5, 'rgba(150,60,200,0.35)'], [-0.25, -0.15, 0.35, 'rgba(60,120,255,0.35)'], [0.25, 0.2, 0.4, 'rgba(255,80,160,0.3)'], [0.05, -0.3, 0.25, 'rgba(255,220,120,0.25)']] as const) {
        const g = ctx.createRadialGradient(cx + dx * p.w, cy + dy * p.h, 0, cx + dx * p.w, cy + dy * p.h, rr * p.w);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 100, y - 100, p.w + 200, p.h + 200);
      }
      break;
    }
    case 'jupiter': {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const bands = ['#e8c9a0', '#c98b5a', '#f1dcc0', '#b86e45', '#e9c69f', '#d29a6b', '#f3e2cc', '#c07f52'];
      bands.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.fillRect(cx - r, cy - r + (i * 2 * r) / bands.length, 2 * r, (2 * r) / bands.length + 1);
      });
      ctx.fillStyle = '#c2543a';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.3, cy + r * 0.25, r * 0.22, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'saturn': {
      const gr = p.h * 0.36;
      ctx.strokeStyle = 'rgba(230,210,160,0.9)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.ellipse(cx, cy, gr * 2.1, gr * 0.5, -0.25, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();
      const g = ctx.createRadialGradient(cx - gr * 0.3, cy - gr * 0.3, gr * 0.1, cx, cy, gr);
      g.addColorStop(0, '#f6e7b8');
      g.addColorStop(1, '#c9a75c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy, gr * 2.1, gr * 0.5, -0.25, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      break;
    }
    case 'uranus': {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#dbfaff');
      g.addColorStop(1, '#5fc7d8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.25, r * 1.3, 0.3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'neptune': {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#6f8cff');
      g.addColorStop(1, '#1b2fa8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d1a6b';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.15, cy - r * 0.1, r * 0.3, r * 0.18, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9fb4ff';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.2, cy - r * 0.12, r * 0.08, r * 0.05, -0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'pluto': {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#e6d5c3');
      g.addColorStop(1, '#8c6a55');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy + r * 0.1);
      ctx.quadraticCurveTo(cx, cy - r * 0.4, cx + r * 0.3, cy + r * 0.1);
      ctx.quadraticCurveTo(cx, cy + r * 0.5, cx - r * 0.3, cy + r * 0.1);
      ctx.fill();
      break;
    }
    case 'diner': {
      /* A little roadside diner floating at the end of the universe. */
      const bx = p.x + 60;
      const by = y + 180;
      const bw = p.w - 120;
      const bh = 200;
      ctx.fillStyle = '#c8ccd6';
      roundRect(ctx, bx, by, bw, bh, 26);
      ctx.fill();
      ctx.fillStyle = '#e8362f';
      ctx.fillRect(bx, by + 30, bw, 22);
      ctx.fillRect(bx, by + bh - 40, bw, 16);
      ctx.fillStyle = '#7fd7ff';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(bx + 24 + i * ((bw - 48) / 6), by + 70, (bw - 48) / 6 - 12, 70);
      }
      ctx.fillStyle = '#4a4f5a';
      ctx.fillRect(bx + bw / 2 - 30, by + bh - 24, 60, 24);
      const blink = Math.floor(frame / 15) % 2 === 0;
      ctx.font = `bold 44px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = blink ? '#ff4bd8' : '#ffd23b';
      ctx.shadowBlur = 18;
      outlinedText(ctx, 'DINER', bx + bw / 2, by - 40, blink ? '#ff8ff0' : '#ffe680', 'rgba(40,0,40,0.8)', 4);
      ctx.shadowBlur = 0;
      ctx.font = `bold 20px ${FONT}`;
      outlinedText(ctx, 'END OF THE UNIVERSE', bx + bw / 2, by - 5, '#ffffff', 'rgba(0,0,0,0.6)', 3);
      break;
    }
  }
  ctx.restore();
}

function drawStarPaths(ctx: CanvasRenderingContext2D, level: Level): void {
  ctx.fillStyle = '#ffffcc';
  for (const p of level.starPaths) {
    const ox = p.x;
    const oy = level.bgY + p.y;
    if (ox + 2 * p.width < -p.width || ox - p.width > W + p.width) continue;
    if (oy + 2 * p.height < -p.height || oy - p.height > H + p.height) continue;
    for (const s of p.stars) {
      const sx = ox + s.x;
      const sy = oy + s.y;
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
      star(ctx, sx, sy, 4 * s.scale, 1.6 * s.scale);
      ctx.fill();
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, level: Level): void {
  const pm = level.pm;
  for (const p of pm.particles) {
    const x = pm.x + p.x;
    const y = level.bgY + p.y;
    if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
    switch (p.kind) {
      case 'drop':
        ctx.fillStyle = hex(p.color);
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'spark': {
        if (p.age > 30) break;
        const t = p.age / 30;
        const size = Math.sin(t * Math.PI) * 9;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        star(ctx, x, y, size, size * 0.35);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,235,120,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, size * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'firework': {
        const fw = p as Firework;
        ctx.fillStyle = hex(fw.glowColor);
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'shadow': {
        const s = p as Shadow;
        if (s.alpha <= 0) break;
        drawDolphin(ctx, x, y, s.dolphinAngle, { anim: 'moving', frame: 0, roll: s.roll, glowAlpha: 0, glowBlur: 0 }, s.tint, s.alpha * 0.8);
        break;
      }
      default:
        ctx.fillStyle = hex(p.color);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
    }
  }
}

function drawFish(ctx: CanvasRenderingContext2D, fish: Fish): void {
  if (fish.x < -80 || fish.x > W + 80 || fish.y < -80 || fish.y > H + 80) return;
  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.rotate(rad(fish.rotation));
  const s = fish.scale;
  ctx.scale(s, fish.flipY ? -s : s);
  const wag = Math.sin(fish.animFrame * 0.5) * 3;
  ctx.lineWidth = 1 / s;
  ctx.strokeStyle = 'rgba(20,30,40,0.7)';
  switch (fish.variant) {
    case 'yellow': {
      ctx.fillStyle = '#f7d037';
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(-24, -10 + wag);
      ctx.lineTo(-24, 10 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f59836';
      ctx.beginPath();
      ctx.moveTo(-4, -10);
      ctx.quadraticCurveTo(0, -22, 8, -10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fbffa5';
      ctx.beginPath();
      ctx.ellipse(2, 4, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'orange': {
      ctx.fillStyle = '#f08a2a';
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-14, -6 + wag);
      ctx.lineTo(-14, 6 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-2, -8, 3, 16);
      ctx.fillRect(5, -7, 3, 14);
      break;
    }
    case 'green': {
      ctx.fillStyle = '#5cb85c';
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-42, -16 + wag);
      ctx.lineTo(-42, 16 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(42, 0);
      ctx.quadraticCurveTo(20, -30, -26, -6);
      ctx.quadraticCurveTo(-30, 0, -26, 6);
      ctx.quadraticCurveTo(20, 30, 42, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath();
      ctx.moveTo(-10, -18);
      ctx.quadraticCurveTo(0, -36, 14, -16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c5e22e';
      ctx.beginPath();
      ctx.ellipse(6, 8, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'blue': {
      ctx.fillStyle = '#3b7dd8';
      ctx.beginPath();
      ctx.moveTo(-50, 0);
      ctx.lineTo(-68, -14 + wag);
      ctx.lineTo(-60, 0 + wag * 0.3);
      ctx.lineTo(-68, 14 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(68, -2);
      ctx.quadraticCurveTo(30, -20, -50, -6);
      ctx.lineTo(-50, 6);
      ctx.quadraticCurveTo(30, 18, 68, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f4fa0';
      ctx.beginPath();
      ctx.moveTo(-10, -12);
      ctx.lineTo(0, -26);
      ctx.lineTo(16, -11);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#cfe6ff';
      ctx.beginPath();
      ctx.ellipse(10, 6, 30, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.fillStyle = '#111';
  ctx.beginPath();
  const ex = fish.variant === 'blue' ? 48 : fish.variant === 'green' ? 26 : 8;
  ctx.arc(ex, -3, fish.variant === 'orange' ? 1.5 : 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGull(ctx: CanvasRenderingContext2D, gull: Seagull): void {
  if (gull.x < -60 || gull.x > W + 60 || gull.y < -60 || gull.y > H + 60) return;
  const flap = gull.flapFrame >= 0 ? Math.sin((gull.flapFrame / 14) * Math.PI * 2) * 8 : 2;
  ctx.save();
  ctx.translate(gull.x, gull.y);
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-17, -flap);
  ctx.quadraticCurveTo(-8, -6 - flap * 0.5, 0, 0);
  ctx.quadraticCurveTo(8, -6 - flap * 0.5, 17, -flap);
  ctx.stroke();
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0, 2, 7, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2b134';
  ctx.beginPath();
  ctx.moveTo(6, 1);
  ctx.lineTo(11, 3);
  ctx.lineTo(6, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRing(ctx: CanvasRenderingContext2D, ring: Ring): void {
  if (ring.x < -120 || ring.x > W + 120 || ring.y < -140 || ring.y > H + 140) return;
  for (const s of ring.sparks) {
    if (s.dead) continue;
    const x = ring.x + s.x;
    const y = ring.y + s.y;
    const color = hex(s.color);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 8);
    g.addColorStop(0, color);
    g.addColorStop(0.4, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCollidables(ctx: CanvasRenderingContext2D, level: Level): void {
  for (const c of level.collidables) {
    if (c.kind === 'fish') drawFish(ctx, c as Fish);
    else if (c.kind === 'gull') drawGull(ctx, c as Seagull);
    else drawRing(ctx, c as Ring);
  }
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  level: Level,
  player: Player | null,
  frame: number,
  skin: DolphinSkin = CLASSIC_SKIN,
  others: RemotePlayer[] = []
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  drawSky(ctx, level);
  drawStarFields(ctx, level);
  drawWater(ctx, level, frame);
  drawFarHills(ctx, level);
  drawDunes(ctx, level);
  drawReef(ctx, level);
  drawSeaFloor(ctx, level);
  if (level.darkness > 0) {
    const top = Math.max(0, level.bgY);
    if (top < H) {
      ctx.fillStyle = `rgba(0,0,0,${level.darkness})`;
      ctx.fillRect(0, top, W, H - top);
    }
  }
  for (const p of level.planets) drawPlanet(ctx, p, level, frame);
  drawStarPaths(ctx, level);
  drawParticles(ctx, level);
  drawClouds(ctx, level);
  drawCollidables(ctx, level);
  drawRemotePlayers(ctx, level, others);
  if (player) {
    drawDolphin(
      ctx,
      player.x,
      player.y,
      player.angle,
      {
        anim: player.anim,
        frame: player.stopped ? 0 : player.animFrame,
        roll: player.rollPhase,
        glowAlpha: player.glowAlpha,
        glowBlur: player.glowBlur,
      },
      null,
      1,
      skin
    );
  }
}

/* --- HUD and menus ------------------------------------------------- */

function drawButton(ctx: CanvasRenderingContext2D, b: UIButton, hover: boolean): void {
  roundRect(ctx, b.x, b.y, b.w, b.h, 8);
  ctx.fillStyle = hover ? '#1b6fe0' : 'rgba(8,52,120,0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.font = `bold ${b.h > 26 ? 15 : 12}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
}

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = 'rgba(4,22,64,0.9)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, game: DolphinGame): void {
  if (game.mode !== 'freestyle') return;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `bold 11px ${FONT}`;
  outlinedText(ctx, 'SCORE', 12, 448, '#bfe3ff');
  outlinedText(ctx, 'TIME', 200, 448, '#bfe3ff');
  ctx.font = `bold 20px ${FONT}`;
  outlinedText(ctx, game.score.toLocaleString('en-GB'), 12, 470);
  outlinedText(ctx, game.timeText, 200, 470);
  if (game.liveScoreText) {
    ctx.font = `bold 11px ${FONT}`;
    outlinedText(ctx, 'COMBO', 300, 448, '#ffe27a');
    ctx.font = `bold 20px ${FONT}`;
    outlinedText(ctx, game.liveScoreText, 300, 470, '#ffe27a');
  }
  if (game.comboNames.length) {
    ctx.font = `bold 14px ${FONT}`;
    ctx.textAlign = 'center';
    const lines = wrapLines(ctx, game.comboNames.join(' + '), 540);
    let y = 412;
    for (let i = lines.length - 1; i >= 0; i--) {
      outlinedText(ctx, lines[i], CX, y);
      y -= 18;
    }
  }
}

const HELP_LINES = [
  ['Up', 'Accelerate. Speed builds while you hold it and bleeds off when you let go.'],
  ['Left / Right', 'Turn. Underwater this steers you; in the air it spins you for Front and Back Flips.'],
  ['Down', 'Roll. In the air a full roll is a Corkscrew. Hold it as you surface to tailslide along the water.'],
  ['Up while sliding', 'Pop off the slide and launch skyward.'],
  ['Type', 'Chat to the room when playing online. Enter clears it.'],
  ['Escape', 'Pause.'],
];

/* The same four controls, played with fingers. Kept as short as the
   keyboard's, so the panel still holds the tips underneath. */
const HELP_LINES_TOUCH = [
  ['Hold', 'Accelerate. You swim for as long as a finger is down.'],
  ['Drag', 'Steer. The dolphin turns to point wherever your finger sits from the spot you first touched. In the air that spins it for Front and Back Flips.'],
  ['Second finger', 'Roll for a Corkscrew, or a tailslide if you hold it as you surface.'],
  ['Lift it again', 'Pop off the slide and launch skyward.'],
  ['Menu', 'Pause, bottom right.'],
];

/* The two tips that name a key say the other thing on a touch screen. */
const helpTips = (touchInput: boolean): string[] => [
  touchInput
    ? 'Dive deep, point back up and keep holding for a big launch. Re-enter the water nose first for a Nice Entry and a speed boost.'
    : 'Dive deep, turn up, and hold Up for a big launch. Re-enter the water nose first for a Nice Entry and a speed boost.',
  'Chain tricks in one jump to build a multiplier. Repeating a trick counts, but adds less each time.',
  'Swim through the rings of sparks. Lead a school of fish into the air for Schooled.',
  `Higher than the moon you will find trails of stars. ${touchInput ? 'A second finger' : 'Hold Down'} rides them: a Starslide, and a speed bonus when you pop off.`,
  'How high can you go? Somewhere out there is a diner.',
];

function drawHelp(ctx: CanvasRenderingContext2D, buttons: UIButton[], hover: string | null, touchInput: boolean): void {
  drawPanel(ctx, 50, 40, 540, 400);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('How to play', 74, 76);
  let y = 104;
  for (const [key, text] of touchInput ? HELP_LINES_TOUCH : HELP_LINES) {
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(key, 74, y);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#e8f1ff';
    const lines = wrapLines(ctx, text, 340);
    lines.forEach((line, i) => ctx.fillText(line, 226, y + i * 15));
    y += Math.max(1, lines.length) * 15 + 6;
  }
  y += 6;
  ctx.font = `12px ${FONT}`;
  for (const tip of helpTips(touchInput)) {
    ctx.fillStyle = '#bfe3ff';
    const lines = wrapLines(ctx, '• ' + tip, 490);
    lines.forEach((line, i) => ctx.fillText(line, 74, y + i * 15));
    y += lines.length * 15 + 4;
  }
  for (const b of buttons) drawButton(ctx, b, hover === b.id);
}

function drawTitle(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { frame, buttons, hover, best, level } = state;
  const bob = Math.sin(frame * 0.06) * 6;
  drawDolphin(ctx, 190, 250 + bob, -28, { anim: 'moving', frame, roll: 0, glowAlpha: 0.4, glowBlur: 6 }, null, 1, state.skin);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 46px ${FONT}`;
  outlinedText(ctx, 'DOLPHIN', 40, 110, '#ffffff', 'rgba(0,40,110,0.95)', 7);
  outlinedText(ctx, 'OLYMPICS', 40, 158, '#ffe27a', 'rgba(0,40,110,0.95)', 7);
  ctx.font = `bold 13px ${FONT}`;
  outlinedText(ctx, 'a tribute port of the Flash classic', 44, 182, '#e8f1ff');
  ctx.font = `bold 12px ${FONT}`;
  outlinedText(ctx, 'Original game by Alan Rawkins', 44, 200, '#ffe27a');
  if (best > 0) {
    ctx.font = `bold 14px ${FONT}`;
    outlinedText(ctx, `Best score: ${best.toLocaleString('en-GB')}`, 44, 228, '#bfe3ff');
  }
  ctx.textAlign = 'center';
  ctx.font = `bold 12px ${FONT}`;
  outlinedText(
    ctx,
    state.touchInput
      ? 'Hold to swim, drag to steer, second finger to roll. Two minutes on the clock.'
      : 'Arrow keys to swim. Two minutes on the clock. Enter to start.',
    CX, 458, '#e8f1ff'
  );
  if (level.skyMode !== 'day') {
    ctx.font = `11px ${FONT}`;
    outlinedText(ctx, level.skyMode === 'night' ? 'Night swim.' : 'Evening swim.', CX, 440, '#bfe3ff');
  }
  for (const b of buttons) drawButton(ctx, b, hover === b.id);
}

function drawPause(ctx: CanvasRenderingContext2D, state: RenderState): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 30px ${FONT}`;
  outlinedText(ctx, 'Paused', CX, 118, '#ffffff', 'rgba(0,40,110,0.95)', 6);
  for (const b of state.buttons) drawButton(ctx, b, state.hover === b.id);
}

function drawEnd(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const stats = state.stats;
  if (!stats) return;
  drawPanel(ctx, 50, 40, 540, 400);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText("Time's up!", CX, 84);
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillStyle = '#ffe27a';
  ctx.fillText(stats.score.toLocaleString('en-GB'), CX, 132);
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillStyle = '#bfe3ff';
  ctx.fillText(stats.score >= state.best && stats.score > 0 ? 'New best score!' : `Best: ${state.best.toLocaleString('en-GB')}`, CX, 154);
  const rows: [string, string][] = [
    ['Longest jump', `${stats.longestJump} m`],
    ['Highest jump', `${stats.highestJump} m`],
    ['Biggest splash', `${stats.biggestSplash} litres`],
    ['Longest tailslide', `${stats.longestTailslide} m`],
    ['Highest speed', `${stats.highestSpeed} m/s`],
    ['Biggest combo', `${stats.biggestCombo} tricks`],
  ];
  let y = 196;
  for (const [label, value] of rows) {
    ctx.textAlign = 'left';
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#e8f1ff';
    ctx.fillText(label, 150, y);
    ctx.textAlign = 'right';
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(value, 490, y);
    y += 26;
  }
  for (const b of state.buttons) drawButton(ctx, b, state.hover === b.id);
}

/* The touch stick: a ring where the finger landed and a knob showing
   which way the dolphin is being pointed. Faint on purpose — it is a
   reminder of where the anchor is, not something to look at. */
function drawStick(ctx: CanvasRenderingContext2D, touch: TouchView): void {
  const dx = touch.x - touch.ax;
  const dy = touch.y - touch.ay;
  const distance = Math.hypot(dx, dy);
  const reach = Math.min(distance, STICK_REACH);
  const kx = distance > 0 ? touch.ax + (dx / distance) * reach : touch.ax;
  const ky = distance > 0 ? touch.ay + (dy / distance) * reach : touch.ay;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(touch.ax, touch.ay, STICK_REACH, 0, Math.PI * 2);
  ctx.stroke();

  if (distance > 0) {
    ctx.beginPath();
    ctx.moveTo(touch.ax, touch.ay);
    ctx.lineTo(kx, ky);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(kx, ky, 16, 0, Math.PI * 2);
  ctx.fillStyle = touch.grinding ? 'rgba(255,226,122,0.5)' : 'rgba(255,255,255,0.28)';
  ctx.fill();
  ctx.strokeStyle = touch.grinding ? 'rgba(255,226,122,0.95)' : 'rgba(255,255,255,0.6)';
  ctx.stroke();
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { screen, game, level, help, buttons, hover, multiplayer } = state;
  drawWorld(ctx, level, game ? game.player : null, state.frame, state.skin, multiplayer?.others ?? []);
  if (screen === 'game' && game && multiplayer) {
    const { chatText, chatUpdatedAt } = multiplayer.self;
    drawChatBubble(ctx, game.player.x, game.player.y - 48, chatText, chatAlpha(chatText, chatUpdatedAt, performance.now()));
  }
  if (screen === 'title') {
    if (help) drawHelp(ctx, buttons, hover, state.touchInput);
    else drawTitle(ctx, state);
    if (multiplayer && !help) drawRoster(ctx, multiplayer, false);
    return;
  }
  if (!game) return;
  drawHud(ctx, game);
  if (state.touch) drawStick(ctx, state.touch);
  if (multiplayer && !help) drawRoster(ctx, multiplayer, true);
  for (const b of buttons) {
    if (b.id === 'ingame-menu') drawButton(ctx, b, hover === b.id);
  }
  const menuButtons = buttons.filter((b) => b.id !== 'ingame-menu');
  if (help) {
    drawHelp(ctx, buttons.filter((b) => b.id === 'close-help'), hover, state.touchInput);
  } else if (screen === 'end') {
    drawEnd(ctx, { ...state, buttons: menuButtons });
  } else if (game.paused) {
    drawPause(ctx, { ...state, buttons: menuButtons });
  }
}

/* Which buttons exist on which screen, and where. */
export function layoutButtons(screen: Screen, help: boolean, game: DolphinGame | null): UIButton[] {
  if (help) return [{ id: 'close-help', label: 'Close', x: 480, y: 396, w: 90, h: 30 }];
  if (screen === 'title') {
    return [
      { id: 'start', label: 'Start Game', x: 330, y: 150, w: 190, h: 36 },
      { id: 'online', label: 'Play Online', x: 330, y: 200, w: 190, h: 36 },
      { id: 'freeswim', label: 'Free Swim', x: 330, y: 250, w: 190, h: 36 },
      { id: 'help', label: 'How to Play', x: 330, y: 300, w: 190, h: 36 },
    ];
  }
  const inGame: UIButton[] = [{ id: 'ingame-menu', label: 'Menu', x: 566, y: 448, w: 64, h: 22 }];
  if (screen === 'end') {
    return [
      { id: 'play-again', label: 'Play Again', x: 200, y: 378, w: 110, h: 34 },
      { id: 'menu', label: 'Main Menu', x: 330, y: 378, w: 110, h: 34 },
      ...inGame,
    ];
  }
  if (game && game.paused) {
    const items: [string, string][] = [['resume', 'Resume']];
    if (game.mode === 'freestyle') items.push(['restart', 'Restart Game']);
    items.push(['help', 'How to Play'], ['menu', 'Main Menu']);
    return [
      ...items.map(([id, label], i) => ({ id, label, x: 225, y: 150 + i * 50, w: 190, h: 36 })),
      ...inGame,
    ];
  }
  return inGame;
}
