'use strict';
// 06-contact.js — 킥·스핀, 연속 3D 접촉 판정(발·가슴·헤딩·발리), GK 패링/캐치, 파울, 득점
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

function computeKickSpin(p, kind, vx, vy, lift, power) {
  const sp = Math.hypot(vx, vy);
  const ux = sp > 1 ? vx / sp : attackDir[p.side];
  const uy = sp > 1 ? vy / sp : 0;
  // 충전 중 방향 꺾기(kickCurve) + 가로질러 달리며 찬 자연 커브
  const crossVel = (p.vx * uy - p.vy * ux) / P_MAX;
  const bend = (p.kickCurve || 0) * 14 * (0.45 + 0.55 * power) + crossVel * 4.5;
  let spinTop = 1.5;
  if (kind === 'shoot') {
    spinTop = power > 0.36 ? (power - 0.32) * 14 : 1.5;
  } else if (lift > 28) {
    spinTop = -5.5 - power * 6;
  }
  return {
    spinZ:Math.max(-20, Math.min(20, bend)),
    spinTop:Math.max(-16, Math.min(16, spinTop))
  };
}

function buildKickPlan(p, kind, power = 0.65) {
  let tx, ty, v, lift = 0;
  const aimMag = Math.hypot(p.aimX, p.aimY);
  const dir = attackDir[p.side];
  const lp = Math.max(0, (power - 0.4) / 0.6);
  if (kind === 'shoot') {
    if (p.manualAim && aimMag > 0.2) {
      tx = p.x + p.aimX / aimMag * 1000; ty = p.y + p.aimY / aimMag * 1000;
    } else {
      const a = aimAt(p.side, p); tx = a.x; ty = a.y;
    }
    v = SHOOT_V * p.shotMul * (0.60 + 0.42 * power) *
      (mode === '1p' && p === ctrl[0] ? 1 + HUMAN_ASSIST[level] * 0.6 : 1);
    lift = shotLift(Math.max(120, dir === 1 ? FW - p.x : p.x), v, power);
  } else {
    const through = kind === 'through';
    const groundPass = p === ctrl[0] && !through;
    const humanCross = p === ctrl[0] && through;
    const t = passTarget(p, through);
    if (t) {
      const lead = through ? Math.min(230, Math.hypot(t.vx, t.vy) * 0.55 + 90) : 0;
      const tm = Math.hypot(t.vx, t.vy);
      tx = t.x + (tm > 5 ? t.vx / tm : dir) * lead;
      ty = t.y + (tm > 5 ? t.vy / tm : 0) * lead;
      const d = Math.hypot(tx - p.x, ty - p.y);
      const passCap = PASS_V * p.passMul * (through ? 1.15 : 1.05);
      v = Math.min(passCap, 150 + d * p.passMul * (through ? 0.48 : 0.42));
      const cross = !groundPass && !humanCross &&
        Math.min(p.y, FH - p.y) < FH * 0.24 &&
        (dir === 1 ? p.x : FW - p.x) > FW * 0.58 &&
        Math.abs(t.y - FH / 2) < FH * 0.30;
      if (cross) {
        matchStats.crosses[p.side]++;
        lift = loftFor(d, v, 1.6);
      } else if (through && !humanCross && lp > 0.5) {
        v *= 0.78; lift = loftFor(d, v, 2.0);
      } else if (!groundPass && !humanCross && lp > 0) {
        v *= 0.92; lift = loftFor(d, v, 1.1) * lp;
      }
    } else if (aimMag > 0.2) {
      tx = p.x + p.aimX / aimMag * 800; ty = p.y + p.aimY / aimMag * 800;
      v = PASS_V * p.passMul * (through ? 0.95 : 0.82);
      if (!groundPass && !humanCross && lp > 0) {
        v *= 0.92; lift = loftFor(800, v, 1.1) * lp;
      }
    } else {
      const a = aimAt(p.side, p); tx = a.x; ty = a.y; v = PASS_V * 0.8;
    }
    if (groundPass) {
      v = PASS_V * p.passMul * (0.45 + 0.58 * power);
      lift = 0;
    }
    if (humanCross) {
      const reach = (16 + 42 * power) * M;
      v = Math.min(B_MAX * 0.72, 240 + power * 230);
      lift = loftFor(reach, v, 2.2);
      matchStats.crosses[p.side]++;
    }
  }
  const ang = Math.atan2(ty - p.y, tx - p.x);
  const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v;
  const spin = computeKickSpin(p, kind, vx, vy, lift, power);
  return { vx, vy, lift, spinZ:spin.spinZ, spinTop:spin.spinTop };
}

