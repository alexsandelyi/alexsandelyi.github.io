'use strict';
// 05-ball.js — 공 갱신(z 물리), 소유·릴리스, 세트피스, 조준·패스 대상 선택
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

function updateBall(dt) {
  ball.prevX = ball.x; ball.prevY = ball.y;
  if (ball.freeCd > 0) ball.freeCd -= dt;
  if (ball.owner) {
    const p = ball.owner;
    let ax = p.aimX, ay = p.aimY;
    if (Math.hypot(ax, ay) < 0.1) {
      const v = Math.hypot(p.vx, p.vy);
      if (v > 10) { ax = p.vx / v; ay = p.vy / v; }
      else { ax = attackDir[p.side]; ay = 0; }
    }
    const d = R_PLAYER + R_BALL + 4;
    ball.x = p.x + ax * d;
    ball.y = p.y + ay * d;
    ball.z = 0; ball.vz = 0;            // 드리블 중에는 발밑에 붙어 있다
    ball.vx = p.vx; ball.vy = p.vy;
    // 골라인을 공과 함께 넘는 마지막 터치도 문전 슛 시도로 분류한다.
    const crossedGoal = attackDir[p.side] === 1 ? ball.x >= FW : ball.x <= 0;
    if (crossedGoal && inGoalMouth(ball.y)) {
      matchStats.shots[p.side]++;
      ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
    }
    return;
  }
  ball.x += ball.vx * dt; ball.y += ball.vy * dt;

  // 지면에 붙어 있고 수직 속도도 없으면 중력을 적분하지 않는다.
  // 그러지 않으면 매 프레임 vz 가 음수로 쌓여 미세 바운스가 남는다.
  if (ball.z > 0 || ball.vz !== 0) {
    ball.vz -= GRAVITY * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      if (-ball.vz > BOUNCE_MIN_VZ) {
        ball.vz = -ball.vz * BOUNCE_Z;
        ball.vx *= BOUNCE_XY; ball.vy *= BOUNCE_XY;
      } else ball.vz = 0;
    }
  }

  const airborne = ball.z > GROUND_EPS;
  // 감속은 진행 반대 방향으로만 작용한다. 공중에서는 속도 벡터 전체(수직
  // 포함)에, 지면에서는 수평에만 건다. 한 프레임 감속이 현재 속도보다
  // 크면 0 으로 자른다 — 안 그러면 공이 뒤로 굴러간다.
  const v = airborne
    ? Math.hypot(ball.vx, ball.vy, ball.vz)
    : Math.hypot(ball.vx, ball.vy);
  if (v > 0) {
    const a = (airborne ? 0 : ROLL_A) + AIR_K * v * v;
    const scale = a * dt >= v ? 0 : (v - a * dt) / v;
    ball.vx *= scale; ball.vy *= scale;
    if (airborne) ball.vz *= scale;
  }
  if (!airborne && ball.vz === 0 && Math.hypot(ball.vx, ball.vy) < 5) {
    ball.vx = 0; ball.vy = 0;
  }
}

function takePossession(p) {
  if (p.trapCd > 0 || ball.freeCd > 0) return false;
  if (ball.z > FOOT_H) return false;              // 낮은 공만 트래핑한다
  if (callOffside(p)) return true;
  // 후보가 아닌 선수에게 패스가 정상 도달하면 이전 후보는 더는 유효하지 않다.
  if (offside) offside = null;
  ball.owner = p; ball.lastTouch = p;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.z = 0; ball.vz = 0;
  ball.vx = p.vx; ball.vy = p.vy;
  return true;
}

function releaseBall(p, vx, vy, vz = 0) {
  ball.owner = null; ball.lastTouch = p; ball.freeCd = 0.08;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  p.trapCd = REOWN_CD; p.kickCd = Math.max(p.kickCd, 0.22);
  const sp = Math.hypot(vx, vy);
  ball.vx = sp > B_MAX ? vx / sp * B_MAX : vx;
  ball.vy = sp > B_MAX ? vy / sp * B_MAX : vy;
  ball.vz = vz;
}

const SET_WAIT = {
  throw:0.8, goalkick:1.0, corner:1.5, free:1.5, kickoff:0.7, penalty:2.0
};

