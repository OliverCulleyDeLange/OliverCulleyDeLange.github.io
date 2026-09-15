import { DurableObject } from 'cloudflare:workers';
import {
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  PING,
  PONG,
  sanitizeChat,
  sanitizeProfile,
  sanitizeRoom,
  sanitizeState,
  type ClientMessage,
  type PlayerState,
  type Profile,
  type RemotePlayerInfo,
  type ServerMessage,
} from './protocol';

/* Dolphin Olympics realtime: a Worker that upgrades WebSockets and hands
   each one to the Durable Object for its room. The room relays poses
   between players and keeps a roster; it holds no game logic and nothing
   that needs to survive a restart, so it never touches storage.

   Uses the hibernation WebSocket API: when nobody is moving the object is
   evicted from memory while the sockets stay connected, so an idle room
   costs nothing. Per-connection state lives in the socket attachment,
   which survives hibernation. */

export interface Env {
  ROOMS: DurableObjectNamespace<DolphinRoom>;
}

/* Browsers send an Origin header on WebSocket upgrades; anything else is
   refused so the relay only serves the game itself. */
const ALLOWED_ORIGINS = new Set(['https://oliverdelange.co.uk', 'https://www.oliverdelange.co.uk']);
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin);
}

const ROOM_PATH = /^\/rooms\/([^/]+)\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({ ok: true, service: 'dolphin-olympics-realtime' });
    }
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    if (!originAllowed(request.headers.get('Origin'))) {
      return new Response('Forbidden', { status: 403 });
    }
    const room = sanitizeRoom(decodeURIComponent(match[1]));
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
    return stub.fetch(new Request(`https://room/${room}`, request));
  },
} satisfies ExportedHandler<Env>;

/* Stored on each socket via serializeAttachment. */
interface Session {
  id: string;
  profile: Profile | null;
}

interface Budget {
  windowStart: number;
  count: number;
}

/* The game sends ten poses a second; anything far beyond that is dropped. */
const MAX_MESSAGES_PER_SECOND = 40;

export class DolphinRoom extends DurableObject<Env> {
  /* Latest pose per player, so a newcomer sees everyone straight away.
     In-memory only: it is rebuilt within a tick after hibernation. */
  private readonly lastState = new Map<string, PlayerState>();
  private readonly budgets = new Map<WebSocket, Budget>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const room = new URL(request.url).pathname.slice(1);
    const existing = this.ctx.getWebSockets();
    if (existing.length >= MAX_PLAYERS) return new Response('Room full', { status: 503 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const session: Session = { id: crypto.randomUUID().slice(0, 8), profile: null };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(session);

    const players: RemotePlayerInfo[] = [];
    for (const ws of existing) {
      const other = this.sessionOf(ws);
      if (!other?.profile) continue;
      players.push({ id: other.id, profile: other.profile, state: this.lastState.get(other.id) });
    }
    this.send(server, { t: 'welcome', id: session.id, room, players });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return;
    if (!this.withinBudget(ws)) return;
    const session = this.sessionOf(ws);
    if (!session) return;
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch (error) {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    if (parsed.t === 'hello') {
      const profile = sanitizeProfile(parsed.profile);
      const first = session.profile === null;
      session.profile = profile;
      ws.serializeAttachment(session);
      this.broadcast({ t: first ? 'join' : 'profile', id: session.id, profile }, ws);
    } else if (parsed.t === 'state') {
      if (!session.profile) return;
      const state = sanitizeState(parsed);
      if (!state) return;
      this.lastState.set(session.id, state);
      this.broadcast({ t: 'move', id: session.id, ...state }, ws);
    } else if (parsed.t === 'chat') {
      if (!session.profile) return;
      this.broadcast({ t: 'chat', id: session.id, text: sanitizeChat(parsed.text) }, ws);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.drop(ws);
    try {
      ws.close(code, reason);
    } catch (error) {}
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  private drop(ws: WebSocket): void {
    this.budgets.delete(ws);
    const session = this.sessionOf(ws);
    if (!session) return;
    this.lastState.delete(session.id);
    if (session.profile) this.broadcast({ t: 'leave', id: session.id }, ws);
  }

  private sessionOf(ws: WebSocket): Session | null {
    try {
      return (ws.deserializeAttachment() as Session | null) ?? null;
    } catch (error) {
      return null;
    }
  }

  private withinBudget(ws: WebSocket): boolean {
    const now = Date.now();
    let budget = this.budgets.get(ws);
    if (!budget || now - budget.windowStart >= 1000) {
      budget = { windowStart: now, count: 0 };
      this.budgets.set(ws, budget);
    }
    budget.count++;
    return budget.count <= MAX_MESSAGES_PER_SECOND;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {}
  }

  private broadcast(message: ServerMessage, except: WebSocket | null): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch (error) {}
    }
  }
}
