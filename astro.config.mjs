// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import appIcons from './src/integrations/app-icons.mjs';
import serviceWorker from './src/integrations/service-worker.mjs';

/* These apps are deployed independently beneath the same origin. The site's
   root service worker must leave both their documents and their assets alone
   so each app can own its own release and offline lifecycle. */
const independentAppPaths = [
  '/6ss',
  '/ecard',
  '/grvmkr',
  '/memory-kmm-compose',
  '/schengen-calculator',
  '/tiles',
  '/trip-planner',
];

// https://astro.build/config
export default defineConfig({
  site: 'https://oliverdelange.co.uk',
  integrations: [mdx(), appIcons(), serviceWorker({ independentAppPaths })],
  output: 'static',
  // Astro 7 switched to JSX-style whitespace stripping by default, which
  // drops the spaces between inline elements. Keep the HTML-aware behaviour.
  compressHTML: true,
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
