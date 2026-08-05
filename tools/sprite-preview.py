#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""스프라이트 시트 눈으로 확인하기 — tmp/preview-*.png

    python tools/sprite-preview.py

시트는 상의가 흰색이라 그냥 열면 안 보인다. 팀 색으로 틴트하고 어두운
줄을 겹쳐 잔디 위에 올린다. 게임과 같은 합성 순서다.
"""
from PIL import Image, ImageDraw
sheet = Image.open('games/soccer/assets/players.png').convert('RGBA')
CELL = 64
LABELS = [('idle',0,1),('walk',1,4),('run',5,4),('kick',9,3),('shoot',12,3),
          ('charge',15,1),('tackle',16,3),('block',19,2),('header',21,3),
          ('deflect',24,2),('gk-dive',26,3),('gk-claim',29,2),('gk-punt',31,3)]
GRASS = (0x2E,0x5B,0x3F,255)
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
    """게임에서 그려지는 크기. 18px/40px 은 **몸 지름** 기준이고 셀은
    그보다 크다 — 몸이 셀의 37.5% 라 셀은 몸의 2.67배로 그려야 한다."""
    rows = [('몸 18px', 48), ('몸 40px', 107)]
    cols = sum(n for _,_,n in LABELS)
    big = max(s for _,s in rows)
    pad = 6; W = cols*(big+pad)+pad+90; H = sum(s for _,s in rows)+pad*3+10
    img = Image.new('RGBA',(W,H),GRASS); dr = ImageDraw.Draw(img)
    y = pad
    for label,S in rows:
        dr.text((8,y+S//2-6), label, fill=(255,255,255,255))
        for c in range(cols):
            col = [HOME,AWAY,GKH][c % 3]
            img.alpha_composite(cell(c,col).resize((S,S),Image.LANCZOS),
                                (90+c*(big+pad)+(big-S)//2, y))
        y += S + pad
    img.save(path)

import os
os.makedirs('tmp', exist_ok=True)
grid('tmp/preview-poses.png', HOME, 2)
actual('tmp/preview-actual.png')
print('tmp/preview-poses.png  포즈별 확대')
print('tmp/preview-actual.png 게임에서 그려지는 크기')
