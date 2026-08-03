'use strict';
// 06-contact.js — 킥, 접촉 판정과 높이 구간(발·가슴·헤딩), 파울, 선수 분리, 득점
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

function kickOwned(p, kind, power = 0.65) {
  if (ball.owner !== p || p.kickCd > 0) return false;
  let tx, ty, v, lift = 0;
  const aimMag = Math.hypot(p.aimX, p.aimY);
  const dir = attackDir[p.side];
  // 누른 시간이 그대로 높이다 (aerial-play.md 「킥 높이 제어」).
  // 0.4 이하는 땅볼로 둬서 짧게 누르면 예전과 같게 나간다.
  const lp = Math.max(0, (power - 0.4) / 0.6);
  if (kind === 'shoot') {
    matchStats.shots[p.side]++;
    if (p.manualAim && aimMag > 0.2) {
      tx = p.x + p.aimX / aimMag * 1000; ty = p.y + p.aimY / aimMag * 1000;
    } else {
      const a = aimAt(p.side); tx = a.x; ty = a.y;
    }
    v = SHOOT_V * p.shotMul * (0.62 + 0.38 * power) *
      (mode === '1p' && p === ctrl[0] ? 1 + HUMAN_ASSIST[level] * 0.8 : 1);
    // 골라인까지의 거리로 역산해 크로스바 아래에 머물게 한다.
    lift = shotLift(Math.max(120, dir === 1 ? FW - p.x : p.x), v, power);
  } else {
    const through = kind === 'through';
    // 사람의 `\` 패스는 무조건 땅볼이고, 누른 길이가 높이가 아니라 거리를
    // 정한다. AI 도 이 함수를 쓰므로 조작 중인 선수에게만 적용한다 —
    // 전부 땅볼로 막으면 AI 의 크로스가 사라진다. 사람이 띄우려면 `]`.
    const groundPass = p === ctrl[0] && !through;
    const t = passTarget(p, through);
    if (t) {
      const lead = through ? Math.min(230, Math.hypot(t.vx, t.vy) * 0.55 + 90) : 0;
      const tm = Math.hypot(t.vx, t.vy);
      tx = t.x + (tm > 5 ? t.vx / tm : attackDir[p.side]) * lead;
      ty = t.y + (tm > 5 ? t.vy / tm : 0) * lead;
      const d = Math.hypot(tx - p.x, ty - p.y);
      v = Math.min(PASS_V * p.passMul * (through ? 1.12 : 1),
        420 + d * p.passMul * (through ? 1.0 : 0.9));
      // 측면 깊은 위치에서 중앙으로 보내면 크로스다. 체공을 길게 줘서
      // 받는 선수가 낙하 지점까지 따라갈 수 있게 한다.
      const cross = !groundPass && Math.min(p.y, FH - p.y) < FH * 0.24 &&
        (dir === 1 ? p.x : FW - p.x) > FW * 0.58 &&
        Math.abs(t.y - FH / 2) < FH * 0.30;
      if (cross) {
        matchStats.crosses[p.side]++;
        lift = loftFor(d, v, 1.6);
      } else if (through && lp > 0.5) {
        v *= 0.7; lift = loftFor(d, v, 2.0);        // 칩 — 수비선 뒤로
      } else if (!groundPass && lp > 0) {
        v *= 0.9; lift = loftFor(d, v, 1.1) * lp;   // 로빙 패스
      }
    } else if (aimMag > 0.2) {
      tx = p.x + p.aimX / aimMag * 800; ty = p.y + p.aimY / aimMag * 800;
      v = PASS_V * p.passMul * (through ? 0.95 : 0.8);
      if (!groundPass && lp > 0) { v *= 0.9; lift = loftFor(800, v, 1.1) * lp; }
    } else {
      const a = aimAt(p.side); tx = a.x; ty = a.y; v = PASS_V * 0.8;
    }
    // 방향은 위에서 고른 대상·조준을 그대로 쓰고, 세기만 누른 길이로
    // 덮어쓴다. 짧게 누르면 20m, 끝까지 누르면 54m 쯤 굴러간다.
    if (groundPass) {
      v = PASS_V * p.passMul * (0.45 + 0.55 * power);
      lift = 0;
    }
  }
  if (kind === 'pass' || kind === 'through') markOffside(p);
  const ang = Math.atan2(ty - p.y, tx - p.x);
  const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v;
  releaseBall(p, vx, vy, lift);
  if (kind === 'shoot') ball.shotSide = p.side;
  else if (goalBoundKick(p.side, p.x, p.y, vx, vy)) {
    matchStats.shots[p.side]++;
    ball.shotSide = p.side;
  }
  p.actShoot = p.actPass = p.actThrough = 0;
  return true;
}

