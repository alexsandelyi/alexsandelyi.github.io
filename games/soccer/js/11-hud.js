'use strict';
// 11-hud.js — HUD 동기화, localStorage 저장·마이그레이션, 팀 UI, 제목 화면과 부팅
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── 무의존 Web Audio 효과음 ─────────────────────────────────────────
let audioCtx = null, sfxMuted = false, noiseBuf = null;
function ensureAudio() {
  if (sfxMuted) return null;
  const AC = typeof AudioContext !== 'undefined' ? AudioContext
    : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
  if (!AC) return null;
  if (!audioCtx) {
    try { audioCtx = new AC(); } catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  if (!noiseBuf && audioCtx) {
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return audioCtx;
}

function sfx(kind, amp = 0.7) {
  const ac = ensureAudio();
  if (!ac) return;
  const now = ac.currentTime, v = Math.max(0.1, Math.min(1, amp));
  if (kind === 'kick' || kind === 'bounce' || kind === 'save') {
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine';
    const f0 = kind === 'kick' ? 140 + v * 50 : kind === 'save' ? 120 : 95;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + (kind === 'bounce' ? 0.05 : 0.09));
    g.gain.setValueAtTime((kind === 'bounce' ? 0.14 : 0.28) * v, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g); g.connect(ac.destination);
    osc.start(now); osc.stop(now + 0.11);
    if (noiseBuf && kind !== 'bounce') {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), ng = ac.createGain();
      src.buffer = noiseBuf; f.type = 'bandpass';
      f.frequency.value = kind === 'save' ? 620 : 980;
      ng.gain.setValueAtTime(0.16 * v, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      src.connect(f); f.connect(ng); ng.connect(ac.destination);
      src.start(now); src.stop(now + 0.07);
    }
  } else if (kind === 'post') {
    for (const freq of [640, 1210]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.22 * v, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(g); g.connect(ac.destination);
      osc.start(now); osc.stop(now + 0.29);
    }
  } else if (kind === 'whistle') {
    const dur = v > 0.95 ? 0.42 : 0.22;
    const osc = ac.createOscillator(), lfo = ac.createOscillator();
    const lg = ac.createGain(), g = ac.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(2860, now);
    lfo.frequency.setValueAtTime(34, now); lg.gain.setValueAtTime(85, now);
    lfo.connect(lg); lg.connect(osc.frequency);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.16, now + 0.02);
    g.gain.setValueAtTime(0.16, now + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(now); lfo.start(now); osc.stop(now + dur + 0.01); lfo.stop(now + dur + 0.01);
  } else if (kind === 'goal') {
    if (noiseBuf) {
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 680; f.Q.value = 0.7;
      g.gain.setValueAtTime(0.01, now);
      g.gain.linearRampToValueAtTime(0.26, now + 0.16);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      src.connect(f); f.connect(g); g.connect(ac.destination);
      src.start(now); src.stop(now + 1.0);
    }
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ac.createOscillator(), g = ac.createGain();
      const t0 = now + idx * 0.07;
      osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.14, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
      osc.connect(g); g.connect(ac.destination);
      osc.start(t0); osc.stop(t0 + 0.38);
    });
  }
}

function syncMuteBtn() {
  const b = document.getElementById('btnMute');
  if (b) b.textContent = sfxMuted ? '음소거' : '소리';
}

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
    settings:{ level:1, matchSec:600, teams:[0,0], formation:'4-4-2', tactics:null, muted:false },
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
    tactics:tacticOverride[0] ? Object.assign({}, tacticOverride[0]) : null,
    muted:sfxMuted
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
  ? '공을 잡거나 받기 직전에 <span class="keys">슛</span>·<span class="keys">패스</span>를 미리 눌러 원터치로 연결할 수 있습니다.<br>패스 버튼을 길게 누르면 띄우는 크로스, 스틱 세기가 걷기부터 스프린트까지 속도를 정합니다.'
  : '<span class="keys">WASD/방향키</span> 이동·조준 · <span class="keys">E/I/;</span> 스프린트 · <span class="keys">C/U/\'</span> 걷기<br><span class="keys">Space/J/Enter</span> 슛·원터치(수비 시 태클) · <span class="keys">K/\\</span> 패스(수비 시 전환) · <span class="keys">L/]</span> 크로스·로빙 · <span class="keys">Q/[</span> 전환<br>길게 눌러 세기를 조절하고, 충전 중 방향을 꺾으면 감아차기(커브)가 걸립니다.';

function showTitle() {
  state = 'title';
  solo = false; soloPlayer = null;      // 연습 모드는 제목 화면으로 나오면 꺼진다
  const ov = document.getElementById('overlay');
  ov.querySelector('h1').textContent = '동네 축구 v1';
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
// 화살표로 감싸 호출 시점에 찾는다 — startPractice 는 12-practice.js 에 있어
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
const muteEl = document.getElementById('btnMute');
if (muteEl) muteEl.addEventListener('click', () => {
  sfxMuted = !sfxMuted; syncMuteBtn(); saveGame();
});

document.getElementById('howto').innerHTML = HOWTO;
saveData = loadSaveData();
const settings = saveData.settings;
sfxMuted = !!settings.muted;
syncMuteBtn();
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
