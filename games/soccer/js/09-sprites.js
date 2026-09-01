'use strict';
// 09-sprites.js — 선수 스프라이트 시트 로드·틴트, 포즈 판정과 프레임 선택
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — 10-draw.js 가 이 파일의 함수를 쓰므로 앞에 온다.
//
// 시트는 tools/sprite-gen.py 가
// 만든다. **시트를 다시 만들면 SPRITE_V 가 자동으로 갱신되고, 그러면
// js/ 해시가 바뀌므로 `node tools/soccer-sim.js --restamp` 를 돌려야 한다.**

const SPRITE_V = '43b4b19e';        // sprite-gen.py 가 덮어쓴다. 손대지 않는다
const SPRITE_CELL = 64;
// 셀 대비 몸(어깨) 지름. 그리기 크기를 몸 기준으로 맞추는 데 쓴다 —
// 셀 기준으로 맞추면 팔다리 여백까지 세어 선수가 작아 보인다.
// **sprite-gen.py 가 덮어쓴다.** STYLE 이나 ART 를 바꾸면 값이 달라지므로
// 손으로 맞추지 않는다.
const SPRITE_BODY = 0.2255;
// 그린 선수를 물리 반지름보다 얼마나 크게 보일지. 1.0 이면 몸 지름이
// 정확히 2·R_PLAYER(0.6m)인데, 그 크기로는 톱다운에서 잘 안 읽힌다 —
// 예전 원은 단색 덩어리라 버텼지만 스프라이트는 머리·팔·발로 쪼개져
// 색 면적이 작다. **그리기에만 곱한다. 접촉 반경·물리는 그대로다.**
const SPRITE_GAIN = 1.35;

// 시트에서의 시작 칸과 장수. sprite-gen.py 의 SHEET 와 같아야 한다.
const POSES = {
  idle:[0, 1], walk:[1, 2], run:[3, 2], kick:[5, 1], shoot:[6, 1],
  charge:[7, 1], tackle:[8, 1], block:[9, 1], header:[10, 1],
  deflect:[11, 1], 'gk-dive':[12, 1], 'gk-claim':[13, 1],
  'gk-punt':[14, 1]
};
const DIRECTION_POSES = {e:[15, 2], se:[17, 2], s:[19, 2], sw:[21, 2], w:[23, 2], nw:[25, 2], n:[27, 2], ne:[29, 2]};
const ACTION_DIRECTION_POSES = {
  kick:{e:[31, 3], se:[34, 3], s:[37, 3], sw:[40, 3], w:[43, 3], nw:[46, 3], n:[49, 3], ne:[52, 3]},
  shoot:{e:[55, 3], se:[58, 3], s:[61, 3], sw:[64, 3], w:[67, 3], nw:[70, 3], n:[73, 3], ne:[76, 3]},
  charge:{e:[79, 3], se:[82, 3], s:[85, 3], sw:[88, 3], w:[91, 3], nw:[94, 3], n:[97, 3], ne:[100, 3]},
  tackle:{e:[103, 3], se:[106, 3], s:[109, 3], sw:[112, 3], w:[115, 3], nw:[118, 3], n:[121, 3], ne:[124, 3]},
  block:{e:[127, 3], se:[130, 3], s:[133, 3], sw:[136, 3], w:[139, 3], nw:[142, 3], n:[145, 3], ne:[148, 3]},
  header:{e:[151, 3], se:[154, 3], s:[157, 3], sw:[160, 3], w:[163, 3], nw:[166, 3], n:[169, 3], ne:[172, 3]},
  deflect:{e:[175, 3], se:[178, 3], s:[181, 3], sw:[184, 3], w:[187, 3], nw:[190, 3], n:[193, 3], ne:[196, 3]},
  'gk-dive':{e:[199, 3], se:[202, 3], s:[205, 3], sw:[208, 3], w:[211, 3], nw:[214, 3], n:[217, 3], ne:[220, 3]},
  'gk-claim':{e:[223, 3], se:[226, 3], s:[229, 3], sw:[232, 3], w:[235, 3], nw:[238, 3], n:[241, 3], ne:[244, 3]},
  'gk-punt':{e:[247, 3], se:[250, 3], s:[253, 3], sw:[256, 3], w:[259, 3], nw:[262, 3], n:[265, 3], ne:[268, 3]}
};
const DIRECTION_ORDER = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

