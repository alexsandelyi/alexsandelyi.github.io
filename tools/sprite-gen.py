#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""선수 스프라이트 시트 생성기 — games/soccer/assets/players.png

포즈를 손으로 찍지 않고 사지 각도에서 그린다. 포즈 하나를 고치려고
34장을 다시 그릴 수는 없기 때문이다. 규격은 games/soccer/player-sprites.md.

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

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('Pillow 가 필요합니다:  pip install Pillow')

CELL = 64          # 셀 한 변(px)
SS = 4             # 슈퍼샘플링 배율. 4배로 그린 뒤 축소해 계단을 없앤다
ROWS = 2           # 0 = 상의(틴트 대상), 1 = 머리·다리·윤곽
# 그림이 셀을 얼마나 채우는지. 회전으로 방향을 내므로 내용은 셀에 내접한
# 원(반지름 32) 안에 들어야 한다. 제일 멀리 뻗는 것은 태클의 뻗은 발이
# 아니라 **좌우로 벌린 팔**이다 — gk-dive 가 어깨 7 + 팔 23 + 손끝 1.7 로
# 약 31.8 이다. 여유 2px 을 남긴다. build() 가 매번 검사한다.
ART = 0.92

SHIRT = (255, 255, 255, 255)      # 흰색으로 굽고 런타임에 팀 색을 입힌다
SKIN = (214, 160, 118, 255)       # 팔·얼굴. 상의와 대비돼야 사지가 읽힌다
BOOT = (26, 28, 32, 255)          # 발·머리카락·윤곽선. 제일 어두운 값

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

ARM_LEN, LEG_LEN = 12.0, 10.0


def base():
    return {'lean': 0.0, 'squash': 1.0,
            'arms': [(-104.0, ARM_LEN), (104.0, ARM_LEN)],
            'legs': [(-112.0, LEG_LEN), (112.0, LEG_LEN)]}


def cycle(f, n, swing, arm_swing, lean):
    """걷기·달리기 루프. 팔은 다리와 반대로 흔든다."""
    t = math.sin(f / n * math.tau)
    p = base()
    p['lean'] = lean
    # 부호 규약 덕에 두 발이 저절로 반대 위상이 된다 — 위쪽 발은 0(앞)
    # 쪽으로, 아래쪽 발은 180(뒤) 쪽으로 돈다.
    p['legs'] = [(-112.0 + swing * t, LEG_LEN + swing * t * 0.10),
                 (112.0 + swing * t, LEG_LEN - swing * t * 0.10)]
    p['arms'] = [(-104.0 - arm_swing * t, ARM_LEN),
                 (104.0 - arm_swing * t, ARM_LEN)]
    return p


