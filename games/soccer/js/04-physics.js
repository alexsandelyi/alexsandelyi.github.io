'use strict';
// 04-physics.js — 물리 상수, 선수 이동·체력, 오프사이드 판정, 아웃오브플레이
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── 물리 ───────────────────────────────────────────────────────────
// 경기장이 1v1 판(1000x620)의 2배 이상이라 속도도 그만큼 올렸다.
const P_ACCEL = 150, P_MAX = 190, P_FRICTION = 4;
// 방향 전환 제동 계수. 시간상수 1/6 = 0.17초 — 어긋난 속도 성분이 그만큼
// 만에 절반 이하로 줄어든다. brakeTurn() 참조.
const P_BRAKE = 6;
const B_MAX = 800;

// 공 감속은 두 항의 합이다 — 잔디 구름 저항(속도 무관 상수) + 공기 저항
// (속도 제곱). 전에는 초당 배율 하나(v 에 비례)로 뭉갰는데, 그러면 빠를
// 때는 맞고 느릴 때 너무 안 멈춰서 공이 20초씩 굴러가는 꼬리가 남았다.
//   지면: a = ROLL_A + AIR_K·v²
//   공중: a = AIR_K·v²          (구름 저항 없음)
// 잔디 구름 저항. 구름저항 계수 Crr 는 잔디 위에서 0.05~0.15 이고
// a = Crr·g 다. 0.6m/s²(Crr 0.061)은 공이 너무 잘 굴러서 0.122 로 올렸다.
const ROLL_A = 1.2 * M;              // 24 단위/s² = 1.2m/s² (Crr 0.122)
// 공기 저항 k = 0.5·ρ·Cd·A/m. 축구공 지름 0.22m·무게 0.43kg·Cd 0.25,
// 공기 밀도 1.225 → 0.01354 /m. 논리단위로는 k/M 이다.
const AIR_K = 0.01354 / M;           // 15m/s 에서 3.05m/s²

// ── 공 높이 (z) ────────────────────────────────────────────────────
// 지면 z=0. 공중에서는 구름저항 대신 공기저항을 쓴다 — 띄운 공이 멀리
// 빠르게 가는 것이 "속도가 조절된다"는 감각의 물리적 근거다.
const GRAVITY = 9.81 * M;            // 196.2 단위/s²
const CROSSBAR = 2.44 * M;           // 48.8 — 규정 크로스바 높이
const BOUNCE_Z = 0.5;                // 잔디 반발. 튈 때마다 높이 절반 이하
const BOUNCE_XY = 0.8;               // 바운스에서 잃는 수평 속도
const GROUND_EPS = 1;                // 0.05m 이하는 지면으로 본다
const BOUNCE_MIN_VZ = 12;            // 이보다 느리면 튀지 않고 붙는다
// 높이 구간 (aerial-play.md 「높이 구간」). 중간 구간을 비워두는 것이
// 핵심이다 — 없으면 공중볼이 땅볼처럼 처리돼 z 를 넣은 의미가 사라진다.
const FOOT_H = 0.5 * M;              // 10 — 트래핑·드리블·일반 킥·태클
const CHEST_H = 1.5 * M;             // 30 — 여기까지는 몸에 튕기기만 한다
const HEAD_H = 2.3 * M;              // 46 — 헤딩 상한
const GK_HIGH_H = 2.6 * M;           // 52 — 골키퍼 점프·다이빙
const HEAD_CD = 0.6;                 // 연속 헤딩 드리블 차단
const HEAD_V = 300;                  // 15m/s — 헤딩은 발킥보다 느리다
const HEAD_ERR = 0.30;               // 조준 오차(rad). 발보다 나쁘다
const GK_CLEAR_V = 560;              // 28m/s — 골키퍼 펀트. B_MAX 안이다
const GK_CLEAR_DIST = 45 * M;        // 펀트 목표 낙하 거리
// 그리기용 과장값(실측 아님). 톱다운에서 높이를 읽으려면 필요하다.
const BALL_LIFT = 0.5;               // z 1단위당 화면 위로 0.5단위
const BALL_GROW = 200, BALL_GROW_MAX = 1.8;
const TOUCH_V = 120, PASS_V = 340, SHOOT_V = 660;
const TRAP_R = R_PLAYER + R_BALL + 7, TRAP_V = 620;
const OWNER_SPEED = 0.88, REOWN_CD = 0.35;
const SPEED_WALK = 5 / 3.6 * M, SPEED_JOG = 11 / 3.6 * M;
const SPEED_RUN = 20 / 3.6 * M, SPEED_SPRINT = P_MAX;
const TACKLE_TRIGGER = 32, SHOT_BLOCK_REACH = 36;
// 태클·블록이 유지되는 시간. 09-sprites.js 가 프레임을 고를 때도 쓰므로
// 리터럴로 흩뿌리지 않는다.
const TACKLE_T = 0.22, BLOCK_T = 0.25;
// 조작 대상이 **자동으로** 바뀐 뒤 다시 안 바꾸는 시간. 수동 전환(`[`)의
// 1.2초보다 짧다 — 공을 놓쳤을 때 따라붙는 건 빨라야 하기 때문이다.
const AUTO_SWITCH_LOCK = 0.45;
const OPPONENT_SPEED_MUL = [1, 1, 1];
// 평소에는 라인 초과분을 되돌리되, 공을 소유한 동안 FW가 짧은 침투
// 구간을 갖는다. 어려울수록 구간이 짧고 드물어 라인을 더 잘 지킨다.
const OFFSIDE_DISCIPLINE = [0, 0.72, 0.90];
const OFFSIDE_RUN_PERIOD = [0, 2, 4];
const OFFSIDE_RUN_REWARD = [0, 260, 120];
const AI_ACTION_RATE = 0.88;
// AI 파라미터만으로 기준 승률을 회복하지 못해 남긴 단조 1P 보조.
// 쉬움≥보통≥어려움이며 한 값으로 슛·태클·GK 범위를 함께 조절한다.
const HUMAN_ASSIST = [1.00, 0.35, 0];