function kickOwned(p, kind, power = 0.65) {
  if (ball.owner !== p || p.kickCd > 0) return false;
  if (kind === 'shoot') matchStats.shots[p.side]++;
  if (kind === 'pass' || kind === 'through') markOffside(p);
  const plan = buildKickPlan(p, kind, power);
  releaseBall(p, plan.vx, plan.vy, plan.lift, plan.spinZ, plan.spinTop);
  if (kind === 'shoot') ball.shotSide = p.side;
  else if (goalBoundKick(p.side, p.x, p.y, plan.vx, plan.vy)) {
    matchStats.shots[p.side]++;
    ball.shotSide = p.side;
  }
  p.actShoot = p.actPass = p.actThrough = 0;
  p.kickCurve = 0;
  setPose(p, kind === 'shoot' ? 'shoot' : 'kick');
  return true;
}

// 빠른 공이 발에 닿았을 때 멀리 튀지 않고 선수 바로 앞에 감속해 떨어뜨려 곧바로 잡게 한다.
function dropAtFeet(p, fx, fy, relSp) {
  const skill = p.stats.pass / 99;
  const dropSp = 14 + (1 - skill) * 10;
  const tx = p.x + fx * (R_PLAYER + R_BALL + 5);
  const ty = p.y + fy * (R_PLAYER + R_BALL + 5);
  const toX = tx - ball.x, toY = ty - ball.y;
  const toM = Math.hypot(toX, toY);
  const ux = toM > 0.5 ? toX / toM : fx, uy = toM > 0.5 ? toY / toM : fy;
  ball.vx = p.vx * 0.85 + ux * dropSp;
  ball.vy = p.vy * 0.85 + uy * dropSp;
  ball.vz = Math.min(10, 4 + relSp * 0.008);
  ball.z = Math.min(ball.z, FOOT_H * 0.4);
  ball.spinZ *= 0.15; ball.spinTop = -1.5;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.freeCd = Math.max(ball.freeCd, 0.04);
  p.trapCd = Math.max(p.trapCd, 0.06);
}

// 느린·보통 공중볼이 몸통/허벅지에 닿았을 때 발 앞으로 부드럽게 떨어뜨린다.
function cushionBodyBall(p, nx, ny) {
  matchStats.deflections[p.side]++;
  const relSp = Math.hypot(ball.vx - p.vx, ball.vy - p.vy);
  const am = Math.hypot(p.aimX, p.aimY);
  const fx = am > 0.1 ? p.aimX / am : nx;
  const fy = am > 0.1 ? p.aimY / am : ny;
  const dropSp = 28 + (1 - p.stats.pass / 99) * 16 + Math.min(20, relSp * 0.08);
  ball.vx = p.vx * 0.85 + fx * dropSp;
  ball.vy = p.vy * 0.85 + fy * dropSp;
  ball.vz = Math.max(8, Math.min(22, -ball.vz * 0.12 + 10));
  ball.spinZ *= 0.2; ball.spinTop = -1.5;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.freeCd = Math.max(ball.freeCd, 0.05);
  p.trapCd = Math.max(p.trapCd, 0.10);
  setPose(p, 'deflect');
}