// 원샷 동작의 재생 길이(초). **쿨다운과 다르다.** headCd 0.6 은 연속
// 헤딩을 막는 게임 규칙이지 동작 길이가 아니다. 쿨다운으로 프레임을
// 고르면 킥 자세로 0.3초를 굳어 있게 된다.
const POSE_DUR = {
  kick:0.26, shoot:0.30, header:0.28, deflect:0.15,
  'gk-dive':0.34, 'gk-punt':0.30
};

// 이동 루프 한 장이 넘어가는 데 걸리는 **이동 거리**(논리 단위).
// 시간으로 넘기면 느리게 걸을 때 발이 땅에서 미끄러진다.
// 포즈마다 다르다 — 걷기는 4장이라 한 걸음이 0.35m, 달리기는 좌우 반전
// 2장이라 한 장이 반 주기(1.1m)를 맡는다. 하나로 묶으면 달리기가
// 미친 듯이 깜빡인다.
const POSE_STRIDE = { walk:7, run:22 };

// poseT 가 아니라 **게임 쪽 타이머**로 도는 포즈. 태클·블록은 원샷이
// 아니라 지속 상태라 poseT 를 쓰지 않는다. 이걸 빠뜨렸더니 두 포즈가
// 프레임 0 에 굳어 17·18·20번 칸이 한 번도 안 그려졌다.
const POSE_TIMER = { tackle:['tackleT', TACKLE_T], block:['blockT', BLOCK_T] };

// 틴트한 시트를 색마다 하나씩 굽는다. 매 프레임 22명을 합성하면 비싸다.
const spriteSheets = {};
let spriteReady = false;

function tintSheet(img, colour) {
  const w = img.width, h = SPRITE_CELL;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  // 0줄(유니폼)은 **회색조**다. multiply 로 팀 색을 곱해야 일러스트의
  // 접힘과 그림자가 살아남는다. source-in 으로 단색을 부으면 평면이 된다.
  // 손으로 그린 포즈는 순백이라 곱해도 팀 색 그대로다 — 둘 다 맞는다.
  c.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = colour;
  c.fillRect(0, 0, w, h);
  // multiply 는 투명한 곳까지 칠한다. 알파를 원본으로 되돌린다.
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  // 1줄(머리·팔·다리·축구화)은 팀 색과 무관하므로 그대로 얹는다.
  c.globalCompositeOperation = 'source-over';
  c.drawImage(img, 0, h, w, h, 0, 0, w, h);
  return cv;
}

(function loadSprites() {
  // 시뮬레이터는 그리지 않으므로 Image 도 캔버스도 없다. 여기서 빠져나가면
  // spriteReady 가 false 로 남고 그리기 경로는 아예 타지 않는다.
  if (typeof Image === 'undefined' || typeof document === 'undefined') return;
  const img = new Image();
  img.onload = function () {
    for (const key of ['home', 'away', 'gkHome', 'gkAway']) {
      spriteSheets[key] = tintSheet(img, C[key]);
    }
    spriteReady = true;
  };
  // 못 받아도 게임은 돌아야 한다 — 10-draw.js 가 원으로 되돌아간다.
  img.onerror = function () { spriteReady = false; };
  img.src = 'assets/players.png?v=' + SPRITE_V;
})();

// 원샷 동작을 건다. 같은 동작이 겹치면 처음부터 다시 재생한다.
function setPose(p, name) {
  p.pose = name;
  p.poseT = POSE_DUR[name] || 0.2;
}

// 흩어진 플래그를 한 포즈로 접는다. **그리기 전용이다** — 물리·AI 는
// 이 함수도 poseT 도 읽지 않는다. 읽으면 프레임률이 경기 결과를 바꾼다.
function playerPose(p) {
  if (p.poseT > 0) return p.pose;
  if (p.isGK && p.gkClaim) return 'gk-claim';
  if (p.tackleT > 0) return 'tackle';
  if (p.blockT > 0) return 'block';
  if (p.shootHeld) return 'charge';
  const sp = Math.hypot(p.vx, p.vy);
  if (sp < SPEED_WALK * 0.45) return 'idle';
  if (sp < SPEED_JOG * 1.05) return 'walk';
  return 'run';
}

// 진행도 0~1 을 프레임 번호로.
function frameAt(col, n, t) {
  return col + Math.max(0, Math.min(n - 1, Math.floor(t * n)));
}

