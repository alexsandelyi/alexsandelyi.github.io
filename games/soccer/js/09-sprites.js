'use strict';
// 09-sprites.js — 2D 멀티행 선수 스프라이트 아틀라스 로드·틴트, 포즈·방향 선택, 발 앵커 그리기
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — 10-draw.js 가 이 파일의 함수를 쓰므로 앞에 온다.
//
// 시트는 tools/sprite-gen.py 가 만든다. 시트를 다시 만들면 SPRITE_V 가
// 자동으로 갱신되므로 반드시 `node tools/soccer-sim.js --restamp` 를 이어서 돌린다.

const SPRITE_V = '65d6ee4d';        // sprite-gen.py 가 덮어쓴다
const SPRITE_CELL = 96;             // sprite-gen.py 가 덮어쓴다
const SPRITE_COLS = 24;             // sprite-gen.py 가 덮어쓴다
const SPRITE_ROWS = 15;             // sprite-gen.py 가 덮어쓴다
const SPRITE_FOOT_Y = 0.87;         // 셀 높이 대비 발바닥 앵커 위치
const SPRITE_BODY = 0.2652;          // sprite-gen.py 가 덮어쓴다
// 그리기 전용 배율. 논리 충돌 반경(R_PLAYER=6)에는 영향을 주지 않는다.
const SPRITE_GAIN = 1.12;

// 시트에서의 시작 칸과 장수. sprite-gen.py 의 SHEET 와 같아야 한다.
const POSES = {
  idle:[0, 1], walk:[1, 2], run:[3, 2], kick:[5, 1], shoot:[6, 1],
  charge:[7, 1], tackle:[8, 1], block:[9, 1], header:[10, 1],
  deflect:[11, 1], 'gk-dive':[12, 1], 'gk-claim':[13, 1],
  'gk-punt':[14, 1]
};
const DIRECTION_POSES = {e:[15, 6], se:[21, 6], s:[27, 6], sw:[33, 6], w:[39, 6], nw:[45, 6], n:[51, 6], ne:[57, 6]};
const IDLE_DIRECTION_POSES = {e:[303, 1], se:[304, 1], s:[305, 1], sw:[306, 1], w:[307, 1], nw:[308, 1], n:[309, 1], ne:[310, 1]};
const WALK_DIRECTION_POSES = {e:[311, 4], se:[315, 4], s:[319, 4], sw:[323, 4], w:[327, 4], nw:[331, 4], n:[335, 4], ne:[339, 4]};
const ACTION_DIRECTION_POSES = {
  kick:{e:[63, 3], se:[66, 3], s:[69, 3], sw:[72, 3], w:[75, 3], nw:[78, 3], n:[81, 3], ne:[84, 3]},
  shoot:{e:[87, 3], se:[90, 3], s:[93, 3], sw:[96, 3], w:[99, 3], nw:[102, 3], n:[105, 3], ne:[108, 3]},
  charge:{e:[111, 3], se:[114, 3], s:[117, 3], sw:[120, 3], w:[123, 3], nw:[126, 3], n:[129, 3], ne:[132, 3]},
  tackle:{e:[135, 3], se:[138, 3], s:[141, 3], sw:[144, 3], w:[147, 3], nw:[150, 3], n:[153, 3], ne:[156, 3]},
  block:{e:[159, 3], se:[162, 3], s:[165, 3], sw:[168, 3], w:[171, 3], nw:[174, 3], n:[177, 3], ne:[180, 3]},
  header:{e:[183, 3], se:[186, 3], s:[189, 3], sw:[192, 3], w:[195, 3], nw:[198, 3], n:[201, 3], ne:[204, 3]},
  deflect:{e:[207, 3], se:[210, 3], s:[213, 3], sw:[216, 3], w:[219, 3], nw:[222, 3], n:[225, 3], ne:[228, 3]},
  'gk-dive':{e:[231, 3], se:[234, 3], s:[237, 3], sw:[240, 3], w:[243, 3], nw:[246, 3], n:[249, 3], ne:[252, 3]},
  'gk-claim':{e:[255, 3], se:[258, 3], s:[261, 3], sw:[264, 3], w:[267, 3], nw:[270, 3], n:[273, 3], ne:[276, 3]},
  'gk-punt':{e:[279, 3], se:[282, 3], s:[285, 3], sw:[288, 3], w:[291, 3], nw:[294, 3], n:[297, 3], ne:[300, 3]}
};
const DIRECTION_ORDER = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

const POSE_DUR = {
  kick:0.26, shoot:0.30, header:0.30, deflect:0.16,
  'gk-dive':0.36, 'gk-punt':0.30
};
const POSE_STRIDE = { walk:8, run:9 };
const POSE_TIMER = { tackle:['tackleT', TACKLE_T], block:['blockT', BLOCK_T] };

const spriteSheets = {};
let spriteReady = false;

