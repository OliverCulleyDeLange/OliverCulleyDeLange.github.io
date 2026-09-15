/* Wire protocol shared by the realtime worker and the game client.

   The server is a relay, not a referee: each browser simulates its own
   dolphin and streams its pose; the room fans that out to everyone else.
   Positions are in the game's "background" space — x grows to the right,
   y grows downward and the water surface is y = 0 — so a client can place
   another dolphin by offsetting with its own scroll. Everything that
   crosses the wire is sanitised here on both sides. */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_ROOM = 'lobby';
export const MAX_PLAYERS = 24;
export const MAX_NAME_LENGTH = 14;
export const MAX_CHAT_LENGTH = 64;
export const MAX_MESSAGE_BYTES = 2048;

export const SKIN_IDS = ['classic', 'pink', 'orca', 'gold', 'mint', 'lava', 'midnight', 'lilac'] as const;
export type SkinId = (typeof SKIN_IDS)[number];

/* Animation names travel as an index into this list. Keep the order stable. */
export const ANIM_NAMES = ['moving', 'accelerating', 'turningLeft', 'turningRight', 'rolling', 'tailslide', 'crashingRight'] as const;
export type AnimName = (typeof ANIM_NAMES)[number];

export interface Profile {
  name: string;
  /* ISO 3166-1 alpha-2 country code, or '' for no flag. */
  flag: string;
  skin: SkinId;
}

/* A dolphin's pose, compact because it is sent ten times a second. */
export interface PlayerState {
  x: number;
  y: number;
  /* Heading in degrees, 0 = facing right, 90 = straight down. */
  a: number;
  /* Index into ANIM_NAMES. */
  an: number;
  /* Animation frame counter. */
  f: number;
  /* Barrel-roll phase, 0..1. */
  r: number;
  /* Boost glow, 0..1. */
  g: number;
  /* Score so far this game. */
  s: number;
  /* 1 while actually playing; 0 on the menus, where the dolphin is not
     in the world and should not be drawn. */
  p: 0 | 1;
  /* The sender's clock (its performance.now(), ms) at the moment this
     pose was true. Receivers place poses on that timeline rather than on
     arrival time, which the network jitters. 0 when unknown. */
  ts: number;
}

export interface RemotePlayerInfo {
  id: string;
  profile: Profile;
  state?: PlayerState;
}

export type ClientMessage =
  | { t: 'hello'; v: number; profile: Profile }
  | ({ t: 'state' } & PlayerState)
  | { t: 'chat'; text: string };

export type ServerMessage =
  | { t: 'welcome'; id: string; room: string; players: RemotePlayerInfo[] }
  | { t: 'join'; id: string; profile: Profile }
  | { t: 'profile'; id: string; profile: Profile }
  | ({ t: 'move'; id: string } & PlayerState)
  | { t: 'chat'; id: string; text: string }
  | { t: 'leave'; id: string }
  | { t: 'error'; message: string };

/* Keep-alive. The server answers this without waking a hibernating room. */
export const PING = 'ping';
export const PONG = 'pong';

/* --- sanitisers ---------------------------------------------------- */

export function sanitizeRoom(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ROOM;
  const room = raw.trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(room) ? room : DEFAULT_ROOM;
}

/* Control characters, zero-width and bidi marks: anything that could hide
   in or reshape a name label. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('');
}

export function sanitizeChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, MAX_CHAT_LENGTH).join('');
}

export function sanitizeFlag(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

export function sanitizeSkin(raw: unknown): SkinId {
  return (SKIN_IDS as readonly string[]).includes(raw as string) ? (raw as SkinId) : 'classic';
}

export function sanitizeProfile(raw: unknown): Profile {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: sanitizeName(source.name) || 'Dolphin',
    flag: sanitizeFlag(source.flag),
    skin: sanitizeSkin(source.skin),
  };
}

function num(value: unknown, min: number, max: number, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value < min ? min : value > max ? max : value;
}

/* Rejects anything that is not shaped like a pose and clamps the rest
   into the range the game can actually produce. */
export function sanitizeState(raw: unknown): PlayerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.x !== 'number' || typeof s.y !== 'number') return null;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
  const a = (((num(s.a, -3600, 3600) % 360) + 360) % 360);
  return {
    x: Math.round(num(s.x, -5_000_000, 5_000_000)),
    y: Math.round(num(s.y, -200_000, 2_000)),
    a: Math.round(a * 10) / 10,
    an: Math.round(num(s.an, 0, ANIM_NAMES.length - 1)),
    f: Math.round(num(s.f, 0, 1_000_000)),
    r: Math.round(num(s.r, 0, 1) * 100) / 100,
    g: Math.round(num(s.g, 0, 1) * 100) / 100,
    s: Math.round(num(s.s, 0, 1_000_000_000)),
    p: s.p === 1 || s.p === true ? 1 : 0,
    ts: Math.round(num(s.ts, 0, 1e14)),
  };
}
