#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""일러스트 배경 제거 — 새 원본 그림을 받았을 때 한 번만 돌린다.

    python tools/sprite-cutout.py <원본.png> <이름>

결과는 tools/sprite-src/<이름>.png 다. **이후로는 그게 원본이고**
sprite-gen.py 가 그걸 읽어 유니폼 층과 나머지 층으로 나눈다. 원본이
저장소 밖(내려받기 폴더 등)에 있으면 재생성이 안 되므로 여기 들여놓는다.

배경은 **테두리에서 흰색을 타고 들어가는 flood fill** 로 지운다.
단순히 밝은 픽셀을 다 지우면 흰 축구화에 구멍이 난다.
"""

import os
import sys
from collections import deque

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow 가 필요합니다:  pip install Pillow')

if len(sys.argv) != 3:
    sys.exit(__doc__)
SRC, NAME = sys.argv[1], sys.argv[2]

im = Image.open(SRC).convert('RGBA')
W, H = im.size
px = im.load()


def nearwhite(p):
    return p[3] < 8 or (p[0] > 234 and p[1] > 234 and p[2] > 234)


bg = bytearray(W * H)
q = deque()
for x in range(W):
    for y in (0, H - 1):
        if nearwhite(px[x, y]) and not bg[y * W + x]:
            bg[y * W + x] = 1
            q.append((x, y))
for y in range(H):
    for x in (0, W - 1):
        if nearwhite(px[x, y]) and not bg[y * W + x]:
            bg[y * W + x] = 1
            q.append((x, y))
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if (0 <= nx < W and 0 <= ny < H and not bg[ny * W + nx]
                and nearwhite(px[nx, ny])):
            bg[ny * W + nx] = 1
            q.append((nx, ny))

out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
op = out.load()
for y in range(H):
    for x in range(W):
        if not bg[y * W + x]:
            op[x, y] = px[x, y]
out = out.crop(out.getbbox())


def split_figures(img, gap=12):
    """한 장에 인물이 여럿이면 세로 빈 칸으로 나눈다.

    받은 그림이 한 장에 두 자세를 나란히 그려 오는 경우가 있다. 통째로
    쓰면 두 명이 한 스프라이트가 되므로 반드시 나눠야 한다.
    """
    p = img.load()
    used = [any(p[x, y][3] > 8 for y in range(img.height))
            for x in range(img.width)]
    spans, start, blank = [], None, 0
    for x in range(img.width):
        if used[x]:
            if start is None:
                start = x
            blank = 0
        elif start is not None:
            blank += 1
            if blank >= gap:
                spans.append((start, x - blank))
                start, blank = None, 0
    if start is not None:
        spans.append((start, img.width - 1))
    return [img.crop((a, 0, b + 1, img.height)).crop(
        img.crop((a, 0, b + 1, img.height)).getbbox()) for a, b in spans]


dst_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sprite-src')
os.makedirs(dst_dir, exist_ok=True)
figs = split_figures(out)
for i, fig in enumerate(figs):
    name = NAME if len(figs) == 1 else '%s%d' % (NAME, i)
    dst = os.path.join(dst_dir, name + '.png')
    fig.save(dst)
    print('%s → %s' % (fig.size, dst))
    # 내부의 밝은 부분(축구화)이 살아남았는지. 0 이면 함께 지워진 것이다.
    lp = fig.load()
    light = sum(1 for y in range(0, fig.height, 2)
                for x in range(0, fig.width, 2)
                if lp[x, y][3] > 128 and min(lp[x, y][:3]) > 190)
    if light == 0:
        print('  경고: 밝은 부분(축구화)이 남지 않았습니다.')
print('인물 %d명' % len(figs))