function ballContactPoint(p) {
  let x = ball.x, y = ball.y;
  if (!ball.owner && ball.shotSide === 1 - p.side) {
    const ux = ball.x - ball.prevX, uy = ball.y - ball.prevY;
    const u2 = ux * ux + uy * uy;
    if (u2 > 0) {
      const q = Math.max(0, Math.min(1,
        ((p.x - ball.prevX) * ux + (p.y - ball.prevY) * uy) / u2));
      const px = ball.prevX + ux * q, py = ball.prevY + uy * q;
      if (Math.hypot(px - p.x, py - p.y) < Math.hypot(x - p.x, y - p.y)) {
        x = px; y = py;
      }
    }
  }
  return { x, y };
}

// 무릎~가슴(0.5~1.5m). 아무도 제대로 다루지 못하고 몸에 튕긴다.
function deflectBall(p, nx, ny) {
  matchStats.deflections[p.side]++;
  const carry = Math.max(0, p.vx * nx + p.vy * ny);
  const v = TOUCH_V * 0.8 + carry * 0.35;
  let vx = ball.vx * 0.35 + nx * v, vy = ball.vy * 0.35 + ny * v;
  const sp = Math.hypot(vx, vy);
  if (sp > B_MAX) { vx = vx / sp * B_MAX; vy = vy / sp * B_MAX; }
  ball.vx = vx; ball.vy = vy;
  ball.vz = Math.abs(ball.vz) * 0.35 + 30;      // 몸에 맞고 살짝 뜬다
  ball.freeCd = Math.max(ball.freeCd, 0.06);
  p.trapCd = Math.max(p.trapCd, 0.18);
}

// 헤딩(1.5~2.3m). 발로 닿을 수 없는 높이를 처리하는 유일한 수단이다.
// 소유로 전환하지 않는 것이 헤딩 드리블을 막는 장치다.
function headBall(p, nx, ny) {
  if (p.headCd > 0) return;
  p.headCd = HEAD_CD;
  matchStats.headers[p.side]++;
  const dir = attackDir[p.side];
  const attacking = (dir === 1 ? FW - p.x : p.x) < FW * 0.32;
  let ang, v, lift;
  if (attacking) {
    const a = aimAt(p.side);
    ang = Math.atan2(a.y - p.y, a.x - p.x);
    v = HEAD_V; lift = 18;
    matchStats.shots[p.side]++;
    ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
    ball.headShot = true;
  } else {
    // 수비·중원 헤딩은 걷어내기 — 멀리 그리고 높이.
    ang = Math.atan2((FH / 2 - p.y) * 0.35 + (Math.random() * 2 - 1) * 260, dir * 800);
    v = HEAD_V * 1.15; lift = 120;
    ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  }
  if (p.manualAim) ang = angLerp(ang, Math.atan2(p.aimY, p.aimX), 0.6);
  // 발보다 정확도가 나쁘다. 공격은 shot, 수비는 defense 로 오차를 줄인다.
  const skill = (attacking ? p.stats.shot : p.stats.defense) / 99;
  ang += (Math.random() * 2 - 1) * HEAD_ERR * (1 - skill * 0.55);
  ball.vx = Math.cos(ang) * v; ball.vy = Math.sin(ang) * v;
  ball.vz = lift;
  ball.freeCd = Math.max(ball.freeCd, 0.12);
  p.trapCd = Math.max(p.trapCd, HEAD_CD);
}

