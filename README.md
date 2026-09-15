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

## Dolphin Olympics multiplayer

The game at `/dolphin-olympics/` shows other people's dolphins in real time. The relay is a
small Cloudflare Worker with a Durable Object per room in
[`workers/dolphin-multiplayer`](workers/dolphin-multiplayer/README.md), deployed separately
from the site by `.github/workflows/deploy-worker.yml`. The site itself stays static.

## Analytics

[ocd.goatcounter.com](https://ocd.goatcounter.com/)