function tintSheet(img, colour) {
  const w = SPRITE_COLS * SPRITE_CELL;
  const h = SPRITE_ROWS * SPRITE_CELL;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  // 상단 절반(0..h)은 유니폼 회색조, 하단 절반(h..2h)은 피부·머리·바지·축구화.
  c.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = colour;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
  c.drawImage(img, 0, h, w, h, 0, 0, w, h);
  return cv;
}

(function loadSprites() {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return;
  const img = new Image();
  img.onload = function () {
    for (const key of ['home', 'away', 'gkHome', 'gkAway']) {
      spriteSheets[key] = tintSheet(img, C[key]);
    }
    spriteReady = true;
  };
  img.onerror = function () { spriteReady = false; };
  img.src = 'assets/players.png?v=' + SPRITE_V;
})();

function setPose(p, name) {
  p.pose = name;
  p.poseT = POSE_DUR[name] || 0.2;
}

function playerPose(p) {
  if (p.poseT > 0) return p.pose;
  if (p.isGK && (p.gkClaim || p.gkHoldT > 0)) return 'gk-claim';
  if (p.tackleT > 0) return 'tackle';
  if (p.blockT > 0) return 'block';
  if (p.shootHeld) return 'charge';
  const sp = Math.hypot(p.vx, p.vy);
  if (sp < SPEED_WALK * 0.45) return 'idle';
  if (sp < SPEED_JOG * 1.05) return 'walk';
  return 'run';
}

function frameAt(col, n, t) {
  return col + Math.max(0, Math.min(n - 1, Math.floor(t * n)));
}

function poseFrame(p, name) {
  const slot = POSES[name] || POSES.idle;
  const col = slot[0], n = slot[1];
  if (n === 1) return col;
  if (POSE_STRIDE[name]) {
    const i = Math.floor(p.stride / POSE_STRIDE[name]) % n;
    return col + (i < 0 ? i + n : i);
  }
  const dur = POSE_DUR[name];
  if (dur) return frameAt(col, n, 1 - p.poseT / dur);
  const timer = POSE_TIMER[name];
  if (timer) return frameAt(col, n, 1 - p[timer[0]] / timer[1]);
  if (name === 'gk-claim') {
    const d = Math.hypot(ball.x - p.x, ball.y - p.y);
    return frameAt(col, n, 1 - Math.min(1, d / (p.reach * 2.5)));
  }
  return col;
}

function spriteSheetFor(p) {
  const key = p.side === 0
    ? (p.isGK ? 'gkHome' : 'home')
    : (p.isGK ? 'gkAway' : 'away');
  return spriteSheets[key];
}

// 화면 기준 8방향 선택: 세로 화면(view.rot)에서도 선수가 눕지 않고 똑바로 서서 달린다.
function playerDirection(p) {
  const sx = view.rot ? p.aimY : p.aimX;
  const sy = view.rot ? -p.aimX : p.aimY;
  let angle = Math.atan2(sy, sx);
  if (angle < 0) angle += Math.PI * 2;
  const i = Math.round(angle / (Math.PI / 4)) % DIRECTION_ORDER.length;
  return DIRECTION_ORDER[i];
}

function directionFrame(p, pose, slot) {
  if (pose === 'idle' || slot[1] === 1) return slot[0];
  const step = POSE_STRIDE[pose] || POSE_STRIDE.run;
  const n = slot[1];
  const i = Math.floor(p.stride / step) % n;
  return slot[0] + (i < 0 ? i + n : i);
}

function actionDirectionFrame(p, pose, slot) {
  const timer = POSE_TIMER[pose];
  if (pose === 'charge') return frameAt(slot[0], slot[1], p.shootCharge || 0);
  if (timer) return frameAt(slot[0], slot[1], 1 - p[timer[0]] / timer[1]);
  if (pose === 'gk-claim') {
    if (p.gkHoldT > 0) return slot[0] + slot[1] - 1;
    const d = Math.hypot(ball.x - p.x, ball.y - p.y);
    return frameAt(slot[0], slot[1], 1 - Math.min(1, d / (p.reach * 2.5)));
  }
  const dur = POSE_DUR[pose];
  if (dur) return frameAt(slot[0], slot[1], 1 - p.poseT / dur);
  return slot[0];
}

