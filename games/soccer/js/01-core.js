// 01-core.js — 경기장·물리 축척 상수, 카메라·화면 변환, 키보드·터치 입력 등록
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

'use strict';

// ═══════════════════════════════════════════════════════════════════
// 동네 축구 11v11 — 톱다운, 카메라 추적
//
// 좌표계: 경기장은 항상 논리 단위(1m = 20단위)로 계산하고, 화면 크기와
// 회전은 그리기·입력 변환 단계에서만 반영한다. 창 크기나 기기 화면비가
// 경기 결과를 바꾸지 않게 하려는 것이다.
//
// 실제 규격(105m x 68m)을 그대로 옮겼다. 페널티박스·골에어리어·센터서클·
// 페널티마크 치수도 실측값이다. 골문만은 예외로 넓혔다 — 실제 7.32m
// (=146단위)로 두면 골키퍼가 있는 상태에서 득점이 거의 불가능하다.
// ═══════════════════════════════════════════════════════════════════

const M = 20;                        // 1미터 = 20 논리단위
const FW = 105 * M, FH = 68 * M;     // 2100 x 1360
const GOAL_H = 146;                  // 7.32m 규정
const PA_D = 16.5 * M, PA_W = 40.3 * M;   // 페널티 에어리어
const GA_D = 5.5 * M,  GA_W = 18.32 * M;  // 골 에어리어
const CIRCLE_R = 9.15 * M;
const PEN_SPOT = 11 * M;

const R_PLAYER = 6, R_BALL = 2.2;    // 물리 반경: 지름 0.6m / 0.22m
let GK_REACH_MUL = 6.0;
// 물리 축척과 화면 가독성을 분리한다. 실제 반경은 충돌에만 쓰고 그리기는
// CSS px 최소 지름을 보장한다. 카메라 줌은 2단계에서 별도로 정한다.
const DRAW_PLAYER_MIN_PX = 18, DRAW_BALL_MIN_PX = 8;
const CAMERA_LANDSCAPE_W = 40 * M, CAMERA_PORTRAIT_W = 26 * M;
const CAMERA_LEAD_MAX = 6 * M;
// Reference-match camera: a mild 3/4 overhead view, about 40 degrees above
// the pitch plane. These values affect drawing only; all game maths stays in
// the 2100 x 1360 logical pitch.
const CAMERA_ELEVATION = 40 * Math.PI / 180;
const CAMERA_DEPTH_SCALE = Math.sin(CAMERA_ELEVATION);
const CAMERA_PERSPECTIVE = 0.14;

let MATCH_SEC = 600;
const GOAL_PAUSE = 1.6;

const C = {
  turf:'#2C7D40', turfAlt:'#338B48', turfOut:'#1D562C',
  line:'rgba(244,250,245,.88)',
  home:'#EB4638', away:'#F7C93B', ball:'#F7F9F8',
  gkHome:'#26D0B8', gkAway:'#A878F5',
  mapBg:'rgba(14,32,22,.84)', mapLine:'rgba(244,250,245,.52)'
};

// AI 난이도. 상대 팀 11명 전체에 적용된다(우리 팀 동료는 항상 '보통' 수준).
// react=목표 재계산 간격, aimErr=공을 향할 때의 조준 오차,
// gk=골키퍼 반응. 물리 속도는 팀 능력치, 행동 시도율은 공통 상수다.
// 값은 결정론적 봇으로 난이도별 200경기 이상 자동 대전해 검증한다.
// 최종 목표 승률 80% / 53% / 23%, 10분 경기 총 2~3골.
//
// 0.84~0.94 상대 속도 배수 스윕을 각 200경기로 측정했을 때 과거 30경기의
// 급변은 재현되지 않았다. 난이도 차이는 react(반응 지연), aimErr(조준
// 오차), gk(골키퍼 위치·다이빙)를 포함한 전체 조합으로 관리하고 단계마다 측정한다.
const LEVELS = [
  { name:'쉬움',  react:0.90, aimErr:280, gk:0.85 },
  { name:'보통',  react:0.28, aimErr:100, gk:1.15 },
  { name:'어려움', react:0.08, aimErr:10,  gk:1.55 }
];
let level = 1;

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ── 화면·카메라 ────────────────────────────────────────────────────
// rot=true(세로 화면)면 경기장을 90° 돌려 세로로 쓴다. 안 돌리면 가로로
// 긴 경기장이 폰 폭에 맞춰져 납작한 띠가 된다.
let view = { scale:1, rot:false, w:0, h:0, dpr:1 };
let cam = { x:FW / 2, y:FH / 2 };

