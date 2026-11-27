'use strict';
// 05-ball.js — 공 물리(스핀·마그누스·바운스·골대충돌·드리블), 소유·릴리스, 세트피스, 조준
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

function applyBallMotion(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  const hMove = Math.hypot(ball.vx, ball.vy);
  ball.rollAngle += (hMove / R_BALL) * dt;

  // 지면에 붙어 있고 수직 속도도 없으면 중력을 적분하지 않는다.
  if (ball.z > 0 || ball.vz !== 0) {
    ball.vz -= GRAVITY * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      if (-ball.vz > BOUNCE_MIN_VZ) {
        const hv = Math.hypot(ball.vx, ball.vy);
        const impactSp = Math.hypot(hv, -ball.vz);
        const steep = impactSp > 1e-3 ? (-ball.vz) / impactSp : 1;
        if (-ball.vz > 45) sfx('bounce', Math.min(1, -ball.vz / 240));
        ball.vz = -ball.vz * BOUNCE_Z;
        const bxy = Math.max(0.68, Math.min(0.92,
          BOUNCE_XY + 0.12 * (1 - steep) - 0.06 * steep));
        ball.vx *= bxy; ball.vy *= bxy;
        // 탑스핀은 바운스 후 앞으로 미끄러지고, 백스핀은 브레이크가 걸린다.
        if (hv > 1 && Math.abs(ball.spinTop) > 0.1) {
          const kick = Math.max(-hv * 0.45, Math.min(110, ball.spinTop * 4.5));
          ball.vx += (ball.vx / hv) * kick;
          ball.vy += (ball.vy / hv) * kick;
          ball.spinTop *= 0.45;
        }
        ball.spinZ *= 0.6;
      } else {
        ball.vz = 0;
      }
    }
  }

  const airborne = ball.z > GROUND_EPS;
  const hv = Math.hypot(ball.vx, ball.vy);
  if (hv > 8) {
    if (Math.abs(ball.spinZ) > 0.05) {
      const m = airborne ? MAGNUS_XY : MAGNUS_XY * 0.22;
      const ax = -ball.vy * ball.spinZ * m;
      const ay = ball.vx * ball.spinZ * m;
      ball.vx += ax * dt; ball.vy += ay * dt;
    }
    if (airborne && Math.abs(ball.spinTop) > 0.05) {
      ball.vz -= hv * ball.spinTop * MAGNUS_Z * dt;
    }
  }

  // 감속은 진행 반대 방향으로만 작용한다. 공중은 공기저항, 지면은 구름+공기저항.
  const v = airborne
    ? Math.hypot(ball.vx, ball.vy, ball.vz)
    : Math.hypot(ball.vx, ball.vy);
  if (v > 0) {
    const a = (airborne ? 0 : ROLL_A) + AIR_K * v * v;
    const scale = a * dt >= v ? 0 : (v - a * dt) / v;
    ball.vx *= scale; ball.vy *= scale;
    if (airborne) ball.vz *= scale;
  }
  const sDecay = Math.exp(-(airborne ? SPIN_AIR_DECAY : SPIN_GROUND_DECAY) * dt);
  ball.spinZ = Math.abs(ball.spinZ * sDecay) < 0.02 ? 0 : ball.spinZ * sDecay;
  ball.spinTop = Math.abs(ball.spinTop * sDecay) < 0.02 ? 0 : ball.spinTop * sDecay;
  if (!airborne && ball.vz === 0 && Math.hypot(ball.vx, ball.vy) < 5) ball.vx = ball.vy = 0;
}

// 골키퍼 캐치 후 배급: 열린 동료가 있으면 땅볼 롤패스, 아니면 펀트.
function distributeFromGK(p) {
  const dir = attackDir[p.side];
  const mate = passTarget(p, false);
  p.gkHoldT = 0;
  if (mate && Math.hypot(mate.x - p.x, mate.y - p.y) < 680 &&
      passLaneRisk(p, mate, teams[1 - p.side]) < 65) {
    const ang = Math.atan2(mate.y - p.y, mate.x - p.x);
    const v = Math.min(PASS_V * 0.95, 170 + Math.hypot(mate.x - p.x, mate.y - p.y) * 0.42);
    releaseBall(p, Math.cos(ang) * v, Math.sin(ang) * v, 0, 0, 1.5);
    setPose(p, 'kick');
    return;
  }
  const ang = Math.atan2((FH / 2 - p.y) * 0.55 + (Math.random() * 2 - 1) * 280, dir * 900);
  const lift = loftFor(GK_CLEAR_DIST, GK_CLEAR_V, 1.9);
  releaseBall(p, Math.cos(ang) * GK_CLEAR_V, Math.sin(ang) * GK_CLEAR_V, lift, 0, -4.5);
  p.kickCd = 0.35;
  setPose(p, 'gk-punt');
}