// 포즈 이름 → 시트에서의 칸 번호.
//
// **장수가 2 이상인 포즈는 반드시 진행도를 낼 근거가 있어야 한다.**
// 없으면 프레임 0 에 굳는다. 셀프테스트의 poseFramesReachable 이 검사한다.
function poseFrame(p, name) {
  const slot = POSES[name] || POSES.idle;
  const col = slot[0], n = slot[1];
  if (n === 1) return col;
  if (POSE_STRIDE[name]) {
    const i = Math.floor(p.stride / POSE_STRIDE[name]) % n;
    return col + (i < 0 ? i + n : i);
  }
  const dur = POSE_DUR[name];
  if (dur) return frameAt(col, n, 1 - p.poseT / dur);      // 원샷
  const timer = POSE_TIMER[name];
  if (timer) return frameAt(col, n, 1 - p[timer[0]] / timer[1]);
  if (name === 'gk-claim') {
    // 하이볼은 타이머가 없다. 공이 가까울수록 더 뻗은 자세를 쓴다.
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

function playerDirection(p) {
  let angle = Math.atan2(p.aimY, p.aimX);
  if (angle < 0) angle += Math.PI * 2;
  const i = Math.round(angle / (Math.PI / 4)) % DIRECTION_ORDER.length;
  return DIRECTION_ORDER[i];
}

function directionFrame(p, pose, slot) {
  if (pose === 'idle' || slot[1] === 1) return slot[0];
  const step = POSE_STRIDE[pose] || POSE_STRIDE.run;
  const i = Math.floor(Math.abs(p.stride) / step) % slot[1];
  return slot[0] + i;
}

function actionDirectionFrame(p, pose, slot) {
  const timer = POSE_TIMER[pose];
  if (pose === 'charge') {
    return frameAt(slot[0], slot[1], p.shootCharge || 0);
  }
  if (timer) {
    return frameAt(slot[0], slot[1], 1 - p[timer[0]] / timer[1]);
  }
  if (pose === 'gk-claim') {
    const d = Math.hypot(ball.x - p.x, ball.y - p.y);
    return frameAt(slot[0], slot[1], 1 - Math.min(1, d / (p.reach * 2.5)));
  }
  const dur = POSE_DUR[pose];
  if (dur) return frameAt(slot[0], slot[1], 1 - p.poseT / dur);
  return slot[0];
}

// 선수 한 명. 못 그리면 false 를 돌려 호출한 쪽이 원으로 되돌아간다.
//
// 필드 좌표계에서 그린다 — 세로 화면에서는 경기장 변환이 이미 90° 돌아
// 있으므로 선수도 경기장과 함께 돈다. 등번호처럼 세우면 안 된다.
// 방향은 이동 방향이 아니라 **조준 방향**이다. 둘이 다를 수 있고
// (뒷걸음질) 그때는 걸음이 뒤로 간다 (advancePose 의 back).
function drawPlayerSprite(p, r) {
  const sheet = spriteReady ? spriteSheetFor(p) : null;
  if (!sheet) return false;
  const pose = playerPose(p);
  const directional = pose === 'idle' || pose === 'walk' || pose === 'run';
  const direction = playerDirection(p);
  const movementSlot = directional ? DIRECTION_POSES[direction] : null;
  const actionSlot = directional ? null
    : (ACTION_DIRECTION_POSES[pose] && ACTION_DIRECTION_POSES[pose][direction]);
  const slot = movementSlot || actionSlot;
  const col = movementSlot ? directionFrame(p, pose, movementSlot)
    : actionSlot ? actionDirectionFrame(p, pose, actionSlot)
    : poseFrame(p, pose);
  const oriented = !!slot;
  // 그리기 크기는 셀이 아니라 **몸 지름** 기준이다. 셀로 맞추면 팔다리
  // 여백까지 세어 선수가 원보다 작아 보인다.
  const s = 2 * r * SPRITE_GAIN / SPRITE_BODY;
  const point = projectWorld(p.x, p.y);
  const scale = projectScaleAt(p.y);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(oriented
    ? (view.rot ? -Math.PI / 2 : 0)
    : Math.atan2(p.aimY, p.aimX) + (view.rot ? -Math.PI / 2 : 0));
  ctx.drawImage(sheet, col * SPRITE_CELL, 0, SPRITE_CELL, SPRITE_CELL,
    -s * scale / 2, -s * scale / 2, s * scale, s * scale);
  ctx.restore();
  return true;
}
