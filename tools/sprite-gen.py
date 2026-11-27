#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""3D 관절 프로시저럴 선수 2D 아틀라스 생성기 — games/soccer/assets/players.png

tools/sprite_rig.py 로 8방향 idle(1f)·walk(4f)·run(6f)·액션 10종(3f)을
일관된 3D 관절 모델에서 생성해 24열 2D 아틀라스로 패킹한다.

    python tools/sprite-gen.py
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

from sprite_rig import CELL, FOOT_Y, STAND_H, render_pose  # noqa: E402

ATLAS_COLS = 24
ROWS = 2  # 상단 절반 = 유니폼 회색조(틴트), 하단 절반 = 피부·머리·바지·양말·축구화·외곽선

SHEET = [
    ('idle', 1), ('walk', 2), ('run', 2), ('kick', 1), ('shoot', 1),
    ('charge', 1), ('tackle', 1), ('block', 1), ('header', 1),
    ('deflect', 1), ('gk-dive', 1), ('gk-claim', 1), ('gk-punt', 1)
]

# atan2 순서(E, SE, S, SW, W, NW, N, NE)와 각도(도)
DIRECTIONS = [
    ('e', 0.0), ('se', 45.0), ('s', 90.0), ('sw', 135.0),
    ('w', 180.0), ('nw', 225.0), ('n', 270.0), ('ne', 315.0)
]
RUN_FRAMES = 6
WALK_FRAMES = 4
IDLE_FRAMES = 1
ACTION_FRAMES = 3
ACTION_NAMES = [
    'kick', 'shoot', 'charge', 'tackle', 'block',
    'header', 'deflect', 'gk-dive', 'gk-claim', 'gk-punt'
]


def _paste_cell(sheet, idx, pair, grid_rows):
    gx = (idx % ATLAS_COLS) * CELL
    gy = (idx // ATLAS_COLS) * CELL
    layer_h = grid_rows * CELL
    sheet.paste(pair[0], (gx, gy))
    sheet.paste(pair[1], (gx, layer_h + gy))


def build():
    total = (sum(n for _, n in SHEET) +
             len(DIRECTIONS) * RUN_FRAMES +
             len(ACTION_NAMES) * len(DIRECTIONS) * ACTION_FRAMES +
             len(DIRECTIONS) * IDLE_FRAMES +
             len(DIRECTIONS) * WALK_FRAMES)
    grid_rows = int(math.ceil(total / float(ATLAS_COLS)))
    sheet = Image.new('RGBA', (ATLAS_COLS * CELL, grid_rows * CELL * ROWS), (0, 0, 0, 0))

    index, col = [], 0
    for name, n in SHEET:
        index.append((name, col, n))
        for f in range(n):
            _paste_cell(sheet, col + f, render_pose(name, f, n, 0.0), grid_rows)
        col += n

    # 8방향 6프레임 스프린트(DIRECTION_POSES)
    direction_index = []
    for dname, yaw in DIRECTIONS:
        direction_index.append((dname, col, RUN_FRAMES))
        for f in range(RUN_FRAMES):
            _paste_cell(sheet, col + f, render_pose('run', f, RUN_FRAMES, yaw), grid_rows)
        col += RUN_FRAMES

    # 10종 액션 × 8방향 × 3프레임
    action_direction_index = []
    for action in ACTION_NAMES:
        action_slots = []
        for dname, yaw in DIRECTIONS:
            action_slots.append((dname, col, ACTION_FRAMES))
            for f in range(ACTION_FRAMES):
                _paste_cell(sheet, col + f, render_pose(action, f, ACTION_FRAMES, yaw), grid_rows)
            col += ACTION_FRAMES
        action_direction_index.append((action, action_slots))

    # 8방향 대기(idle, 1프레임) & 걷기/조깅(walk, 4프레임)
    idle_index = []
    for dname, yaw in DIRECTIONS:
        idle_index.append((dname, col, IDLE_FRAMES))
        _paste_cell(sheet, col, render_pose('idle', 0, 1, yaw), grid_rows)
        col += IDLE_FRAMES

    walk_index = []
    for dname, yaw in DIRECTIONS:
        walk_index.append((dname, col, WALK_FRAMES))
        for f in range(WALK_FRAMES):
            _paste_cell(sheet, col + f, render_pose('walk', f, WALK_FRAMES, yaw), grid_rows)
        col += WALK_FRAMES

    return sheet, grid_rows, index, direction_index, action_direction_index, idle_index, walk_index


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


def stamp_js(root, png_path, grid_rows, index, direction_index,
             action_direction_index, idle_index, walk_index):
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
        (r"const IDLE_DIRECTION_POSES = \{[^}]*\};",
         'const IDLE_DIRECTION_POSES = {' + directions_literal(idle_index) + '};'),
        (r"const WALK_DIRECTION_POSES = \{[^}]*\};",
         'const WALK_DIRECTION_POSES = {' + directions_literal(walk_index) + '};'),
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
    sheet, grid_rows, idx, dir_idx, act_idx, idle_idx, walk_idx = build()
    path = os.path.join(out, 'players.png')
    sheet.save(path, optimize=True)
    kb = os.path.getsize(path) / 1024.0
    print('%s  %d x %d  (%dcols x %drows, %.1f KB)'
          % (os.path.relpath(path, root), sheet.width, sheet.height, ATLAS_COLS, grid_rows, kb))
    stamped = stamp_js(root, path, grid_rows, idx, dir_idx, act_idx, idle_idx, walk_idx)
    if stamped:
        print('SPRITE_V = %s   SPRITE_BODY = %s' % stamped)
        print('이어서 `node tools/soccer-sim.js --restamp`')


if __name__ == '__main__':
    main()