function updateBall(dt) {
  ball.prevX = ball.x; ball.prevY = ball.y; ball.prevZ = ball.z;
  if (ball.freeCd > 0) ball.freeCd -= dt;
  if (ball.owner) {
    const p = ball.owner;
    // 골키퍼가 손으로 잡고 있는 구간
    if (p.isGK && p.gkHoldT > 0) {
      const dir = attackDir[p.side];
      p.gkHoldT -= dt;
      ball.x = p.x + dir * (R_PLAYER + R_BALL + 2);
      ball.y = p.y; ball.z = 16; ball.vz = 0;
      ball.vx = p.vx; ball.vy = p.vy;
      ball.spinZ = 0; ball.spinTop = 0;
      if (p.gkHoldT <= 0) distributeFromGK(p);
      return;
    }

    // 드리블 물리: 발에 고정하지 않고 자체 관성·잔디 마찰로 구르며 터치로 밀어낸다.
    applyBallMotion(dt);
    let ax = p.aimX, ay = p.aimY;
    const sp = Math.hypot(p.vx, p.vy);
    if (Math.hypot(ax, ay) < 0.1) {
      if (sp > 10) { ax = p.vx / sp; ay = p.vy / sp; }
      else { ax = attackDir[p.side]; ay = 0; }
    }
    const lead = R_PLAYER + R_BALL + 3.5 + (sp / P_MAX) * 14;
    const tx = p.x + ax * lead, ty = p.y + ay * lead;
    const bx = ball.x - p.x, by = ball.y - p.y;
    const bd = Math.hypot(bx, by);
    if (bd > DRIBBLE_LOSE_R) {
      ball.owner = null; p.trapCd = 0.08;
      return;
    }
    if (bd < R_PLAYER + R_BALL && bd > 0.01) {
      ball.x = p.x + (bx / bd) * (R_PLAYER + R_BALL);
      ball.y = p.y + (by / bd) * (R_PLAYER + R_BALL);
    }
    if (bd <= R_PLAYER + R_BALL + 18 && ball.z <= FOOT_H + 4) {
      const ex = tx - ball.x, ey = ty - ball.y;
      const err = Math.hypot(ex, ey);
      if (sp > 14) {
        if (p.dribbleTouchCd <= 0 && (err > 3.2 || bd < R_PLAYER + R_BALL + 1.5)) {
          const knock = 1.05 + (sp / P_MAX) * 0.18;
          let nvx = p.vx * knock + ex * 4.4;
          let nvy = p.vy * knock + ey * 4.4;
          const cap = Math.max(sp * 1.38, 128);
          const nm = Math.hypot(nvx, nvy);
          if (nm > cap) { nvx = nvx / nm * cap; nvy = nvy / nm * cap; }
          ball.vx = nvx; ball.vy = nvy;
          ball.spinTop = 2.2;
          p.dribbleTouchCd = 0.12 + (sp / P_MAX) * 0.11;
        }
      } else {
        const k = 1 - Math.exp(-12 * dt);
        ball.vx += (ex * 6.5 - ball.vx) * k;
        ball.vy += (ey * 6.5 - ball.vy) * k;
      }
    }
    const crossedGoal = attackDir[p.side] === 1 ? ball.x >= FW : ball.x <= 0;
    if (crossedGoal && inGoalMouth(ball.y)) {
      matchStats.shots[p.side]++;
      ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
    }
    return;
  }

  applyBallMotion(dt);
  collideGoalFrame();
}

function takePossession(p) {
  if (p.trapCd > 0 || ball.freeCd > 0) return false;
  if (ball.z > FOOT_H) return false;              // 낮은 공만 트래핑한다
  if (callOffside(p)) return true;
  if (offside) offside = null;
  ball.owner = p; ball.lastTouch = p;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  // 퍼스트 터치 쿠션: 즉시 0 으로 얼리지 않고 능력치에 따라 일부 관성을 남긴다.
  const control = 0.52 + (p.stats.pass / 99) * 0.35;
  const keep = (1 - control) * 0.55;
  ball.vx = p.vx + (ball.vx - p.vx) * keep;
  ball.vy = p.vy + (ball.vy - p.vy) * keep;
  ball.vz = ball.z > 2 ? Math.min(24, Math.abs(ball.vz) * 0.18) : 0;
  ball.z = Math.min(ball.z, 3);
  ball.spinZ *= 0.25; ball.spinTop = 0;
  p.dribbleTouchCd = 0.08;
  return true;
}

