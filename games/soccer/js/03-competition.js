'use strict';
// 03-competition.js — 토너먼트·리그·시즌 화면 흐름, 승부차기, 액션 입력(act/beginAction)
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

function tournamentText() {
  if (!competition) return '';
  const lines = competition.history.map((h, i) =>
    `${i + 1}R ${TEAM_DEFS[h.away].name} ${h.result}`);
  const next = competition.opponents[competition.round];
  if (next != null) lines.push(`${competition.round + 1}R 상대: ${TEAM_DEFS[next].name}`);
  return lines.join('\n');
}

function showTournamentReady() {
  state = 'title';
  const ov = document.getElementById('overlay');
  const finalRound = competition.round === 2;
  ov.querySelector('h1').textContent = finalRound ? '토너먼트 결승' :
    `토너먼트 ${competition.round + 1}라운드`;
  document.getElementById('howto').textContent =
    `${TEAM_DEFS[competition.userTeam].name}의 8팀 녹아웃. 무승부는 승부차기로 결정합니다.`;
  document.getElementById('modeInfo').textContent =
    [competition.lastMatch, tournamentText()].filter(Boolean).join('\n\n');
  setConfigVisible(false);
  setModeButtons('btnTournament', competition.round ? '다음 경기' : '토너먼트 시작');
  ov.classList.remove('hidden');
}

function startTournament() {
  competition = createTournament(selectedTeams[0]);
  selectedTeams[1] = competition.opponents[0];
  selectedFormation[1] = TEAM_DEFS[selectedTeams[1]].formation;
  saveGame();
  showTournamentReady();
}

function startTournamentMatch() {
  const away = competition.opponents[competition.round];
  selectedTeams[0] = competition.userTeam;
  selectedTeams[1] = away;
  selectedFormation[1] = TEAM_DEFS[away].formation;
  tacticOverride[1] = null;
  saveGame();
  startMatch('1p');
}

function beginShootout() {
  state = 'shootout';
  shootout = { shots:[0,0], scored:[0,0], rounds:[] };
  competition.shootout = shootout;
  showShootoutScreen();
  saveGame();
}

function showShootoutScreen() {
  state = 'shootout';
  const ov = document.getElementById('overlay');
  ov.querySelector('h1').textContent = '승부차기';
  document.getElementById('howto').textContent =
    '찰 방향을 고르세요. 5번씩 찬 뒤 동률이면 서든데스입니다.';
  setConfigVisible(false);
  document.getElementById('modeRow').hidden = true;
  document.getElementById('pkRow').hidden = false;
  updateShootoutText();
  ov.classList.remove('hidden');
}

function penaltyGoal(shooter, keeper, guessed) {
  const shot = TEAM_DEFS[shooter].stats.shot;
  const keeping = TEAM_DEFS[keeper].stats.keeping;
  const chance = Math.max(.52, Math.min(.88, .72 + (shot - keeping) / 250));
  return Math.random() < chance * (guessed ? .46 : 1);
}

function updateShootoutText(last = '') {
  const sudden = shootout.shots[0] >= 5 ? ' · 서든데스' : '';
  document.getElementById('modeInfo').textContent =
    `${TEAM_DEFS[selectedTeams[0]].name} ${shootout.scored[0]} : ` +
    `${shootout.scored[1]} ${TEAM_DEFS[selectedTeams[1]].name}\n` +
    `${shootout.shots[0]}번째 킥${sudden}${last ? `\n${last}` : ''}`;
}

function takePenaltyRound(dir) {
  if (state !== 'shootout' || !shootout) return;
  const awayDir = Math.floor(Math.random() * 3);
  const awayKeeper = Math.floor(Math.random() * 3);
  const homeKeeper = Math.floor(Math.random() * 3);
  const hg = penaltyGoal(selectedTeams[0], selectedTeams[1], dir === awayKeeper);
  const ag = penaltyGoal(selectedTeams[1], selectedTeams[0], awayDir === homeKeeper);
  shootout.shots[0]++; shootout.shots[1]++;
  if (hg) shootout.scored[0]++;
  if (ag) shootout.scored[1]++;
  shootout.rounds.push([hg ? 1 : 0, ag ? 1 : 0]);
  updateShootoutText(`우리 ${hg ? '성공' : '실패'} · 상대 ${ag ? '성공' : '실패'}`);
  saveGame();
  if (penaltyFinished(shootout)) {
    const won = shootout.scored[0] > shootout.scored[1];
    setTimeout(() => finishTournamentMatch(won,
      `승부차기 ${shootout.scored[0]}:${shootout.scored[1]}`), 450);
  }
}