function collide(p) {
  // 높이 게이트. 헤딩 구간 위는 골키퍼만 닿는다. 헤딩 쿨다운 중이면
  // 헤딩 구간에 아예 닿지 못한다 — 안 그러면 공만 밀어내며 lastTouch 를
  // 계속 가져간다.
  const reachH = p.isGK ? GK_HIGH_H : p.headCd > 0 ? CHEST_H : HEAD_H;
  if (ball.z > reachH) return;
  const contact = ballContactPoint(p);
  const dx = contact.x - p.x, dy = contact.y - p.y;
  const gkAssist = p.isGK && p.side === 0 && mode === '1p'
    ? 1 + HUMAN_ASSIST[level] : 1;
  // 보통을 1로 정규화해 기존 물리 도달 거리를 보존하고, 난이도의 gk 축은
  // 실제 다이빙 도달 범위를 단조롭게 바꾼다.
  const gkDifficulty = p.isGK ? p.gkDifficulty / LEVELS[1].gk : 1;
  const blockReach = !p.isGK && p.blockT > 0 && ball.shotSide === 1 - p.side
    ? SHOT_BLOCK_REACH * p.defenseMul : 0;
  const d = Math.hypot(dx, dy),
    min = p.reach * gkAssist * gkDifficulty + R_BALL + blockReach;
  if (d >= min || d === 0) return;
  if (!ball.owner && callOffside(p)) return;
  const nx = dx / d, ny = dy / d;

  if (ball.owner) {
    const owner = ball.owner;
    if (owner === p || owner.side === p.side) return;
    const rel = Math.hypot(p.vx - owner.vx, p.vy - owner.vy);
    const assist = mode === '1p' && p.side === 0 ? HUMAN_ASSIST[level] : 0;
    const contest = p.defenseMul / (p.defenseMul + owner.defenseMul);
    if ((p.tackleT > 0 && Math.random() < contest + .18 + assist) ||
        rel > P_MAX * 0.72) {
      owner.trapCd = REOWN_CD;
      ball.owner = null; ball.freeCd = 0.06; ball.lastTouch = p;
      ball.x = p.x + nx * min; ball.y = p.y + ny * min;
      ball.vx = p.vx * 0.75 + nx * TOUCH_V;
      ball.vy = p.vy * 0.75 + ny * TOUCH_V;
      p.tackleT = 0;
    }
    return;
  }

  ball.x = p.x + nx * min; ball.y = p.y + ny * min;
  ball.lastTouch = p;

  // 골키퍼는 잡아서 앞으로 크게 걷어낸다. 다른 선수처럼 튕겨내면
  // 골문 앞에서 공이 계속 맴돌아 결국 실점한다.
  if (p.isGK) {
    if (ball.shotSide === 1 - p.side && !ball.shotCounted) {
      matchStats.onTarget[ball.shotSide]++; ball.shotCounted = true;
    }
    if (p.gkClaim) { matchStats.gkClaims[p.side]++; p.gkClaim = false; }
    ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
    p.kickCd = 0.35;
    const dir = attackDir[p.side];
    const ang = Math.atan2((FH / 2 - p.y) * 0.6 + (Math.random() * 2 - 1) * 300, dir * 900);
    // 잡은 공을 손에서 놓고 펀트한다. 전에는 1150(207km/h)으로 슛보다
    // 빨랐고 B_MAX 클램프도 우회했다.
    ball.vx = Math.cos(ang) * GK_CLEAR_V;
    ball.vy = Math.sin(ang) * GK_CLEAR_V;
    ball.z = 0;
    ball.vz = loftFor(GK_CLEAR_DIST, GK_CLEAR_V, 1.8);
    return;
  }

  if (ball.shotSide === 1 - p.side) {
    if (!ball.blockCounted) matchStats.blocks[p.side]++;
    ball.blockCounted = true;
  }

  // 높이 구간별 경합. 발 구간에서만 트래핑·드리블·의도한 킥이 나온다.
  if (ball.z > CHEST_H) { headBall(p, nx, ny); return; }
  if (ball.z > FOOT_H) { deflectBall(p, nx, ny); return; }

  let vx, vy, deliberateKick = false;
  if (p.actShoot > 0 && p.kickCd <= 0) {
    deliberateKick = true;
    p.actShoot = 0; p.kickCd = 0.3;
    matchStats.shots[p.side]++;
    ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
    const a = aimAt(p.side);
      const ang = Math.atan2(a.y - p.y, a.x - p.x);
      vx = Math.cos(ang) * SHOOT_V * p.shotMul; vy = Math.sin(ang) * SHOOT_V * p.shotMul;
  } else if (p.actPass > 0 && p.kickCd <= 0) {
    deliberateKick = true;
    p.actPass = 0; p.kickCd = 0.25;
    markOffside(p);
    const t = passTarget(p);
    if (t) {
      const ang = Math.atan2(t.y - p.y, t.x - p.x);
      const d2 = Math.hypot(t.x - p.x, t.y - p.y);
      const v = Math.min(PASS_V * p.passMul, 420 + d2 * 0.9 * p.passMul);
      vx = Math.cos(ang) * v; vy = Math.sin(ang) * v;
    } else {
      const a = aimAt(p.side);
      const ang = Math.atan2(a.y - p.y, a.x - p.x);
      vx = Math.cos(ang) * PASS_V * 0.8 * p.passMul;
      vy = Math.sin(ang) * PASS_V * 0.8 * p.passMul;
    }
  } else if (p.actThrough > 0 && p.kickCd <= 0) {
    deliberateKick = true;
    p.actThrough = 0; p.kickCd = 0.25;
    markOffside(p);
    const t = passTarget(p, true);
    const tx = t ? t.x + attackDir[p.side] * 150 : p.x + attackDir[p.side] * 600;
    const ty = t ? t.y : p.y;
    const ang = Math.atan2(ty - p.y, tx - p.x);
    vx = Math.cos(ang) * PASS_V; vy = Math.sin(ang) * PASS_V;
  } else if (Math.hypot(ball.vx - p.vx, ball.vy - p.vy) < TRAP_V &&
             d < TRAP_R && takePossession(p)) {
    return;
  } else {
    // 빠른 공은 트래핑하지 못하고 몸에 튕긴다
    const carry = Math.max(0, p.vx * nx + p.vy * ny);
    const v = TOUCH_V + carry * 0.5;
    vx = nx * v + p.vx * 0.3; vy = ny * v + p.vy * 0.3;
  }
  if (deliberateKick && ball.shotSide < 0 &&
      goalBoundKick(p.side, ball.x, ball.y, vx, vy)) {
    matchStats.shots[p.side]++;
    ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  }
  const sp = Math.hypot(vx, vy);
  ball.vx = sp > B_MAX ? vx / sp * B_MAX : vx;
  ball.vy = sp > B_MAX ? vy / sp * B_MAX : vy;
}

