import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Renders the home-screen icons an installed app needs.

   The site's mark is 16x16 pixel art (public/favicon.svg), so making a
   512px icon of it is an integer blow-up: no image library, no smoothing,
   nothing to install, and no PNGs in the repository that can drift from
   the favicon. The two rect lists below are that file's, at 16x16.

   The icons only exist in a build, which is the only place they are asked
   for: `astro dev` never installs anything. */

const BADGE = [
  [6, 0, 4], [4, 1, 8], [3, 2, 10], [2, 3, 12], [2, 4, 12], [1, 5, 14],
  [1, 6, 14], [1, 7, 14], [1, 8, 14], [1, 9, 14], [1, 10, 14], [2, 11, 12],
  [2, 12, 12], [3, 13, 10], [4, 14, 8], [6, 15, 4],
];
const LETTER = [
  [6, 4, 4], [5, 5, 1], [10, 5, 1], [5, 6, 1], [10, 6, 1], [5, 7, 1],
  [10, 7, 1], [5, 8, 1], [10, 8, 1], [5, 9, 1], [10, 9, 1], [5, 10, 1],
  [10, 10, 1], [6, 11, 4],
];

const INK = [0, 0, 0];
const PAPER = [255, 255, 255];

/* Each icon: file, pixel size, and how much of it the mark covers. A
   maskable icon is cropped to a circle by the launcher, so its art has to
   sit well inside the safe zone. */
const ICONS = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.68],
  ['apple-touch-icon.png', 180, 0.86],
];

/* The 16x16 art as a colour per cell, or null for background. */
function grid() {
  const cells = Array.from({ length: 16 }, () => new Array(16).fill(null));
  for (const [colour, rects] of [[INK, BADGE], [PAPER, LETTER]]) {
    for (const [x, y, width] of rects) {
      for (let i = 0; i < width; i++) cells[y][x + i] = colour;
    }
  }
  return cells;
}

function chunk(kind, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function render(size, fill) {
  const cells = grid();
  const cell = Math.max(1, Math.floor((size * fill) / 16));
  const art = cell * 16;
  const offset = Math.floor((size - art) / 2);

  /* One filter byte ("none") then RGB triples, row by row. */
  const rows = Buffer.alloc(size * (1 + size * 3));
  let at = 0;
  for (let y = 0; y < size; y++) {
    rows[at++] = 0;
    for (let x = 0; x < size; x++) {
      const inside = x >= offset && x < offset + art && y >= offset && y < offset + art;
      const colour = inside ? cells[Math.floor((y - offset) / cell)][Math.floor((x - offset) / cell)] ?? PAPER : PAPER;
      rows[at++] = colour[0];
      rows[at++] = colour[1];
      rows[at++] = colour[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // bit depth
  header[9] = 2;  // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default function appIcons() {
  return {
    name: 'odl-app-icons',
    hooks: {
      /* Before the service worker integration, which sweeps dist/ into
         its precache list and should find these. */
      'astro:build:done': async ({ dir, logger }) => {
        const out = join(fileURLToPath(dir), 'icons');
        await mkdir(out, { recursive: true });
        for (const [name, size, fill] of ICONS) {
          await writeFile(join(out, name), render(size, fill));
        }
        logger.info(`${ICONS.length} app icons`);
      },
    },
  };
}
