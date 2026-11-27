#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""3D 관절 축구 선수 리깅 렌더러 — tools/sprite-gen.py 전용.

40° 사선 카메라(01-core.js 의 CAMERA_ELEVATION)로 3D 인간 관절을 투영해
2톤 셀 셰이딩 + 선명한 외곽선으로 4배 슈퍼샘플링 렌더링한다.
모든 8방향·이동·액션이 하나의 3D 모델에서 나오므로 체형·원근·보폭이
완벽하게 일관된다.
"""

import math
from PIL import Image, ImageChops, ImageDraw, ImageFilter

CELL = 96
SS = 4                      # 384×384 렌더링 후 96×96 LANCZOS 축소
SIZE = CELL * SS
FOOT_Y = 0.87               # 발바닥 기준선 (셀 하단 여유 확보해 S/SW 발끝 절단 방지)
STAND_H = 0.78              # 서 있는 선수 키 비율
SCALE = SIZE * 0.425        # 1m → 슈퍼샘플 픽셀

ELEV = math.radians(40.0)
SIN_E, COS_E = math.sin(ELEV), math.cos(ELEV)
LIGHT = (-0.42, -0.34, 0.84)

# 색상 팔레트 (레이어 0 = 팀 색 곱셈용 회색조, 레이어 1 = 피부·머리·바지·양말·축구화)
KIT_HI = (252, 252, 252, 255)
KIT_MID = (224, 224, 224, 255)
KIT_SH = (168, 168, 168, 255)
KIT_TRIM = (244, 244, 244, 255)
SKIN_HI = (246, 192, 146, 255)
SKIN_SH = (212, 146, 102, 255)
HAIR_HI = (84, 58, 42, 255)
HAIR_SH = (46, 31, 23, 255)
SHORTS_HI = (42, 54, 78, 255)
SHORTS_SH = (24, 32, 48, 255)
SOCK_HI = (36, 48, 70, 255)
SOCK_SH = (22, 30, 44, 255)
BOOT_HI = (245, 248, 250, 255)
BOOT_SH = (182, 192, 200, 255)
GLOVE_HI = (248, 252, 248, 255)
GLOVE_SH = (188, 206, 198, 255)
INK = (20, 26, 32, 255)
INNER_INK = (26, 34, 42, 165)


def deg(a):
    return a * math.pi / 180.0


def add3(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def lerp3(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def rot_y(v, rad):
    c, s = math.cos(rad), math.sin(rad)
    return (v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c)


def rot_z(v, rad):
    c, s = math.cos(rad), math.sin(rad)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2])


def leg_chain(hip, pitch_deg, knee_deg, out_deg=0.0):
    """고관절→무릎→발목→발끝 3D 좌표. 무릎은 해부학적으로 뒤로만 굽는다."""
    l_th, l_sh, l_ft = 0.43, 0.43, 0.19
    a1 = deg(pitch_deg)
    a2 = deg(pitch_deg - max(0.0, knee_deg))
    oy = math.sin(deg(out_deg))
    th = (math.sin(a1) * l_th, oy * l_th * 0.55, -math.cos(a1) * l_th)
    knee = add3(hip, th)
    sh = (math.sin(a2) * l_sh, oy * l_sh * 0.35, -math.cos(a2) * l_sh)
    ankle = add3(knee, sh)
    af = a2 + deg(82.0)
    toe = add3(ankle, (math.sin(af) * l_ft, oy * 0.04, -math.cos(af) * l_ft))
    return hip, knee, ankle, toe


def arm_chain(sho, side, pitch_deg, elbow_deg, out_deg=14.0):
    """어깨→팔꿈치→손목 3D 좌표. 팔꿈치는 앞으로만 굽는다."""
    l_up, l_fo = 0.29, 0.27
    a1 = deg(pitch_deg)
    a2 = deg(pitch_deg + max(0.0, elbow_deg))
    out = side * math.sin(deg(out_deg))
    up = (math.sin(a1) * l_up, out * l_up, -math.cos(a1) * l_up)
    elbow = add3(sho, up)
    fo = (math.sin(a2) * l_fo, out * l_fo * 0.35, -math.cos(a2) * l_fo)
    hand = add3(elbow, fo)
    return sho, elbow, hand


def pose_params(name, f, total):
    """포즈별 3D 관절 각도(도)와 몸통 자세를 반환한다."""
    # 기본값: 균형 잡힌 준비 자세
    p = {
        'pelvis_z': 0.90, 'pitch': 6.0, 'roll': 0.0, 'hip_yaw': 0.0, 'sho_yaw': 0.0,
        'l_leg': (8.0, 14.0, -4.0), 'r_leg': (-6.0, 12.0, 4.0),
        'l_arm': (-8.0, 32.0, 14.0), 'r_arm': (10.0, 34.0, 14.0),
        'head_pitch': 4.0, 'gloves': False, 'air': False, 'ground_z': 0.0
    }
    if name == 'idle':
        return p

    if name == 'walk':
        ph = (f / max(1, total)) * math.tau
        s, c = math.sin(ph), math.cos(ph)
        p['pelvis_z'] = 0.89 + 0.022 * abs(s)
        p['pitch'] = 8.0
        p['hip_yaw'] = 5.0 * s
        p['sho_yaw'] = -7.0 * s
        # 각 다리: 전진 시 무릎 들기, 후진 시 살짝 접기
        lk = 14.0 + max(0.0, -c) * 28.0 + max(0.0, -s) * 14.0
        rk = 14.0 + max(0.0, c) * 28.0 + max(0.0, s) * 14.0
        p['l_leg'] = (24.0 * s, lk, -3.0)
        p['r_leg'] = (-24.0 * s, rk, 3.0)
        p['l_arm'] = (-20.0 * s, 38.0 + 14.0 * max(0.0, -s), 13.0)
        p['r_arm'] = (20.0 * s, 38.0 + 14.0 * max(0.0, s), 13.0)
        return p

    if name == 'run':
        # 6프레임 역동적 스프린트: 힙·어깨 반대 비틀림 + 높은 무릎 드라이브 + 뒷꿈치 차올림
        ph = (f / max(1, total)) * math.tau
        s, c = math.sin(ph), math.cos(ph)
        p['pelvis_z'] = 0.87 + 0.065 * abs(s)
        p['pitch'] = 20.0
        p['hip_yaw'] = 11.0 * s
        p['sho_yaw'] = -16.0 * s
        # 왼다리 위상 ph, 오른다리 위상 ph + pi
        l_hp = 46.0 * s + 5.0
        r_hp = -46.0 * s + 5.0
        l_kb = 18.0 + 68.0 * max(0.0, -c) + 22.0 * max(0.0, s)
        r_kb = 18.0 + 68.0 * max(0.0, c) + 22.0 * max(0.0, -s)
        p['l_leg'] = (l_hp, min(98.0, l_kb), -3.0)
        p['r_leg'] = (r_hp, min(98.0, r_kb), 3.0)
        p['l_arm'] = (-42.0 * s - 4.0, 86.0 + 18.0 * max(0.0, -s), 16.0)
        p['r_arm'] = (42.0 * s - 4.0, 86.0 + 18.0 * max(0.0, s), 16.0)
        p['ground_z'] = 0.04 * max(0.0, abs(s) - 0.55)
        return p

    t = f / max(1, total - 1) if total > 1 else 0.5
    if name == 'charge':
        p['pitch'] = 10.0 + 6.0 * t
        p['sho_yaw'] = -18.0 - 16.0 * t
        p['l_leg'] = (14.0, 22.0, -5.0)
        p['r_leg'] = (-26.0 - 36.0 * t, 46.0 + 36.0 * t, 5.0)
        p['l_arm'] = (34.0 + 26.0 * t, 55.0, 32.0 + 12.0 * t)
        p['r_arm'] = (-22.0 - 20.0 * t, 48.0, 22.0)
        return p

    if name in ('kick', 'shoot', 'gk-punt'):
        strong = name != 'kick'
        p['gloves'] = name == 'gk-punt'
        sw = [-46.0, 52.0, 78.0][min(f, 2)] if strong else [-30.0, 38.0, 56.0][min(f, 2)]
        kb = [82.0, 12.0, 8.0][min(f, 2)] if strong else [56.0, 14.0, 10.0][min(f, 2)]
        p['pitch'] = [12.0, 14.0, -4.0][min(f, 2)]
        p['sho_yaw'] = [-28.0, 16.0, 34.0][min(f, 2)]
        p['l_leg'] = (14.0, 22.0, -6.0)
        p['r_leg'] = (sw, kb, 4.0)
        p['l_arm'] = ([48.0, 22.0, -28.0][min(f, 2)], 52.0, 36.0)
        p['r_arm'] = ([-32.0, 16.0, 44.0][min(f, 2)], 58.0, 26.0)
        return p

    if name == 'tackle':
        ext = [0.45, 1.0, 0.85][min(f, 2)]
        p['pelvis_z'] = 0.50 - 0.24 * ext
        p['pitch'] = -46.0 * ext
        p['roll'] = 24.0 * ext
        p['sho_yaw'] = -22.0 * ext
        p['l_leg'] = (16.0, 96.0 * ext, -18.0)
        p['r_leg'] = (82.0 * ext, 8.0, 4.0)
        p['l_arm'] = (-38.0 * ext, 22.0, 44.0)
        p['r_arm'] = (46.0 * ext, 34.0, 34.0)
        return p

    if name == 'block':
        sp = [0.65, 1.0, 0.8][min(f, 2)]
        p['pelvis_z'] = 0.78
        p['pitch'] = 14.0
        p['l_leg'] = (10.0, 34.0, -24.0 * sp)
        p['r_leg'] = (-8.0, 34.0, 24.0 * sp)
        p['l_arm'] = (14.0, 28.0, 66.0 * sp)
        p['r_arm'] = (14.0, 28.0, 66.0 * sp)
        return p

    if name == 'header':
        arch = [-14.0, 26.0, 10.0][min(f, 2)]
        p['pelvis_z'] = 0.94
        p['pitch'] = arch
        p['head_pitch'] = arch * 0.9
        p['l_leg'] = (-18.0, 48.0, -6.0)
        p['r_leg'] = (10.0, 52.0, 6.0)
        p['l_arm'] = ([-20.0, -34.0, 8.0][min(f, 2)], 65.0, 38.0)
        p['r_arm'] = ([-20.0, -34.0, 8.0][min(f, 2)], 65.0, 38.0)
        p['air'] = f == 1
        return p

    if name == 'deflect':
        rec = [1.0, 0.65, 0.3][min(f, 2)]
        p['pitch'] = -16.0 * rec
        p['sho_yaw'] = 20.0 * rec
        p['l_leg'] = (14.0, 26.0, -8.0)
        p['r_leg'] = (-10.0, 24.0, 8.0)
        p['l_arm'] = (30.0, 96.0, 22.0)
        p['r_arm'] = (26.0, 96.0, 22.0)
        return p

    if name == 'gk-dive':
        ext = [0.60, 1.0, 0.85][min(f, 2)]
        p['gloves'] = True
        p['air'] = True
        p['pelvis_z'] = 0.68
        p['pitch'] = 76.0 * ext
        p['l_leg'] = (-18.0 * ext, 18.0, -8.0)
        p['r_leg'] = (-10.0 * ext, 26.0, 8.0)
        # 96° = 수평 앞으로 쭉 뻗은 슈퍼맨 다이빙 팔
        p['l_arm'] = (98.0 * ext, 10.0, 10.0)
        p['r_arm'] = (102.0 * ext, 10.0, 10.0)
        return p

    if name == 'gk-claim':
        p['gloves'] = True
        reach = [0.5, 1.0, 0.65][min(f, 2)]
        p['pitch'] = 10.0
        p['l_leg'] = (8.0, 20.0, -8.0)
        p['r_leg'] = (-6.0, 20.0, 8.0)
        p['l_arm'] = (52.0 + 42.0 * reach, 26.0 if f < 2 else 74.0, 14.0 if f < 2 else 6.0)
        p['r_arm'] = (52.0 + 42.0 * reach, 26.0 if f < 2 else 74.0, 14.0 if f < 2 else 6.0)
        return p

    return p


def build_primitives(name, f, total, yaw_rad):
    """3D 관절을 조합해 깊이 정렬 가능한 도형(캡슐·구) 목록을 생성한다."""
    p = pose_params(name, f, total)
    pelvis = (0.0, 0.0, p['pelvis_z'])
    pitch = deg(p['pitch'])
    hip_yaw = deg(p['hip_yaw'])
    sho_yaw = deg(p['sho_yaw'])

    def body_pt(local, twist=0.0):
        v = rot_z(local, twist)
        v = rot_y(v, pitch)
        return add3(pelvis, v)

    hip_l = body_pt((0.0, -0.115, 0.0), hip_yaw)
    hip_r = body_pt((0.0, 0.115, 0.0), hip_yaw)
    waist = body_pt((0.0, 0.0, 0.14), hip_yaw * 0.4)
    chest = body_pt((0.02, 0.0, 0.40), sho_yaw * 0.7)
    neck = body_pt((0.03, 0.0, 0.51), sho_yaw * 0.8)
    head = body_pt((0.05 + math.sin(deg(p['head_pitch'])) * 0.05, 0.0, 0.67), sho_yaw * 0.5)
    sho_l = body_pt((0.01, -0.225, 0.43), sho_yaw)
    sho_r = body_pt((0.01, 0.225, 0.43), sho_yaw)

    l_h, l_k, l_a, l_t = leg_chain(hip_l, *p['l_leg'])
    r_h, r_k, r_a, r_t = leg_chain(hip_r, *p['r_leg'])
    # 다이빙 시 다리도 몸통 기울기를 따라 뻗게 보정
    if name == 'gk-dive':
        d_ang = deg(p['pitch'] * 0.72)
        l_k = add3(hip_l, rot_y((l_k[0] - hip_l[0], l_k[1] - hip_l[1], l_k[2] - hip_l[2]), d_ang))
        l_a = add3(hip_l, rot_y((l_a[0] - hip_l[0], l_a[1] - hip_l[1], l_a[2] - hip_l[2]), d_ang))
        l_t = add3(hip_l, rot_y((l_t[0] - hip_l[0], l_t[1] - hip_l[1], l_t[2] - hip_l[2]), d_ang))
        r_k = add3(hip_r, rot_y((r_k[0] - hip_r[0], r_k[1] - hip_r[1], r_k[2] - hip_r[2]), d_ang))
        r_a = add3(hip_r, rot_y((r_a[0] - hip_r[0], r_a[1] - hip_r[1], r_a[2] - hip_r[2]), d_ang))
        r_t = add3(hip_r, rot_y((r_t[0] - hip_r[0], r_t[1] - hip_r[1], r_t[2] - hip_r[2]), d_ang))

    l_s, l_e, l_ha = arm_chain(sho_l, -1, *p['l_arm'])
    r_s, r_e, r_ha = arm_chain(sho_r, 1, *p['r_arm'])

    # 모든 점을 캐릭터 yaw 로 회전하고 최저 발끝이 z = ground_z 에 닿게 정렬
    pts_all = [pelvis, hip_l, hip_r, waist, chest, neck, head, sho_l, sho_r,
               l_k, l_a, l_t, r_k, r_a, r_t, l_e, l_ha, r_e, r_ha]
    min_z = min(pt[2] for pt in pts_all)
    z_shift = (0.24 if p['air'] else p['ground_z']) - min_z + 0.055

    def xf(pt):
        r = rot_z((pt[0], pt[1], pt[2] + z_shift), yaw_rad)
        return r

    prims = []  # (kind, layer, a, b, rad, hi_col, sh_col, rim)

    def cap(layer, a, b, rad, hi, sh, rim=True):
        prims.append(('cap', layer, xf(a), xf(b), rad, hi, sh, rim))

    def sph(layer, c, rad, hi, sh, rim=True):
        prims.append(('sph', layer, xf(c), xf(c), rad, hi, sh, rim))

    # 다리 (반바지 → 맨허벅지/무릎 → 높은 양말 + 팀 색 띠 → 흰 축구화)
    for hh, kk, aa, tt in ((l_h, l_k, l_a, l_t), (r_h, r_k, r_a, r_t)):
        short_end = lerp3(hh, kk, 0.62)
        sock_top = lerp3(kk, aa, 0.24)
        sock_band = lerp3(kk, aa, 0.36)
        cap(1, hh, short_end, 0.115, SHORTS_HI, SHORTS_SH)
        cap(0, lerp3(hh, short_end, 0.25), short_end, 0.048, KIT_TRIM, KIT_SH, False)
        cap(1, short_end, sock_top, 0.078, SKIN_HI, SKIN_SH)
        cap(1, sock_top, aa, 0.072, SOCK_HI, SOCK_SH)
        cap(0, sock_top, sock_band, 0.075, KIT_TRIM, KIT_MID, False)
        cap(1, aa, tt, 0.068, BOOT_HI, BOOT_SH)

    # 골반(반바지 허리) & 매끈한 역삼각형 상체 유니폼 (내부 가로줄 제거)
    cap(1, hip_l, hip_r, 0.115, SHORTS_HI, SHORTS_SH, False)
    cap(0, pelvis, chest, 0.168, KIT_HI, KIT_SH, False)
    cap(0, waist, chest, 0.180, KIT_HI, KIT_SH, False)
    cap(0, sho_l, sho_r, 0.128, KIT_HI, KIT_SH, False)
    cap(0, lerp3(chest, sho_l, 0.6), lerp3(chest, sho_r, 0.6), 0.150, KIT_HI, KIT_MID, False)
    # 셔츠 목선(흰 칼라 포인트)
    sph(1, lerp3(chest, neck, 0.65), 0.092, BOOT_HI, BOOT_SH, False)

    # 팔 (반팔 소매 → 맨팔 → 손/골키퍼 장갑)
    hand_hi, hand_sh = (GLOVE_HI, GLOVE_SH) if p['gloves'] else (SKIN_HI, SKIN_SH)
    hand_r = 0.076 if p['gloves'] else 0.056
    for ss, ee, ha in ((l_s, l_e, l_ha), (r_s, r_e, r_ha)):
        slv = lerp3(ss, ee, 0.56)
        cap(0, ss, slv, 0.088, KIT_HI, KIT_SH)
        cap(1, slv, ee, 0.064, SKIN_HI, SKIN_SH)
        cap(1, ee, ha, 0.056, SKIN_HI, SKIN_SH)
        sph(1, ha, hand_r, hand_hi, hand_sh)

    # 목·얼굴·머리카락 + 정면/측면 시선 눈 표현
    cap(1, neck, head, 0.072, SKIN_SH, SKIN_SH, False)
    sph(1, head, 0.156, SKIN_HI, SKIN_SH)
    for ey in (-0.048, 0.048):
        eye_pt = add3(head, (0.145, ey, -0.01))
        sph(1, eye_pt, 0.022, INK, INK, False)
    hair_back = add3(head, (-0.050, 0.0, 0.032))
    hair_top = add3(head, (-0.015, 0.0, 0.068))
    sph(1, hair_back, 0.150, HAIR_HI, HAIR_SH, False)
    sph(1, hair_top, 0.136, HAIR_HI, HAIR_SH, False)

    return prims


def proj(pt):
    cx = SIZE * 0.5
    fy = SIZE * FOOT_Y
    sx = cx + pt[0] * SCALE
    sy = fy + pt[1] * SIN_E * SCALE - pt[2] * COS_E * SCALE
    depth = pt[1] * COS_E + pt[2] * SIN_E
    return sx, sy, depth


def draw_prim(l0, l1, kind, layer, a, b, rad, hi, sh, rim=True):
    """3D 프리미티브 하나를 2톤 셀 셰이딩으로 그리고 레이어 간 3D 가림을 보존한다."""
    ax, ay, _ = proj(a)
    bx, by, _ = proj(b)
    r = max(2.0, rad * SCALE)
    target = l0 if layer == 0 else l1
    other = l1 if layer == 0 else None
    d = ImageDraw.Draw(target)
    do = ImageDraw.Draw(other) if other else None

    def paint_shape(draw_obj, col, ox=0.0, oy=0.0, shrink=0.0):
        rr = max(1.0, r - shrink)
        if kind == 'sph' or (abs(ax - bx) < 0.5 and abs(ay - by) < 0.5):
            draw_obj.ellipse([ax + ox - rr, ay + oy - rr, ax + ox + rr, ay + oy + rr], fill=col)
        else:
            draw_obj.line([(ax + ox, ay + oy), (bx + ox, by + oy)], fill=col, width=int(round(rr * 2)))
            draw_obj.ellipse([ax + ox - rr, ay + oy - rr, ax + ox + rr, ay + oy + rr], fill=col)
            draw_obj.ellipse([bx + ox - rr, by + oy - rr, bx + ox + rr, by + oy + rr], fill=col)

    # 레이어 0(유니폼)이 앞쪽에 그려질 때 뒤쪽 레이어 1(팔·다리)을 지워 3D 가림을 완벽히 유지
    if do is not None:
        paint_shape(do, (0, 0, 0, 0))

    if rim:
        paint_shape(d, INNER_INK, 0.0, 0.0, -1.6)
    paint_shape(d, sh, 0.0, 0.0, 0.0)
    paint_shape(d, hi, -r * 0.16, -r * 0.18, r * 0.18)


def render_pose(name, f, total, yaw_deg):
    """(유니폼 회색조 CELL×CELL, 디테일+외곽선 CELL×CELL) 한 쌍을 생성한다."""
    l0 = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    l1 = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    prims = build_primitives(name, f, total, deg(yaw_deg))
    prims.sort(key=lambda it: (proj(it[2])[2] + proj(it[3])[2]) * 0.5)
    for it in prims:
        draw_prim(l0, l1, *it)

    # 전체 실루엣 바깥쪽에 선명한 다크 잉크 외곽선 합성 (배경 잔디 대비 극대화)
    alpha = ImageChops.lighter(l0.split()[3], l1.split()[3])
    dilated = alpha.filter(ImageFilter.MaxFilter(9))
    ring_a = ImageChops.subtract(dilated, alpha)
    outline = Image.new('RGBA', (SIZE, SIZE), INK)
    outline.putalpha(ring_a)
    l1 = Image.alpha_composite(outline, l1)

    return (
        l0.resize((CELL, CELL), Image.LANCZOS),
        l1.resize((CELL, CELL), Image.LANCZOS),
    )
