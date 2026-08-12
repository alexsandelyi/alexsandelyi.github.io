#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""손으로 그린 일러스트를 스프라이트 셀로 옮긴다.

sprite-gen.py 가 500줄을 넘어서 분리했다. 규격은
games/soccer/sprite-pipeline.md 「이동 포즈는 손 일러스트다」.

원본은 tools/sprite-src/ 에 있다 — 내려받기 폴더 같은 저장소 밖 경로에
두면 재생성이 안 된다. 배경 제거는 tools/sprite-cutout.py 가 먼저 한다.
"""

import os
import sys

from PIL import Image


SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sprite-src')

# 셀 한 변(px). sprite-gen.py 와 같아야 한다.
CELL = 64

# 손으로 그린 일러스트를 쓰는 포즈. (원본 파일들, 좌우 반전을 더할지).
#
# 원본은 **위를 향해** 그려져 있고 여기서 +x 를 향하게 돌린다.
# 좌우 반전을 켜면 파일마다 두 프레임이 나온다 — 걷기·달리기는 두 다리가
# 번갈아 나가는 대칭 동작이라 반전 한 장이 반 주기를 그대로 대신한다.
#
# 프레임 수 = 파일 수 × (반전이면 2, 아니면 1). SHEET 와 어긋나면 build()
# 가 실패시킨다.
IMPORTED = {
    'idle': (['stand0.png'], False),
    'walk': (['stand0.png', 'stand1.png'], True),
    'run': (['run.png'], True),
}

# 일러스트의 크기 기준은 **어깨 폭**이다 (전체 길이가 아니다). 길이로
# 맞추면 달릴 때 뒤로 뻗은 다리 때문에 선수가 작아지고, 서 있을 때 커진다.
# 벡터 포즈의 몸통 폭(2 × torso_ry × ART)과 같은 값으로 둔다.
KIT_W = 20.0

_imported_cache = {}


def _kit(px):
    """유니폼(파랑) 픽셀인가. 살색·검정·흰 줄무늬는 제외된다."""
    r, g, b, a = px
    return a > 40 and b - max(r, g) > 30 and b > 55


def _split_layers(src):
    """유니폼 층(회색조)과 나머지 층으로 나누고, 어깨 폭을 잰다.

    유니폼을 **회색조로 남기는** 이유는 런타임에서 multiply 로 팀 색을
    곱하기 위해서다. 단색을 부으면 접힘과 그림자가 사라져 평면이 된다.
    """
    px = src.load()
    lum, widest = [], 0
    for y in range(src.height):
        xs = []
        for x in range(src.width):
            q = px[x, y]
            if _kit(q):
                lum.append(0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2])
                xs.append(x)
        if xs:
            widest = max(widest, xs[-1] - xs[0] + 1)
    if not lum:
        sys.exit('유니폼 색을 찾지 못했습니다')
    lo, hi = min(lum), max(lum)

    shirt = Image.new('RGBA', src.size, (0, 0, 0, 0))
    detail = Image.new('RGBA', src.size, (0, 0, 0, 0))
    sp, dp = shirt.load(), detail.load()
    for y in range(src.height):
        for x in range(src.width):
            q = px[x, y]
            if q[3] == 0:
                continue
            if _kit(q):
                L = 0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2]
                t = (L - lo) / max(1e-6, hi - lo)
                v = int(round(255 * (0.55 + 0.45 * t)))   # 너무 어두워지지 않게
                sp[x, y] = (v, v, v, q[3])
            else:
                dp[x, y] = q
    return shirt, detail, widest


def _fit(shirt, detail, kit_w, flip):
    """층 한 쌍을 어깨 폭 기준으로 셀에 앉힌다."""
    k = KIT_W / kit_w
    pair = []
    for layer in (shirt, detail):
        img = layer.transpose(Image.FLIP_LEFT_RIGHT) if flip else layer
        img = img.transpose(Image.ROTATE_270)          # 위 → +x
        img = img.resize((max(1, int(round(img.width * k))),
                          max(1, int(round(img.height * k)))), Image.LANCZOS)
        cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        cell.paste(img, ((CELL - img.width) // 2, (CELL - img.height) // 2))
        pair.append(cell)
    return pair


def load_imported(files, mirror):
    """일러스트들을 셀 크기의 (유니폼, 나머지) 쌍 목록으로 돌려준다."""
    key = (tuple(files), mirror)
    if key in _imported_cache:
        return _imported_cache[key]
    frames = []
    for fname in files:
        src = Image.open(os.path.join(SRC_DIR, fname)).convert('RGBA')
        shirt, detail, kit_w = _split_layers(src)
        for flip in ((False, True) if mirror else (False,)):
            frames.append(_fit(shirt, detail, kit_w, flip))
    _imported_cache[key] = frames
    return frames