def pose(name, f):
    p = base()
    if name == 'idle':
        return p
    if name == 'walk':
        return cycle(f, 4, 34.0, 18.0, 0.0)
    if name == 'run':
        return cycle(f, 4, 54.0, 34.0, 1.6)
    if name == 'kick':
        # 준비 → 임팩트 → 팔로스루. 오른발(+y)이 찬다.
        sw = [-40.0, 52.0, 76.0][f]
        p['lean'] = [-1.0, 1.4, 2.0][f]
        p['legs'] = [(-112.0, LEG_LEN), (112.0 - sw, LEG_LEN + abs(sw) * 0.09)]
        p['arms'] = [(-124.0 + sw * 0.3, ARM_LEN), (112.0, ARM_LEN)]
        return p
    if name == 'shoot':
        sw = [-56.0, 66.0, 96.0][f]
        p['lean'] = [-1.6, 2.0, 2.6][f]
        p['legs'] = [(-112.0, LEG_LEN), (112.0 - sw, LEG_LEN + abs(sw) * 0.12)]
        p['arms'] = [(-132.0 + sw * 0.4, ARM_LEN + 2), (104.0, ARM_LEN)]
        return p
    if name == 'charge':
        # 힘을 모으는 자세. 차는 발을 뒤로 빼고 반대 팔을 젖힌다.
        p['lean'] = -1.2
        p['legs'] = [(-112.0, LEG_LEN), (142.0, LEG_LEN + 2.0)]
        p['arms'] = [(-142.0, ARM_LEN + 2), (96.0, ARM_LEN)]
        return p
    if name == 'tackle':
        # 몸을 낮추고 한 발을 앞으로 완전히 뻗는다. 실루엣이 길어진다.
        ext = [0.35, 1.0, 0.8][f]
        p['lean'] = 2.2 * ext
        p['squash'] = 1.0 - 0.24 * ext
        p['legs'] = [(-112.0 + 80 * ext, LEG_LEN + 11 * ext),
                     (124.0, LEG_LEN + 1)]
        p['arms'] = [(-148.0, ARM_LEN + 3 * ext), (148.0, ARM_LEN + 3 * ext)]
        return p
    if name == 'block':
        # 두 팔을 좌우로 벌려 슛 궤도를 막는다.
        sp = [0.6, 1.0][f]
        p['squash'] = 1.0 - 0.08 * sp
        p['arms'] = [(-92.0, ARM_LEN + 7 * sp), (92.0, ARM_LEN + 7 * sp)]
        p['legs'] = [(-96.0 - 26 * sp, LEG_LEN + 2 * sp),
                     (96.0 + 26 * sp, LEG_LEN + 2 * sp)]
        return p
    if name == 'header':
        # 목을 앞으로 내밀고 팔로 균형을 잡는다.
        push = [0.2, 1.0, 0.5][f]
        p['lean'] = 3.6 * push
        p['arms'] = [(-136.0 + 26 * push, ARM_LEN + 3),
                     (136.0 - 26 * push, ARM_LEN + 3)]
        p['legs'] = [(-124.0, LEG_LEN), (124.0, LEG_LEN)]
        return p
    if name == 'deflect':
        # 몸에 맞고 튀는 순간. 팔을 접고 상체를 비튼다.
        t = [1.0, 0.5][f]
        p['lean'] = -1.6 * t
        p['arms'] = [(-64.0, ARM_LEN - 4 * t), (146.0, ARM_LEN - 3 * t)]
        p['legs'] = [(-130.0, LEG_LEN - 1), (108.0, LEG_LEN - 1)]
        return p
    if name == 'gk-dive':
        # 옆(-y)으로 몸을 날린다. 두 팔을 같은 쪽으로 모아 뻗고 다리는
        # 반대쪽으로 끌린다. 실루엣이 한 축으로 길어진다.
        ext = [0.4, 1.0, 0.85][f]
        p['squash'] = 1.0 - 0.32 * ext
        p['arms'] = [(-100.0 + 10 * ext, ARM_LEN + 11 * ext),
                     (-80.0 - 10 * ext, ARM_LEN + 11 * ext)]
        p['legs'] = [(96.0, LEG_LEN + 7 * ext), (108.0, LEG_LEN + 6 * ext)]
        return p
    if name == 'gk-claim':
        # 하이볼. 두 팔을 앞으로 모아 올린다.
        up = [0.5, 1.0][f]
        p['lean'] = 1.2 * up
        p['arms'] = [(-40.0 + 16 * up, ARM_LEN + 7 * up),
                     (40.0 - 16 * up, ARM_LEN + 7 * up)]
        p['legs'] = [(-116.0, LEG_LEN - 2 * up), (116.0, LEG_LEN - 2 * up)]
        return p
    if name == 'gk-punt':
        sw = [-48.0, 58.0, 88.0][f]
        p['lean'] = [-1.0, 1.6, 2.2][f]
        p['legs'] = [(-112.0, LEG_LEN), (112.0 - sw, LEG_LEN + abs(sw) * 0.10)]
        p['arms'] = [(-56.0, ARM_LEN + 3), (56.0, ARM_LEN + 3)]
        return p
    raise ValueError('모르는 포즈: ' + name)


# 이름과 장수. player-sprites.md 「프레임」과 같아야 한다.
SHEET = [('idle', 1), ('walk', 4), ('run', 4), ('kick', 3), ('shoot', 3),
         ('charge', 1), ('tackle', 3), ('block', 2), ('header', 3),
         ('deflect', 2), ('gk-dive', 3), ('gk-claim', 2), ('gk-punt', 3)]


SLEEVE = 4.2          # 반팔 길이. 여기서부터 팔은 맨살이다