function finishTournamentMatch(won, result = `${score[0]}:${score[1]}`) {
  if (competition.type === 'season') {
    finishSeasonCupMatch(won, result); return;
  }
  const away = selectedTeams[1];
  competition.history.push({ away, result, won });
  competition.shootout = null; shootout = null;
  const ov = document.getElementById('overlay');
  if (!won) {
    const summary = tournamentText();
    competition = null; saveGame();
    state = 'end'; setConfigVisible(false);
    ov.querySelector('h1').textContent = '토너먼트 탈락';
    document.getElementById('howto').textContent = result;
    document.getElementById('modeInfo').textContent = summary;
    document.getElementById('btnTournament').textContent = '새 토너먼트';
    document.getElementById('btnCancelCompetition').hidden = true;
    ov.classList.remove('hidden');
    return;
  }
  competition.round++;
  if (competition.round >= 3) {
    const summary = tournamentText();
    competition = null; saveGame();
    state = 'end'; setConfigVisible(false);
    ov.querySelector('h1').textContent = '토너먼트 우승!';
    document.getElementById('howto').textContent = '3라운드를 모두 이겼습니다.';
    document.getElementById('modeInfo').textContent = summary;
    document.getElementById('btnTournament').textContent = '새 토너먼트';
    document.getElementById('btnCancelCompetition').hidden = true;
    ov.classList.remove('hidden');
    return;
  }
  selectedTeams[1] = competition.opponents[competition.round];
  saveGame();
  showTournamentReady();
}

function standingsText(c, limit = 8) {
  const ranked = rankedTable(c.table);
  return ranked.slice(0, limit).map((r, i) =>
    `${i + 1}. ${TEAM_DEFS[r.team].name} ${r.pts}점 ` +
    `${r.w}승${r.d}무${r.l}패 ${r.gf - r.ga >= 0 ? '+' : ''}${r.gf - r.ga}`
  ).join('\n');
}

function showLeagueReady() {
  state = 'title';
  const ov = document.getElementById('overlay');
  const fixture = leagueUserFixture(competition);
  const opponent = fixture[0] === competition.userTeam ? fixture[1] : fixture[0];
  selectedTeams[0] = competition.userTeam; selectedTeams[1] = opponent;
  selectedFormation[1] = TEAM_DEFS[opponent].formation; tacticOverride[1] = null;
  ov.querySelector('h1').textContent = competition.type === 'season'
    ? `시즌 ${competition.seasonNo} · 리그 ${competition.round + 1}/14`
    : `리그 ${competition.round + 1}/14`;
  document.getElementById('howto').textContent =
    `${TEAM_DEFS[competition.userTeam].name} vs ${TEAM_DEFS[opponent].name}`;
  document.getElementById('modeInfo').textContent =
    [competition.lastMatch, standingsText(competition, 4)].filter(Boolean).join('\n\n');
  setConfigVisible(false);
  setModeButtons(competition.type === 'season' ? 'btnSeason' : 'btnLeague',
    competition.round ? '다음 리그 경기' : '리그 시작');
  ov.classList.remove('hidden');
}

function startLeague(type = 'league') {
  competition = createLeague(selectedTeams[0], type);
  saveGame(); showLeagueReady();
}

function startLeagueMatch() {
  const fixture = leagueUserFixture(competition);
  const opponent = fixture[0] === competition.userTeam ? fixture[1] : fixture[0];
  selectedTeams[0] = competition.userTeam; selectedTeams[1] = opponent;
  selectedFormation[1] = TEAM_DEFS[opponent].formation; tacticOverride[1] = null;
  saveGame(); startMatch('1p');
}

function finishLeagueMatch() {
  const fixture = leagueUserFixture(competition);
  const [a,b] = fixture;
  const userIsA = a === competition.userTeam;
  applyTableResult(competition.table, a, b,
    userIsA ? score[0] : score[1], userIsA ? score[1] : score[0]);
  for (const [x,y] of competition.rounds[competition.round]) {
    if (x === competition.userTeam || y === competition.userTeam) continue;
    const result = simulateFixture(x, y);
    applyTableResult(competition.table, x, y, result[0], result[1]);
  }
  competition.history.push({
    round:competition.round + 1, away:selectedTeams[1],
    gf:score[0], ga:score[1]
  });
  competition.round++;
  if (competition.round >= competition.rounds.length) finishLeagueStage();
  else { saveGame(); showLeagueReady(); }
}

