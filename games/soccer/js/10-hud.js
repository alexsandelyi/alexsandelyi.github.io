'use strict';
// 10-hud.js — HUD 동기화, localStorage 저장·마이그레이션, 팀 UI, 제목 화면과 부팅
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── HUD·기록 ───────────────────────────────────────────────────────
function syncHud() {
  document.getElementById('sHome').textContent = score[0];
  document.getElementById('sAway').textContent = score[1];
  syncClock();
}
function syncClock() {
  const t = Math.max(0, Math.ceil(clock));
  document.getElementById('clock').textContent =
    `${half}H ` + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') +
    (inAdded ? '+' : '');
}

const OLD_KEY = 'ilbbang.soccer11.v1';
const SAVE_KEY = 'ilbbang.soccer11.v2';
function emptyRecord() { return { w:0, d:0, l:0, bestGd:0 }; }
function normalizeMatchSec(value) {
  const sec = +value;
  if (sec === 180) return 360;
  return [360, 600, 1200].includes(sec) ? sec : 600;
}
function defaultSave() {
  return {
    version:2,
    settings:{ level:1, matchSec:600, teams:[0,0], formation:'4-4-2', tactics:null },
    records:{ 0:emptyRecord(), 1:emptyRecord(), 2:emptyRecord() },
    progress:null
  };
}

function loadSaveData() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  const hadV2 = !!data && data.version === 2;
  if (!hadV2) data = defaultSave();
  data.settings = Object.assign(defaultSave().settings, data.settings || {});
  data.settings.matchSec = normalizeMatchSec(data.settings.matchSec);
  data.records = data.records || {};
  for (let i = 0; i < 3; i++) {
    if (!hadV2 || !data.records[i]) {
      try {
        data.records[i] = JSON.parse(localStorage.getItem(OLD_KEY + '.rec' + i)) ||
          emptyRecord();
      } catch { data.records[i] = emptyRecord(); }
    }
  }
  try {
    if (!hadV2) {
      const oldLevel = +localStorage.getItem(OLD_KEY + '.lvl');
      const oldSec = +localStorage.getItem(OLD_KEY + '.matchSec');
      if (Number.isInteger(oldLevel) && oldLevel >= 0 && oldLevel <= 2)
        data.settings.level = oldLevel;
      if ([180,360,600].includes(oldSec))
        data.settings.matchSec = normalizeMatchSec(oldSec);
    }
  } catch {}
  return data;
}

function saveGame() {
  if (!saveData) return;
  saveData.settings = {
    level, matchSec:MATCH_SEC, teams:selectedTeams.slice(),
    formation:selectedFormation[0],
    tactics:tacticOverride[0] ? Object.assign({}, tacticOverride[0]) : null
  };
  saveData.progress = competition ? JSON.parse(JSON.stringify(competition)) : null;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveData)); } catch {}
}

function loadRec(n = level) {
  return saveData && saveData.records[n] ? saveData.records[n] : emptyRecord();
}
function saveBest(gd) {
  const r = loadRec();
  if (gd > 0) r.w++; else if (gd === 0) r.d++; else r.l++;
  if (gd > r.bestGd) r.bestGd = gd;
  saveGame();
}
function showBest() {
  const r = loadRec();
  document.getElementById('best').textContent = (r.w + r.d + r.l)
    ? `${LEVELS[level].name} 전적 ${r.w}승 ${r.d}무 ${r.l}패 · 최다 득점차 +${r.bestGd}` : '';
}
function selectLevel(n) {
  level = n;
  for (const b of document.querySelectorAll('.lvl')) b.classList.toggle('sel', +b.dataset.lvl === n);
  saveGame();
  showBest();
}

function selectLength(sec) {
  MATCH_SEC = sec;
  for (const b of document.querySelectorAll('.len'))
    b.classList.toggle('sel', +b.dataset.sec === sec);
  saveGame();
  if (state === 'title') { clock = MATCH_SEC / 2; half = 1; syncClock(); }
}