function beginSetpiece(type, side, spot) {
  offside = null;
  matchStats.setpieces[type] = (matchStats.setpieces[type] || 0) + 1;
  if (matchStats.events.length < 20)
    matchStats.events.push({ event:type, side, x:Math.round(spot.x), y:Math.round(spot.y) });
  if (type === 'corner') matchStats.corners[side]++;
  ball.owner = null; ball.vx = ball.vy = 0; ball.freeCd = 0.1;
  ball.z = 0; ball.vz = 0;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.x = Math.max(0, Math.min(FW, spot.x));
  ball.y = Math.max(0, Math.min(FH, spot.y));
  ball.prevX = ball.x; ball.prevY = ball.y;
  let taker = null, bd = Infinity;
  for (const p of teams[side]) {
    if (p.isGK && type !== 'goalkick') continue;
    const d = Math.hypot(p.x - ball.x, p.y - ball.y);
    if (d < bd) { bd = d; taker = p; }
  }
  if (!taker) taker = teams[side][0];
  const inwardX = ball.x < FW / 2 ? 1 : -1;
  const inwardY = ball.y < FH / 2 ? 1 : -1;
  const ox = type === 'throw' ? 0 : -attackDir[side] * (R_PLAYER + R_BALL + 8);
  const oy = type === 'throw' ? inwardY * 90 : 0;
  taker.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, ball.x + ox));
  taker.y = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, ball.y + oy));
  taker.vx = taker.vy = 0;
  if (type === 'throw') {
    for (const sidePlayers of teams) for (const p of sidePlayers) {
      if (p !== taker) p.y = Math.max(120, Math.min(FH - 120, p.y));
    }
  }
  for (const p of teams[1 - side]) {
    if (type === 'penalty' && p.isGK) {
      const gx = attackDir[p.side] === 1 ? R_PLAYER : FW - R_PLAYER;
      p.x = gx; p.y = FH / 2; p.vx = p.vy = 0;
      continue;
    }
    const dx = p.x - ball.x, dy = p.y - ball.y;
    const d = Math.hypot(dx, dy);
    if (d < CIRCLE_R && d > 0) {
      p.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, ball.x + dx / d * CIRCLE_R));
      p.y = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, ball.y + dy / d * CIRCLE_R));
    } else if (d === 0) {
      p.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, ball.x + inwardX * CIRCLE_R));
    }
  }
  setpiece = {
    type, side, spot:{ x:ball.x, y:ball.y }, taker,
    timer:SET_WAIT[type] || 1, ready:false, auto:3
  };
  state = 'setpiece';
}

// 목표 지점에 떨어지도록 수직 속도를 정한다. 체공 t 동안 수평으로
// 날아간 거리가 목표와 맞아야 받는 선수가 따라갈 수 있다.
function loftFor(dist, v, maxT = 2.6) {
  if (v <= 0) return 0;
  return GRAVITY * Math.min(maxT, dist / v) / 2;
}

// 슛의 로프트. 잘 뜨면 크로스바 위로 다 날아가 득점이 사라지므로
// 골문에 닿는 시점의 높이를 크로스바 아래로 역산해서 정한다.
function shotLift(dist, v, power) {
  const lp = Math.max(0, (power - 0.4) / 0.6);   // 짧게 누르면 땅볼
  if (v <= 0 || lp <= 0) return 0;
  const t = dist / v;
  // 정점도 크로스바를 넘지 않게 잘라 먼 거리 슛이 부풀지 않게 한다.
  return Math.min((CROSSBAR * 0.72 * lp + GRAVITY * t * t / 2) / t,
    Math.sqrt(2 * GRAVITY * CROSSBAR));
}

// 공중볼 낙하 지점. z(t)=0 의 해석해를 쓰고 수평은 등속으로 근사한다.
// 수치 적분을 돌리지 않으려는 것이다 (aerial-play.md 「AI 판단」).
function ballLanding() {
  if (ball.owner || ball.z <= 0) return { x:ball.x, y:ball.y, t:0 };
  const t = (ball.vz + Math.sqrt(ball.vz * ball.vz + 2 * GRAVITY * ball.z)) / GRAVITY;
  return { x:ball.x + ball.vx * t, y:ball.y + ball.vy * t, t };
}

// 각도 보간. ±π 경계를 넘어가도 짧은 쪽으로 돈다.
function angLerp(a, b, t) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