// 방향 전환 제동. 입력 방향으로 **가지 않는** 속도 성분만 깎는다.
//
// 이게 없으면 감속이 「입력이 없을 때」만 걸려서, 방향을 바꾸는 동안에는
// 브레이크가 아예 없고 가속도 하나로 관성을 이겨야 한다. 그래서 좌우
// 반전에 1.5초, 90° 꺾음에 반경 4m 의 호가 나왔다.
//
// 현실에서는 방향을 바꿀 때 발로 땅을 밀어 **적극적으로 제동한다.**
// 빠진 항을 채우는 것이지 속도를 올리는 게 아니다 — 직진 중에는
// 어긋난 성분이 0 이라 아무 영향이 없고, 최고 속도도 그대로다.
function brakeTurn(p, ax, ay, dt) {
  const along = p.vx * ax + p.vy * ay;      // 입력 방향 성분(부호 있음)
  const perpX = p.vx - along * ax;          // 옆으로 흐르는 성분
  const perpY = p.vy - along * ay;
  const f = Math.exp(-P_BRAKE * dt);
  // 뒤로 가는 성분(along < 0)과 옆 성분만 깎는다. 앞으로 가는 성분은 둔다.
  const keep = along >= 0 ? along : along * f;
  p.vx = keep * ax + perpX * f;
  p.vy = keep * ay + perpY * f;
}

function movePlayer(p, ax, ay, dt, maxSpeed = P_MAX) {
  const m = Math.hypot(ax, ay);
  if (m > 0.001) { ax /= m; ay /= m; }
  if (m > 0.001) brakeTurn(p, ax, ay, dt);
  p.vx += ax * P_ACCEL * dt;
  p.vy += ay * P_ACCEL * dt;
  if (m < 0.01) { const f = Math.exp(-P_FRICTION * dt); p.vx *= f; p.vy *= f; }
  const cap = Math.max(0, maxSpeed);
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > cap) { p.vx = p.vx / sp * cap; p.vy = p.vy / sp * cap; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, p.x));
  p.y = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, p.y));
  if (p.kickCd > 0) p.kickCd -= dt;
  if (p.trapCd > 0) p.trapCd -= dt;
  if (p.tackleCd > 0) p.tackleCd -= dt;
  if (p.tackleT > 0) p.tackleT -= dt;
  if (p.blockT > 0) p.blockT -= dt;
  if (p.headCd > 0) p.headCd -= dt;
  if (p.actShoot > 0) p.actShoot -= dt;
  if (p.actPass > 0) p.actPass -= dt;
  if (p.actThrough > 0) p.actThrough -= dt;
  if (p.shootHeld) p.shootCharge = Math.min(1, p.shootCharge + dt / 1.05);
  advancePose(p, dt);
}