// 빠른 공이 몸통·어깨·머리에 맞았을 때 표면 법선을 따라 강하게 튕겨 나간다.
function reboundOffBody(p, nx, ny, part) {
  if (part === 'head') matchStats.headers[p.side]++;
  else matchStats.deflections[p.side]++;
  const rvx = ball.vx - p.vx, rvy = ball.vy - p.vy;
  const relSp = Math.hypot(rvx, rvy);
  const vn = rvx * nx + rvy * ny;
  const rest = part === 'head' ? 0.58 : 0.46;
  let vx, vy;
  if (vn < 0) {
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const outN = Math.max(TOUCH_V * 1.05, -vn * rest);
    const outT = vt * (part === 'head' ? 0.72 : 0.62);
    vx = p.vx + nx * outN + tx * outT;
    vy = p.vy + ny * outN + ty * outT;
    ball.spinZ = Math.max(-20, Math.min(20, ball.spinZ * 0.4 + vt * 0.025));
  } else {
    const outN = Math.max(TOUCH_V * 1.05, relSp * rest);
    vx = p.vx * 0.6 + nx * outN;
    vy = p.vy * 0.6 + ny * outN;
    ball.spinZ *= 0.4;
  }
  const sp = Math.hypot(vx, vy);
  if (sp > B_MAX) { vx = vx / sp * B_MAX; vy = vy / sp * B_MAX; }
  ball.vx = vx; ball.vy = vy;
  ball.vz = part === 'head'
    ? Math.max(42, -ball.vz * 0.35 + Math.min(95, relSp * 0.16))
    : Math.max(24, Math.abs(ball.vz) * 0.32 + 26);
  ball.spinTop = part === 'head' ? -2 : 0;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.freeCd = Math.max(ball.freeCd, 0.08);
  p.trapCd = Math.max(p.trapCd, 0.22);
  if (part === 'head') p.headCd = Math.max(p.headCd, 0.28);
  setPose(p, part === 'head' ? 'deflect' : (p.blockT > 0 ? 'block' : 'deflect'));
  sfx('kick', Math.min(0.85, Math.max(0.35, relSp / SHOOT_V)));
}

// 헤딩(1.5~2.3m). 소유로 전환하지 않고 머리로 슛·클리어링한다.
function headBall(p, nx, ny) {
  if (p.headCd > 0) return;
  p.headCd = HEAD_CD;
  matchStats.headers[p.side]++;
  const dir = attackDir[p.side];
  const attacking = (dir === 1 ? FW - p.x : p.x) < FW * 0.32;
  let ang, v, lift;
  if (attacking) {
    const a = aimAt(p.side, p);
    ang = Math.atan2(a.y - p.y, a.x - p.x);
    v = HEAD_V; lift = 10;
    matchStats.shots[p.side]++;
    ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
    ball.headShot = true;
  } else {
    ang = Math.atan2((FH / 2 - p.y) * 0.35 + (Math.random() * 2 - 1) * 260, dir * 800);
    v = HEAD_V * 1.15; lift = 120;
    ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  }
  if (p.manualAim) ang = angLerp(ang, Math.atan2(p.aimY, p.aimX), 0.72);
  const skill = (attacking ? p.stats.shot : p.stats.defense) / 99;
  ang += (Math.random() * 2 - 1) * HEAD_ERR * (1 - skill * 0.55);
  ball.vx = Math.cos(ang) * v; ball.vy = Math.sin(ang) * v;
  ball.vz = lift; ball.spinZ *= 0.3; ball.spinTop = attacking ? 5 : -3;
  ball.freeCd = Math.max(ball.freeCd, 0.12);
  p.trapCd = Math.max(p.trapCd, HEAD_CD);
  setPose(p, 'header');
  sfx('kick', 0.45);
}

function handleGKContact(p, contact, d, min) {
  if (ball.shotSide === 1 - p.side && !ball.shotCounted) {
    matchStats.onTarget[ball.shotSide]++; ball.shotCounted = true;
  }
  if (p.gkClaim) { matchStats.gkClaims[p.side]++; p.gkClaim = false; }
  const wasEnemyShot = ball.shotSide === 1 - p.side;
  const ballSp = Math.hypot(ball.vx, ball.vy, ball.vz);
  const reachFrac = d / Math.max(1, min);
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  ball.lastTouch = p;

  // 강한 슛·먼 다이빙·높은 슛은 쳐내기(패링)로 세컨드볼/코너를 만든다.
  const hardParry = wasEnemyShot && (ballSp > 460 || reachFrac > 0.60 || contact.z > HEAD_H * 0.85);
  if (hardParry) {
    const dir = attackDir[p.side];
    const sideSign = contact.y < FH / 2 ? -1 : 1;
    const ang = Math.atan2(sideSign * 0.82 + (Math.random() - 0.5) * 0.3, dir * 0.58);
    const outV = 175 + Math.min(135, ballSp * 0.22);
    ball.x = contact.x; ball.y = contact.y;
    ball.vx = Math.cos(ang) * outV;
    ball.vy = Math.sin(ang) * outV;
    ball.vz = 55 + Math.random() * 55;
    ball.spinZ = sideSign * 8; ball.spinTop = -3;
    ball.freeCd = 0.08;
    p.kickCd = 0.28; p.trapCd = 0.26;
    setPose(p, 'gk-dive');
    sfx('save', 0.9);
    return;
  }

  // 제어 가능한 공은 품에 안고(gkHoldT) 잠시 뒤 패스 또는 펀트로 배급한다.
  ball.owner = p;
  p.gkHoldT = GK_HOLD_SEC;
  p.kickCd = 0.25;
  ball.x = contact.x; ball.y = contact.y; ball.z = 16;
  ball.vx = p.vx; ball.vy = p.vy; ball.vz = 0;
  ball.spinZ = 0; ball.spinTop = 0;
  setPose(p, 'gk-claim');
  sfx('save', 0.5);
}

