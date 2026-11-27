#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""손으로 그린 일러스트를 2D 스프라이트 아틀라스 셀로 변환한다.

원본은 tools/sprite-src/ 에 있다 — 저장소 밖 경로에 두지 않는다.
"""

import os
import sys

from PIL import Image

SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sprite-src')

CELL = 96            # 셀 한 변(px) — 24×12 2D 아틀라스 (2304×2304, GPU 안전)
FOOT_Y = 0.92        # 서 있는 포즈 발바닥 앵커 위치 (셀 높이 비율)
DIVE_Y = 0.82        # 공중 다이빙 포즈 하단 앵커 위치
STAND_H = 0.80       # 서 있는 포즈 통일 키 (셀 높이 비율)
PRONE_SPAN = 0.90    # 태클·다이빙처럼 가로로 누운 포즈 최대 폭

IMPORTED = {
    'idle': (['stand0.png'], False),
    'walk': (['stand0.png', 'stand1.png'], False),
    'run': (['run.png', 'run1.png'], False),
    'kick': (['kick.png'], False),
    'shoot': (['shoot.png'], False),
    'charge': (['charge.png'], False),
    'tackle': (['tackle.png'], False),
    'block': (['block.png'], False),
    'header': (['header.png'], False),
    'deflect': (['deflect.png'], False),
    'gk-dive': (['gk-dive.png'], False),
    'gk-claim': (['gk-claim.png'], False),
    'gk-punt': (['gk-punt.png'], False),
}

_imported_cache = {}


def _kit_weight(r, g, b, a):
    """부드러운 파랑 유니폼 가중치(0..1). 안티앨리어싱 경계 잔여물을 줄인다."""
    if a <= 16:
        return 0.0
    excess = b - max(r, g)
    if excess <= 20 or b <= 62:
        return 0.0
    w1 = min(1.0, (excess - 20.0) / 34.0)
    w2 = min(1.0, (b - 62.0) / 36.0)
    return w1 * w2


def _split_layers(src):
    """유니폼 회색조 층(고정 명도 곡선)과 디테일 층으로 분리하고 몸통 중심 X를 구한다."""
    w, h = src.size
    px = src.load()
    shirt = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    detail = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sp, dp = shirt.load(), detail.load()
    kit_x_sum, kit_w_sum = 0.0, 0.0

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            kw = _kit_weight(r, g, b, a)
            if kw > 0.0:
                # 전 프레임 공통 명도 곡선: 프레임 간 밝기 깜빡임을 제거하고
                # 팀 색 곱셈 시 선명하고 풍성한 음영을 유지한다.
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                t = max(0.0, min(1.0, (lum - 24.0) / 84.0))
                v = int(round(156.0 + 99.0 * t))
                sa = int(round(a * kw))
                if sa > 0:
                    sp[x, y] = (v, v, v, sa)
                    kit_x_sum += x * kw
                    kit_w_sum += kw
            da = int(round(a * (1.0 - kw)))
            if da > 0:
                # 경계 픽셀의 파란 번짐을 중화해 주황·노랑 팀 색에서 푸른 테두리를 없앤다.
                if 0.02 < kw < 0.98 and b > max(r, g):
                    nb = int(round(max(r, g) + (b - max(r, g)) * 0.15))
                    dp[x, y] = (r, g, nb, da)
                else:
                    dp[x, y] = (r, g, b, da)

    cx = (kit_x_sum / kit_w_sum) if kit_w_sum > 1e-3 else (w * 0.5)
    return shirt, detail, cx


def _is_prone(fname):
    return fname.startswith('tackle') or fname.startswith('gk-dive')


def _place_cell(src, flip, fname):
    """원본을 여백 절단 → 2x 슈퍼샘플링 분리 → 발바닥 앵커 기준 셀 배치한다."""
    bbox = src.getbbox()
    if not bbox:
        sys.exit('빈 스프라이트 원본: ' + fname)
    cropped = src.crop(bbox)
    if flip:
        cropped = cropped.transpose(Image.FLIP_LEFT_RIGHT)
    bw, bh = cropped.size

    margin = 2
    max_w = CELL - margin * 2
    max_h = int(round(CELL * (DIVE_Y if fname.startswith('gk-dive') else FOOT_Y))) - margin
    if _is_prone(fname):
        target = CELL * PRONE_SPAN
        k = min(target / max(bw, bh), max_w / bw, max_h / bh)
    else:
        k = min((CELL * STAND_H) / bh, max_w / bw, max_h / bh)

    tw = max(1, int(round(bw * k)))
    th = max(1, int(round(bh * k)))
    # 2배 슈퍼샘플링 해상도에서 층을 나눈 뒤 축소해 안티앨리어싱을 깔끔하게 유지
    hi = cropped.resize((tw * 2, th * 2), Image.LANCZOS)
    shirt_hi, detail_hi, cx_hi = _split_layers(hi)
    shirt = shirt_hi.resize((tw, th), Image.LANCZOS)
    detail = detail_hi.resize((tw, th), Image.LANCZOS)

    anchor_y = int(round(CELL * (DIVE_Y if fname.startswith('gk-dive') else FOOT_Y)))
    # 몸통 중심을 셀 X 중앙에 맞추되 좌우 경계를 넘지 않게 클램프
    cx = cx_hi * 0.5
    px = int(round(CELL * 0.5 - cx))
    px = max(margin, min(CELL - margin - tw, px))
    py = max(margin, anchor_y - th)

    cells = []
    for layer in (shirt, detail):
        cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        cell.paste(layer, (px, py))
        cells.append(cell)
    return cells


def load_imported(files, mirror):
    """일러스트들을 CELL×CELL (유니폼, 디테일) 쌍 목록으로 돌려준다."""
    key = (tuple(files), mirror)
    if key in _imported_cache:
        return _imported_cache[key]
    frames = []
    for fname in files:
        src = Image.open(os.path.join(SRC_DIR, fname)).convert('RGBA')
        for flip in ((False, True) if mirror else (False,)):
            frames.append(_place_cell(src, flip, fname))
    _imported_cache[key] = frames
    return frames
