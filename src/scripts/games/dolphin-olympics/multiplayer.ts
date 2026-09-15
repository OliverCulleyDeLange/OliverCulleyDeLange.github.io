import {
  ANIM_NAMES,
  DEFAULT_ROOM,
  PING,
  PONG,
  PROTOCOL_VERSION,
  sanitizeRoom,
  type PlayerState,
  type Profile,
  type RemotePlayerInfo,
  type ServerMessage,
} from '../../../../workers/dolphin-multiplayer/src/protocol';
import type { Anim } from './player';

/* The client side of multiplayer: one WebSocket to the room's Durable
   Object, a roster of the other dolphins, and enough buffering to draw
   them smoothly between the ten-a-second updates they send.

   Nothing here touches the simulation. Other players are ghosts: they are
   drawn into your world at their reported position, and you into theirs. */

export type ConnectionStatus = 'offline' | 'connecting' | 'online';

/* Draw other dolphins this far in the past so there is nearly always a
   newer packet to interpolate towards. Poses arrive roughly every 100 ms,
   so this leaves about one packet's worth of slack for network jitter. */
const RENDER_DELAY_MS = 200;
/* When the next pose is later than that, carry on along the last known
   velocity for at most this long before freezing in place. Long enough to
   ride out a TCP retransmit without a visible stall, short enough not to
   overshoot much when the dolphin has actually turned. */
const EXTRAPOLATE_MAX_MS = 120;
/* The sender's clock offset is the minimum over this many recent packets:
   enough to have seen a quick one, few enough to follow clock drift. */
const OFFSET_WINDOW = 32;
/* A dolphin that has gone quiet for this long stays visible, but is shown
   frozen and grey with an AFK timer until it moves or disconnects. */
export const AFK_AFTER_MS = 4_000;
const SNAPSHOTS = 12;
const PING_INTERVAL_MS = 30_000;
const STEP_MS = 1000 / 31;
export const CHAT_HOLD_MS = 3_000;
export const CHAT_FADE_MS = 1_500;

export interface RemotePose {
  x: number;
  y: number;
  angle: number;
  anim: Anim;
  frame: number;
  roll: number;
  glow: number;
}

interface Snapshot {
  at: number;
  state: PlayerState;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* Interpolate around a wrap point: degrees mod 360, or a phase mod 1. */
function lerpWrapped(a: number, b: number, t: number, period: number): number {
  let d = (b - a) % period;
  if (d > period / 2) d -= period;
  else if (d < -period / 2) d += period;
  const v = (a + d * t) % period;
  return v < 0 ? v + period : v;
}

export class RemotePlayer {
  profile: Profile;
  latest: PlayerState | null = null;
  lastSeen = 0;
  chatText = '';
  chatUpdatedAt = 0;
  private readonly snapshots: Snapshot[] = [];
  private readonly offsets: number[] = [];

  constructor(readonly id: string, profile: Profile) {
    this.profile = profile;
  }

  get score(): number {
    return this.latest?.s ?? 0;
  }

  get playing(): boolean {
    return this.latest?.p === 1;
  }

  push(state: PlayerState, now: number): void {
    this.latest = state;
    this.lastSeen = now;
    const previous = this.snapshots[this.snapshots.length - 1];
    const at = Math.max(this.placeOnTimeline(state, now), previous ? previous.at + 1 : 0);
    this.snapshots.push({ at, state });
    if (this.snapshots.length > SNAPSHOTS) this.snapshots.shift();
  }

  /* WebSockets ride on TCP, so poses reach us in bursts and stalls rather
     than at the steady rate they were sent: one lost segment holds back
     everything behind it until the retransmit lands. Stamping poses on
     arrival bakes all of that into the animation, which is what made the
     other dolphins look smeared. Instead each pose carries the sender's
     clock, and the smallest (arrival - sent) seen recently is the best
     estimate of the offset between our clocks, because delay only ever
     makes a packet later, never earlier. */
  private placeOnTimeline(state: PlayerState, now: number): number {
    if (!(state.ts > 0)) return now;
    this.offsets.push(now - state.ts);
    if (this.offsets.length > OFFSET_WINDOW) this.offsets.shift();
    return state.ts + Math.min(...this.offsets);
  }

  pushChat(text: string, now: number): void {
    this.chatText = text;
    this.chatUpdatedAt = now;
  }

