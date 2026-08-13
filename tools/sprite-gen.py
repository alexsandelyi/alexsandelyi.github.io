#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""선수 스프라이트 시트 생성기 — games/soccer/assets/players.png

포즈를 손으로 찍지 않고 사지 각도에서 그린다. 포즈 하나를 고치려고
시트 전체를 다시 그릴 수는 없기 때문이다. 실패한 제작 방법은
games/soccer/CLAUDE.md 「스프라이트 — 실패한 방법」에 있다.

    python tools/sprite-gen.py

Pillow 만 쓴다. tools/ 는 개발 도구라 사이트 의존성은 늘지 않는다.

시트를 다시 만들면 09-sprites.js 의 SPRITE_V 도 함께 고친다. 그래야
js/ 해시가 바뀌어 index.html 의 ?v= 갱신(--restamp)까지 이어진다.
안 그러면 브라우저가 옛 시트를 계속 쓴다.
"""

import hashlib
import io
import math
import os
import re
import sys

# 같은 폴더의 sprite_import 를 부르려면 경로가 필요하다 (패키지가 아니다).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('Pillow 가 필요합니다:  pip install Pillow')

CELL = 64          # 셀 한 변(px)
SS = 4             # 슈퍼샘플링 배율. 4배로 그린 뒤 축소해 계단을 없앤다
ROWS = 2           # 0 = 상의(틴트 대상), 1 = 머리·다리·윤곽
# 그림이 셀을 얼마나 채우는지. 회전으로 방향을 내므로 내용은 셀에 내접한
# 원(반지름 32) 안에 들어야 한다. 제일 멀리 뻗는 것은 태클의 뻗은 발이
# 아니라 **뒤로 뻗은 다리**다 — 엉덩이 -11 에서 달릴 때 18.5 뻗고 축구화가
# 붙어 약 32 다. 몸을 길게 바꾸면서 1.05 로는 잘려 낮췄다.
# build() 가 매 셀을 check_fit() 으로 검사하므로 짐작하지 않아도 된다.
ART = 0.88

# 색은 손 일러스트(tools/sprite-src/)에서 실측해 맞췄다. 벡터 포즈가
# 일러스트와 섞여 있으므로 값이 다르면 포즈가 바뀔 때 눈에 띈다.
#
# 유니폼 줄(0줄)은 **회색조**다 — 런타임에서 multiply 로 팀 색을 곱한다.
# 255 면 팀 색 그대로, 낮출수록 어두워진다. 상의보다 양말·반바지를 조금
# 어둡게 둬 일러스트의 명암 느낌을 흉내 낸다.
# 값은 일러스트에 맞춰 낮췄다. 순백(255)으로 두면 팀 색이 그대로 나와
# 일러스트(음영 때문에 평균 171)보다 훨씬 밝고, 킥·태클로 바뀌는 순간
# 선수가 번쩍인다. 세 값을 0.72 배 해 평균을 맞췄다.
SHIRT = (183, 183, 183, 255)      # 상의
SHORTS = (166, 166, 166, 255)     # 반바지 — 상의보다 살짝 어둡게
SOCK = (148, 148, 148, 255)       # 양말 — **팀 색이다.** 일러스트도 파란 양말
SKIN = (248, 192, 136, 255)       # 팔·얼굴. 일러스트 실측값
HAIR = (24, 32, 32, 255)          # 뒤통수. 일러스트 실측값
BOOT = (22, 24, 28, 255)          # 윤곽선. 제일 어두운 값
SHOE = (236, 240, 244, 255)       # 축구화. 밝아야 발끝이 어디인지 보인다

# 선수는 항상 +x(오른쪽)를 보게 그린다. 방향은 런타임 회전으로 낸다.
# 좌표는 셀 중심 기준, 단위는 축소 전 픽셀(CELL*SS).


def deg(a):
    return a * math.pi / 180


class Pen:
    """셀 하나에 그리는 붓. 좌표를 중심 기준으로 받아 픽셀로 옮긴다."""

    def __init__(self, size):
        self.img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
        self.c = size / 2
        self.k = size / CELL * ART    # 논리 1 = k 픽셀

    def _p(self, x, y):
        return (self.c + x * self.k, self.c + y * self.k)

    def ellipse(self, x, y, rx, ry, fill, outline=None, ow=0):
        # 회전 없는 타원도 다각형으로 그린다 — 윤곽선 굵기를 논리 단위로
        # 주려면 Pillow 의 ellipse() 로는 부족하다.
        pts = []
        for i in range(48):
            t = i / 48 * math.tau
            pts.append(self._p(x + rx * math.cos(t), y + ry * math.sin(t)))
        self.d.polygon(pts, fill=fill, outline=outline,
                       width=max(1, int(ow * self.k)))

    def capsule(self, x, y, ang, length, w, fill):
        """관절 (x, y) 에서 ang 방향으로 뻗은 사지. 끝을 둥글게 맺는다."""
        ex = x + math.cos(deg(ang)) * length
        ey = y + math.sin(deg(ang)) * length
        self.d.line([self._p(x, y), self._p(ex, ey)],
                    fill=fill, width=int(w * self.k))
        r = w / 2
        self.ellipse(x, y, r, r, fill)
        self.ellipse(ex, ey, r, r, fill)
        return ex, ey


# ── 포즈 ────────────────────────────────────────────────────────────
# 각 포즈는 프레임 번호를 받아 사지 파라미터를 돌려준다.
#   lean       : 상체가 앞으로 쏠린 정도
#   arms/legs  : [(각도, 길이), (각도, 길이)] — 위쪽(-y) 먼저
# 각도는 +x 가 0, 시계 방향(+y)이 양수다.

# 팔은 어깨에서 옆으로 벌어지고, 다리는 몸 뒤로 길게 뻗는다.
# 다리가 몸 길이의 절반을 차지한다 — 위에서 비스듬히 보면 그렇게 보이고,
# 여기가 예전 수직 톱다운 그림과 제일 다른 점이다.
# 몸이 길어지면서 팔도 같이 길어져야 한다. 9 로는 어깨가 몸통(ry 8.2)
# 안에 묻혀 팔이 위아래에 붙은 얇은 조각으로만 보였다.
ARM_LEN, LEG_LEN = 12.5, 13.0

# 다리 기본 각도. 180 이 정확한 뒤쪽인데 그 근처에서는 각도 부호가
# 뒤집혀 두 다리가 서로 넘어간다. 168 로 조금 벌려 각자 제 쪽에 둔다.
LEG_BACK = 168.0


def base():
    return {'lean': 0.0, 'squash': 1.0,
            'arms': [(-74.0, ARM_LEN), (74.0, ARM_LEN)],
            'legs': [(-LEG_BACK, LEG_LEN), (LEG_BACK, LEG_LEN)]}


def cycle(f, n, swing, arm_swing, lean):
    """걷기·달리기 루프.

    **보폭은 각도가 아니라 길이로 낸다.** 위에서 보면 다리는 원근으로
    짧아져 보이므로, 앞으로 나온 다리는 짧고 뒤로 뻗은 다리는 길다.
    각도로 크게 돌리면 180 근처에서 두 다리가 서로 넘어간다.
    """
    t = math.sin(f / n * math.tau)
    p = base()
    p['lean'] = lean
    p['legs'] = [(-LEG_BACK + swing * 0.30 * t, LEG_LEN * (1 + swing / 100 * t)),
                 (LEG_BACK + swing * 0.30 * t, LEG_LEN * (1 - swing / 100 * t))]
    p['arms'] = [(-74.0 - arm_swing * t, ARM_LEN),
                 (74.0 - arm_swing * t, ARM_LEN)]
    return p


def pose(name, f):
    p = base()
    if name == 'idle':
        return p
    if name == 'walk':
        return cycle(f, 4, 26.0, 16.0, 0.0)
    if name == 'run':
        return cycle(f, 4, 42.0, 32.0, 1.4)
    if name == 'kick':
        # 차는 발(+y)이 뒤에서 옆을 거쳐 앞으로 돈다. 디딤발은 그대로.
        sw = [162.0, 108.0, 52.0][f]
        p['lean'] = [-1.0, 1.4, 2.0][f]
        p['legs'] = [(-LEG_BACK, LEG_LEN * 0.95),
                     (sw, LEG_LEN * [1.05, 1.20, 1.12][f])]
        p['arms'] = [(-118.0 + (162 - sw) * 0.16, ARM_LEN), (104.0, ARM_LEN)]
        return p
    if name == 'shoot':
        sw = [172.0, 96.0, 28.0][f]
        p['lean'] = [-1.6, 2.0, 2.6][f]
        p['legs'] = [(-LEG_BACK, LEG_LEN * 0.92),
                     (sw, LEG_LEN * [1.10, 1.30, 1.22][f])]
        p['arms'] = [(-126.0 + (172 - sw) * 0.20, ARM_LEN + 1.5), (98.0, ARM_LEN)]
        return p
    if name == 'charge':
        # 힘을 모은다 — 차는 발을 뒤로 크게 빼고 반대 팔을 젖힌다.
        p['lean'] = -1.2
        p['legs'] = [(-LEG_BACK + 6, LEG_LEN * 0.92), (176.0, LEG_LEN * 1.22)]
        p['arms'] = [(-132.0, ARM_LEN + 1.5), (88.0, ARM_LEN)]
        return p
    if name == 'tackle':
        # 한 발을 앞으로 완전히 뻗고 몸을 낮춘다. 실루엣이 길어진다.
        ext = [0.35, 1.0, 0.8][f]
        p['lean'] = 2.0 * ext
        p['squash'] = 1.0 - 0.22 * ext
        p['legs'] = [(-160.0 + 26 * ext, LEG_LEN * (0.9 + 0.15 * ext)),
                     (150.0 - 128 * ext, LEG_LEN * (1.0 + 0.30 * ext))]
        p['arms'] = [(-142.0, ARM_LEN + 2 * ext), (142.0, ARM_LEN + 2 * ext)]
        return p
    if name == 'block':
        # 두 팔을 좌우로 벌리고 다리도 넓게 벌려 궤도를 막는다.
        sp = [0.6, 1.0][f]
        p['arms'] = [(-88.0, ARM_LEN + 6 * sp), (88.0, ARM_LEN + 6 * sp)]
        p['legs'] = [(-LEG_BACK + 26 * sp, LEG_LEN * 0.92),
                     (LEG_BACK - 26 * sp, LEG_LEN * 0.92)]
        return p
    if name == 'header':
        # 목을 앞으로 내밀고 팔로 균형을 잡는다.
        push = [0.2, 1.0, 0.5][f]
        p['lean'] = 3.4 * push
        p['arms'] = [(-128.0 + 24 * push, ARM_LEN + 2),
                     (128.0 - 24 * push, ARM_LEN + 2)]
        p['legs'] = [(-LEG_BACK - 4, LEG_LEN * 1.05), (LEG_BACK + 4, LEG_LEN * 1.05)]
        return p
    if name == 'deflect':
        # 몸에 맞고 튀는 순간. 팔을 접고 상체를 비튼다.
        t = [1.0, 0.5][f]
        p['lean'] = -1.6 * t
        p['arms'] = [(-62.0, ARM_LEN - 3 * t), (140.0, ARM_LEN - 2 * t)]
        p['legs'] = [(-LEG_BACK - 8 * t, LEG_LEN * 0.9), (LEG_BACK - 4 * t, LEG_LEN)]
        return p
    if name == 'gk-dive':
        # 옆(-y)으로 몸을 날린다. 팔은 모아 뻗고 다리는 반대쪽으로 끌린다.
        ext = [0.4, 1.0, 0.85][f]
        p['squash'] = 1.0 - 0.28 * ext
        p['arms'] = [(-98.0 + 10 * ext, ARM_LEN + 9 * ext),
                     (-82.0 - 10 * ext, ARM_LEN + 9 * ext)]
        p['legs'] = [(LEG_BACK - 40 * ext, LEG_LEN * (1 + 0.20 * ext)),
                     (LEG_BACK - 16 * ext, LEG_LEN * (1 + 0.12 * ext))]
        return p
    if name == 'gk-claim':
        # 하이볼. 두 팔을 앞으로 모아 올린다.
        up = [0.5, 1.0][f]
        p['lean'] = 1.2 * up
        p['arms'] = [(-38.0 + 14 * up, ARM_LEN + 6 * up),
                     (38.0 - 14 * up, ARM_LEN + 6 * up)]
        p['legs'] = [(-LEG_BACK + 8 * up, LEG_LEN * (1 - 0.12 * up)),
                     (LEG_BACK - 8 * up, LEG_LEN * (1 - 0.12 * up))]
        return p
    if name == 'gk-punt':
        sw = [168.0, 100.0, 36.0][f]
        p['lean'] = [-1.0, 1.6, 2.2][f]
        p['legs'] = [(-LEG_BACK, LEG_LEN * 0.95),
                     (sw, LEG_LEN * [1.08, 1.26, 1.18][f])]
        p['arms'] = [(-52.0, ARM_LEN + 2), (52.0, ARM_LEN + 2)]
        return p
    raise ValueError('모르는 포즈: ' + name)


# 일러스트를 셀로 옮기는 일은 sprite-import.py 가 한다 — 이 파일이
# 500줄을 넘어서 나눴다.
from sprite_import import IMPORTED, load_imported   # noqa: E402

SHEET = [('idle', 1), ('walk', 4), ('run', 2), ('kick', 1), ('shoot', 1),
         ('charge', 1), ('tackle', 1), ('block', 1), ('header', 1),
         ('deflect', 1), ('gk-dive', 1), ('gk-claim', 1), ('gk-punt', 1)]


# ── 몸 비율 ─────────────────────────────────────────────────────────
# 그림의 성격은 거의 전부 여기서 나온다. 포즈(각도)와 분리해 둔 이유는
# 비율만 바꿔 다른 느낌을 시험하려면 각도를 건드리지 않아야 하기 때문이다.
#
#   shoulder_rx/ry  어깨 타원. 위에서 보면 앞뒤로 얕고 좌우로 넓다
#   head_r/head_x   정수리 크기와 앞쪽 치우침
#   hair_r/face     머리카락 원의 크기와 뒤로 밀린 정도. hair_r 0 이면
#                   머리카락 없이 살색 점 하나 — 작게 그려질수록 이게 낫다
#   arm_w/foot_w    팔·발 굵기
#   sleeve          반팔 길이. 여기서부터 팔은 맨살
#   outline         몸통 윤곽선 굵기. 0 이면 안 그린다
STYLE = {
    # 몸 축(+x)을 따라 앞에서 뒤로: 머리 → 어깨 → 몸통 → 반바지 → 다리
    'head_x':15.0, 'head_r':5.4, 'hair_r':4.6, 'face':1.0,
    'torso_x':2.0, 'torso_rx':9.0, 'torso_ry':8.2,
    # 팔을 좌우 대칭 수직(±90)으로 두면 몸통을 관통하는 막대 하나로
    # 보인다. 기본을 ±74 로 앞으로 기울여 두 팔로 읽히게 한다.
    'shoulder_x':5.0, 'shoulder_y':8.6,
    'shorts_x':-8.5, 'shorts_rx':4.6, 'shorts_ry':6.8,
    'hip_x':-11.0, 'hip_y':4.2,
    'arm_w':4.0, 'leg_w':6.0, 'boot_len':3.4, 'boot_w':4.4,
    'sleeve':3.4, 'outline':1.2,
}


def joints(p):
    """어깨·엉덩이 관절. 사지는 몸통 가장자리에서 나와야 한다."""
    S, lean, sq = STYLE, p['lean'], p['squash']
    sy = S['shoulder_y'] * sq
    return ([(lean + S['shoulder_x'], -sy), (lean + S['shoulder_x'], sy)],
            [(lean + S['hip_x'], -S['hip_y'] * sq),
             (lean + S['hip_x'], S['hip_y'] * sq)])


def draw_cell(name, f, layer):
    """포즈 한 장. layer 0 = 유니폼(상의·소매·반바지), 1 = 머리·팔·다리.

    **위에서 비스듬히 뒤를 본 각도**다. 정수리만 보이는 수직 톱다운이
    아니라, 머리 → 어깨(등번호) → 반바지 → 다리 → 축구화가 몸 축을 따라
    늘어선다. 다리가 몸 길이의 절반을 차지하는 것이 이 각도의 핵심이고,
    달릴 때 보폭이 실제로 보이는 이유다.

    **팔·다리는 유니폼이 아니라 맨살·양말로 그린다.** 전부 팀 색으로
    칠하면 몸통에 묻혀 실루엣이 덩어리 하나가 된다.
    """
    S = STYLE
    pen = Pen(CELL * SS)
    p = pose(name, f)
    lean, sq = p['lean'], p['squash']
    sho, hip = joints(p)

    if layer == 1:
        # 축구화만 여기. 양말은 팀 색이라 0줄에 있다.
        # 어두운 원을 찍으면 막대에 공을 붙인 꼴이 되므로, 축구화도 다리와
        # 같은 방향으로 뻗은 짧은 캡슐이라야 발처럼 읽힌다.
        for (jx, jy), (ang, ln) in zip(hip, p['legs']):
            ex = jx + math.cos(deg(ang)) * ln
            ey = jy + math.sin(deg(ang)) * ln
            pen.capsule(ex, ey, ang, S['boot_len'], S['boot_w'], SHOE)
        # 맨팔 — 소매 끝에서 손까지.
        for (jx, jy), (ang, ln) in zip(sho, p['arms']):
            sx = jx + math.cos(deg(ang)) * S['sleeve']
            sy = jy + math.sin(deg(ang)) * S['sleeve']
            pen.capsule(sx, sy, ang, max(1.0, ln - S['sleeve']), S['arm_w'], SKIN)
        # 상의 윤곽 — 잔디와 맨팔 양쪽에서 유니폼을 떼어 놓는다.
        if S['outline'] > 0:
            pen.ellipse(lean + S['torso_x'], 0, S['torso_rx'],
                        S['torso_ry'] * sq, None, outline=BOOT, ow=S['outline'])
        # 머리. 뒤통수는 머리카락, 앞쪽에 얼굴이 초승달로 남아 방향이 읽힌다.
        hx = lean + S['head_x']
        pen.ellipse(hx, 0, S['head_r'], S['head_r'], SKIN)
        if S['hair_r'] > 0:
            pen.ellipse(hx - S['face'], 0, S['hair_r'], S['hair_r'], HAIR)
        return pen.img

    # 양말 — **팀 색이다.** 일러스트도 파란 양말이라 여기 있어야 색이 맞는다.
    # 회색조로 그려두면 런타임 multiply 가 팀 색을 입힌다.
    for (jx, jy), (ang, ln) in zip(hip, p['legs']):
        pen.capsule(jx, jy, ang, ln, S['leg_w'], SOCK)
    # 반바지 — 몸통 뒤. 상의보다 살짝 어둡게 해 경계를 만든다.
    pen.ellipse(lean + S['shorts_x'], 0, S['shorts_rx'], S['shorts_ry'] * sq, SHORTS)
    # 소매는 어깨에서 짧게. 팔 각도의 시작점을 보여준다.
    for (jx, jy), (ang, _ln) in zip(sho, p['arms']):
        pen.capsule(jx, jy, ang, S['sleeve'], S['arm_w'] + 1.8, SHIRT)
    # 상의 — 등번호가 얹히는 면이다. 제일 큰 색 덩어리여야 한다.
    pen.ellipse(lean + S['torso_x'], 0, S['torso_rx'], S['torso_ry'] * sq, SHIRT)
    return pen.img


def check_fit(img, where):
    """내접원을 넘는 픽셀이 있으면 회전 시 모서리가 잘린다."""
    px = img.load()
    lim = CELL / 2 - 1.0
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y][3] > 8:
                r = math.hypot(x - (CELL - 1) / 2, y - (CELL - 1) / 2)
                if r > lim:
                    raise SystemExit(
                        '%s 가 내접원을 넘었습니다 (r=%.1f > %.1f). '
                        'ART 를 줄이거나 포즈를 좁히세요.' % (where, r, lim))


def build():
    cols = sum(n for _, n in SHEET)
    sheet = Image.new('RGBA', (cols * CELL, ROWS * CELL), (0, 0, 0, 0))
    index, col = [], 0
    for name, n in SHEET:
        index.append((name, col, n))
        for f in range(n):
            for layer in range(ROWS):
                if name in IMPORTED:
                    got = load_imported(*IMPORTED[name])
                    if len(got) != n:
                        sys.exit('%s: 일러스트 %d프레임인데 SHEET 는 %d장'
                                 % (name, len(got), n))
                    cell = got[f][layer]
                else:
                    cell = draw_cell(name, f, layer).resize(
                        (CELL, CELL), Image.LANCZOS)
                check_fit(cell, '%s[%d] 줄%d' % (name, f, layer))
                sheet.paste(cell, ((col + f) * CELL, layer * CELL))
        col += n
    return sheet, index


def poses_literal(index):
    """09-sprites.js 의 POSES 에 넣을 JS 객체 리터럴."""
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


def stamp_js(root, png_path, index):
    """09-sprites.js 의 SPRITE_V·SPRITE_BODY·POSES 를 덮어쓴다.

    SPRITE_BODY 는 셀 대비 몸통 **폭** 비율이다 (길이가 아니다 — 선수는
    몸 축으로 길쭉하고, 충돌 반경에 맞출 것은 폭이다). STYLE 이나 ART 를
    바꾸면 값이 달라지므로 손으로 맞추지 않는다.

    POSES 까지 여기서 박는 이유는, 어느 포즈의 장수를 바꾸면 **그 뒤 모든
    포즈의 시작 칸이 밀리기 때문**이다. 손으로 옮기면 옆 포즈나 빈 칸을
    그리는데, 화면에는 그럴듯하게 나와서 알아채기 어렵다.
    """
    js = os.path.join(root, 'games', 'soccer', 'js', '09-sprites.js')
    if not os.path.exists(js):
        return None
    with open(png_path, 'rb') as f:
        v = hashlib.sha256(f.read()).hexdigest()[:8]
    body = round(2 * STYLE['torso_ry'] * ART / CELL, 4)

    with io.open(js, encoding='utf-8') as f:
        src = f.read()
    out, n1 = re.subn(r"(const SPRITE_V = ')[0-9a-f]+(')",
                      lambda m: m.group(1) + v + m.group(2), src)
    out, n2 = re.subn(r"(const SPRITE_BODY = )[0-9.]+(;)",
                      lambda m: m.group(1) + repr(body) + m.group(2), out)
    out, n3 = re.subn(r"const POSES = \{[^}]*\};",
                      'const POSES = {\n' + poses_literal(index) + '\n};', out)
    if n1 != 1 or n2 != 1 or n3 != 1:
        sys.exit('09-sprites.js 치환 실패 — SPRITE_V %d, SPRITE_BODY %d, '
                 'POSES %d (각각 1이어야 함)' % (n1, n2, n3))
    if out != src:
        with io.open(js, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
    return v, body


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'games', 'soccer', 'assets')
    os.makedirs(out, exist_ok=True)
    sheet, index = build()
    path = os.path.join(out, 'players.png')
    sheet.save(path)
    print('%s  %d x %d  (%d장)'
          % (os.path.relpath(path, root), sheet.width, sheet.height,
             sum(n for _, n in SHEET)))
    print('POSES = ' + ', '.join('%s:%d+%d' % (n, c, k) for n, c, k in index))
    stamped = stamp_js(root, path, index)
    if stamped:
        print('SPRITE_V = %s   SPRITE_BODY = %s' % stamped)
        print('이어서 `node tools/soccer-sim.js --restamp`')


if __name__ == '__main__':
    main()
