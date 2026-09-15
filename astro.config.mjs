// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://oliverdelange.co.uk',
  integrations: [mdx()],
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
