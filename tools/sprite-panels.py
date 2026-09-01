#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Split and clean a generated three-frame action strip.

Unlike sprite-cutout.py this keeps disconnected parts of the same player
(for example a separated boot) in one panel instead of treating them as
separate figures.

    python tools/sprite-panels.py <strip.png> <action-direction>
"""

import os
import sys
from collections import deque

from PIL import Image

if len(sys.argv) != 3:
    sys.exit(__doc__)

src, base = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root, 'tools', 'sprite-src')


def nearwhite(p):
    return p[3] < 8 or (p[0] > 234 and p[1] > 234 and p[2] > 234)


def clean(panel):
    panel = panel.convert('RGBA')
    width, height = panel.size
    px = panel.load()
    bg = bytearray(width * height)
    queue = deque()

    def add(x, y):
        i = y * width + x
        if not bg[i] and nearwhite(px[x, y]):
            bg[i] = 1
            queue.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height:
                add(nx, ny)

    out = Image.new('RGBA', panel.size, (0, 0, 0, 0))
    op = out.load()
    for y in range(height):
        for x in range(width):
            if not bg[y * width + x]:
                op[x, y] = px[x, y]

    # ImageGen may place the next panel a few pixels inside this panel's
    # boundary.  Keep the main connected player and any interior pieces, but
    # discard a separate component touching a panel edge (usually a clipped
    # head/boot from the neighbouring frame).  A real player clipped by the
    # crop is the largest component and is retained.
    alpha = out.getchannel('A')
    foreground = alpha.load()
    seen = bytearray(width * height)
    components = []
    for y in range(height):
        for x in range(width):
            pos = y * width + x
            if seen[pos] or foreground[x, y] <= 8:
                continue
            seen[pos] = 1
            queue = deque([(x, y)])
            pixels = []
            touches_edge = False
            while queue:
                cx, cy = queue.popleft()
                pixels.append((cx, cy))
                if cx == 0 or cy == 0 or cx == width - 1 or cy == height - 1:
                    touches_edge = True
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        if not dx and not dy:
                            continue
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < width and 0 <= ny < height:
                            npos = ny * width + nx
                            if not seen[npos] and foreground[nx, ny] > 8:
                                seen[npos] = 1
                                queue.append((nx, ny))
            components.append((len(pixels), touches_edge, pixels))

    if components:
        largest = max(range(len(components)),
                      key=lambda i: components[i][0])
        for i, (_size, touches_edge, pixels) in enumerate(components):
            if i == largest or (not touches_edge and
                                _size >= max(8, components[largest][0] * 0.015)):
                continue
            for x, y in pixels:
                op[x, y] = (0, 0, 0, 0)

    box = out.getbbox()
    if not box:
        raise SystemExit('%s: no visible player found' % base)
    return out.crop(box)


im = Image.open(src).convert('RGBA')
vertical = im.height > im.width
if (im.height if vertical else im.width) < 3:
    sys.exit('strip is too narrow to split into three panels')
os.makedirs(out_dir, exist_ok=True)

for frame in range(3):
    if vertical:
        top = im.height * frame // 3
        bottom = im.height * (frame + 1) // 3
        panel = im.crop((0, top, im.width, bottom))
    else:
        left = im.width * frame // 3
        right = im.width * (frame + 1) // 3
        panel = im.crop((left, 0, right, im.height))
    out = clean(panel)
    dst = os.path.join(out_dir, '%s-%d.png' % (base, frame))
    out.save(dst)
    print('%s -> %s' % (out.size, dst))