function syncTeamPanel() {
  const team = TEAM_DEFS[selectedTeams[0]];
  document.getElementById('homeTeam').value = String(selectedTeams[0]);
  document.getElementById('awayTeam').value = String(selectedTeams[1]);
  document.getElementById('formationPick').value = selectedFormation[0];
  document.getElementById('teamRating').textContent =
    `${team.name} 종합 ${ratingBars(team)} · 속도/슛/패스/수비/체력/선방`;
  const t = teamTactics(0);
  document.getElementById('lineTactic').value = Math.round(t.line * 100);
  document.getElementById('pressTactic').value = Math.round(t.press * 100);
  document.getElementById('widthTactic').value = Math.round(t.width * 100);
  document.getElementById('chaserTactic').value = String(t.chasers);
}

function selectTeam(side, n) {
  selectedTeams[side] = Math.max(0, Math.min(TEAM_DEFS.length - 1, n));
  selectedFormation[side] = TEAM_DEFS[selectedTeams[side]].formation;
  tacticOverride[side] = null;
  syncTeamPanel();
  saveGame();
}

function initTeamUi() {
  for (const id of ['homeTeam', 'awayTeam']) {
    const el = document.getElementById(id);
    for (let i = 0; i < TEAM_DEFS.length; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = `${TEAM_DEFS[i].name} ${ratingBars(TEAM_DEFS[i])}`;
      el.appendChild(o);
    }
  }
  const formation = document.getElementById('formationPick');
  for (const name of Object.keys(FORMATIONS)) {
    const o = document.createElement('option'); o.value = name; o.textContent = name;
    formation.appendChild(o);
  }
  document.getElementById('homeTeam').addEventListener('change', e => selectTeam(0, +e.target.value));
  document.getElementById('awayTeam').addEventListener('change', e => selectTeam(1, +e.target.value));
  formation.addEventListener('change', e => {
    selectedFormation[0] = e.target.value; saveGame();
  });
  for (const id of ['lineTactic','pressTactic','widthTactic','chaserTactic']) {
    document.getElementById(id).addEventListener('input', () => {
      tacticOverride[0] = {
        line:+document.getElementById('lineTactic').value / 100,
        press:+document.getElementById('pressTactic').value / 100,
        width:+document.getElementById('widthTactic').value / 100,
        chasers:+document.getElementById('chaserTactic').value
      };
      saveGame();
    });
  }
  syncTeamPanel();
}

// ── 시작 ───────────────────────────────────────────────────────────
const HOWTO = isTouch
  ? '공을 잡으면 이동 방향으로 조준합니다. <span class="keys">슛/태클</span> · <span class="keys">패스/선수전환</span> 버튼의 의미가 소유 여부에 따라 바뀝니다.<br>패스 버튼을 길게 누르면 스루패스, 스틱 세기가 걷기부터 스프린트까지 속도를 정합니다.'
  : '<span class="keys">WASD/방향키</span> 이동·조준 · <span class="keys">;</span> 스프린트 · <span class="keys">\'</span> 걷기<br><span class="keys">Enter</span> 슛(공이 없으면 태클) · <span class="keys">\</span> 패스 · <span class="keys">]</span> 스루패스 · <span class="keys">[</span> 선수전환<br>슛·패스는 누른 길이가 세기와 높이를 정합니다.';

function showTitle() {
  state = 'title';
  solo = false; soloPlayer = null;      // 연습 모드는 제목 화면으로 나오면 꺼진다
  const ov = document.getElementById('overlay');
  ov.querySelector('h1').textContent = '동네 축구';
  document.getElementById('howto').innerHTML = HOWTO;
  document.getElementById('btn1p').textContent = 'AI와 대전';
  document.getElementById('btnHome').hidden = true;
  setConfigVisible(true);
  document.getElementById('modeInfo').textContent = '';
  resetModeButtons();
  document.getElementById('btnCancelCompetition').textContent = '진행 포기';
  if (competition) {
    const id = competition.type === 'tournament' ? 'btnTournament' :
      competition.type === 'league' ? 'btnLeague' : 'btnSeason';
    setModeButtons(id, competition.type === 'tournament' ? '토너먼트 이어하기' :
      competition.type === 'league' ? '리그 이어하기' : '시즌 이어하기');
  }
  ov.classList.remove('hidden');
  showBest();
}