  /* Where to draw this dolphin right now, or null if it is not in the
     world (for example, while it is on a menu). */
  sample(now: number): RemotePose | null {
    const latest = this.latest;
    if (!latest || latest.p !== 1) return null;
    const t = now - RENDER_DELAY_MS;
    const list = this.snapshots;
    let from = list[0];
    let to = list[list.length - 1];
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i - 1].at <= t) {
        from = list[i - 1];
        to = list[i];
        break;
      }
    }
    const a = from.state;
    const b = to.state;
    const span = to.at - from.at;
    const mix = span > 0 ? Math.min(1, Math.max(0, (t - from.at) / span)) : 1;
    let x = lerp(a.x, b.x, mix);
    let y = lerp(a.y, b.y, mix);
    /* How far past the newest pose we are: negative while there is still
       something to interpolate towards. */
    const ahead = t - to.at;
    if (ahead > 0 && span > 0) {
      const carry = Math.min(ahead, EXTRAPOLATE_MAX_MS) / span;
      x = b.x + (b.x - a.x) * carry;
      y = b.y + (b.y - a.y) * carry;
    }
    return {
      x,
      y,
      angle: lerpWrapped(a.a, b.a, mix, 360),
      anim: ANIM_NAMES[b.an] ?? 'moving',
      /* The tail keeps time with the sender's frame counter, and stops
         once they have gone quiet. */
      frame: Math.max(0, b.f + Math.min(AFK_AFTER_MS, ahead) / STEP_MS),
      roll: lerpWrapped(a.r, b.r, mix, 1),
      glow: lerp(a.g, b.g, mix),
    };
  }
}

export interface RealtimeOptions {
  /* Origin of the worker, e.g. https://example.workers.dev */
  server: string;
  room?: string;
  profile: Profile;
  onChange?: () => void;
}

export class RealtimeClient {
  status: ConnectionStatus = 'offline';
  id: string | null = null;
  readonly room: string;
  readonly players = new Map<string, RemotePlayer>();
  private readonly url: string;
  private profile: Profile;
  private ws: WebSocket | null = null;
  private closed = false;
  private introduced = false;
  private retryMs = 1000;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private readonly onChange: () => void;

  constructor(options: RealtimeOptions) {
    this.room = sanitizeRoom(options.room ?? DEFAULT_ROOM);
    this.profile = options.profile;
    this.onChange = options.onChange ?? (() => {});
    const origin = options.server.replace(/\/+$/, '').replace(/^http/, 'ws');
    this.url = `${origin}/rooms/${encodeURIComponent(this.room)}`;
  }

  get others(): RemotePlayer[] {
    return [...this.players.values()];
  }

  get onlineCount(): number {
    return this.status === 'online' ? this.players.size + 1 : 0;
  }

  connect(): void {
    if (this.closed || this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (error) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.introduced = false;
    this.setStatus('connecting');
    ws.addEventListener('open', () => {
      this.retryMs = 1000;
      this.send({ t: 'hello', v: PROTOCOL_VERSION, profile: this.profile });
      this.introduced = true;
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(PING);
      }, PING_INTERVAL_MS);
    });
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data === PONG) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch (error) {
        return;
      }
      this.handle(message);
    });
    ws.addEventListener('close', () => this.dropped(ws));
    ws.addEventListener('error', () => this.dropped(ws));
  }

  setProfile(profile: Profile): void {
    this.profile = profile;
    if (this.introduced) this.send({ t: 'hello', v: PROTOCOL_VERSION, profile });
  }

  sendState(state: PlayerState): void {
    if (this.status !== 'online') return;
    this.send({ t: 'state', ...state });
  }

  sendChat(text: string): void {
    if (this.status !== 'online') return;
    this.send({ t: 'chat', text });
  }

  /* Leave the room. Unlike destroy(), connect() works again afterwards.
     Clearing `ws` before closing keeps the close event from scheduling a
     reconnect; the server's close handler tells the others we have gone. */
  disconnect(): void {
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retryMs = 1000;
    const ws = this.ws;
    this.ws = null;
    this.id = null;
    this.introduced = false;
    this.stopPing();
    if (ws) {
      try {
        ws.close(1000, 'bye');
      } catch (error) {}
    }
    this.players.clear();
    this.setStatus('offline');
  }

  destroy(): void {
    this.closed = true;
    this.disconnect();
  }

  private handle(message: ServerMessage): void {
    const now = performance.now();
    switch (message.t) {
      case 'welcome':
        this.id = message.id;
        this.players.clear();
        for (const info of message.players) this.add(info, now);
        this.setStatus('online');
        break;
      case 'join':
        this.add({ id: message.id, profile: message.profile }, now);
        this.onChange();
        break;
      case 'profile': {
        const player = this.players.get(message.id);
        if (player) player.profile = message.profile;
        else this.add({ id: message.id, profile: message.profile }, now);
        this.onChange();
        break;
      }
      case 'move': {
        const player = this.players.get(message.id);
        if (!player) return;
        const { t, id, ...state } = message;
        player.push(state, now);
        break;
      }
      case 'chat': {
        const player = this.players.get(message.id);
        if (player) player.pushChat(message.text, now);
        break;
      }
      case 'leave':
        if (this.players.delete(message.id)) this.onChange();
        break;
      case 'error':
        break;
    }
  }

  private add(info: RemotePlayerInfo, now: number): void {
    const player = new RemotePlayer(info.id, info.profile);
    if (info.state) player.push(info.state, now);
    this.players.set(info.id, player);
  }

  private send(message: object): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {}
  }

  private dropped(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.stopPing();
    this.players.clear();
    this.setStatus('offline');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(30_000, this.retryMs * 2);
  }

  private stopPing(): void {
    if (this.pingTimer != null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onChange();
  }
}
