#!/usr/bin/env python3
"""Render the 16x16 favicon monogram into the PNG sizes a PWA needs.

The site's art is pixel art, so scaling is a plain integer blow-up: no
image library, no smoothing, no dependency to install. Re-run after
changing public/favicon.svg:

    python3 scripts/make-icons.py
"""

import struct
import zlib
from pathlib import Path

# The two rect lists from public/favicon.svg, as (x, y, width) at 16x16.
BADGE = [
    (6, 0, 4), (4, 1, 8), (3, 2, 10), (2, 3, 12), (2, 4, 12), (1, 5, 14),
    (1, 6, 14), (1, 7, 14), (1, 8, 14), (1, 9, 14), (1, 10, 14), (2, 11, 12),
    (2, 12, 12), (3, 13, 10), (4, 14, 8), (6, 15, 4),
]
LETTER = [
    (6, 4, 4), (5, 5, 1), (10, 5, 1), (5, 6, 1), (10, 6, 1), (5, 7, 1),
    (10, 7, 1), (5, 8, 1), (10, 8, 1), (5, 9, 1), (10, 9, 1), (5, 10, 1),
    (10, 10, 1), (6, 11, 4),
]

INK = (0, 0, 0)
PAPER = (255, 255, 255)


def grid():
    """The 16x16 art as a colour per cell, or None where it is background."""
    cells = [[None] * 16 for _ in range(16)]
    for colour, rects in ((INK, BADGE), (PAPER, LETTER)):
        for x, y, w in rects:
            for i in range(w):
                cells[y][x + i] = colour
    return cells


def write_png(path: Path, size: int, fill: float) -> None:
    """Blow the art up to `size`, covering `fill` of it, centred on paper."""
    cells = grid()
    cell = max(1, int(size * fill) // 16)
    art = cell * 16
    offset = (size - art) // 2

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter: none
        for x in range(size):
            gx, gy = (x - offset) // cell, (y - offset) // cell
            colour = PAPER
            if 0 <= gx < 16 and 0 <= gy < 16 and offset <= x < offset + art and offset <= y < offset + art:
                colour = cells[gy][gx] or PAPER
            rows += bytes(colour)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF))

    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
           + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))
    path.write_bytes(png)
    print(f'{path} ({size}x{size})')


def main() -> None:
    out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
    out.mkdir(parents=True, exist_ok=True)
    write_png(out / 'icon-192.png', 192, 1.0)
    write_png(out / 'icon-512.png', 512, 1.0)
    # Maskable icons get cropped to a circle by the launcher, so the art
    # has to sit well inside the safe zone.
    write_png(out / 'icon-maskable-512.png', 512, 0.68)
    write_png(out / 'apple-touch-icon.png', 180, 0.86)


if __name__ == '__main__':
    main()
