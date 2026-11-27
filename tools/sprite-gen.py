#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""선수 2D 스프라이트 아틀라스 생성기 — games/soccer/assets/players.png

tools/sprite-src/ 의 고해상도 일러스트 271장을 GPU 친화적인 2D 멀티행
아틀라스(24열 × 12행 × 2레이어, 96×96 셀 → 2304×2304)로 패킹한다.

    python tools/sprite-gen.py

시트를 다시 만들면 09-sprites.js 의 SPRITE_V·SPRITE_CELL·SPRITE_COLS·
SPRITE_ROWS·POSES 를 함께 갱신한다. 이어서 반드시 실행한다:

    node tools/soccer-sim.js --restamp
"""

import hashlib
import io
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow 가 필요합니다:  pip install Pillow')

from sprite_import import CELL, FOOT_Y, IMPORTED, STAND_H, load_imported  # noqa: E402

ATLAS_COLS = 24
ROWS = 2  # 상단 절반 = 유니폼 회색조(틴트), 하단 절반 = 피부·머리·바지·축구화·윤곽

SHEET = [
    ('idle', 1), ('walk', 2), ('run', 2), ('kick', 1), ('shoot', 1),
    ('charge', 1), ('tackle', 1), ('block', 1), ('header', 1),
    ('deflect', 1), ('gk-dive', 1), ('gk-claim', 1), ('gk-punt', 1)
]

# atan2 순서(E, SE, S, SW, W, NW, N, NE) 8방향 이동 프레임
DIRECTIONS = [
    ('e', ['dir-e.png', 'dir-e2.png']),
    ('se', ['dir-se.png', 'dir-se2.png']),
    ('s', ['dir-s.png', 'dir-s2.png']),
    ('sw', ['dir-sw.png', 'dir-sw2.png']),
    ('w', ['dir-w.png', 'dir-w2.png']),
    ('nw', ['dir-nw.png', 'dir-nw2.png']),
    ('n', ['dir-n.png', 'dir-n2.png']),
    ('ne', ['dir-ne.png', 'dir-ne2.png'])
]

ACTION_NAMES = [
    'kick', 'shoot', 'charge', 'tackle', 'block',
    'header', 'deflect', 'gk-dive', 'gk-claim', 'gk-punt'
]
ACTION_DIRECTIONS = [
    (action, [(direction, [
        '%s-%s-%d.png' % (action, direction, frame) for frame in range(3)
    ]) for direction, _files in DIRECTIONS])
    for action in ACTION_NAMES
]


def _paste_cell(sheet, idx, pair, grid_rows):
    gx = (idx % ATLAS_COLS) * CELL
    gy = (idx // ATLAS_COLS) * CELL
    layer_h = grid_rows * CELL
    sheet.paste(pair[0], (gx, gy))
    sheet.paste(pair[1], (gx, layer_h + gy))


def build():
    total = (sum(n for _, n in SHEET) +
             sum(len(files) for _, files in DIRECTIONS) +
             sum(len(files) for _, directions in ACTION_DIRECTIONS
                 for _, files in directions))
    grid_rows = int(math.ceil(total / float(ATLAS_COLS)))
    sheet = Image.new('RGBA', (ATLAS_COLS * CELL, grid_rows * CELL * ROWS), (0, 0, 0, 0))

    index, col = [], 0
    for name, n in SHEET:
        if name not in IMPORTED:
            sys.exit('IMPORTED 에 없는 포즈: ' + name)
        got = load_imported(*IMPORTED[name])
        if len(got) != n:
            sys.exit('%s: 원본 %d장인데 SHEET 는 %d장' % (name, len(got), n))
        index.append((name, col, n))
        for f in range(n):
            _paste_cell(sheet, col + f, got[f], grid_rows)
        col += n

    direction_index = []
    for name, files in DIRECTIONS:
        got = load_imported(files, False)
        if len(got) != len(files):
            sys.exit('%s: direction source count mismatch' % name)
        direction_index.append((name, col, len(files)))
        for f in range(len(files)):
            _paste_cell(sheet, col + f, got[f], grid_rows)
        col += len(files)

    action_direction_index = []
    for action, directions in ACTION_DIRECTIONS:
        action_slots = []
        for direction, files in directions:
            got = load_imported(files, False)
            if len(got) != len(files):
                sys.exit('%s-%s: action source count mismatch' % (action, direction))
            action_slots.append((direction, col, len(files)))
            for f in range(len(files)):
                _paste_cell(sheet, col + f, got[f], grid_rows)
            col += len(files)
        action_direction_index.append((action, action_slots))

    return sheet, grid_rows, index, direction_index, action_direction_index


def poses_literal(index):
    parts = []
    for name, col, n in index:
        key = name if name.isalnum() else "'%s'" % name
        parts.append('%s:[%d, %d]' % (key, col, n))
    lines, cur = [], '  '
    for part in parts:
        piece = part + ','
        if len(cur) + len(piece) > 74:
            lines.append(cur.rstrip())
            cur = '  '
        cur += piece + ' '
    lines.append(cur.rstrip().rstrip(','))
    return '\n'.join(lines)


def directions_literal(index):
    return ', '.join('%s:[%d, %d]' % (name, col, n) for name, col, n in index)


def action_directions_literal(index):
    lines = []
    for action, directions in index:
        key = action if action.isalnum() else "'%s'" % action
        slots = ', '.join('%s:[%d, %d]' % (direction, col, n)
                          for direction, col, n in directions)
        lines.append('  %s:{%s}' % (key, slots))
    return ',\n'.join(lines)


def stamp_js(root, png_path, grid_rows, index, direction_index, action_direction_index):
    js = os.path.join(root, 'games', 'soccer', 'js', '09-sprites.js')
    if not os.path.exists(js):
        return None
    with open(png_path, 'rb') as f:
        v = hashlib.sha256(f.read()).hexdigest()[:8]
    body = round(STAND_H * 0.34, 4)

    with io.open(js, encoding='utf-8') as f:
        src = f.read()
    subs = [
        (r"(const SPRITE_V = ')[0-9a-f]+(')", lambda m: m.group(1) + v + m.group(2)),
        (r"(const SPRITE_CELL = )\d+(;)", lambda m: m.group(1) + str(CELL) + m.group(2)),
        (r"(const SPRITE_COLS = )\d+(;)", lambda m: m.group(1) + str(ATLAS_COLS) + m.group(2)),
        (r"(const SPRITE_ROWS = )\d+(;)", lambda m: m.group(1) + str(grid_rows) + m.group(2)),
        (r"(const SPRITE_FOOT_Y = )[0-9.]+(;)", lambda m: m.group(1) + repr(FOOT_Y) + m.group(2)),
        (r"(const SPRITE_BODY = )[0-9.]+(;)", lambda m: m.group(1) + repr(body) + m.group(2)),
        (r"const POSES = \{[^}]*\};", 'const POSES = {\n' + poses_literal(index) + '\n};'),
        (r"const DIRECTION_POSES = \{[^}]*\};",
         'const DIRECTION_POSES = {' + directions_literal(direction_index) + '};'),
        (r"const ACTION_DIRECTION_POSES = \{[\s\S]*?\};",
         'const ACTION_DIRECTION_POSES = {\n' + action_directions_literal(action_direction_index) + '\n};'),
    ]
    out = src
    for pat, repl in subs:
        out, n = re.subn(pat, repl, out)
        if n != 1:
            sys.exit('09-sprites.js 치환 실패: %s (%d회)' % (pat, n))
    if out != src:
        with io.open(js, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
    return v, body


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'games', 'soccer', 'assets')
    os.makedirs(out, exist_ok=True)
    sheet, grid_rows, index, direction_index, action_direction_index = build()
    path = os.path.join(out, 'players.png')
    sheet.save(path, optimize=True)
    kb = os.path.getsize(path) / 1024.0
    print('%s  %d x %d  (%dcols x %drows, %.1f KB)'
          % (os.path.relpath(path, root), sheet.width, sheet.height, ATLAS_COLS, grid_rows, kb))
    stamped = stamp_js(root, path, grid_rows, index, direction_index, action_direction_index)
    if stamped:
        print('SPRITE_V = %s   SPRITE_BODY = %s' % stamped)
        print('이어서 `node tools/soccer-sim.js --restamp`')


if __name__ == '__main__':
    main()