function resize() {
  const stage = document.getElementById('stage');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = stage.clientWidth, h = stage.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const rot = h > w;
  const scale = cameraScale(w, h, rot, dpr);
  view = { rot, scale, w, h, dpr };
}
window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined')
  new ResizeObserver(resize).observe(document.getElementById('stage'));

// 화면에 보이는 경기장 범위(논리단위)
function viewSpan() {
  const s = view.scale;
  const depthScale = CAMERA_DEPTH_SCALE * (1 + CAMERA_PERSPECTIVE * .5);
  return view.rot
    ? { x:canvas.height / (s * depthScale), y:canvas.width / s }
    : { x:canvas.width / s,  y:canvas.height / (s * depthScale) };
}

function cameraScale(w, h, rot, dpr = 1) {
  const primarySpan = rot ? CAMERA_PORTRAIT_W : CAMERA_LANDSCAPE_W;
  const primary = w * dpr / primarySpan;
  const projectedDepth = FH * CAMERA_DEPTH_SCALE * (1 + CAMERA_PERSPECTIVE * .5);
  const secondary = h * dpr / (rot ? FW : projectedDepth);
  return Math.max(primary, secondary);
}

function depthScaleAt(y) {
  return Math.max(.88, Math.min(1.12,
    1 + ((y - FH / 2) / FH) * CAMERA_PERSPECTIVE));
}

function depthFactor(x, y) {
  if (!view.rot) return depthScaleAt(y);
  return Math.max(.90, Math.min(1.10,
    1 + ((cam.x - x) / (CAMERA_PORTRAIT_W * 1.9)) * CAMERA_PERSPECTIVE));
}

// 논리 경기장 좌표 → 물리 캔버스 픽셀. 세로 화면에서도 원근 축소가 위→아래로 대칭 동작한다.
function projectWorld(x, y) {
  const q = depthFactor(x, y);
  let px, py;
  if (view.rot) {
    px = (y - cam.y) * view.scale * q;
    py = -(x - cam.x) * view.scale * CAMERA_DEPTH_SCALE * q;
  } else {
    px = (x - cam.x) * view.scale * q;
    py = (y - cam.y) * view.scale * CAMERA_DEPTH_SCALE * q;
  }
  return { x:canvas.width / 2 + px, y:canvas.height / 2 + py };
}

function projectScaleAt(y) {
  return view.scale * depthScaleAt(y);
}

function projectScale(x, y) {
  return view.scale * depthFactor(x, y);
}

function projectWorld3D(x, y, z = 0) {
  const pt = projectWorld(x, y);
  const scale = projectScale(x, y);
  return { x:pt.x, y:pt.y - z * BALL_LIFT * scale, groundY:pt.y, scale };
}

