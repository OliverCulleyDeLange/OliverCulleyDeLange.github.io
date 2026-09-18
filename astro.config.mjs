// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import appIcons from './src/integrations/app-icons.mjs';
import serviceWorker from './src/integrations/service-worker.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://oliverdelange.co.uk',
  integrations: [mdx(), appIcons(), serviceWorker()],
  output: 'static',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});
