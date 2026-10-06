# oliverdelange.co.uk

Personal blog at [oliverdelange.co.uk](https://oliverdelange.co.uk), built with [Astro](https://astro.build) and deployed to GitHub Pages.

## Local dev

```sh
npm install
npm run dev        # http://localhost:4321
```

## Build

```sh
npm run build      # outputs to dist/
npm run preview    # preview the build locally
```

## Deploy

Pushing to `master` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`) which builds and deploys to GitHub Pages automatically.

Each deployment gets a release version in the form `YYYY.M.D-N`, shown in
the desktop's **About This Site** window. The workflow generates it from the
UK date on which the run was created and its order among that day's runs, so
rerunning the same workflow keeps the same version and a second release that
day becomes `-2`. Local builds use `YYYY.M.D-dev`.

## Offline

The site is a PWA: one visit caches every page, script, stylesheet and font,
so the whole thing — games included — works on a plane.

`src/integrations/service-worker.mjs` walks `dist/` after a build and writes
`dist/sw.js` from the template in `src/sw/service-worker.js`, filling in two
lists. The shell (pages, JS, CSS, fonts, icons) is cached while the worker
installs. The images are asked for by the page once it has loaded, a few at
a time, and skipped when the browser is in data-saving mode; the pass only
fetches what is missing, so it picks up where the last visit left off.
Videos and the handful of multi-megabyte scans are deliberately left out and
are cached only if you actually open one.

The version is a hash of the shell, so a deploy that changes nothing leaves
the visitor's cache alone, and one that does swaps the whole cache over and
resets persisted desktop layout/session state before the new desktop mounts.
Every page load explicitly checks for a newer worker. Once it is installed and
ready, the site prompts the visitor to update; accepting activates it and
reloads the page under the new version.
There is no `sw.js` in `astro dev` — only the built site registers a worker.

Apps deployed independently below this domain are listed in `astro.config.mjs`.
The root worker bypasses their documents and assets completely and only ever
reads or deletes its own `odl-site-*` caches (plus its exact legacy fingerprint
format during migration), leaving each app's caches untouched.

Install metadata lives in `public/manifest.webmanifest`. The home-screen
icons are rendered into the build by `src/integrations/app-icons.mjs`,
which blows the 16x16 favicon art up to the sizes a PWA needs — so there
are no icon files to keep in step with the mark.

## Dolphin Olympics multiplayer

The game at `/dolphin-olympics/` shows other people's dolphins in real time. The relay is a
small Cloudflare Worker with a Durable Object per room in
[`workers/dolphin-multiplayer`](workers/dolphin-multiplayer/README.md), deployed separately
from the site by `.github/workflows/deploy-worker.yml`. The site itself stays static.

## Analytics

[ocd.goatcounter.com](https://ocd.goatcounter.com/)


## Dolphin Olympics on a phone

The game is playable with fingers as well as arrow keys (`src/scripts/games/
dolphin-olympics/touch.ts`). The first finger down is a stick: where it lands
is the anchor, and the direction from there to the finger is where the
dolphin points — drag down to dive, up to climb. Holding the screen at all
accelerates, so a plain touch is "swim". A second finger anywhere is Down: a
roll in the air, a tailslide when you surface, and lifting it pops you off
the rail. The layer only holds and releases the same four keys the keyboard
does, so the physics, tricks and scoring are untouched.
