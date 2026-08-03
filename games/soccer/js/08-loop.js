'use strict';
// 08-loop.js — 경기 루프 step(), 전후반·추가시간, 경기 종료와 기록 요약
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── 루프 ───────────────────────────────────────────────────────────
function endHalf() {
  if (half === 1) {
    half = 2;
    attackDir[0] *= -1; attackDir[1] *= -1;
    clock = MATCH_SEC / 2; addedBank = 0; inAdded = false;
    state = 'halftime'; goalTimer = 1.5;
    ball.owner = null; ball.vx = ball.vy = 0;
    syncClock();
  } else {
    clock = 0; endMatch();
  }
}

function advanceClock(dt, stopped = false) {
  clock -= dt;
  if (stopped && !inAdded) addedBank += dt;
  if (clock > 0) return;
  if (!inAdded && addedBank > 0.05) {
    clock = addedBank; addedBank = 0; inAdded = true;
  } else {
    clock = 0; endHalf();
  }
  syncClock();
}

function step(dt) {
  if (notice.timer > 0) notice.timer -= dt;
  if (offside) {
    offside.timer -= dt;
    if (offside.timer <= 0) offside = null;
  }
  if (state === 'halftime') {
    goalTimer -= dt;
    if (goalTimer <= 0) {
      resetPositions(1);
      beginSetpiece('kickoff', 1, { x:FW / 2, y:FH / 2 });
    }
    return;
  }
  if (state === 'setpiece') {
    stepSetpiece(dt); syncClock(); return;
  }
  if (state === 'goal') {
    advanceClock(dt, true);
    if (state !== 'goal') return;
    goalTimer -= dt;
    if (goalTimer <= 0) {
      const kick = lastScorer === 0 ? 1 : 0;
      resetPositions(kick);
      beginSetpiece('kickoff', kick, { x:FW / 2, y:FH / 2 });
    }
    return;
  }
  if (state !== 'play') return;

  advanceClock(dt, false);
  if (state !== 'play') return;
  if (ball.owner) matchStats.possession[ball.owner.side] += dt;

  const L = LEVELS[level];
  ctrlLock[0] = Math.max(0, ctrlLock[0] - dt);
  ctrlLock[1] = Math.max(0, ctrlLock[1] - dt);
  pickControlled(0);

  const chaser = [
    new Set(nearestChasers(0, null)),
    new Set(nearestChasers(1, null))
  ];
  const offsideLine = level > 0
    ? [secondLastDefenderLine(0), secondLastDefenderLine(1)] : [null, null];

  for (const side of [0, 1]) {
    const human = side === 0;
    const inp = human ? readHuman(side) : null;
    for (const p of teams[side]) {
      if (human && p === ctrl[side]) {
        const im = Math.hypot(inp.ax, inp.ay);
        p.manualAim = !!inp.human && im > 0.15;
        if (p.manualAim) { p.aimX = inp.ax / im; p.aimY = inp.ay / im; }
        const ownerMul = ball.owner === p ? OWNER_SPEED : 1;
        const targetSpeed = staminaLimitedSpeed(p, inp.targetSpeed || 0, dt);
        movePlayer(p, inp.ax, inp.ay, dt,
          abilityAdjustedSpeed(p, inp.targetSpeed || 0, targetSpeed) * ownerMul);
      } else if (human) {
        // 사람 팀의 나머지 선수는 아군 AI (난이도와 무관하게 보통 수준)
        const a = aiPlayer(p, dt, LEVELS[1],
          chaser[side].has(p) && p !== ctrl[side], offsideLine[side]);
        const targetSpeed = staminaLimitedSpeed(p, a.targetSpeed, dt);
        movePlayer(p, a.ax, a.ay, dt,
          abilityAdjustedSpeed(p, a.targetSpeed, targetSpeed));
      } else {
        const a = aiPlayer(p, dt, L, chaser[side].has(p), offsideLine[side]);
        const targetSpeed = staminaLimitedSpeed(p, a.targetSpeed, dt);
        movePlayer(p, a.ax, a.ay, dt,
          abilityAdjustedSpeed(p, a.targetSpeed, targetSpeed) *
          (mode === '1p' ? OPPONENT_SPEED_MUL[level] : 1));
      }
    }
  }

  separateAll();
  if (state !== 'play') return;
  if (ball.owner) {
    const p = ball.owner;
    if (p.actShoot > 0) kickOwned(p, 'shoot', p.actShoot);
    else if (p.actThrough > 0) kickOwned(p, 'through', p.kickPower);
    else if (p.actPass > 0) kickOwned(p, 'pass', p.kickPower);
  }
  updateBall(dt);
  if (state !== 'play') return;                        // 소유한 채 득점한 경우 중단
  for (const side of [0, 1]) for (const p of teams[side]) collide(p);
  if (outOfPlay(ball.x, ball.y)) return;
  updateCamera(dt);
  syncClock();
  syncTouchActions();
}

function endMatch() {
  state = 'end';
  const summary = matchSummaryText();
  if (competition) competition.lastMatch = summary;
  if (mode === '1p') saveBest(score[0] - score[1]);
  const knockout = competition && (competition.type === 'tournament' ||
    (competition.type === 'season' && competition.phase === 'cup'));
  if (knockout) {
    if (score[0] === score[1]) { beginShootout(); return; }
    finishTournamentMatch(score[0] > score[1]);
    return;
  }
  if (competition && (competition.type === 'league' ||
      (competition.type === 'season' && competition.phase === 'league'))) {
    finishLeagueMatch(); return;
  }
  const ov = document.getElementById('overlay');
  const win = score[0] > score[1] ? '승리' : score[0] < score[1] ? '패배' : '무승부';
  ov.querySelector('h1').textContent = `${win}  ${score[0]} : ${score[1]}`;
  document.getElementById('howto').innerHTML = mode === '1p'
    ? `${LEVELS[level].name} 난이도 경기가 끝났습니다.` : '경기가 끝났습니다.';
  document.getElementById('btn1p').textContent = '다시 하기';
  const home = document.getElementById('btnHome');
  home.hidden = false; home.textContent = '처음으로';
  document.getElementById('levelRow').style.display = mode === '1p' ? '' : 'none';
  document.getElementById('lengthRow').style.display = '';
  document.getElementById('modeInfo').textContent = summary;
  ov.classList.remove('hidden');
  showBest();
}

function matchSummaryText() {
  const total = matchStats.possession[0] + matchStats.possession[1];
  const homePoss = total ? Math.round(matchStats.possession[0] / total * 100) : 50;
  const awayPoss = 100 - homePoss;
  return [
    `기록                우리  상대`,
    `점유율             ${homePoss}%   ${awayPoss}%`,
    `슛 / 유효슈팅      ${matchStats.shots[0]}/${matchStats.onTarget[0]}   ` +
      `${matchStats.shots[1]}/${matchStats.onTarget[1]}`,
    `코너               ${matchStats.corners[0]}     ${matchStats.corners[1]}`,
    `파울 / 카드        ${matchStats.fouls[0]}/${matchStats.cards[0]}   ` +
      `${matchStats.fouls[1]}/${matchStats.cards[1]}`
  ].join('\n');
}
