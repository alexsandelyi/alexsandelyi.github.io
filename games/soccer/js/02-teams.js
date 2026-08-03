'use strict';
// 02-teams.js — 경기 상태 변수, 포메이션·팀 정의, 대회 자료구조, buildTeams·startMatch
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── 상태 ───────────────────────────────────────────────────────────
let mode = '1p', state = 'title';
let clock = MATCH_SEC / 2, goalTimer = 0, lastScorer = -1;
let half = 1, addedBank = 0, inAdded = false, setpiece = null;
let offside = null, notice = { text:'', timer:0, color:'#F2CE7A' };
let competition = null, shootout = null, saveData = null;
const score = [0, 0];
const matchStats = {
  shots:[0,0], onTarget:[0,0], possession:[0,0], corners:[0,0],
  shotGoals:[0,0], nonShotGoals:[0,0], blocks:[0,0],
  carryGoals:[0,0], looseGoals:[0,0],
  attackingLooseGoals:[0,0], ownGoals:[0,0],
  fouls:[0,0], cards:[0,0], offsides:[0,0], setpieces:{}, events:[],
  headers:[0,0], headGoals:[0,0], deflections:[0,0], crosses:[0,0], gkClaims:[0,0]
};
const ball = {
  x:0, y:0, z:0, vx:0, vy:0, vz:0, owner:null, lastTouch:null, freeCd:0,
  shotSide:-1, shotCounted:false, blockCounted:false, prevX:0, prevY:0,
  headShot:false                     // 마지막 슛이 헤딩이었나 (headGoals 집계)
};
const teams = [[], []];              // teams[0] = 우리(왼쪽 골 수비), teams[1] = 상대
const attackDir = [1, -1];
const ctrl = [null, null];           // 사람이 조작 중인 선수 (1P 만 사용)
const ctrlLock = [0, 0];

// 자기 골문(x=0) 기준 정규화 좌표.
const FORMATIONS = {
  '4-4-2': [
    {role:'GK',x:.035,y:.50},
    {role:'DF',x:.20,y:.16},{role:'DF',x:.19,y:.39},{role:'DF',x:.19,y:.61},{role:'DF',x:.20,y:.84},
    {role:'MF',x:.42,y:.14},{role:'MF',x:.40,y:.38},{role:'MF',x:.40,y:.62},{role:'MF',x:.42,y:.86},
    {role:'FW',x:.62,y:.40},{role:'FW',x:.62,y:.60}
  ],
  '4-3-3': [
    {role:'GK',x:.035,y:.50},
    {role:'DF',x:.20,y:.15},{role:'DF',x:.19,y:.38},{role:'DF',x:.19,y:.62},{role:'DF',x:.20,y:.85},
    {role:'MF',x:.41,y:.25},{role:'MF',x:.39,y:.50},{role:'MF',x:.41,y:.75},
    {role:'FW',x:.64,y:.18},{role:'FW',x:.66,y:.50},{role:'FW',x:.64,y:.82}
  ],
  '3-5-2': [
    {role:'GK',x:.035,y:.50},
    {role:'DF',x:.20,y:.24},{role:'DF',x:.18,y:.50},{role:'DF',x:.20,y:.76},
    {role:'MF',x:.43,y:.10},{role:'MF',x:.39,y:.30},{role:'MF',x:.40,y:.50},
    {role:'MF',x:.39,y:.70},{role:'MF',x:.43,y:.90},
    {role:'FW',x:.64,y:.39},{role:'FW',x:.64,y:.61}
  ],
  '5-3-2': [
    {role:'GK',x:.035,y:.50},
    {role:'DF',x:.22,y:.10},{role:'DF',x:.19,y:.30},{role:'DF',x:.18,y:.50},
    {role:'DF',x:.19,y:.70},{role:'DF',x:.22,y:.90},
    {role:'MF',x:.42,y:.25},{role:'MF',x:.40,y:.50},{role:'MF',x:.42,y:.75},
    {role:'FW',x:.62,y:.39},{role:'FW',x:.62,y:.61}
  ]
};