def joints(p):
    """어깨·엉덩이 관절 위치. 사지는 몸통 가장자리에서 나와야 한다."""
    lean = p['lean']
    sh = 10.5 * p['squash']
    return ([(lean + 1.0, -sh), (lean + 1.0, sh)],       # 어깨
            [(lean - 5.0, -5.0), (lean - 5.0, 5.0)])     # 엉덩이


def draw_cell(name, f, layer):
    """포즈 한 장. layer 0 = 상의(어깨·소매), 1 = 머리·팔·발.

    위에서 곧장 내려다본 그림이다. 보이는 것은 정수리와 어깨, 팔이고
    다리는 어깨에 가려 발만 뒤로 삐져나온다. 그래서 어깨는 앞뒤로 얕고
    좌우로 넓은 타원이다.

    **팔은 상의가 아니라 맨살로 그린다.** 소매까지 팀 색으로 칠하면 팔이
    몸통에 묻혀 실루엣이 덩어리 하나가 된다. 반팔 소매만 상의 줄에 두고
    그 밖은 피부색이라, 어느 팀이든 팔의 각도가 읽힌다.
    """
    pen = Pen(CELL * SS)
    p = pose(name, f)
    lean, sq = p['lean'], p['squash']
    sho, hip = joints(p)

    if layer == 1:
        # 몸통 윤곽선을 먼저. 잔디와 맨팔 양쪽에서 상의를 떼어 놓는다.
        pen.ellipse(lean, 0, 8.4, 13.0 * sq, None, outline=BOOT, ow=1.1)
        # 발 — 짧고 굵은 점. 잔디 위에서 접지 위치를 알려준다.
        for (jx, jy), (ang, ln) in zip(hip, p['legs']):
            pen.capsule(jx, jy, ang, ln, 4.2, BOOT)
        # 맨팔 — 소매 끝에서 시작해 손까지.
        for (jx, jy), (ang, ln) in zip(sho, p['arms']):
            sx = jx + math.cos(deg(ang)) * SLEEVE
            sy = jy + math.sin(deg(ang)) * SLEEVE
            pen.capsule(sx, sy, ang, max(1.0, ln - SLEEVE), 3.4, SKIN)
        # 머리. 뒤통수는 머리카락, 앞쪽에 얼굴이 초승달로 남아 어느 쪽을
        # 보고 있는지 드러난다 — 회전만으로 방향을 내는 데 이게 단서다.
        pen.ellipse(lean + 1.8, 0, 5.4, 5.4, SKIN)
        pen.ellipse(lean + 0.4, 0, 4.4, 4.8, BOOT)
        return pen.img

    # 소매는 어깨에서 짧게. 팔 각도의 시작점을 보여준다.
    for (jx, jy), (ang, _ln) in zip(sho, p['arms']):
        pen.capsule(jx, jy, ang, SLEEVE, 5.0, SHIRT)
    # 어깨 — 앞뒤로 얕고 좌우로 넓다.
    pen.ellipse(lean, 0, 8.4, 13.0 * sq, SHIRT)
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
                cell = draw_cell(name, f, layer).resize(
                    (CELL, CELL), Image.LANCZOS)
                check_fit(cell, '%s[%d] 줄%d' % (name, f, layer))
                sheet.paste(cell, ((col + f) * CELL, layer * CELL))
        col += n
    return sheet, index


def stamp_js(root, png_path):
    """09-sprites.js 의 SPRITE_V 를 시트 내용 해시로 덮어쓴다."""
    js = os.path.join(root, 'games', 'soccer', 'js', '09-sprites.js')
    if not os.path.exists(js):
        return None
    with open(png_path, 'rb') as f:
        v = hashlib.sha256(f.read()).hexdigest()[:8]
    with io.open(js, encoding='utf-8') as f:
        src = f.read()
    out, n = re.subn(r"(const SPRITE_V = ')[0-9a-f]+(')",
                     lambda m: m.group(1) + v + m.group(2), src)
    if n != 1:
        sys.exit('09-sprites.js 에서 SPRITE_V 를 %d 개 찾았습니다 (1개여야 함)' % n)
    if out != src:
        with io.open(js, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
    return v


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
    v = stamp_js(root, path)
    if v:
        print('SPRITE_V = %s  →  이어서 `node tools/soccer-sim.js --restamp`' % v)


if __name__ == '__main__':
    main()