function executeFirstTouch(p, kind) {
  const power = p.kickPower || (kind === 'shoot' ? Math.min(1, p.actShoot) : 0.45);
  if (kind === 'shoot') matchStats.shots[p.side]++;
  if (kind === 'pass' || kind === 'through') markOffside(p);
  const plan = buildKickPlan(p, kind, power);
  const sp = Math.hypot(plan.vx, plan.vy);
  ball.vx = sp > B_MAX ? plan.vx / sp * B_MAX : plan.vx;
  ball.vy = sp > B_MAX ? plan.vy / sp * B_MAX : plan.vy;
  // 발리/하프발리일 때는 기존 수직 속도를 지우고 새 탄도를 적용한다.
  ball.vz = plan.lift;
  ball.spinZ = plan.spinZ; ball.spinTop = plan.spinTop;
  ball.freeCd = Math.max(ball.freeCd, 0.08);
  p.trapCd = REOWN_CD;
  p.kickCd = kind === 'shoot' ? 0.3 : 0.25;
  p.actShoot = p.actPass = p.actThrough = 0;
  p.kickCurve = 0;
  if (kind === 'shoot') {
    ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  } else if (goalBoundKick(p.side, ball.x, ball.y, ball.vx, ball.vy)) {
    matchStats.shots[p.side]++;
    ball.shotSide = p.side; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  }
  setPose(p, kind === 'shoot' ? 'shoot' : 'kick');
  sfx('kick', Math.max(0.35, Math.min(1, Math.hypot(ball.vx, ball.vy, ball.vz) / SHOOT_V)));
}

function tryStealOwnedBall(p, dToPlayer, nx, ny) {
  const owner = ball.owner;
  if (owner === p || owner.side === p.side) return;
  if (owner.isGK && owner.gkHoldT > 0) return;          // 키퍼 손에 든 공은 탈취 불가
  const rel = Math.hypot(p.vx - owner.vx, p.vy - owner.vy);
  const assist = mode === '1p' && p.side === 0 ? HUMAN_ASSIST[level] : 0;
  const contest = p.defenseMul / (p.defenseMul + owner.defenseMul);
  const ownerDist = Math.hypot(owner.x - p.x, owner.y - p.y);
  const angleBonus = dToPlayer < ownerDist + 4 ? 0.20 : -0.14;
  if ((p.tackleT > 0 && Math.random() < contest + 0.16 + assist + angleBonus) ||
      rel > P_MAX * 0.72) {
    owner.trapCd = REOWN_CD;
    ball.owner = null; ball.freeCd = 0.06; ball.lastTouch = p;
    ball.vx = p.vx * 0.8 + nx * TOUCH_V;
    ball.vy = p.vy * 0.8 + ny * TOUCH_V;
    ball.vz = 14;
    ball.spinZ = (Math.random() * 2 - 1) * 5;
    p.tackleT = 0;
  }
}