const TEAM_DEFS = [
  {id:'alley',name:'골목 FC',formation:'4-4-2',stats:{speed:62,shot:62,pass:62,defense:62,stamina:62,keeping:62},tactics:{line:.58,press:.42,width:.30,chasers:1}},
  {id:'market',name:'시장 상인회',formation:'5-3-2',stats:{speed:52,shot:58,pass:61,defense:76,stamina:70,keeping:72},tactics:{line:.50,press:.35,width:.27,chasers:1}},
  {id:'river',name:'한강 러너스',formation:'4-3-3',stats:{speed:78,shot:65,pass:60,defense:48,stamina:82,keeping:55},tactics:{line:.66,press:.47,width:.42,chasers:1}},
  {id:'dawn',name:'새벽 조기회',formation:'4-4-2',stats:{speed:58,shot:70,pass:72,defense:63,stamina:74,keeping:68},tactics:{line:.57,press:.40,width:.32,chasers:1}},
  {id:'park',name:'공원 패밀리',formation:'3-5-2',stats:{speed:61,shot:56,pass:76,defense:58,stamina:66,keeping:57},tactics:{line:.60,press:.38,width:.25,chasers:1}},
  {id:'rail',name:'철길 유나이티드',formation:'5-3-2',stats:{speed:48,shot:54,pass:50,defense:67,stamina:57,keeping:64},tactics:{line:.47,press:.29,width:.24,chasers:1}},
  {id:'roof',name:'옥상 시티',formation:'4-3-3',stats:{speed:72,shot:75,pass:69,defense:52,stamina:58,keeping:51},tactics:{line:.68,press:.52,width:.40,chasers:2}},
  {id:'bolt',name:'번개 클럽',formation:'3-5-2',stats:{speed:84,shot:78,pass:73,defense:70,stamina:80,keeping:75},tactics:{line:.63,press:.50,width:.34,chasers:2}}
];

function shuffledOpponents(home, random = Math.random) {
  const a = TEAM_DEFS.map((_, i) => i).filter(i => i !== home);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 3);
}

function createTournament(home, random = Math.random) {
  return {
    type:'tournament', userTeam:home, round:0,
    opponents:shuffledOpponents(home, random), history:[], shootout:null
  };
}

function penaltyFinished(pk) {
  const played = pk.shots[0];
  if (played < 5)
    return Math.abs(pk.scored[0] - pk.scored[1]) > 5 - played;
  return pk.scored[0] !== pk.scored[1];
}

function makeLeagueRounds(teamCount = TEAM_DEFS.length) {
  let ring = Array.from({length:teamCount}, (_, i) => i);
  const first = [];
  for (let r = 0; r < teamCount - 1; r++) {
    const fixtures = [];
    for (let i = 0; i < teamCount / 2; i++) {
      const a = ring[i], b = ring[teamCount - 1 - i];
      fixtures.push((r + i) % 2 ? [b, a] : [a, b]);
    }
    first.push(fixtures);
    ring = [ring[0], ring[ring.length - 1], ...ring.slice(1, -1)];
  }
  return first.concat(first.map(round => round.map(([a,b]) => [b,a])));
}

function emptyTable() {
  return TEAM_DEFS.map((_, team) => ({team,p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}));
}

function applyTableResult(table, a, b, ga, gb) {
  const A = table[a], B = table[b];
  A.p++; B.p++; A.gf += ga; A.ga += gb; B.gf += gb; B.ga += ga;
  if (ga > gb) { A.w++; B.l++; A.pts += 3; }
  else if (gb > ga) { B.w++; A.l++; B.pts += 3; }
  else { A.d++; B.d++; A.pts++; B.pts++; }
}

function rankedTable(table) {
  return table.slice().sort((a,b) =>
    b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) ||
    b.gf - a.gf || a.team - b.team);
}

