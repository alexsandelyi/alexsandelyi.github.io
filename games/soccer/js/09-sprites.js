'use strict';
// 09-sprites.js — 선수 스프라이트 시트 로드·틴트, 포즈 판정과 프레임 선택
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — 10-draw.js 가 이 파일의 함수를 쓰므로 앞에 온다.
//
// 규격은 games/soccer/player-sprites.md. 시트는 tools/sprite-gen.py 가
// 만든다. **시트를 다시 만들면 SPRITE_V 가 자동으로 갱신되고, 그러면
// js/ 해시가 바뀌므로 `node tools/soccer-sim.js --restamp` 를 돌려야 한다.**

const SPRITE_V = '51fdcaac';        // sprite-gen.py 가 덮어쓴다. 손대지 않는다
const SPRITE_CELL = 64;
// 셀 대비 몸(어깨) 지름. 그리기 크기를 몸 기준으로 맞추는 데 쓴다 —
// 셀 기준으로 맞추면 팔다리 여백까지 세어 선수가 작아 보인다.
const SPRITE_BODY = 0.375;

// 시트에서의 시작 칸과 장수. sprite-gen.py 의 SHEET 와 같아야 한다.
const POSES = {
  idle:[0, 1], walk:[1, 4], run:[5, 4], kick:[9, 3], shoot:[12, 3],
  charge:[15, 1], tackle:[16, 3], block:[19, 2], header:[21, 3],
  deflect:[24, 2], 'gk-dive':[26, 3], 'gk-claim':[29, 2], 'gk-punt':[31, 3]
};

// 원샷 동작의 재생 길이(초). **쿨다운과 다르다.** headCd 0.6 은 연속
// 헤딩을 막는 게임 규칙이지 동작 길이가 아니다. 쿨다운으로 프레임을
// 고르면 킥 자세로 0.3초를 굳어 있게 된다.
const POSE_DUR = {
  kick:0.26, shoot:0.30, header:0.28, deflect:0.15,
  'gk-dive':0.34, 'gk-punt':0.30
};

// 이동 루프 한 장이 넘어가는 데 걸리는 이동 거리(논리 단위, 0.35m).
// 시간이 아니라 거리로 넘겨야 발이 미끄러지지 않는다.
const STRIDE = 7;

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
  // 0줄(상의)을 팀 색으로 칠한다. source-in 은 이미 그린 알파만 남긴다.
  c.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = colour;
  c.fillRect(0, 0, w, h);
  // 1줄(머리·팔·발·윤곽)은 그대로 얹는다.
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
  if (name === 'walk' || name === 'run') {
    const i = Math.floor(p.stride / STRIDE) % n;
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

// 선수 한 명. 못 그리면 false 를 돌려 호출한 쪽이 원으로 되돌아간다.
//
// 필드 좌표계에서 그린다 — 세로 화면에서는 경기장 변환이 이미 90° 돌아
// 있으므로 선수도 경기장과 함께 돈다. 등번호처럼 세우면 안 된다.
// 방향은 이동 방향이 아니라 **조준 방향**이다. 둘이 다를 수 있고
// (뒷걸음질) 그때는 걸음이 뒤로 간다 (advancePose 의 back).
function drawPlayerSprite(p, r) {
  const sheet = spriteReady ? spriteSheetFor(p) : null;
  if (!sheet) return false;
  const col = poseFrame(p, playerPose(p));
  // 그리기 크기는 셀이 아니라 **몸 지름** 기준이다. 셀로 맞추면 팔다리
  // 여백까지 세어 선수가 원보다 작아 보인다.
  const s = 2 * r / SPRITE_BODY;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(p.aimY, p.aimX));
  ctx.drawImage(sheet, col * SPRITE_CELL, 0, SPRITE_CELL, SPRITE_CELL,
    -s / 2, -s / 2, s, s);
  ctx.restore();
  return true;
}
