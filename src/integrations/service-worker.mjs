import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Turns the finished build into a precache list and writes dist/sw.js.

   The site is static and small, so rather than guess at what a visitor
   will want next, the worker takes the lot: every page and script up
   front, the images in the background. See src/sw/service-worker.js for
   what the worker then does with the lists. */

const TEMPLATE = new URL('../sw/service-worker.js', import.meta.url);

/* Kept out of the precache lists entirely: the worker itself, and the
   videos, which are most of the site's bytes and stream fine online. */
const SKIP = new Set(['sw.js']);
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

/* Everything needed to render any page, offline, immediately. The icons
   are here rather than with the images because an installed app wants
   them before it has a network. */
const SHELL = /\.(html|css|js|mjs|woff2?|webmanifest|json|txt|xml|ico)$/i;
const SHELL_FILES = /^(favicon\.svg|icons\/)/;

/* Fetched in the background afterwards. A handful of scanned maps run to
   several megabytes each; they are not worth a background download, and
   are still cached if you actually look at one. */
const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MEDIA_MAX_BYTES = 1_500_000;

async function walk(dir, base = dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, files);
    else if (entry.isFile()) files.push(relative(base, full).split(sep).join('/'));
  }
  return files;
}

/* The URL a browser will actually ask for: a directory for a page, the
   file itself for everything else. */
function urlFor(file) {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return '/' + file.slice(0, -'index.html'.length);
  return '/' + file;
}

export default function serviceWorker() {
  return {
    name: 'odl-service-worker',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const files = (await walk(outDir)).filter((file) => !SKIP.has(file));

        const shell = [];
        const media = [];
        let mediaBytes = 0;
        const hash = createHash('sha256');

        for (const file of files.sort()) {
          if (VIDEO.test(file)) continue;
          const path = join(outDir, file);
          if (SHELL.test(file) || SHELL_FILES.test(file)) {
            shell.push(urlFor(file));
            /* The version is the shell's fingerprint, so a deploy that
               changes nothing leaves the visitor's cache alone. */
            hash.update(file).update(await readFile(path));
          } else if (MEDIA.test(file)) {
            const { size } = await stat(path);
            if (size > MEDIA_MAX_BYTES) continue;
            media.push(urlFor(file));
            mediaBytes += size;
          }
        }

        const version = hash.digest('hex').slice(0, 12);
        const template = await readFile(fileURLToPath(TEMPLATE), 'utf8');
        const worker = template
          .replace('__VERSION__', version)
          .replace('__SHELL__', JSON.stringify(shell, null, 2))
          .replace('__MEDIA__', JSON.stringify(media, null, 2));
        await writeFile(join(outDir, 'sw.js'), worker);

        const mb = (mediaBytes / 1e6).toFixed(1);
        logger.info(`sw.js ${version}: ${shell.length} shell files, ${media.length} images (${mb} MB) in the background`);
      },
    },
  };
}