function releaseBall(p, vx, vy, vz = 0, spinZ = 0, spinTop = 0) {
  ball.owner = null; ball.lastTouch = p; ball.freeCd = 0.08;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  p.trapCd = REOWN_CD; p.kickCd = Math.max(p.kickCd, 0.22);
  const sp = Math.hypot(vx, vy);
  ball.vx = sp > B_MAX ? vx / sp * B_MAX : vx;
  ball.vy = sp > B_MAX ? vy / sp * B_MAX : vy;
  ball.vz = vz;
  ball.spinZ = Math.max(-22, Math.min(22, spinZ));
  ball.spinTop = Math.max(-18, Math.min(18, spinTop));
  sfx('kick', Math.max(0.25, Math.min(1, Math.hypot(ball.vx, ball.vy, vz) / SHOOT_V)));
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
  if (ball.owner && ball.owner.gkHoldT > 0) ball.owner.gkHoldT = 0;
  ball.owner = null; ball.vx = ball.vy = 0; ball.freeCd = 0.1;
  ball.z = ball.prevZ = 0; ball.vz = 0; ball.spinZ = ball.spinTop = 0;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.x = ball.prevX = Math.max(0, Math.min(FW, spot.x));
  ball.y = ball.prevY = Math.max(0, Math.min(FH, spot.y));
  let taker = null, bd = Infinity;
  for (const p of teams[side]) {
    if (p.isGK && type !== 'goalkick') continue;
    const d = Math.hypot(p.x - ball.x, p.y - ball.y);
    if (d < bd) { bd = d; taker = p; }
  }
  if (!taker) taker = teams[side][0];
  const inwardX = ball.x < FW / 2 ? 1 : -1, inwardY = ball.y < FH / 2 ? 1 : -1;
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
      p.x = attackDir[p.side] === 1 ? R_PLAYER : FW - R_PLAYER;
      p.y = FH / 2; p.vx = p.vy = 0; continue;
    }
    const dx = p.x - ball.x, dy = p.y - ball.y, d = Math.hypot(dx, dy);
    if (d < CIRCLE_R && d > 0) {
      p.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, ball.x + dx / d * CIRCLE_R));
      p.y = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, ball.y + dy / d * CIRCLE_R));
    } else if (d === 0) {
      p.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, ball.x + inwardX * CIRCLE_R));
    }
  }
  setpiece = { type, side, spot:{ x:ball.x, y:ball.y }, taker,
    timer:SET_WAIT[type] || 1, ready:false, auto:3 };
  state = 'setpiece';
}

// 공기저항을 반영한 로프트 계산: 2차 저항 하의 비행시간 t = (e^(k·d)-1)/(k·v)
function loftFor(dist, v, maxT = 2.6) {
  if (v <= 0) return 0;
  const kd = Math.min(1.4, AIR_K * Math.max(0, dist));
  const tDrag = kd > 1e-4 ? (Math.exp(kd) - 1) / (AIR_K * v) : dist / v;
  const t = Math.min(maxT, tDrag);
  return GRAVITY * t * 0.5 * (1 + 0.045 * AIR_K * GRAVITY * t * t);
}

// 슛 로프트: 약하면 땅볼, 중강은 탑스핀 드롭 궤적, 과충전(>0.86)은 크로스바 위로 뜰 수 있다.
function shotLift(dist, v, power) {
  if (v <= 0 || power <= 0.35) return 0;
  const lp = Math.min(1, (power - 0.35) / 0.51);
  const t = Math.max(0.18, Math.min(1.6, dist / v));
  const targetH = CROSSBAR * (0.22 + 0.72 * lp);
  let vz = (targetH + GRAVITY * t * t * 0.5) / t;
  if (power > 0.86) vz += ((power - 0.86) / 0.14) * 115;
  return Math.min(vz, 380);
}

// 공중볼 낙하 지점: 실제 공기저항·마그누스를 그대로 적분해 정확도를 맞춘다.
function ballLanding() {
  if (ball.owner || ball.z <= 0) return { x:ball.x, y:ball.y, t:0 };
  let x = ball.x, y = ball.y, z = ball.z, vx = ball.vx, vy = ball.vy, vz = ball.vz;
  let sz = ball.spinZ, st = ball.spinTop, t = 0;
  const h = 0.05, sDecay = Math.exp(-SPIN_AIR_DECAY * h);
  for (let i = 0; i < 70; i++) {
    const px = x, py = y, pz = z;
    vz -= GRAVITY * h;
    const hv = Math.hypot(vx, vy);
    if (hv > 8) {
      if (Math.abs(sz) > 0.05) { vx -= vy * sz * MAGNUS_XY * h; vy += vx * sz * MAGNUS_XY * h; }
      if (Math.abs(st) > 0.05) vz -= hv * st * MAGNUS_Z * h;
    }
    const v = Math.hypot(vx, vy, vz);
    if (v > 0) {
      const sc = AIR_K * v * v * h >= v ? 0 : 1 - AIR_K * v * h;
      vx *= sc; vy *= sc; vz *= sc;
    }
    x += vx * h; y += vy * h; z += vz * h;
    sz *= sDecay; st *= sDecay;
    if (z <= 0) {
      const f = pz > z ? pz / (pz - z) : 1;
      return { x:px + (x - px) * f, y:py + (y - py) * f, t:t + h * f };
    }
    t += h;
  }
  return { x, y, t };
}