function takeSetpiece(kind = 'pass') {
  if (!setpiece) return;
  const s = setpiece, p = s.taker;
  let tx, ty, v, lift = 0;
  const needsTarget = s.type === 'kickoff' || (s.type === 'free' && kind !== 'shoot');
  const target = needsTarget ? passTarget(p, kind === 'through') : null;
  const isShot = s.type === 'penalty' || kind === 'shoot';
  if (s.type === 'penalty') {
    const a = aimAt(s.side); tx = a.x; ty = a.y; v = SHOOT_V;
  } else if (s.type === 'throw') {
    // 던지기는 15m/s. 현실 전환 때 재조정되지 않아 820(148km/h)이었다.
    tx = Math.max(180, Math.min(FW - 180, ball.x + attackDir[s.side] * 180));
    ty = ball.y < FH / 2 ? 350 : FH - 350;
    v = 300;
  } else if (s.type === 'corner') {
    const goalX = attackDir[s.side] === 1 ? FW : 0;
    tx = goalX - attackDir[s.side] * PA_D * 0.55;
    ty = FH / 2; v = PASS_V;
  } else if (s.type === 'goalkick') {
    // 골킥은 26m/s. 전환 전 1150(207km/h)은 슛보다 빨랐다.
    tx = p.x + attackDir[s.side] * 1000;
    ty = FH / 2 + (Math.random() * 2 - 1) * 320; v = 520;
  } else if (s.type === 'kickoff') {
    const mate = target || teams[s.side].find(t => t !== p && !t.isGK);
    tx = mate ? mate.x : p.x + attackDir[s.side] * 300;
    ty = mate ? mate.y : p.y; v = 260;
  } else if (target && kind !== 'shoot') {
    tx = target.x + (kind === 'through' ? attackDir[s.side] * 130 : 0);
    ty = target.y; v = PASS_V * 0.9;
  } else {
    const a = aimAt(s.side); tx = a.x; ty = a.y;
    v = kind === 'shoot' ? SHOOT_V * 0.85 : PASS_V * 0.8;
  }
  const ang = Math.atan2(ty - ball.y, tx - ball.x);
  const dist = Math.hypot(tx - ball.x, ty - ball.y);
  // 코너·골킥·스로인은 띄운다. 킥오프와 슛은 땅으로 간다.
  if (s.type === 'corner' || s.type === 'goalkick') lift = loftFor(dist, v);
  else if (s.type === 'throw') lift = loftFor(dist, v, 1.4);
  else if (s.type === 'free' && !isShot) lift = loftFor(dist, v, 1.0) * 0.6;
  v = Math.min(v, B_MAX);
  ball.lastTouch = p; ball.owner = null; ball.freeCd = 0.12;
  ball.vx = Math.cos(ang) * v; ball.vy = Math.sin(ang) * v;
  ball.z = 0; ball.vz = lift;
  const goalBound = goalBoundKick(p.side, ball.x, ball.y, ball.vx, ball.vy);
  ball.shotSide = isShot || goalBound ? p.side : -1;
  ball.shotCounted = ball.blockCounted = false;
  if (isShot || goalBound) matchStats.shots[p.side]++;
  if (matchStats.events.length < 20)
    matchStats.events.push({ event:'kick', type:s.type, vx:Math.round(ball.vx), vy:Math.round(ball.vy) });
  p.kickCd = 0.3; setpiece = null; state = 'play';
}

function stepSetpiece(dt) {
  if (!setpiece) { state = 'play'; return; }
  advanceClock(dt, true);
  if (state !== 'setpiece') return;
  if (setpiece.timer > 0) {
    setpiece.timer -= dt;
    return;
  }
  const human = setpiece.side === 0;
  if (!human) { takeSetpiece('pass'); return; }
  setpiece.ready = true;
  setpiece.auto -= dt;
  if (setpiece.auto <= 0) takeSetpiece('pass');
}

// 공용 슛 분산. 난이도별 시도율을 만들지 않고 200경기 성공률로 보정한다.
function aimAt(side) {
  return { x:attackDir[side] === 1 ? FW : 0,
    y:FH / 2 + (Math.random() * 2 - 1) * GOAL_H * 6.00 };
}

function goalBoundKick(side, x, y, vx, vy) {
  const gx = attackDir[side] === 1 ? FW : 0;
  if (vx * attackDir[side] <= 0) return false;
  const t = (gx - x) / vx;
  return t >= 0 && inGoalMouth(y + vy * t);
}

function passLaneRisk(from, to, defenders) {
  const ux = to.x - from.x, uy = to.y - from.y;
  const u2 = ux * ux + uy * uy;
  let risk = 0;
  for (const o of defenders) {
    const q = u2 ? Math.max(0, Math.min(1,
      ((o.x - from.x) * ux + (o.y - from.y) * uy) / u2)) : 0;
    const lane = Math.hypot(o.x - (from.x + ux * q), o.y - (from.y + uy * q));
    if (lane < 100) risk += (100 - lane) * 4;
  }
  return risk;
}

// 패스 대상: 앞쪽에 있고 가까운 동료
function passTarget(p, through = false) {
  const dir = attackDir[p.side];
  const tactic = teamTactics(p.side);
  let best = null, bestScore = Infinity;
  for (const t of teams[p.side]) {
    if (t === p || t.isGK) continue;
    const ahead = (t.x - p.x) * dir;
    if (ahead < 40) continue;                        // 뒤나 옆은 제외
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < 120) continue;                           // 너무 가까우면 의미 없다
    const laneRisk = passLaneRisk(p, t, teams[1 - p.side]);
    const edgePenalty = Math.max(0, 150 - Math.min(t.y, FH - t.y)) * 3;
    // 넓게 벌린 팀은 가까운 중앙 선수만 고르지 않고 빈 측면의 전진
    // 패스도 적극적으로 선택한다. 기본 폭(.30) 이하는 기존 판정을 유지한다.
    const outletReward = Math.abs(t.y - FH / 2) *
      Math.max(0, tactic.width - .30) * 4;
    const runReward = level > 0 && t.role === 'FW' &&
      (Math.floor(clock / 4) + t.no) % OFFSIDE_RUN_PERIOD[level] === 0
      ? OFFSIDE_RUN_REWARD[level] : 0;
    const sc = d - ahead * (through ? 0.95 : 0.6) +
      laneRisk + edgePenalty - outletReward - runReward;
    if (sc < bestScore) { bestScore = sc; best = t; }
  }
  return best;
}