function createLeague(home, type = 'league', seasonNo = 1, trophies = null) {
  return {
    type, phase:'league', userTeam:home, round:0,
    rounds:makeLeagueRounds(), table:emptyTable(), history:[],
    seasonNo, trophies:trophies || {league:0,cup:0}, shootout:null
  };
}

function leagueUserFixture(c) {
  return c.rounds[c.round].find(pair => pair.includes(c.userTeam));
}

function sampleGoals(strength) {
  const lambda = Math.max(.55, Math.min(3.2, 1.65 + strength / 32));
  let p = 1, k = 0, limit = Math.exp(-lambda);
  do { k++; p *= Math.random(); } while (p > limit && k < 10);
  return k - 1;
}

function simulateFixture(a, b) {
  const diff = teamRating(TEAM_DEFS[a]) - teamRating(TEAM_DEFS[b]);
  return [sampleGoals(diff), sampleGoals(-diff)];
}
const selectedTeams = [0, 0];
const selectedFormation = ['4-4-2', '4-4-2'];
const tacticOverride = [null, null];

function clampStat(n) { return Math.max(1, Math.min(99, n)); }
function teamRating(t) {
  const s = t.stats;
  return (s.speed + s.shot + s.pass + s.defense + s.stamina + s.keeping) / 6;
}
function ratingBars(t) {
  const n = Math.max(1, Math.min(5, Math.round(teamRating(t) / 20)));
  return '●'.repeat(n) + '○'.repeat(5 - n);
}
function playerStats(team, f, i) {
  const s = team.stats, jitter = (i * 7 % 9) - 4;
  return {
    speed:clampStat(s.speed + jitter + (f.role === 'FW' ? 3 : 0)),
    shot:clampStat(s.shot + jitter + (f.role === 'FW' ? 10 : f.role === 'MF' ? 2 : -7)),
    pass:clampStat(s.pass - jitter + (f.role === 'MF' ? 8 : 0)),
    defense:clampStat(s.defense + (f.role === 'DF' ? 10 : f.role === 'FW' ? -8 : 0)),
    stamina:clampStat(s.stamina + jitter),
    keeping:clampStat(f.role === 'GK' ? s.keeping : 1)
  };
}

function teamTactics(side) {
  return tacticOverride[side] || TEAM_DEFS[selectedTeams[side]].tactics;
}

function buildTeams() {
  for (const side of [0, 1]) {
    const team = TEAM_DEFS[selectedTeams[side]];
    const formation = FORMATIONS[selectedFormation[side] || team.formation];
    teams[side] = formation.map((f, i) => {
      const stats = playerStats(team, f, i);
      return {
      side, role:f.role, no:i, isGK:f.role === 'GK',
      hx:f.x, hy:f.y,                       // 정규화 홈 위치
      stats,
      // P_MAX가 전체 선수의 실제 상한이다. 능력치는 그 아래에서만 차이를 낸다.
      speedMul:.78 + stats.speed / 99 * .22,
      shotMul:.84 + stats.shot / 99 * .28,
      passMul:.84 + stats.pass / 99 * .26,
      defenseMul:.76 + stats.defense / 99 * .46,
      energy:1,
      // 골키퍼는 공에 대해서만 몸보다 넓게 닿는다 = 다이빙 선방.
      // 이게 없으면 골문을 실측(146)까지 좁혀도 경기당 7골이 넘는다.
      reach:f.role === 'GK'
        ? R_PLAYER * GK_REACH_MUL * (.82 + stats.keeping / 99 * .30) : R_PLAYER,
      x:0, y:0, vx:0, vy:0,
      kickCd:0, trapCd:0, tackleCd:0, tackleT:0, blockT:0, headCd:0,
      actShoot:0, actPass:0, actThrough:0, shootHeld:false, shootCharge:0,
      kickPower:0, gkClaim:false,
      aimX:attackDir[side], aimY:0, manualAim:false, yellow:0,
      aiT:Math.random() * 0.3, aiTx:0, aiTy:0, gkDifficulty:LEVELS[1].gk
    };
    });
  }
}