for (const b of document.querySelectorAll('.lvl'))
  b.addEventListener('click', () => selectLevel(+b.dataset.lvl));
for (const b of document.querySelectorAll('.len'))
  b.addEventListener('click', () => selectLength(+b.dataset.sec));
document.getElementById('btn1p').addEventListener('click', () => startMatch('1p'));
document.getElementById('btnHome').addEventListener('click', showTitle);
// 화살표로 감싸 호출 시점에 찾는다 — startPractice 는 11-practice.js 에 있어
// 이 파일이 로드될 때는 아직 없다 (클래식 스크립트는 파일 단위 호이스팅).
document.getElementById('btnPractice').addEventListener('click', () => startPractice());
document.getElementById('btnTournament').addEventListener('click', () => {
  if (!competition) startTournament();
  else if (competition.shootout) {
    shootout = competition.shootout; showShootoutScreen();
  } else startTournamentMatch();
});
document.getElementById('btnLeague').addEventListener('click', () => {
  if (!competition) startLeague('league'); else startLeagueMatch();
});
document.getElementById('btnSeason').addEventListener('click', () => {
  if (!competition) { startLeague('season'); return; }
  if (competition.shootout) {
    shootout = competition.shootout; showShootoutScreen(); return;
  }
  if (competition.phase === 'league') startLeagueMatch();
  else if (competition.phase === 'cup') startCupMatch();
  else {
    competition = createLeague(competition.userTeam, 'season',
      competition.seasonNo + 1, competition.trophies);
    saveGame(); showLeagueReady();
  }
});
document.getElementById('btnCancelCompetition').addEventListener('click', () => {
  competition = null; shootout = null; saveGame();
  document.getElementById('btnCancelCompetition').textContent = '진행 포기';
  showTitle();
});
for (const b of document.querySelectorAll('[data-pk]'))
  b.addEventListener('click', () => takePenaltyRound(+b.dataset.pk));

document.getElementById('howto').innerHTML = HOWTO;
saveData = loadSaveData();
const settings = saveData.settings;
competition = saveData.progress &&
  ['tournament','league','season'].includes(saveData.progress.type)
  ? saveData.progress : null;
selectedTeams[0] = Math.max(0, Math.min(TEAM_DEFS.length - 1, +(settings.teams || [0])[0] || 0));
selectedTeams[1] = Math.max(0, Math.min(TEAM_DEFS.length - 1, +(settings.teams || [0,0])[1] || 0));
selectedFormation[0] = FORMATIONS[settings.formation]
  ? settings.formation : TEAM_DEFS[selectedTeams[0]].formation;
selectedFormation[1] = TEAM_DEFS[selectedTeams[1]].formation;
tacticOverride[0] = settings.tactics || null;
if (competition) {
  selectedTeams[0] = competition.userTeam;
  const restoredOpponent = competition.type === 'tournament'
    ? competition.opponents[competition.round]
    : competition.phase === 'cup'
      ? competition.cupOpponents[competition.cupRound]
      : competition.phase === 'league'
        ? (leagueUserFixture(competition) || []).find(n => n !== competition.userTeam)
        : selectedTeams[1];
  selectedTeams[1] = restoredOpponent ?? 0;
  selectedFormation[1] = TEAM_DEFS[selectedTeams[1]].formation;
  shootout = competition.shootout || null;
}
initTeamUi();
selectLevel(Math.min(2, Math.max(0, +settings.level || 1)));
selectLength(normalizeMatchSec(settings.matchSec));
if (competition) {
  if (shootout) showShootoutScreen();
  else if (competition.type === 'tournament') showTournamentReady();
  else if (competition.phase === 'league') showLeagueReady();
  else if (competition.phase === 'cup') showCupReady();
  else showSeasonComplete(!!competition.cupWon);
}

resize();
requestAnimationFrame(resize);        // 초기 flex/header 레이아웃이 확정된 뒤 한 번 보정
buildTeams();
resetPositions(0);