function collide(p) {
  if (p.isGK) {
    const contact = ballContactPoint(p);
    if (contact.z > GK_HIGH_H) return;
    const dx = contact.x - p.x, dy = contact.y - p.y;
    const gkAssist = p.side === 0 && mode === '1p' ? 1 + HUMAN_ASSIST[level] : 1;
    const gkDifficulty = p.gkDifficulty / LEVELS[1].gk;
    const d = Math.hypot(dx, dy), min = p.reach * gkAssist * gkDifficulty + R_BALL;
    if (d >= min) return;
    if (!ball.owner && callOffside(p)) return;
    const bm = Math.hypot(ball.vx, ball.vy);
    const nx = d > 1e-4 ? dx / d : (bm > 1 ? -ball.vx / bm : (p.aimX || attackDir[p.side]));
    const ny = d > 1e-4 ? dy / d : (bm > 1 ? -ball.vy / bm : (p.aimY || 0));
    if (ball.owner) { tryStealOwnedBall(p, d, nx, ny); return; }
    if (p.kickCd > 0 && ball.lastTouch === p) return;
    handleGKContact(p, contact, d, min);
    return;
  }

  const blockReach = p.blockT > 0 && ball.shotSide === 1 - p.side
    ? SHOT_BLOCK_REACH * p.defenseMul : 0;
  const maxR = 22 + blockReach;
  if (Math.abs(ball.x - p.x) > maxR + 60 || Math.abs(ball.y - p.y) > maxR + 60) return;

  const hit = findFieldBodyHit(p, blockReach);
  if (!hit) return;
  const dx = hit.bx - hit.cx, dy = hit.by - hit.cy;
  const bm = Math.hypot(ball.vx, ball.vy);
  const nx = hit.d > 1e-4 ? dx / hit.d : (bm > 1 ? -ball.vx / bm : hit.fx);
  const ny = hit.d > 1e-4 ? dy / hit.d : (bm > 1 ? -ball.vy / bm : hit.fy);

  if (ball.owner) {
    tryStealOwnedBall(p, Math.hypot(ball.x - p.x, ball.y - p.y), nx, ny);
    return;
  }
  if (p.kickCd > 0 && ball.lastTouch === p) return;
  if (callOffside(p)) return;

  const relSpXY = Math.hypot(ball.vx - p.vx, ball.vy - p.vy);
  const relSp3D = Math.hypot(relSpXY, ball.vz * 0.5);
  if (hit.part === 'head' && p.headCd > 0 && relSp3D < FAST_HEAD_V) return;

  const wantKind = p.kickCd <= 0
    ? (p.actShoot > 0 ? 'shoot' : p.actThrough > 0 ? 'through' : p.actPass > 0 ? 'pass' : null)
    : null;

  if (ball.shotSide === 1 - p.side) {
    if (!ball.blockCounted) matchStats.blocks[p.side]++;
    ball.blockCounted = true;
  }

  // 정지·보통 속도 낮은 공은 바깥으로 밀어내지 않고 즉시 발에 붙여 소유한다.
  if (hit.part === 'foot' && !wantKind && relSpXY < FAST_FOOT_V && takePossession(p)) {
    return;
  }

  ball.x = hit.cx + nx * hit.min; ball.y = hit.cy + ny * hit.min; ball.z = hit.bz;
  ball.lastTouch = p;

  if (hit.part === 'head') {
    if (relSp3D >= FAST_HEAD_V) reboundOffBody(p, nx, ny, 'head');
    else headBall(p, nx, ny);
    return;
  }

  if (wantKind && (hit.part === 'foot' || relSp3D < FAST_BODY_V)) {
    executeFirstTouch(p, wantKind);
    return;
  }

  if (hit.part === 'body') {
    if (relSp3D >= FAST_BODY_V) reboundOffBody(p, nx, ny, 'body');
    else cushionBodyBall(p, nx, ny);
    return;
  }

  if (relSpXY < FAST_FOOT_V) {
    ball.vx = p.vx * 0.9 + (ball.vx - p.vx) * 0.5;
    ball.vy = p.vy * 0.9 + (ball.vy - p.vy) * 0.5;
    return;
  }
  ball.x = hit.cx + nx * (hit.min + 0.5);
  ball.y = hit.cy + ny * (hit.min + 0.5);
  dropAtFeet(p, hit.fx, hit.fy, relSpXY);
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
  sfx('whistle', 0.9);
  if (ball.owner) { ball.owner.trapCd = REOWN_CD; ball.owner = null; }
  if (inPenaltyArea(victim.side, victim.x, victim.y)) {
    beginSetpiece('penalty', victim.side, {
      x:attackDir[victim.side] === 1 ? FW - PEN_SPOT : PEN_SPOT, y:FH / 2
    });
  } else {
    beginSetpiece('free', victim.side, { x:victim.x, y:victim.y });
  }
}

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
  sfx('goal', 1);
  syncHud();
}