// 정규화 홈 위치 → 실제 좌표 (side 1 은 x 반전)
function homePos(p) {
  const nx = attackDir[p.side] === 1 ? p.hx : 1 - p.hx;
  return { x:nx * FW, y:p.hy * FH };
}

function resetPositions(kickSide) {
  for (const side of [0, 1]) for (const p of teams[side]) {
    const h = homePos(p);
    p.x = h.x; p.y = h.y; p.vx = p.vy = 0;
    p.kickCd = p.trapCd = p.tackleCd = p.tackleT = p.blockT = p.headCd = 0;
    p.actShoot = p.actPass = p.actThrough = 0;
    p.shootHeld = false; p.shootCharge = 0;
    p.kickPower = 0; p.gkClaim = false;
    // 킥오프: 공을 넣는 팀만 센터서클 안으로 한 명 들여보낸다
    if (p.role === 'FW' && p.no === 9 && side === kickSide) {
      p.x = FW / 2 - attackDir[side] * R_PLAYER * 2;
      p.y = FH / 2;
    }
  }
  ball.x = ball.prevX = FW / 2; ball.y = ball.prevY = FH / 2;
  ball.vx = ball.vy = 0; ball.z = 0; ball.vz = 0;
  ball.owner = ball.lastTouch = null; ball.freeCd = 0;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false; offside = null;
  cam.x = FW / 2; cam.y = FH / 2;
  ctrl[0] = ctrl[1] = null;
  ctrlLock[0] = ctrlLock[1] = 0;
}

function startMatch(m) {
  mode = m;
  score[0] = score[1] = 0;
  matchStats.shots.fill(0); matchStats.onTarget.fill(0);
  matchStats.shotGoals.fill(0); matchStats.nonShotGoals.fill(0);
  matchStats.blocks.fill(0);
  matchStats.carryGoals.fill(0); matchStats.looseGoals.fill(0);
  matchStats.attackingLooseGoals.fill(0); matchStats.ownGoals.fill(0);
  matchStats.possession.fill(0); matchStats.corners.fill(0);
  matchStats.fouls.fill(0); matchStats.cards.fill(0); matchStats.setpieces = {};
  matchStats.offsides.fill(0);
  matchStats.events = [];
  half = 1; clock = MATCH_SEC / 2; addedBank = 0; inAdded = false;
  attackDir[0] = 1; attackDir[1] = -1; setpiece = null; offside = null;
  buildTeams();
  resetPositions(0);
  state = 'play';
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('nameAway').textContent = TEAM_DEFS[selectedTeams[1]].name;
  document.getElementById('nameHome').textContent = TEAM_DEFS[selectedTeams[0]].name;
  syncHud();
}

function setConfigVisible(show) {
  for (const id of ['levelRow','lengthRow','teamSetup','tacticsPanel','quickRow'])
    document.getElementById(id).hidden = !show;
  document.getElementById('modeRow').hidden = false;
  document.getElementById('pkRow').hidden = true;
}

function setModeButtons(activeId, text) {
  for (const id of ['btnTournament','btnLeague','btnSeason'])
    document.getElementById(id).hidden = id !== activeId;
  const active = document.getElementById(activeId);
  active.hidden = false; active.textContent = text;
  document.getElementById('btnCancelCompetition').hidden = false;
}

function resetModeButtons() {
  const labels = {
    btnTournament:'8팀 토너먼트', btnLeague:'14경기 리그', btnSeason:'시즌'
  };
  for (const [id, text] of Object.entries(labels)) {
    const b = document.getElementById(id); b.hidden = false; b.textContent = text;
  }
  document.getElementById('btnCancelCompetition').hidden = true;
}
