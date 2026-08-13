#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""스프라이트 시트 눈으로 확인하기 — tmp/preview-*.png

    python tools/sprite-preview.py

시트는 상의가 흰색이라 그냥 열면 안 보인다. 팀 색으로 틴트하고 어두운
줄을 겹쳐 잔디 위에 올린다. 게임과 같은 합성 순서다.
"""
import io
import re
from PIL import Image, ImageDraw
sheet = Image.open('games/soccer/assets/players.png').convert('RGBA')
CELL = 64
GRASS = (0x2E,0x5B,0x3F,255)
# 09-sprites.js 에서 읽는다. 베껴 두면 시트를 바꿀 때 어긋난다.
_js = io.open('games/soccer/js/09-sprites.js', encoding='utf-8').read()
BODY = float(re.search(r"const SPRITE_BODY = ([0-9.]+);", _js).group(1))
GAIN = float(re.search(r"const SPRITE_GAIN = ([0-9.]+);", _js).group(1))
# 칸 배치도 마찬가지다. 예전에 손으로 베껴 뒀다가 run 이 4→2 로 준 것을
# 놓쳐, 프리뷰만 빈 칸과 옆 포즈를 그리고 있었다. sprite-gen.py 가 POSES
# 를 09-sprites.js 에 직접 박으므로 그걸 그대로 읽는다.
_poses = re.search(r"const POSES = \{(.*?)\};", _js, re.S).group(1)
LABELS = [(m.group(1), int(m.group(2)), int(m.group(3)))
          for m in re.finditer(r"'?([\w-]+)'?\s*:\s*\[(\d+),\s*(\d+)\]", _poses)]
HOME=(0xF5,0x8A,0x5E); AWAY=(0xF2,0xCE,0x7A); GKH=(0x8F,0xD1,0xC4)

def tint(img, rgb):
    out = img.copy(); px = out.load()
    for y in range(out.height):
        for x in range(out.width): px[x,y] = (rgb[0],rgb[1],rgb[2],px[x,y][3])
    return out

def cell(c, colour):
    s = sheet.crop((c*CELL,0,c*CELL+CELL,CELL))
    d = sheet.crop((c*CELL,CELL,c*CELL+CELL,2*CELL))
    b = Image.new('RGBA',(CELL,CELL),(0,0,0,0))
    b.alpha_composite(tint(s,colour)); b.alpha_composite(d); return b

def grid(path, colour, Z):
    pad = 4; maxn = max(n for _,_,n in LABELS)
    W = maxn*(CELL*Z+pad)+pad+140; H = len(LABELS)*(CELL*Z+pad)+pad
    img = Image.new('RGBA',(W,H),GRASS); dr = ImageDraw.Draw(img)
    for r,(name,c0,n) in enumerate(LABELS):
        y = pad + r*(CELL*Z+pad)
        dr.text((8, y+CELL*Z//2-6), name, fill=(255,255,255,255))
        for f in range(n):
            img.alpha_composite(cell(c0+f,colour).resize((CELL*Z,CELL*Z),Image.LANCZOS),
                                (140+f*(CELL*Z+pad), y))
    img.save(path)

def actual(path):
    """게임에서 그려지는 크기.

    18/40px 은 DRAW_PLAYER_MIN_PX 기준의 **물리 몸 지름**이다. 실제로는
    SPRITE_GAIN 만큼 크게 그리고, 셀은 다시 몸 비율(SPRITE_BODY)의
    역수만큼 크다. 두 값은 09-sprites.js 에서 읽어 온다 — 여기 숫자를
    베껴 두면 시트를 바꿀 때 미리보기만 조용히 거짓말을 한다.
    """
    rows = [('최소 줌', 18), ('보통 줌', 40)]
    cells = [(lab, int(round(bp * GAIN / BODY))) for lab, bp in rows]
    cols = sum(n for _, _, n in LABELS)
    big = max(c for _, c in cells)
    pad = 6
    W = cols * (big + pad) + pad + 90
    H = sum(c for _, c in cells) + pad * 3 + 10
    img = Image.new('RGBA', (W, H), GRASS)
    dr = ImageDraw.Draw(img)
    y = pad
    for label, S in cells:
        dr.text((8, y + S // 2 - 6), label, fill=(255, 255, 255, 255))
        for c in range(cols):
            col = [HOME, AWAY, GKH][c % 3]
            img.alpha_composite(cell(c, col).resize((S, S), Image.LANCZOS),
                                (90 + c * (big + pad) + (big - S) // 2, y))
        y += S + pad
    img.save(path)


grid('tmp/preview-poses.png', HOME, 2)
actual('tmp/preview-actual.png')
print('tmp/preview-poses.png  포즈별 확대')
print('tmp/preview-actual.png 게임에서 그려지는 크기')