// 발바닥 앵커(SPRITE_FOOT_Y)로 선수를 그린다. 반환값: 화면 그리기 크기(실패 시 0).
function drawPlayerSprite(p, r) {
  const sheet = spriteReady ? spriteSheetFor(p) : null;
  if (!sheet) return 0;
  const pose = playerPose(p);
  const direction = playerDirection(p);
  const movementSlot = pose === 'idle' ? IDLE_DIRECTION_POSES[direction]
    : pose === 'walk' ? WALK_DIRECTION_POSES[direction]
    : pose === 'run' ? DIRECTION_POSES[direction] : null;
  const actionSlot = movementSlot ? null
    : (ACTION_DIRECTION_POSES[pose] && ACTION_DIRECTION_POSES[pose][direction]);
  const col = movementSlot ? directionFrame(p, pose, movementSlot)
    : actionSlot ? actionDirectionFrame(p, pose, actionSlot)
    : poseFrame(p, pose);

  const scale = projectScale(p.x, p.y);
  const drawS = (2 * r * SPRITE_GAIN / SPRITE_BODY) * scale;
  const point = projectWorld(p.x, p.y);

  // 헤딩 점프 리프트(달리기 바운스는 6프레임 3D 리깅에 이미 포함)
  let liftPx = 0;
  if (pose === 'header' && p.poseT > 0) {
    const prog = 1 - p.poseT / (POSE_DUR.header || 0.3);
    liftPx = Math.sin(Math.max(0, Math.min(1, prog)) * Math.PI) * 14 * scale;
  }

  const sx = (col % SPRITE_COLS) * SPRITE_CELL;
  const sy = Math.floor(col / SPRITE_COLS) * SPRITE_CELL;
  ctx.drawImage(sheet, sx, sy, SPRITE_CELL, SPRITE_CELL,
    point.x - drawS * 0.5, point.y - drawS * SPRITE_FOOT_Y - liftPx,
    drawS, drawS);
  return drawS;
}

function bodyFont() { return getComputedStyle(document.body).fontFamily; }

function drawRadius(physicalRadius, minDiameterPx) {
  return Math.max(physicalRadius,
    minDiameterPx * view.dpr / (2 * Math.max(view.scale, 1e-6)));
}

function drawPlayerGround(p) {
  const isCtrl = p === ctrl[0];
  const r = drawRadius(R_PLAYER, DRAW_PLAYER_MIN_PX);
  const point = projectWorld(p.x, p.y);
  const rp = r * projectScale(p.x, p.y);

  ctx.fillStyle = 'rgba(8,22,12,.34)';
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + rp * 0.08, rp * 1.18, rp * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isCtrl) {
    ctx.save();
    ctx.strokeStyle = 'rgba(247,251,248,.92)';
    ctx.lineWidth = Math.max(2 * view.dpr, rp * 0.16);
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, rp * 1.52, rp * 0.68, 0, 0, Math.PI * 2);
    ctx.stroke();
    const sx = view.rot ? p.aimY : p.aimX;
    const sy = view.rot ? -p.aimX : p.aimY;
    const am = Math.hypot(sx, sy);
    if (am > 0.1) {
      ctx.fillStyle = '#F7C93B';
      ctx.beginPath();
      ctx.arc(point.x + (sx / am) * rp * 2.05, point.y + (sy / am) * rp * 0.96,
        Math.max(2.5 * view.dpr, rp * 0.24), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPlayerBody(p) {
  const isCtrl = p === ctrl[0];
  const base = p.side === 0
    ? (p.isGK ? C.gkHome : C.home)
    : (p.isGK ? C.gkAway : C.away);
  const r = drawRadius(R_PLAYER, DRAW_PLAYER_MIN_PX);
  const point = projectWorld(p.x, p.y);
  const rp = r * projectScale(p.x, p.y);
  const drawS = drawPlayerSprite(p, r);

  if (!drawS) {
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(point.x, point.y - rp * 0.5, rp, 0, Math.PI * 2); ctx.fill();
  }

  const headTop = drawS ? point.y - drawS * 0.84 : point.y - rp * 2.1;
  if (isCtrl) {
    const m = Math.max(4.5 * view.dpr, rp * 0.44);
    ctx.fillStyle = '#F7FBF8';
    ctx.strokeStyle = 'rgba(12,24,16,.75)';
    ctx.lineWidth = 1.4 * view.dpr;
    ctx.beginPath();
    ctx.moveTo(point.x, headTop - 3 * view.dpr);
    ctx.lineTo(point.x - m, headTop - 3 * view.dpr - m * 1.25);
    ctx.lineTo(point.x + m, headTop - 3 * view.dpr - m * 1.25);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  if (p.yellow) {
    ctx.fillStyle = '#F7C93B';
    ctx.strokeStyle = 'rgba(18,22,16,.75)';
    ctx.lineWidth = 1 * view.dpr;
    const cw = Math.max(5 * view.dpr, rp * 0.45), ch = cw * 1.4;
    ctx.fillRect(point.x + rp * 0.7, headTop, cw, ch);
    ctx.strokeRect(point.x + rp * 0.7, headTop, cw, ch);
  }

  ctx.save();
  const fs = Math.max(8 * view.dpr, rp * 0.76);
  ctx.font = '700 ' + fs + 'px ' + bodyFont();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const label = p.isGK ? 'GK' : String(p.no);
  const ly = point.y + rp * 0.56;
  ctx.strokeStyle = 'rgba(10,24,14,.88)';
  ctx.lineWidth = Math.max(2.2, fs * 0.3);
  ctx.lineJoin = 'round';
  ctx.strokeText(label, point.x, ly);
  ctx.fillStyle = isCtrl ? '#F7C93B' : '#F7FBF8';
  ctx.fillText(label, point.x, ly);
  ctx.restore();
}
