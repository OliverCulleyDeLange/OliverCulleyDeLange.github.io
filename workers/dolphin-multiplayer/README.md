# Dolphin Olympics realtime relay

A Cloudflare Worker plus one Durable Object per room. Each browser runs the game itself and
streams its dolphin's pose about ten times a second; the room fans that and live chat out to
everyone else, who draw it as a ghost with a name and flag. Rings, fish and scoring stay local. The object
holds no game logic and writes nothing to storage, so it fits comfortably in the Workers Free
plan: SQLite-backed Durable Objects are free-tier eligible, and the hibernation WebSocket API
means an idle room is evicted from memory while its sockets stay connected.

Free-plan budget (per day): 100,000 requests, 13,000 GB-s. Incoming WebSocket messages count
20:1 against requests and outgoing ones are free, so one player-hour is about 1,800 requests.

## Endpoints

- `GET /health` — liveness.
- `GET /rooms/<name>` — WebSocket upgrade. Room names are `[a-z0-9-]{1,32}`; anything else
  lands in `lobby`. The `Origin` header must be the site (or localhost for development).

The message shapes live in [`src/protocol.ts`](src/protocol.ts), which the game imports
directly so the two sides cannot drift.

## Develop

```sh
npm install
npm run dev              # http://localhost:8787 on the local runtime
node scripts/smoke.mjs   # two clients join, swap poses, ping and leave
npm run check && npm test
```

The game connects to `localhost:8787` automatically when the Astro dev server is on
localhost, and to the deployed worker otherwise. `?server=<origin>` on the game URL overrides
either.

## Deploy

```sh
npx wrangler login       # once
npm run deploy
```

CI does the same on pushes to `master` that touch this directory, when the repository has the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. The game expects the worker at
`https://dolphin-olympics-realtime.oliverdelange.workers.dev`; change `PRODUCTION_SERVER` in
`src/scripts/games/dolphin-olympics/index.ts` if it lives elsewhere.
