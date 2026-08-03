'use strict';
// 07-ai.js — AI 목표 선정·행동, 골키퍼 판단, 사람 입력 읽기, 조작 선수 전환
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── AI ─────────────────────────────────────────────────────────────
// 팀에서 공에 가장 가까운 필드 선수만 공을 쫓고, 나머지는 포메이션 위치를
// 공 위치에 따라 밀고 당긴 지점을 지킨다. 전원이 공만 쫓으면 뭉쳐버린다.
function nearestToBall(side, exclude) {
  let best = null, bd = Infinity;
  for (const p of teams[side]) {
    if (p.isGK || p === exclude) continue;
    const d = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function nearestChasers(side, exclude) {
  let first = null, second = null, d1 = Infinity, d2 = Infinity;
  for (const p of teams[side]) {
    if (p.isGK || p === exclude) continue;
    const d = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (d < d1) { second = first; d2 = d1; first = p; d1 = d; }
    else if (d < d2) { second = p; d2 = d; }
  }
  return teamTactics(side).chasers > 1 && second ? [first, second] : [first];
}

// 포메이션 위치를 공 쪽으로 이동시킨 목표 지점
function slotTarget(p, offsideLine = null) {
  const h = homePos(p);
  const tactic = teamTactics(p.side);
  const shiftX = (ball.x - FW / 2) * tactic.press;
  // 폭은 공 쪽으로 전원이 몰리는 정도가 아니라, 대형 자체가 좌우로
  // 벌어지는 정도다. 공을 따라가는 이동은 작게 유지해 넓은 전개가
  // 두 명 압박을 자연스럽게 분산시키게 한다.
  const spread = .72 + tactic.width * 1.55;
  const shiftY = (ball.y - FH / 2) * .18;
  let tx = h.x + shiftX;
  let ty = FH / 2 + (h.y - FH / 2) * spread + shiftY;
  // 수비는 자기 진영을 크게 벗어나지 않는다
  if (p.role === 'DF') {
    tx = attackDir[p.side] === 1
      ? Math.min(tx, FW * tactic.line)
      : Math.max(tx, FW * (1 - tactic.line));
  }
  if (level > 0 && (p.role === 'MF' || p.role === 'FW')) {
    const line = offsideLine ?? secondLastDefenderLine(p.side);
    const dir = attackDir[p.side];
    const safe = line - dir * 36;
    const excess = (tx - safe) * dir;
    const phase = Math.floor(clock / 4) + p.no;
    const attackingSide = ball.owner ? ball.owner.side :
      (ball.lastTouch ? ball.lastTouch.side : -1);
    const riskyRun = p.role === 'FW' && attackingSide === p.side &&
      ball.owner !== p && phase % OFFSIDE_RUN_PERIOD[level] === 0;
    if (riskyRun) {
      const risky = line + dir * 160;
      if ((risky - tx) * dir > 0) tx = risky;
    } else if (excess > 0) {
      tx = safe + dir * excess * (1 - OFFSIDE_DISCIPLINE[level]);
    }
  }
  return {
    x:Math.max(R_PLAYER, Math.min(FW - R_PLAYER, tx)),
    y:Math.max(100, Math.min(FH - 100, ty))
  };
}

function segmentPointDistance(p, a, b) {
  const ux = b.x - a.x, uy = b.y - a.y;
  const u2 = ux * ux + uy * uy;
  const q = u2 ? Math.max(0, Math.min(1,
    ((p.x - a.x) * ux + (p.y - a.y) * uy) / u2)) : 0;
  const x = a.x + ux * q, y = a.y + uy * q;
  return { q, x, y, distance:Math.hypot(p.x - x, p.y - y) };
}

function defensiveTarget(p, fallback, isChaser) {
  if (isChaser || p.isGK || p.role === 'FW' || !ball.owner ||
      ball.owner.side === p.side) return fallback;

  const owner = ball.owner;
  const ownGoal = { x:attackDir[p.side] === 1 ? 0 : FW, y:FH / 2 };
  const markers = teams[p.side].filter(t => !t.isGK && t.role !== 'FW')
    .sort((a, b) => a.y - b.y || a.no - b.no);
  const threats = teams[owner.side].filter(t => !t.isGK && t !== owner)
    .sort((a, b) => a.y - b.y || a.no - b.no);
  const markerIndex = markers.indexOf(p);
  let target = fallback;

  // 대형 슬롯을 버리지 않되, 대응 공격수보다 골문 쪽에 선다.
  if (markerIndex >= 0 && threats.length) {
    const threatIndex = Math.min(threats.length - 1,
      Math.floor(markerIndex * threats.length / markers.length));
    const threat = threats[threatIndex];
    const gx = ownGoal.x - threat.x, gy = ownGoal.y - threat.y;
    const gm = Math.max(1, Math.hypot(gx, gy));
    const mark = { x:threat.x + gx / gm * 52, y:threat.y + gy / gm * 52 };
    target = { x:mark.x * .72 + fallback.x * .28,
      y:mark.y * .72 + fallback.y * .28 };
  }

  // 공격이 고르는 것과 같은 레인 위험 함수·패스 대상을 공유한다.
  const receiver = passTarget(owner);
  if (receiver) {
    const laneMid = { x:owner.x + (receiver.x - owner.x) * .52,
      y:owner.y + (receiver.y - owner.y) * .52 };
    const guards = markers.slice().sort((a, b) =>
      Math.hypot(a.x - laneMid.x, a.y - laneMid.y) -
      Math.hypot(b.x - laneMid.x, b.y - laneMid.y)).slice(0, 2);
    if (guards.includes(p) && passLaneRisk(owner, receiver, [p]) < 160) {
      const lane = segmentPointDistance(p, owner, receiver);
      const q = Math.max(.28, Math.min(.76, lane.q));
      target = { x:owner.x + (receiver.x - owner.x) * q,
        y:owner.y + (receiver.y - owner.y) * q };
    }
  }

  // 페널티 지역 쪽에서는 두 수비수가 슈터와 골문 사이를 직접 막는다.
  const goalDistance = Math.hypot(owner.x - ownGoal.x, owner.y - ownGoal.y);
  if (p.role === 'DF' && goalDistance < FW * .38) {
    const gx = ownGoal.x - owner.x, gy = ownGoal.y - owner.y;
    const gm = Math.max(1, Math.hypot(gx, gy));
    const block = { x:owner.x + gx / gm * 88, y:owner.y + gy / gm * 88 };
    const blockers = teams[p.side].filter(t => t.role === 'DF')
      .sort((a, b) => Math.hypot(a.x - block.x, a.y - block.y) -
        Math.hypot(b.x - block.x, b.y - block.y)).slice(0, 3);
    const bi = blockers.indexOf(p);
    if (bi >= 0) {
      p.blockT = Math.max(p.blockT, .25);
      const offset = (bi - 1) * 20;
      target = { x:block.x - gy / gm * offset, y:block.y + gx / gm * offset };
    }
  }

  return {
    x:Math.max(R_PLAYER, Math.min(FW - R_PLAYER, target.x)),
    y:Math.max(R_PLAYER, Math.min(FH - R_PLAYER, target.y))
  };
}

function gkTarget(p) {
  const dir = attackDir[p.side];
  const gx = dir === 1 ? 0 : FW;

  // 크로스가 들어오면 나와서 잡는다. 항상 나오면 골문이 비고 안 나오면
  // 크로스가 무적이 되므로, 낙하 지점까지 제때 갈 수 있을 때만 나간다.
  // keeping 이 판단 거리를 늘려서 결정이 양극단으로 굳지 않게 한다.
  p.gkClaim = false;
  if (ball.z > FOOT_H && !ball.owner) {
    const land = ballLanding();
    if (land.t > 0.25 && inPenaltyArea(p.side, land.x, land.y)) {
      const reach = SPEED_RUN * land.t * (0.70 + p.stats.keeping / 99 * 0.50);
      if (Math.hypot(land.x - p.x, land.y - p.y) < reach) {
        p.gkClaim = true;
        return { x:land.x, y:land.y, claim:true };
      }
    }
  }

  // 골라인에서 조금 나와 공과 골문 중심을 잇는 선 위에 선다
  const t = Math.max(0, Math.min(1, 1 - Math.abs(ball.x - gx) / (FW * 0.35)));
  const out = 40 + t * (PA_D * 0.55);
  const keeping = .78 + p.stats.keeping / 99 * .18;
  const ty = FH / 2 + (ball.y - FH / 2) * keeping;
  return {
    x:gx + dir * out,
    y:Math.max((FH - GOAL_H) / 2 - 30, Math.min((FH + GOAL_H) / 2 + 30, ty)),
    claim:false
  };
}

function aiPlayer(p, dt, L, isChaser, offsideLine = null) {
  if (p.isGK) p.gkDifficulty = L.gk;
  p.aiT -= dt;
  if (p.aiT <= 0) {
    p.aiT = L.react * (p.isGK ? 0.5 : 1);
    let t;
    if (p.isGK) {
      t = gkTarget(p);
      // 하이볼을 잡으러 나가는 중이면 골문 폭 제한을 걸지 않는다.
      if (!t.claim) {
        // 골키퍼 반응은 별도 계수 — 난이도가 낮으면 늦게 붙는다
        t.y = FH / 2 + (t.y - FH / 2) * Math.min(1, L.gk);
        t.y = Math.max((FH - GOAL_H) / 2 - 30,
          Math.min((FH + GOAL_H) / 2 + 30, t.y));
      }
    } else if (ball.owner === p) {
      const dir = attackDir[p.side];
      t = { x:p.x + dir * 320, y:p.y + (FH / 2 - p.y) * 0.16 };
    } else if (isChaser) {
      const dir = attackDir[p.side];
      // 공중볼은 지금 위치가 아니라 낙하 지점으로 간다.
      const aim = ball.z > FOOT_H ? ballLanding() : ball;
      t = {
        x:aim.x - dir * (R_PLAYER + R_BALL + 4),
        y:aim.y + (Math.random() * 2 - 1) * L.aimErr
      };
    } else {
      const slot = slotTarget(p, offsideLine);
      t = defensiveTarget(p, slot, isChaser);
    }
    p.aiTx = Math.max(R_PLAYER, Math.min(FW - R_PLAYER, t.x));
    p.aiTy = Math.max(R_PLAYER, Math.min(FH - R_PLAYER, t.y));
  }

  let ax = p.aiTx - p.x, ay = p.aiTy - p.y;
  const d = Math.hypot(ax, ay);
  if (d > 6) {
    ax /= d; ay /= d;
  } else {
    // 위치를 지키는 동안에도 완전히 정지하지 않고 짧게 걸으며 시야를 잡는다.
    const patrol = clock * .7 + p.no * 1.7 + p.side * Math.PI;
    ax = Math.cos(patrol); ay = Math.sin(patrol);
  }

  let targetSpeed = SPEED_WALK;
  if (p.isGK) {
    // 하이볼을 잡으러 나갈 때만 전력으로 뛴다.
    targetSpeed = p.gkClaim ? SPEED_SPRINT : d > 120 ? SPEED_JOG : SPEED_WALK;
  } else if (ball.owner === p) {
    targetSpeed = SPEED_RUN;
  } else if (isChaser) {
    const chaseDistance = Math.hypot(ball.x - p.x, ball.y - p.y);
    targetSpeed = chaseDistance > 240 && p.energy > .08 ? SPEED_SPRINT
      : chaseDistance > 80 ? SPEED_RUN : SPEED_JOG;
  } else {
    const attacking = ball.owner && ball.owner.side === p.side;
    const forwardRun = attacking && p.role === 'FW' && d > 160 && p.energy > .08;
    targetSpeed = forwardRun ? SPEED_SPRINT
      : d > 430 ? SPEED_RUN : d > 140 ? SPEED_JOG : SPEED_WALK;
  }

  // 공이 발 앞에 있으면 슛이나 패스
  const bd = Math.hypot(ball.x - p.x, ball.y - p.y);
  if (ball.owner && ball.owner.side !== p.side && bd < TACKLE_TRIGGER && p.tackleCd <= 0) {
    p.tackleT = 0.22; p.tackleCd = 0.85;
  }
  if (bd < R_PLAYER + R_BALL + 24 && p.kickCd <= 0) {
    const dir = attackDir[p.side];
    const toGoal = dir === 1 ? FW - p.x : p.x;
    const exploitHighLine = teamTactics(p.side).width > .38 &&
      teamTactics(1 - p.side).line > .65;
    // 측면 깊은 위치면 크로스를 우선 검토한다. kickOwned 가 같은 조건에서
    // 체공을 붙이므로 여기서는 패스를 고르기만 하면 된다.
    const crossSpot = Math.min(p.y, FH - p.y) < FH * 0.24 && toGoal < FW * 0.42;
    if (p.isGK) {
      // 처리는 collide() 안에서 직접 한다 (잡아서 걷어내기)
    } else if (toGoal < FW * 0.39 && !crossSpot && Math.random() < AI_ACTION_RATE) {
      p.actShoot = 0.65; p.kickPower = 0.65;                  // 골문 근처면 슛
    } else if (crossSpot && Math.random() < AI_ACTION_RATE * .9) {
      p.actPass = 0.15; p.kickPower = 1;                      // 측면에서 크로스
    } else if (exploitHighLine && Math.random() < AI_ACTION_RATE * .8) {
      // 수비선이 높고 배후가 비면 칩으로 넘긴다.
      p.actThrough = 0.15; p.kickPower = 0.85;
    } else if (Math.random() < AI_ACTION_RATE * 0.8) {
      p.actPass = 0.15; p.kickPower = 0.2;                    // 아니면 땅볼 패스
    }
  }
  return { ax, ay, targetSpeed };
}

// ── 사람 입력 ──────────────────────────────────────────────────────
function readHuman(i) {
  let sx = 0, sy = 0;
  let keyboard = false;
  if (keys.KeyA || keys.ArrowLeft) { sx -= 1; keyboard = true; }
  if (keys.KeyD || keys.ArrowRight) { sx += 1; keyboard = true; }
  if (keys.KeyW || keys.ArrowUp) { sy -= 1; keyboard = true; }
  if (keys.KeyS || keys.ArrowDown) { sy += 1; keyboard = true; }
  if (stick.active) { sx += stick.dx; sy += stick.dy; }
  // 화면 위로 밀면 상대 골문(필드 +x) 쪽. 회전 시 입력도 같이 돌려야 한다.
  const sprint = !!keys.Semicolon;
  const walking = !!keys.Quote;
  const inputMag = Math.min(1, Math.hypot(sx, sy));
  const base = view.rot ? { ax:-sy, ay:sx } : { ax:sx, ay:sy };
  const v = { ax:base.ax * attackDir[i], ay:base.ay * attackDir[i] };
  v.targetSpeed = inputMag <= .01 ? 0
    : keyboard ? (walking ? SPEED_WALK : sprint ? SPEED_SPRINT : SPEED_RUN)
      : SPEED_SPRINT * inputMag;
  v.sprint = sprint; v.human = true; return v;
}

// 조작 대상 자동 전환. 히스테리시스를 둬서 두 선수가 비슷할 때 깜빡이지 않게 한다.
function pickControlled(teamIdx) {
  const side = teamIdx;
  const cur = ctrl[teamIdx];
  const best = nearestToBall(side, null);
  if (!cur) { ctrl[teamIdx] = best; return; }
  if (ctrlLock[teamIdx] > 0) return;
  if (cur.isGK) { ctrl[teamIdx] = best; return; }
  const dCur = Math.hypot(ball.x - cur.x, ball.y - cur.y);
  const dBest = best ? Math.hypot(ball.x - best.x, ball.y - best.y) : Infinity;
  if (best && best !== cur && dBest < dCur - 90) ctrl[teamIdx] = best;
}

function cycleControlled(teamIdx) {
  const players = teams[teamIdx]
    .filter(p => !p.isGK)
    .sort((a, b) => Math.hypot(ball.x - a.x, ball.y - a.y) -
                    Math.hypot(ball.x - b.x, ball.y - b.y));
  if (!players.length) return;
  const at = players.indexOf(ctrl[teamIdx]);
  ctrl[teamIdx] = players[(at + 1 + players.length) % players.length];
  ctrlLock[teamIdx] = 1.2;
}

function syncTouchActions() {
  const p = ctrl[0];
  const owned = p && ball.owner === p;
  shootBtn.textContent = owned ? '슛' : '태클';
  passBtn.textContent = owned ? '패스' : '전환';
  // 충전 게이지로 지금 얼마나 뜰지 보이게 한다. 소유 중에만 의미가 있다.
  setCharge(shootBtn, owned && p.shootHeld ? p.shootCharge : 0);
  setCharge(passBtn, owned && passHeld
    ? Math.min(1, (performance.now() - passHoldTimer) / KICK_CHARGE_MS) : 0);
}

function setCharge(btn, v) {
  btn.style.setProperty('--charge', v.toFixed(3));
}