function inPenaltyArea(side, x, y) {
  if (y < (FH - PA_W) / 2 || y > (FH + PA_W) / 2) return false;
  return attackDir[side] === 1 ? x > FW - PA_D : x < PA_D;
}

function callFoul(tackler, victim) {
  if (state !== 'play' || tackleFoulGuard) return;
  tackleFoulGuard = true;
  tackler.tackleT = 0; tackler.tackleCd = Math.max(tackler.tackleCd, 1);
  matchStats.fouls[tackler.side]++;
  const rel = Math.hypot(tackler.vx - victim.vx, tackler.vy - victim.vy);
  if (rel > 420) {
    tackler.yellow = 1; matchStats.cards[tackler.side]++;
    notice = { text:'파울 · 옐로카드', timer:1.2, color:'#F2CE4A' };
  } else {
    notice = { text:'파울', timer:1.0, color:'#F2F7F4' };
  }
  if (ball.owner) { ball.owner.trapCd = REOWN_CD; ball.owner = null; }
  if (inPenaltyArea(victim.side, victim.x, victim.y)) {
    beginSetpiece('penalty', victim.side, {
      x:attackDir[victim.side] === 1 ? FW - PEN_SPOT : PEN_SPOT, y:FH / 2
    });
  } else {
    beginSetpiece('free', victim.side, { x:victim.x, y:victim.y });
  }
}

// 선수끼리 겹치지 않게 (22명 → 231쌍, Canvas 2D 로 충분히 가볍다)
let tackleFoulGuard = false;
function separateAll() {
  tackleFoulGuard = false;
  const all = teams[0].concat(teams[1]);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy), min = R_PLAYER * 2;
    if (d >= min || d === 0) continue;
    if (a.side !== b.side) {
      const tackler = a.tackleT > 0 ? a : b.tackleT > 0 ? b : null;
      const victim = tackler === a ? b : a;
      if (tackler) {
        const ballDist = Math.hypot(ball.x - tackler.x, ball.y - tackler.y);
        if (ballDist > d + R_BALL * 0.6) {
          callFoul(tackler, victim);
          if (state !== 'play') return;
        }
      }
    }
    const push = (min - d) / 2, nx = dx / d, ny = dy / d;
    a.x -= nx * push; a.y -= ny * push;
    b.x += nx * push; b.y += ny * push;
    a.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, a.x));
    a.y = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, a.y));
    b.x = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, b.x));
    b.y = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, b.y));
  }
}

function goal(side) {
  const attackingLastTouch = !ball.owner && ball.lastTouch &&
    ball.lastTouch.side === side;
  if (ball.shotSide === side || attackingLastTouch) {
    if (ball.shotSide !== side) matchStats.shots[side]++;
    matchStats.shotGoals[side]++;
    if (!ball.shotCounted) matchStats.onTarget[side]++;
  } else {
    matchStats.nonShotGoals[side]++;
    matchStats[ball.owner ? 'carryGoals' : 'looseGoals'][side]++;
    if (!ball.owner) {
      const ownGoal = ball.lastTouch && ball.lastTouch.side !== side;
      matchStats[ownGoal ? 'ownGoals' : 'attackingLooseGoals'][side]++;
    }
  }
  if (ball.headShot && ball.shotSide === side) matchStats.headGoals[side]++;
  score[side]++; lastScorer = side;
  ball.owner = null; setpiece = null;
  state = 'goal'; goalTimer = GOAL_PAUSE;
  syncHud();
}