function finishLeagueStage() {
  const ranked = rankedTable(competition.table);
  const rank = ranked.findIndex(r => r.team === competition.userTeam) + 1;
  const tableText = standingsText(competition);
  const ov = document.getElementById('overlay');
  if (competition.type === 'season') {
    if (rank === 1) competition.trophies.league++;
    competition.phase = 'cup'; competition.cupRound = 0;
    competition.cupOpponents = shuffledOpponents(competition.userTeam);
    competition.cupHistory = [];
    saveGame(); showCupReady(); return;
  }
  competition = null; saveGame(); state = 'end'; setConfigVisible(false);
  setModeButtons('btnLeague', '새 리그');
  document.getElementById('btnCancelCompetition').hidden = true;
  ov.querySelector('h1').textContent = `리그 ${rank}위`;
  document.getElementById('howto').textContent = '14경기를 모두 마쳤습니다.';
  document.getElementById('modeInfo').textContent = tableText;
  ov.classList.remove('hidden');
}

function showCupReady() {
  state = 'title';
  const ov = document.getElementById('overlay');
  const opponent = competition.cupOpponents[competition.cupRound];
  selectedTeams[0] = competition.userTeam; selectedTeams[1] = opponent;
  selectedFormation[1] = TEAM_DEFS[opponent].formation; tacticOverride[1] = null;
  ov.querySelector('h1').textContent =
    `시즌 ${competition.seasonNo} · 컵 ${competition.cupRound + 1}라운드`;
  document.getElementById('howto').textContent =
    `${TEAM_DEFS[competition.userTeam].name} vs ${TEAM_DEFS[opponent].name}`;
  document.getElementById('modeInfo').textContent = [
    competition.lastMatch,
    `누적 우승 · 리그 ${competition.trophies.league} / 컵 ${competition.trophies.cup}`
  ].filter(Boolean).join('\n\n');
  setConfigVisible(false);
  setModeButtons('btnSeason', competition.cupRound ? '다음 컵 경기' : '컵 시작');
  ov.classList.remove('hidden');
}

function startCupMatch() {
  const opponent = competition.cupOpponents[competition.cupRound];
  selectedTeams[0] = competition.userTeam; selectedTeams[1] = opponent;
  selectedFormation[1] = TEAM_DEFS[opponent].formation; tacticOverride[1] = null;
  saveGame(); startMatch('1p');
}

function finishSeasonCupMatch(won, result) {
  competition.cupHistory.push({
    round:competition.cupRound + 1, away:selectedTeams[1], result, won
  });
  competition.shootout = null; shootout = null;
  if (!won) {
    competition.phase = 'complete'; competition.cupWon = false;
    saveGame(); showSeasonComplete(false); return;
  }
  competition.cupRound++;
  if (competition.cupRound >= 3) {
    competition.trophies.cup++; competition.phase = 'complete';
    competition.cupWon = true;
    saveGame(); showSeasonComplete(true); return;
  }
  saveGame(); showCupReady();
}

function showSeasonComplete(cupWon) {
  state = 'end';
  const ov = document.getElementById('overlay');
  ov.querySelector('h1').textContent = `시즌 ${competition.seasonNo} 완료`;
  document.getElementById('howto').textContent =
    cupWon ? '컵 우승으로 시즌을 마쳤습니다.' : '컵에서 탈락해 시즌을 마쳤습니다.';
  document.getElementById('modeInfo').textContent =
    `누적 우승 · 리그 ${competition.trophies.league} / 컵 ${competition.trophies.cup}`;
  setConfigVisible(false); setModeButtons('btnSeason', '다음 시즌');
  document.getElementById('btnCancelCompetition').textContent = '시즌 끝내기';
  ov.classList.remove('hidden');
}

function beginAction(teamIdx) {
  if (state === 'setpiece' && setpiece && setpiece.side === teamIdx) {
    takeSetpiece('shoot'); return;
  }
  if (state !== 'play') return;
  const p = ctrl[teamIdx];
  if (!p) return;
  if (ball.owner === p) {
    p.shootHeld = true;
    p.shootCharge = Math.max(0.12, p.shootCharge);
  } else {
    act(teamIdx, 'tackle');
  }
}

function endAction(teamIdx) {
  const p = ctrl[teamIdx];
  if (!p || !p.shootHeld) return;
  p.shootHeld = false;
  p.actShoot = Math.max(0.25, Math.min(1, p.shootCharge));
  p.shootCharge = 0;
}

function act(teamIdx, kind, power = 0) {
  if (state === 'setpiece' && setpiece && setpiece.side === teamIdx) {
    takeSetpiece(kind); return;
  }
  if (state !== 'play') return;
  const p = ctrl[teamIdx];
  if (!p) return;
  if (kind === 'switch') { cycleControlled(teamIdx); return; }
  if (kind === 'tackle') {
    if (ball.owner !== p && p.tackleCd <= 0) {
      p.tackleT = TACKLE_T; p.tackleCd = 0.85;
    }
  } else if (ball.owner === p) {
    if (kind === 'pass') { p.actPass = 0.25; p.kickPower = power; }
    if (kind === 'through') { p.actThrough = 0.25; p.kickPower = power; }
  }
}