function angLerp(a, b, t) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

function takeSetpiece(kind = 'pass') {
  if (!setpiece) return;
  const s = setpiece, p = s.taker;
  let tx, ty, v, lift = 0, spinZ = 0, spinTop = 0;
  const needsTarget = s.type === 'kickoff' || (s.type === 'free' && kind !== 'shoot');
  const target = needsTarget ? passTarget(p, kind === 'through') : null;
  const isShot = s.type === 'penalty' || kind === 'shoot';
  if (s.type === 'penalty') {
    const a = aimAt(s.side, p); tx = a.x; ty = a.y; v = SHOOT_V;
    spinTop = 6;
  } else if (s.type === 'throw') {
    tx = Math.max(180, Math.min(FW - 180, ball.x + attackDir[s.side] * 180));
    ty = ball.y < FH / 2 ? 350 : FH - 350; v = 300;
  } else if (s.type === 'corner') {
    const goalX = attackDir[s.side] === 1 ? FW : 0;
    tx = goalX - attackDir[s.side] * PA_D * 0.55;
    ty = FH / 2; v = PASS_V * 1.05;
    spinZ = (ball.y < FH / 2 ? 1 : -1) * attackDir[s.side] * 11;
    spinTop = -5;
  } else if (s.type === 'goalkick') {
    tx = p.x + attackDir[s.side] * 1000;
    ty = FH / 2 + (Math.random() * 2 - 1) * 320; v = 520;
    spinTop = -4;
  } else if (s.type === 'kickoff') {
    const mate = target || teams[s.side].find(t => t !== p && !t.isGK);
    tx = mate ? mate.x : p.x + attackDir[s.side] * 300;
    ty = mate ? mate.y : p.y; v = 240;
  } else if (target && kind !== 'shoot') {
    tx = target.x + (kind === 'through' ? attackDir[s.side] * 130 : 0);
    ty = target.y; v = PASS_V * 0.9;
  } else {
    const a = aimAt(s.side, p); tx = a.x; ty = a.y;
    v = kind === 'shoot' ? SHOOT_V * 0.85 : PASS_V * 0.8;
    if (isShot) { spinZ = (Math.random() * 2 - 1) * 9; spinTop = 7; }
  }
  const ang = Math.atan2(ty - ball.y, tx - ball.x);
  const dist = Math.hypot(tx - ball.x, ty - ball.y);
  if (s.type === 'corner' || s.type === 'goalkick') lift = loftFor(dist, v);
  else if (s.type === 'throw') lift = loftFor(dist, v, 1.4);
  else if (s.type === 'free' && !isShot) lift = loftFor(dist, v, 1.0) * 0.6;
  else if (isShot && s.type === 'free') lift = shotLift(dist, v, 0.68);
  v = Math.min(v, B_MAX);
  ball.lastTouch = p; ball.owner = null; ball.freeCd = 0.12;
  ball.vx = Math.cos(ang) * v; ball.vy = Math.sin(ang) * v;
  ball.z = 0; ball.vz = lift;
  ball.spinZ = spinZ; ball.spinTop = spinTop;
  sfx('kick', Math.max(0.3, Math.min(1, v / SHOOT_V)));
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
  if (setpiece.timer > 0) { setpiece.timer -= dt; return; }
  const human = setpiece.side === 0;
  if (!human) { takeSetpiece('pass'); return; }
  setpiece.ready = true;
  setpiece.auto -= dt;
  if (setpiece.auto <= 0) takeSetpiece('pass');
}

// 슛 조준: 골문 폭 안팎의 현실적인 오차 원뿔로 조준한다.
function aimAt(side, shooter = null) {
  const skill = shooter ? shooter.stats.shot / 99 : 0.62;
  const spread = GOAL_H * (0.85 + (1 - skill) * 1.15);
  return {
    x:attackDir[side] === 1 ? FW : 0,
    y:FH / 2 + (Math.random() * 2 - 1) * spread
  };
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

function passTarget(p, through = false) {
  const dir = attackDir[p.side];
  const tactic = teamTactics(p.side);
  let best = null, bestScore = Infinity;
  for (const t of teams[p.side]) {
    if (t === p || t.isGK) continue;
    const ahead = (t.x - p.x) * dir;
    if (ahead < 40) continue;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < 120) continue;
    const laneRisk = passLaneRisk(p, t, teams[1 - p.side]);
    const edgePenalty = Math.max(0, 150 - Math.min(t.y, FH - t.y)) * 3;
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