// 그리기 전용 상태. 물리·AI·경기 판정은 절대 읽지 않는다 — 읽는 순간
// 프레임률이나 창 크기가 경기 결과를 바꿀 수 있다.
// 보폭은 시간이 아니라 **이동 거리**로 쌓는다. 시간으로 쌓으면 느리게
// 걸을 때 발이 땅에서 미끄러진다. 조준 반대로 움직이면(뒷걸음질)
// 거꾸로 쌓아 걸음도 뒤로 간다.
function advancePose(p, dt) {
  if (p.poseT > 0) p.poseT -= dt;
  const back = p.vx * p.aimX + p.vy * p.aimY < 0 ? -1 : 1;
  p.stride += Math.hypot(p.vx, p.vy) * dt * back;
}

function staminaLimitedSpeed(p, requested, dt) {
  let target = Math.max(0, Math.min(SPEED_SPRINT, requested));
  const staminaLoad = 1.25 - p.stats.stamina / 220;
  if (target >= SPEED_SPRINT * .9) {
    if (p.energy <= .08) target = SPEED_RUN;
    else p.energy -= dt * .015 * staminaLoad;
  } else if (target >= SPEED_RUN * .9) {
    p.energy -= dt * .003 * staminaLoad;
  } else if (target >= SPEED_JOG * .9) {
    p.energy -= dt * .0012 * staminaLoad;
  } else if (target <= SPEED_WALK * 1.05) {
    p.energy -= dt * .0004 * staminaLoad;
  }
  p.energy = Math.max(0, Math.min(1, p.energy));
  // 피로는 조깅 이상에서 페이스를 떨어뜨리고, 5km/h 걷기는 회복 가능한
  // 기준 보행 속도로 유지한다.
  const fatigue = target >= SPEED_JOG * .9 ? .70 + p.energy * .30 : 1;
  return target * fatigue;
}

function abilityAdjustedSpeed(p, requested, limited) {
  // 걷기·조깅은 전 선수의 공통 행동 속도, 달리기 이상만 속도 능력치 차이다.
  return limited * (requested <= SPEED_JOG * 1.05 ? 1 : p.speedMul);
}

const inGoalMouth = (y) => y > (FH - GOAL_H) / 2 && y < (FH + GOAL_H) / 2;

function defendingAtGoal(x) {
  const ownDir = x <= 0 ? 1 : -1;
  return attackDir[0] === ownDir ? 0 : 1;
}

function secondLastDefenderLine(side) {
  const dir = attackDir[side];
  const projected = teams[1 - side].map(p => p.x * dir).sort((a, b) => b - a);
  return projected.length > 1 ? projected[1] / dir : (dir === 1 ? FW : 0);
}

function markOffside(p) {
  if (level === 0) { offside = null; return; }
  const dir = attackDir[p.side];
  const lineX = secondLastDefenderLine(p.side);
  const threshold = Math.max(lineX * dir, ball.x * dir) + 18;
  const offenders = teams[p.side].filter(t =>
    t !== p && !t.isGK && (t.x - FW / 2) * dir > 0 && t.x * dir > threshold
  );
  offside = offenders.length ? { side:p.side, offenders, lineX, timer:3 } : null;
}

function callOffside(p) {
  if (!offside || offside.side !== p.side || !offside.offenders.includes(p)) return false;
  matchStats.offsides[p.side]++;
  notice = { text:'오프사이드', timer:1.2, color:'#F2CE7A' };
  const side = 1 - p.side;
  offside = null;
  beginSetpiece('free', side, { x:p.x, y:p.y });
  return true;
}

function outOfPlay(x, y) {
  const last = ball.lastTouch ? ball.lastTouch.side : 0;
  if (y < 0 || y > FH) {
    const spot = { x:Math.max(80, Math.min(FW - 80, x)), y:y < 0 ? 0 : FH };
    beginSetpiece('throw', 1 - last, spot);
    return true;
  }
  if (x < 0 || x > FW) {
    // 크로스바 위로 넘어간 공은 골이 아니다. 아래 골킥·코너로 떨어진다.
    if (inGoalMouth(y) && ball.z < CROSSBAR) {
      goal(1 - defendingAtGoal(x));
      return true;
    }
    const defender = defendingAtGoal(x);
    const attacker = 1 - defender;
    if (last === attacker) {
      const gx = x < 0 ? GA_D * 0.7 : FW - GA_D * 0.7;
      beginSetpiece('goalkick', defender, { x:gx, y:FH / 2 });
    } else {
      beginSetpiece('corner', attacker, {
        x:x < 0 ? 0 : FW, y:y < FH / 2 ? 0 : FH
      });
    }
    return true;
  }
  return false;
}