function updateCamera(dt) {
  const sp = viewSpan();
  const speed = Math.hypot(ball.vx, ball.vy);
  const lead = Math.min(CAMERA_LEAD_MAX, speed * .22);
  const leadX = speed > 1 ? ball.vx / speed * lead : 0;
  const leadY = speed > 1 ? ball.vy / speed * lead : 0;
  const focusX = ball.x + leadX, focusY = ball.y + leadY;
  // 공을 따라가되 경기장 밖이 보이지 않게 가둔다.
  // 보이는 범위가 경기장보다 크면 그 축은 가운데 고정.
  const tx = sp.x >= FW ? FW / 2 : Math.max(sp.x / 2, Math.min(FW - sp.x / 2, focusX));
  const ty = sp.y >= FH ? FH / 2 : Math.max(sp.y / 2, Math.min(FH - sp.y / 2, focusY));
  const k = 1 - Math.exp(-7 * dt);     // 부드럽게 따라감(즉시 스냅은 눈이 피로하다)
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

// 경기장 좌표 → 화면. 회전 시 필드 x=0(우리 골문)이 화면 아래로 온다.
function applyFieldTransform() {
  const s = view.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view.rot) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.transform(0, -s, s, 0, 0, 0);
    // 이 translate 는 회전 '전' 좌표계에 적용되므로 필드 순서(x, y) 그대로다.
    // (y, x) 로 뒤집어 쓰면 카메라가 엉뚱한 곳을 보게 된다.
    ctx.translate(-cam.x, -cam.y);
  } else {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(s, s);
    ctx.translate(-cam.x, -cam.y);
  }
}

// ── 입력 ───────────────────────────────────────────────────────────
const keys = Object.create(null);
const SHOOT_KEYS = { Enter:true, Space:true, KeyJ:true };
const SWITCH_KEYS = { BracketLeft:true, KeyQ:true };
// 킥 충전 시간. shootCharge 와 같은 1.05초를 쓴다.
const KICK_CHARGE_MS = 1050;
const PASS_KEYS = {
  Backslash:[0, 'pass'], KeyK:[0, 'pass'],
  BracketRight:[0, 'through'], KeyL:[0, 'through']
};
const holdStart = Object.create(null);
const holdAim = Object.create(null);
const holdPower = (t0) =>
  Math.max(0, Math.min(1, (performance.now() - t0) / KICK_CHARGE_MS));

function aimBend(ax0, ay0, ax1, ay1) {
  const m0 = Math.hypot(ax0, ay0), m1 = Math.hypot(ax1, ay1);
  if (m0 < 0.1 || m1 < 0.1) return 0;
  const cross = (ax0 * ay1 - ay0 * ax1) / (m0 * m1);
  return Math.max(-1, Math.min(1, cross * 1.45));
}

function humanChargeInfo() {
  const p = ctrl[0];
  if (!p) return null;
  if (p.shootHeld) {
    return {
      kind:'shoot', power:p.shootCharge,
      curve:aimBend(p.chargeAimX, p.chargeAimY, p.aimX, p.aimY)
    };
  }
  for (const code in holdStart) {
    if (holdStart[code] > 0) {
      const pk = PASS_KEYS[code];
      const a0 = holdAim[code] || [p.aimX, p.aimY];
      return {
        kind:pk ? pk[1] : 'pass', power:holdPower(holdStart[code]),
        curve:aimBend(a0[0], a0[1], p.aimX, p.aimY)
      };
    }
  }
  if (passHeld) {
    const held = performance.now() - passHoldTimer;
    return {
      kind:held >= 420 ? 'through' : 'pass',
      power:Math.max(0, Math.min(1, held / KICK_CHARGE_MS)), curve:0
    };
  }
  return null;
}

addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.code] = true;
  // Shift 는 쓰지 않는다 — Windows 고정 키가 5회 연타를 가로채 창을 띄운다.
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',
       'Backslash','BracketRight','BracketLeft','Quote','Semicolon'].includes(e.code))
    e.preventDefault();
  if (SHOOT_KEYS[e.code]) beginAction(0);          // 슛·원터치 (수비 시 태클)
  if (SWITCH_KEYS[e.code]) act(0, 'switch');
  // 패스·로빙은 뗄 때 발사한다. 누른 길이가 세기·거리를 정한다.
  if (PASS_KEYS[e.code]) {
    const pk = PASS_KEYS[e.code];
    const oppOwns = state === 'play' && ball.owner && ball.owner.side !== pk[0];
    if (pk[1] === 'pass' && oppOwns) {
      act(pk[0], 'switch');
    } else {
      const p = ctrl[pk[0]];
      holdStart[e.code] = performance.now();
      holdAim[e.code] = p ? [p.aimX, p.aimY] : [1, 0];
    }
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (SHOOT_KEYS[e.code]) endAction(0);
  const pk = PASS_KEYS[e.code];
  if (pk && holdStart[e.code]) {
    const p = ctrl[pk[0]];
    const a0 = holdAim[e.code] || (p ? [p.aimX, p.aimY] : [1, 0]);
    const curve = p ? aimBend(a0[0], a0[1], p.aimX, p.aimY) : 0;
    act(pk[0], pk[1], holdPower(holdStart[e.code]), curve);
    holdStart[e.code] = 0;
  }
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  for (const k in holdStart) holdStart[k] = 0;
  endAction(0);
});

const touchLayer = document.getElementById('touch');
const stickEl = document.getElementById('stick');
const knobEl = document.getElementById('knob');
const STICK_MAX = 52;
let stick = { active:false, id:null, cx:0, cy:0, dx:0, dy:0 };
const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
if (isTouch) touchLayer.classList.add('on');

touchLayer.addEventListener('pointerdown', e => {
  if (e.target.classList.contains('actbtn')) return;
  if (stick.active) return;
  stick.active = true; stick.id = e.pointerId;
  stick.cx = e.clientX; stick.cy = e.clientY; stick.dx = 0; stick.dy = 0;
  const r = touchLayer.getBoundingClientRect();
  stickEl.style.left = (e.clientX - r.left) + 'px';
  stickEl.style.top = (e.clientY - r.top) + 'px';
  stickEl.classList.add('on');
  knobEl.style.transform = 'translate(0,0)';
  touchLayer.setPointerCapture(e.pointerId);
});
touchLayer.addEventListener('pointermove', e => {
  if (!stick.active || e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.cx, dy = e.clientY - stick.cy;
  const d = Math.hypot(dx, dy);
  if (d > STICK_MAX) { dx = dx / d * STICK_MAX; dy = dy / d * STICK_MAX; }
  stick.dx = dx / STICK_MAX; stick.dy = dy / STICK_MAX;
  knobEl.style.transform = `translate(${dx}px,${dy}px)`;
});
function endStick(e) {
  if (!stick.active || (e && e.pointerId !== stick.id)) return;
  stick.active = false; stick.id = null; stick.dx = stick.dy = 0;
  stickEl.classList.remove('on');
}
touchLayer.addEventListener('pointerup', endStick);
touchLayer.addEventListener('pointercancel', endStick);
const shootBtn = document.getElementById('shoot');
const passBtn = document.getElementById('pass');
shootBtn.addEventListener('pointerdown', e => {
  e.preventDefault(); shootBtn.setPointerCapture(e.pointerId);
  shootBtn.classList.add('held'); beginAction(0);
});
shootBtn.addEventListener('pointerup', e => {
  e.preventDefault(); shootBtn.classList.remove('held'); endAction(0);
});
shootBtn.addEventListener('pointercancel', () => {
  shootBtn.classList.remove('held'); endAction(0);
});
let passHoldTimer = 0, passHeld = false;
passBtn.addEventListener('pointerdown', e => {
  e.preventDefault(); passBtn.setPointerCapture(e.pointerId);
  passBtn.classList.add('held');
  passHoldTimer = performance.now(); passHeld = true;
});
passBtn.addEventListener('pointerup', e => {
  e.preventDefault(); passBtn.classList.remove('held'); passHeld = false;
  const p = ctrl[0];
  const oppOwns = ball.owner && ball.owner.side !== 0;
  const canKick = p && (ball.owner === p || (!oppOwns && Math.hypot(ball.x - p.x, ball.y - p.y) < 180));
  const held = performance.now() - passHoldTimer;
  act(0, canKick ? (held >= 420 ? 'through' : 'pass') : 'switch',
    Math.max(0, Math.min(1, held / KICK_CHARGE_MS)));
});
passBtn.addEventListener('pointercancel', () => {
  passBtn.classList.remove('held'); passHeld = false;
});
