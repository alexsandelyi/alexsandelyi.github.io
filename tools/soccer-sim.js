#!/usr/bin/env node
// 동네 축구 밸런스 측정.
//
// games/soccer/index.html 의 게임 스크립트를 그대로 vm 에 올리고, readHuman
// 만 봇으로 갈아끼운 뒤 실제 step(1/60) 을 반복 호출해 난이도별 승률을 낸다.
// 브라우저 requestAnimationFrame 은 백그라운드에서 초당 1회로 스로틀되므로
// 쓰지 않는다.
//
//   node tools/soccer-sim.js              # 난이도별 30경기
//   node tools/soccer-sim.js -n 200       # 200경기 (밸런스 변경 시 권장)
//   node tools/soccer-sim.js -l 1         # 보통 난이도만
//   node tools/soccer-sim.js --seed 7
//   node tools/soccer-sim.js --sweep-speed # 보통 상대 속도 배수 0.84~0.94, 각 200경기
//
// Node 내장 모듈만 쓴다 (게임과 같은 무의존 원칙).

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const GAME = path.join(__dirname, '..', 'games', 'soccer', 'index.html');
// 쉬움 / 보통 / 어려움 목표 승률(%).
// 쉬움은 원래 73% 였으나 2026-07-31 실측 81.5% 를 목표로 인정해 80% 로
// 고쳤다. 이는 쉬움의 제품 목표이며 봇 측정값을 사람 승률로 해석하지 않는다.
// games/soccer/balance.md 참조.
const TARGET_WIN = [80, 53, 23];
const TARGET_GOALS = [2, 3];            // 골목 FC끼리 10분 총 득점 목표
const LEVEL_NAMES = ['쉬움', '보통', '어려움'];
const SWEEP_SPEEDS = Array.from({ length:11 }, (_, i) => (84 + i) / 100);
const TACTIC_PRESETS = {
  default:null,
  high:{ line:.70, press:.35, width:.28, chasers:2 },
  press:{ line:.58, press:.55, width:.25, chasers:2 },
  wide:{ line:.50, press:.45, width:.45, chasers:2 }
};

// ── 인자 ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    n:null, seed:1, levels:[0, 1, 2], botLevel:1, sweepSpeed:false,
    gkReach:null, opponentSpeed:null, selfTest:false, homeTeam:0, awayTeam:0,
    homeTactic:'default', awayTactic:'default', matchSec:null
  };
  let levelSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} 뒤에 값이 필요합니다`);
      return v;
    };
    if (a === '-n' || a === '--matches') o.n = +next();
    else if (a === '--seed') o.seed = +next();
    else if (a === '-l' || a === '--level') { o.levels = [+next()]; levelSet = true; }
    else if (a === '--bot') o.botLevel = +next();
    else if (a === '--gk-reach') o.gkReach = +next();
    else if (a === '--opponent-speed') o.opponentSpeed = +next();
    else if (a === '--home-team') o.homeTeam = +next();
    else if (a === '--away-team') o.awayTeam = +next();
    else if (a === '--home-tactic') o.homeTactic = next();
    else if (a === '--away-tactic') o.awayTactic = next();
    else if (a === '--match-sec') o.matchSec = +next();
    else if (a === '--sweep-speed') o.sweepSpeed = true;
    else if (a === '--self-test') o.selfTest = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (o.n === null) o.n = o.sweepSpeed ? 200 : 30;
  if (!Number.isInteger(o.n) || o.n < 1) throw new Error('-n 은 1 이상의 정수여야 합니다');
  if (!Number.isInteger(o.seed)) throw new Error('--seed 는 정수여야 합니다');
  for (const l of o.levels) {
    if (!Number.isInteger(l) || l < 0 || l > 2) throw new Error('-l 은 0~2 정수여야 합니다');
  }
  if (!Number.isInteger(o.botLevel) || o.botLevel < 0 || o.botLevel > 2) {
    throw new Error('--bot 은 0~2 정수여야 합니다');
  }
  if (o.sweepSpeed && levelSet) throw new Error('--sweep-speed 와 -l 은 함께 쓸 수 없습니다');
  if (o.gkReach !== null && (!Number.isFinite(o.gkReach) || o.gkReach < 1 || o.gkReach > 8)) {
    throw new Error('--gk-reach 는 1~8 숫자여야 합니다');
  }
  if (o.opponentSpeed !== null &&
      (!Number.isFinite(o.opponentSpeed) || o.opponentSpeed < 0.5 || o.opponentSpeed > 1.2)) {
    throw new Error('--opponent-speed 는 0.5~1.2 숫자여야 합니다');
  }
  if (![o.homeTeam, o.awayTeam].every(n => Number.isInteger(n) && n >= 0 && n < 8)) {
    throw new Error('--home-team/--away-team 은 0~7 정수여야 합니다');
  }
  if (![o.homeTactic, o.awayTactic].every(n => Object.hasOwn(TACTIC_PRESETS, n))) {
    throw new Error('--home-tactic/--away-tactic 은 default|high|press|wide 여야 합니다');
  }
  if (o.matchSec !== null && ![360, 600, 1200].includes(o.matchSec)) {
    throw new Error('--match-sec 는 360|600|1200 이어야 합니다');
  }
  return o;
}

const HELP = `동네 축구 밸런스 측정

  -n, --matches <수>   난이도당 경기 수 (기본 30)
  -l, --level <0|1|2>  한 난이도만 측정 (0=쉬움, 1=보통, 2=어려움)
      --seed <정수>    난수 시드 (기본 1). 같은 시드면 결과가 재현된다
      --bot <0|1|2>    사람 자리를 대신하는 봇의 수준 (기본 1=보통)
      --gk-reach <수>  골키퍼 공 접촉 반경 배수 측정값 덮어쓰기
      --opponent-speed <수>  1P 상대 이동 속도 배수 덮어쓰기
      --home-team <0~7> / --away-team <0~7>  측정 팀 선택
      --home-tactic/--away-tactic <default|high|press|wide>
      --match-sec <360|600|1200>  6·10·20분 경기 길이 검증
      --sweep-speed    보통 1P 상대 속도 배수 0.84~0.94를 0.01 간격으로 측정
                       기본 경기 수는 속도값당 200 (-n으로 변경 가능)
      --self-test      오프사이드·파울 결정론 시나리오 검사
  -h, --help           이 도움말
`;

// ── 결정적 난수 (mulberry32) ────────────────────────────────────────
// 시드를 고정해야 밸런스 변경의 효과와 난수 요동을 구분할 수 있다.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 게임 스크립트 추출 ──────────────────────────────────────────────
function readGameSource() {
  const html = fs.readFileSync(GAME, 'utf8');
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open < 0 || close < 0 || close < open) {
    throw new Error(`${GAME} 에서 <script> 블록을 찾지 못했습니다`);
  }
  const src = html.slice(open + '<script>'.length, close);
  // 게임이 한 블록이라는 전제가 깨지면 조용히 일부만 실행된다.
  if (html.indexOf('<script') !== open || html.split('<script').length !== 2) {
    throw new Error('<script> 블록이 2개 이상입니다. 추출 로직을 확인하세요');
  }
  return src;
}

// ── 브라우저 스텁 ───────────────────────────────────────────────────
// 게임은 DOM·Canvas·localStorage 를 만지지만 시뮬레이션에는 필요 없다.
// draw() 를 호출하지 않으므로 Canvas 컨텍스트는 전부 no-op 이면 된다.
function makeSandbox(rand) {
  const noop = () => {};
  const ctx2d = new Proxy({}, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (!(k in t)) t[k] = noop;
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });

  const els = new Map();
  const makeEl = () => ({
    style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
    // resize() 가 읽는 값. 가로 화면이라 경기장을 회전하지 않는다.
    clientWidth: 1280, clientHeight: 720, width: 1280, height: 720,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop,
    setPointerCapture: noop, releasePointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
    appendChild: noop, focus: noop,
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getContext: () => ctx2d
  });
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl());
    return els.get(id);
  };

  const store = new Map();
  let t = 0;

  const sandbox = {
    console,
    __rand: rand,
    document: {
      body: makeEl(),
      getElementById: getEl,
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: makeEl
    },
    window: { addEventListener: noop, devicePixelRatio: 1 },
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    performance: { now: () => (t += 16.667) },
    // 실제 루프는 우리가 step() 으로 직접 돌린다.
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop
  };
  sandbox.globalThis = sandbox;
  sandbox.window.localStorage = sandbox.localStorage;
  return sandbox;
}

// ── 하네스 ──────────────────────────────────────────────────────────
// 게임 소스와 같은 스코프에 이어 붙인다. readHuman 은 함수 선언이라
// 같은 스코프에서 재할당할 수 있고, step() 은 바뀐 쪽을 호출한다.
const HARNESS = `
;(function(){
  var botDt = 1/60;
  var botLevel = 1;

  // 사람 자리를 봇으로. 조작 중인 선수에게 상대 AI 와 같은 판단 로직을
  // 쓰되, step() 이 사람에게는 속도 감속을 걸지 않는 점은 그대로 둔다.
  readHuman = function (i) {
    var p = ctrl[i];
    if (!p) return { ax: 0, ay: 0 };
    return aiPlayer(p, botDt, LEVELS[botLevel], true);
  };

  var offsideChecks = 0, offsideMarks = 0;
  var gameMarkOffside = markOffside;
  markOffside = function (p) {
    offsideChecks++;
    gameMarkOffside(p);
    if (offside) offsideMarks++;
  };

  globalThis.__sim = {
    setBotLevel: function (n) { botLevel = n; },
    setLevelOpponentSpeed: function (n, speed) { OPPONENT_SPEED_MUL[n] = speed; },
    setGkReach: function (n) { GK_REACH_MUL = n; },
    setOpponentSpeed: function (n) {
      for (var i = 0; i < OPPONENT_SPEED_MUL.length; i++) OPPONENT_SPEED_MUL[i] = n;
    },
    setTeams: function (home, away) {
      selectedTeams[0] = home; selectedTeams[1] = away;
      selectedFormation[0] = TEAM_DEFS[home].formation;
      selectedFormation[1] = TEAM_DEFS[away].formation;
      tacticOverride[0] = tacticOverride[1] = null;
    },
    setTactics: function (side, tactics) { tacticOverride[side] = tactics; },
    setMatchSec: function (n) { MATCH_SEC = n; this.matchSec = n; },
    run: function (lvl) {
      level = lvl;
      startMatch('1p');
      offsideChecks = offsideMarks = 0;
      var movement = {
        count:0, sum:0, max:0, bins:[0,0,0,0],
        halfCount:[0,0], halfSum:[0,0]
      };
      var dt = 1/60, steps = 0;
      var MAX = 60 * 60 * 30;            // 안전장치: 30분 분량
      while (state !== 'end' && steps < MAX) {
        botDt = dt;
        step(dt);
        if (state === 'play') {
          var allPlayers = teams[0].concat(teams[1]);
          for (var pi = 0; pi < allPlayers.length; pi++) {
            var player = allPlayers[pi];
            var kmh = Math.hypot(player.vx, player.vy) / M * 3.6;
            movement.count++; movement.sum += kmh;
            movement.max = Math.max(movement.max, kmh);
            movement.halfCount[half - 1]++;
            movement.halfSum[half - 1] += kmh;
            movement.bins[kmh < 8 ? 0 : kmh < 15.5 ? 1 : kmh < 27 ? 2 : 3]++;
          }
        }
        steps++;
      }
      if (steps >= MAX) throw new Error('경기가 끝나지 않았습니다 (무한 루프)');
      return {
        gf: score[0], ga: score[1], steps: steps,
        setpieces: Object.assign({}, matchStats.setpieces),
        events: matchStats.events.slice(),
        movement: movement,
        stats: {
          shots: matchStats.shots.slice(),
          shotGoals: matchStats.shotGoals.slice(),
          nonShotGoals: matchStats.nonShotGoals.slice(),
          carryGoals: matchStats.carryGoals.slice(),
          looseGoals: matchStats.looseGoals.slice(),
          attackingLooseGoals: matchStats.attackingLooseGoals.slice(),
          ownGoals: matchStats.ownGoals.slice(),
          blocks: matchStats.blocks.slice(),
          offsides: matchStats.offsides.slice(),
          offsideChecks: [offsideChecks],
          offsideMarks: [offsideMarks],
          fouls: matchStats.fouls.slice(),
          cards: matchStats.cards.slice()
        }
      };
    },
    matchSec: MATCH_SEC,
    levelNames: LEVELS.map(function (l) { return l.name; }),
    strictMode: (function () { return this === undefined; })(),
    selfTest: function () {
      level = 1;
      startMatch('1p');
      var passer = teams[0][9], offender = teams[0][10];
      passer.x = 1050; passer.y = 680;
      offender.x = 1800; offender.y = 680;
      for (var i = 0; i < teams[1].length; i++) {
        teams[1][i].x = 1200 + i * 8;
        teams[1][i].y = 100 + i * 90;
      }
      ball.owner = passer; ball.x = passer.x + 42; ball.y = passer.y;
      markOffside(passer);
      var marked = !!offside && offside.offenders.indexOf(offender) >= 0;
      ball.owner = null; ball.freeCd = 0; offender.trapCd = 0;
      takePossession(offender);
      var called = state === 'setpiece' && setpiece && setpiece.type === 'free' &&
                   matchStats.offsides[0] === 1;

      startMatch('1p');
      passer = teams[0][9]; offender = teams[0][10];
      var validReceiver = teams[0][8];
      passer.x = 1050; passer.y = 680;
      offender.x = 1800; offender.y = 680;
      validReceiver.x = 1080; validReceiver.y = 760;
      for (i = 0; i < teams[1].length; i++) teams[1][i].x = 1200 + i * 8;
      ball.owner = passer; ball.x = passer.x + 42; ball.y = passer.y;
      markOffside(passer);
      ball.owner = null; ball.freeCd = 0; validReceiver.trapCd = 0;
      takePossession(validReceiver);
      var offsideClearedOnValidTouch = offside === null && ball.owner === validReceiver;

      startMatch('1p');
      passer = teams[0][9]; offender = teams[0][10];
      passer.x = 1050; passer.y = 680;
      offender.x = 1800; offender.y = 680;
      for (i = 0; i < teams[1].length; i++) teams[1][i].x = 1200 + i * 8;
      ball.owner = null; ball.x = passer.x + 7; ball.y = passer.y;
      ball.vx = ball.vy = 0; passer.actPass = 0.1; passer.kickCd = 0;
      collide(passer);
      var collisionPassMarked = !!offside && offside.offenders.indexOf(offender) >= 0;

      ball.owner = null; ball.x = offender.x - 7; ball.y = offender.y;
      ball.vx = 900; ball.vy = 0; ball.freeCd = 0;
      collide(offender);
      var fastTouchCalled = state === 'setpiece' && setpiece && setpiece.type === 'free';

      level = 0; offside = null;
      markOffside(passer);
      var easyOffsideDisabled = offside === null;

      level = 1;
      startMatch('1p');
      var tackler = teams[1][1], victim = teams[0][1];
      tackler.x = 1000; tackler.y = 680; tackler.vx = 500; tackler.vy = 0;
      victim.x = 1010; victim.y = 680; victim.vx = 0; victim.vy = 0;
      ball.owner = victim; ball.x = 1030; ball.y = 680;
      tackler.tackleT = 0.2;
      separateAll();
      var foul = state === 'setpiece' && setpiece && matchStats.fouls[1] === 1;
      var card = matchStats.cards[1] === 1 && tackler.yellow === 1;
      tackler.energy = 0.2;
      state = 'goal'; goalTimer = 0; lastScorer = 0;
      step(1/60);
      var stateAfterGoal = tackler.yellow === 1 && tackler.energy === 0.2;
      state = 'halftime'; goalTimer = 0;
      step(1/60);
      var stateAfterHalftime = tackler.yellow === 1 && tackler.energy === 0.2;
      startMatch('1p');
      var stateAtNewMatch = teams[0].concat(teams[1]).every(function (p) {
        return p.yellow === 0 && p.energy === 1;
      });

      startMatch('1p');
      matchStats.shots[1] = matchStats.onTarget[1] = 0;
      beginSetpiece('penalty', 1, { x:FW - PEN_SPOT, y:FH / 2 });
      takeSetpiece('pass');
      var penaltyShotCounted = ball.shotSide === 1 && matchStats.shots[1] === 1;
      goal(1);
      var penaltyOnTarget = matchStats.onTarget[1] === 1;
      ball.shotSide = -1; ball.shotCounted = false;
      goal(0);
      var goalClassification = score.every(function (goals, side) {
        return goals === matchStats.shotGoals[side] + matchStats.nonShotGoals[side];
      }) && matchStats.nonShotGoals.every(function (goals, side) {
        return goals === matchStats.carryGoals[side] + matchStats.looseGoals[side];
      }) && matchStats.looseGoals.every(function (goals, side) {
        return goals === matchStats.attackingLooseGoals[side] + matchStats.ownGoals[side];
      }) && matchStats.shotGoals[1] === 1 && matchStats.nonShotGoals[0] === 1;
      startMatch('1p');
      var formationsValid = Object.keys(FORMATIONS).every(function (name) {
        selectedFormation[0] = name; selectedFormation[1] = name;
        buildTeams(); resetPositions(0);
        return teams[0].length === 11 && teams[1].length === 11 &&
          teams[0].every(function (p, i) {
            return teams[0].every(function (q, j) {
              return i === j || Math.hypot(p.x - q.x, p.y - q.y) >= R_PLAYER * 2;
            });
          });
      });
      var ratingsOrdered = teamRating(TEAM_DEFS[7]) > teamRating(TEAM_DEFS[0]) &&
                           teamRating(TEAM_DEFS[0]) > teamRating(TEAM_DEFS[5]);
      var tournament = createTournament(0, function () { return 0; });
      var tournamentValid = tournament.opponents.length === 3 &&
        new Set(tournament.opponents).size === 3 &&
        tournament.opponents.every(function (n) { return n !== 0; });
      var shootoutRules = penaltyFinished({ shots:[3,3], scored:[3,0] }) &&
        !penaltyFinished({ shots:[5,5], scored:[4,4] }) &&
        penaltyFinished({ shots:[6,6], scored:[5,4] });
      localStorage.removeItem(SAVE_KEY);
      localStorage.setItem(OLD_KEY + '.rec1',
        JSON.stringify({ w:7, d:2, l:3, bestGd:4 }));
      localStorage.setItem(OLD_KEY + '.matchSec', '180');
      var migrated = loadSaveData();
      var storageMigrated = migrated.version === 2 &&
        migrated.records[1].w === 7 && migrated.records[1].bestGd === 4 &&
        migrated.settings.matchSec === 360;
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version:2, settings:{matchSec:180}, records:{}
      }));
      var migratedV2 = loadSaveData();
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version:2, settings:{matchSec:1200}, records:{}
      }));
      var keptV2 = loadSaveData();
      var matchLengthMigration = migratedV2.settings.matchSec === 360 &&
        keptV2.settings.matchSec === 1200 && normalizeMatchSec(null) === 600;

      startMatch('1p');
      var runner = teams[0][1];
      runner.x = FW / 2; runner.y = FH / 2; runner.vx = P_MAX; runner.vy = 0;
      var runnerStart = runner.x;
      for (var mv = 0; mv < 60; mv++) movePlayer(runner, 1, 0, 1/60, P_MAX);
      var straightSpeed = Math.abs((runner.x - runnerStart) - P_MAX) < 0.01;
      runner.energy = 1;
      var sprintStartEnergy = runner.energy;
      var requestedSprint = 0;
      for (var staminaTick = 0; staminaTick < 60; staminaTick++) {
        requestedSprint = staminaLimitedSpeed(runner, SPEED_SPRINT, 1/60);
      }
      runner.energy = 0;
      var exhaustedSprint = staminaLimitedSpeed(runner, SPEED_SPRINT, 1/60);
      var movementPaces = Math.abs(SPEED_WALK / M * 3.6 - 5) < 1e-9 &&
        Math.abs(SPEED_JOG / M * 3.6 - 11) < 1e-9 &&
        Math.abs(SPEED_RUN / M * 3.6 - 20) < 1e-9 &&
        Math.abs(SPEED_SPRINT / M * 3.6 - 34.2) < 1e-9 &&
        runner.energy < sprintStartEnergy && requestedSprint <= SPEED_SPRINT &&
        exhaustedSprint <= SPEED_RUN &&
        abilityAdjustedSpeed(runner, SPEED_SPRINT, SPEED_SPRINT) <= P_MAX;
      var colliderA = teams[0][9], colliderB = teams[1][9];
      colliderA.x = 900; colliderA.y = 500; colliderA.vx = colliderA.vy = 0;
      colliderB.x = 900 + R_PLAYER * 2 - 1; colliderB.y = 500;
      colliderB.vx = colliderB.vy = 0; ball.x = 1500; ball.y = 900;
      separateAll();
      var collisionRadius = Math.hypot(colliderA.x - colliderB.x,
        colliderA.y - colliderB.y) >= R_PLAYER * 2 - 1e-6;
      var oldView = view;
      view = {dpr:2, scale:.5, rot:false, w:0, h:0, whole:true};
      var separatedDrawScale = Math.abs(drawRadius(R_PLAYER, DRAW_PLAYER_MIN_PX) - 36) < 1e-9 &&
        Math.abs(drawRadius(R_BALL, DRAW_BALL_MIN_PX) - 16) < 1e-9;
      view = oldView;
      var landscapeScaleA = cameraScale(1280, 720, false, 1);
      var landscapeScaleB = cameraScale(1920, 1080, false, 1);
      var portraitScaleA = cameraScale(390, 844, true, 1);
      var portraitScaleB = cameraScale(768, 1024, true, 1);
      var cameraViewportStable =
        Math.abs(1280 / landscapeScaleA - CAMERA_LANDSCAPE_W) < 1e-9 &&
        Math.abs(1920 / landscapeScaleB - CAMERA_LANDSCAPE_W) < 1e-9 &&
        Math.abs(390 / portraitScaleA - CAMERA_PORTRAIT_W) < 1e-9 &&
        Math.abs(768 / portraitScaleB - CAMERA_PORTRAIT_W) < 1e-9;
      var physicalScale = R_PLAYER === 6 && R_BALL === 2.2 && P_ACCEL === 150 &&
        P_MAX === 190 && P_FRICTION === 4 && B_FRICTION === .82 && B_MAX === 800 &&
        TOUCH_V === 120 && PASS_V === 340 && SHOOT_V === 660 && GOAL_H === 146 &&
        GK_REACH_MUL === 6 && TACKLE_TRIGGER === 32 && SHOT_BLOCK_REACH === 36 &&
        teams[0].concat(teams[1]).every(function (p) {
          return p.speedMul <= 1;
        });
      // ── 공 높이(z) 물리 ────────────────────────────────────────
      var ballHeightConstants = GRAVITY === 9.81 * M && CROSSBAR === 2.44 * M &&
        BOUNCE_Z === .5 && AIR_FRICTION === .94 && FOOT_H === 10 && GK_HIGH_H === 52;

      var dtq = 1 / 60;
      function launch(z0, vz0, vx0) {
        ball.owner = null; ball.lastTouch = null; ball.freeCd = 0;
        ball.x = FW / 2; ball.y = FH / 2;
        ball.vx = vx0 || 0; ball.vy = 0; ball.z = z0; ball.vz = vz0;
      }

      // 체공 2.02초가 나오는 수직 속도로 쏘아 올려 정점과 체공을 잰다.
      // 정점 이론값은 vz²/(2g). 적분 오차 5% 안이면 통과.
      startMatch('1p');
      var vz0 = GRAVITY * 1.01;
      launch(0, vz0);
      var apex = 0, flight = 0;
      for (var q = 0; q < 600; q++) {
        updateBall(dtq); flight += dtq;
        if (ball.z > apex) apex = ball.z;
        if (ball.z <= 0 && q > 2) break;
      }
      var parabola = Math.abs(flight - 2.02) < .12 &&
        Math.abs(apex - vz0 * vz0 / (2 * GRAVITY)) / (vz0 * vz0 / (2 * GRAVITY)) < .05;

      // 바운스마다 정점이 크게 줄고 결국 완전히 멈춘다.
      launch(100, 0);
      var apexes = [], rising = false, prevZ = ball.z;
      for (var q2 = 0; q2 < 4000; q2++) {
        updateBall(dtq);
        if (ball.z > prevZ) rising = true;
        else if (rising) { rising = false; apexes.push(prevZ); }
        prevZ = ball.z;
      }
      var bounceDecay = apexes.length >= 2 && apexes[1] < apexes[0] * .4 &&
        ball.z === 0 && ball.vz === 0;

      // 비행 중에는 구름저항이 없어 수평 속도를 더 잘 유지한다.
      // 총 도달거리는 바운스 손실 때문에 오히려 짧다 (ball-height.md 참조).
      function speedAfter(seconds, vz0b) {
        launch(0, vz0b, 300);
        var n = Math.round(seconds * 60);
        for (var q3 = 0; q3 < n; q3++) updateBall(dtq);
        return Math.hypot(ball.vx, ball.vy);
      }
      var airHoldsSpeed = speedAfter(1, GRAVITY * .8) > speedAfter(1, 0) * 1.1;

      // 크로스바 위는 골이 아니라 골킥, 아래는 골이다.
      function goalLineTest(z) {
        startMatch('1p');
        var before = score[1];
        ball.owner = null; ball.lastTouch = teams[1][9];
        ball.x = -1; ball.y = FH / 2; ball.z = z; ball.vz = 0;
        var handled = outOfPlay(ball.x, ball.y);
        return { handled:handled, scored:score[1] - before, type:setpiece && setpiece.type };
      }
      var over = goalLineTest(CROSSBAR + 5), under = goalLineTest(CROSSBAR - 5);
      var crossbar = over.scored === 0 && over.type === 'goalkick' && under.scored === 1;

      // 발이 닿지 않는 높이는 아무도 건드리지 못하고, 낮으면 잡는다.
      startMatch('1p');
      var kicker = teams[0][9];
      kicker.x = FW / 2; kicker.y = FH / 2; kicker.vx = kicker.vy = 0; kicker.trapCd = 0;
      launch(FOOT_H + 5, 0);
      ball.x = kicker.x + 4; ball.y = kicker.y;
      collide(kicker);
      var heightGate = ball.owner === null;
      ball.z = 0; ball.vz = 0; collide(kicker);
      var footStillWorks = ball.owner === kicker;

      var rounds = makeLeagueRounds(8), pairCounts = {};
      rounds.forEach(function (fixtures) {
        fixtures.forEach(function (pair) {
          var key = pair.slice().sort(function(a,b){ return a-b; }).join('-');
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        });
      });
      var leagueSchedule = rounds.length === 14 &&
        rounds.every(function (fixtures) {
          return new Set([].concat.apply([], fixtures)).size === 8;
        }) &&
        Object.keys(pairCounts).length === 28 &&
        Object.values(pairCounts).every(function (n) { return n === 2; });
      var testTable = emptyTable();
      applyTableResult(testTable, 0, 1, 2, 0);
      applyTableResult(testTable, 2, 3, 1, 1);
      var leagueRanking = rankedTable(testTable)[0].team === 0 &&
        rankedTable(testTable)[1].team === 2;
      var season = createLeague(0, 'season', 2, {league:1,cup:1});
      var seasonValid = season.rounds.length === 14 && season.seasonNo === 2 &&
        season.trophies.league === 1 && season.phase === 'league';
      var leagueFlow = createLeague(0, 'league');
      competition = leagueFlow; showLeagueReady();
      for (var lr = 0; lr < 14; lr++) {
        score[0] = 1; score[1] = 0; finishLeagueMatch();
      }
      var leagueCompleted = competition === null &&
        leagueFlow.table.every(function (row) { return row.p === 14; });
      var seasonFlow = createLeague(0, 'season');
      competition = seasonFlow; showLeagueReady();
      for (var sr = 0; sr < 14; sr++) {
        score[0] = 1; score[1] = 0; finishLeagueMatch();
      }
      var seasonToCup = competition === seasonFlow &&
        seasonFlow.phase === 'cup' && seasonFlow.cupOpponents.length === 3;
      matchStats.possession[0] = 60; matchStats.possession[1] = 40;
      matchStats.shots[0] = 7; matchStats.shots[1] = 5;
      matchStats.onTarget[0] = 3; matchStats.onTarget[1] = 2;
      matchStats.corners[0] = 4; matchStats.corners[1] = 1;
      matchStats.fouls[0] = 2; matchStats.fouls[1] = 3;
      matchStats.cards[0] = 1; matchStats.cards[1] = 0;
      var summaryText = matchSummaryText();
      var recordsSummary = summaryText.indexOf('60%') >= 0 &&
        summaryText.indexOf('7/3') >= 0 && summaryText.indexOf('2/1') >= 0;
      return {
        strictMode:this.strictMode,
        offsideMarked:marked, offsideCalled:called, foulCalled:foul, yellowCard:card,
        offsideClearedOnValidTouch:offsideClearedOnValidTouch,
        collisionPassMarked:collisionPassMarked, fastTouchCalled:fastTouchCalled,
        easyOffsideDisabled:easyOffsideDisabled,
        stateAfterGoal:stateAfterGoal, stateAfterHalftime:stateAfterHalftime,
        stateAtNewMatch:stateAtNewMatch,
        penaltyShotCounted:penaltyShotCounted, penaltyOnTarget:penaltyOnTarget,
        goalClassification:goalClassification,
        physicalScale:physicalScale, straightSpeed:straightSpeed,
        ballHeightConstants:ballHeightConstants, parabola:parabola,
        bounceDecay:bounceDecay, airHoldsSpeed:airHoldsSpeed,
        crossbar:crossbar, heightGate:heightGate, footStillWorks:footStillWorks,
        movementPaces:movementPaces,
        collisionRadius:collisionRadius, separatedDrawScale:separatedDrawScale,
        cameraViewportStable:cameraViewportStable,
        matchLengthMigration:matchLengthMigration,
        formationsValid:formationsValid, ratingsOrdered:ratingsOrdered,
        tournamentValid:tournamentValid, shootoutRules:shootoutRules,
        storageMigrated:storageMigrated, leagueSchedule:leagueSchedule,
        leagueRanking:leagueRanking, seasonValid:seasonValid,
        leagueCompleted:leagueCompleted, seasonToCup:seasonToCup,
        recordsSummary:recordsSummary
      };
    }
  };
})();
`;

// ── 통계 ────────────────────────────────────────────────────────────
// 승률은 비율이라 정규근사가 꼬리에서 부정확하다. Wilson 구간을 쓴다.
function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n, z2 = z * z;
  const d = 1 + z2 / n;
  const c = p + z2 / (2 * n);
  const s = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

const pct = (x) => (x * 100).toFixed(1).padStart(5);

// ── 실행 ────────────────────────────────────────────────────────────
function createSimulation(seed) {
  const src = readGameSource();
  const sandbox = makeSandbox(mulberry32(seed));
  const context = vm.createContext(sandbox);

  // Math.random 은 게임 소스가 로드되는 시점(buildTeams)부터 쓰이므로
  // 앞에서 먼저 갈아끼운다.
  vm.runInContext('Math.random = __rand;', context, { filename:'soccer-seed.js' });
  vm.runInContext(src + '\n' + HARNESS, context, { filename:'soccer.js' });
  return sandbox.__sim;
}

function runBatch(job) {
  const sim = createSimulation(job.seed);
  sim.setBotLevel(job.botLevel);
  if (job.speed !== undefined) sim.setLevelOpponentSpeed(job.lvl, job.speed);
  if (job.gkReach !== null && job.gkReach !== undefined) sim.setGkReach(job.gkReach);
  if (job.opponentSpeed !== null && job.opponentSpeed !== undefined) {
    sim.setOpponentSpeed(job.opponentSpeed);
  }
  sim.setTeams(job.homeTeam || 0, job.awayTeam || 0);
  if (job.matchSec !== null && job.matchSec !== undefined) sim.setMatchSec(job.matchSec);
  if (job.homeTactic !== 'default') sim.setTactics(0, TACTIC_PRESETS[job.homeTactic]);
  if (job.awayTactic !== 'default') sim.setTactics(1, TACTIC_PRESETS[job.awayTactic]);

  let w = 0, d = 0, l = 0, gf = 0, ga = 0, steps = 0;
  const setpieces = {};
  const eventTotals = {
    shots:0, shotGoals:0, nonShotGoals:0, carryGoals:0, looseGoals:0,
    attackingLooseGoals:0, ownGoals:0, blocks:0,
    offsides:0, offsideChecks:0, offsideMarks:0, fouls:0, cards:0
  };
  const movement = { count:0, sum:0, max:0, bins:[0,0,0,0], halfCount:[0,0], halfSum:[0,0] };
  let sampleEvents = [];
  const t0 = Date.now();
  for (let i = 0; i < job.n; i++) {
    const r = sim.run(job.lvl);
    gf += r.gf; ga += r.ga; steps += r.steps;
    for (const [type, count] of Object.entries(r.setpieces || {})) {
      setpieces[type] = (setpieces[type] || 0) + count;
    }
    if (!sampleEvents.length) sampleEvents = r.events || [];
    if (r.movement) {
      movement.count += r.movement.count; movement.sum += r.movement.sum;
      movement.max = Math.max(movement.max, r.movement.max);
      for (let b = 0; b < 4; b++) movement.bins[b] += r.movement.bins[b];
      for (let h = 0; h < 2; h++) {
        movement.halfCount[h] += r.movement.halfCount[h];
        movement.halfSum[h] += r.movement.halfSum[h];
      }
    }
    for (const key of Object.keys(eventTotals)) {
      eventTotals[key] += (r.stats && r.stats[key] || []).reduce((s, n) => s + n, 0);
    }
    if (r.gf > r.ga) w++; else if (r.gf === r.ga) d++; else l++;
  }
  return {
    lvl:job.lvl, speed:job.speed, w, d, l, gf, ga, n:job.n,
    matchSec:sim.matchSec, avgSteps:steps / job.n, setpieces, sampleEvents, eventTotals,
    movement,
    secs:(Date.now() - t0) / 1000
  };
}

function runWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData:{ kind:'batch', job } });
    let settled = false;
    worker.once('message', message => {
      settled = true;
      if (message.ok) resolve(message.row);
      else reject(new Error(message.error));
    });
    worker.once('error', error => {
      settled = true;
      reject(error);
    });
    worker.once('exit', code => {
      if (!settled) reject(new Error(`측정 작업이 결과 없이 종료 코드 ${code}로 끝났습니다`));
    });
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const count = Math.min(items.length, Math.max(1, limit));
  await Promise.all(Array.from({ length:count }, runner));
  return results;
}

function workerLimit(count) {
  return Math.min(count, Math.max(1, os.availableParallelism() - 1));
}

async function runJobs(jobs, onDone) {
  let done = 0;
  return mapLimit(jobs, workerLimit(jobs.length), async job => {
    const row = await runWorker(job);
    done++;
    onDone(row, done, jobs.length);
    return row;
  });
}

function measurementChunks(n) {
  const count = Math.min(n, Math.max(1, os.availableParallelism() - 1));
  const base = Math.floor(n / count), extra = n % count;
  return Array.from({ length:count }, (_, i) => base + (i < extra ? 1 : 0));
}

function chunkSeed(seed, index) {
  return index === 0 ? seed : (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
}

function combineRows(parts) {
  const groups = new Map();
  for (const row of parts) {
    const key = `${row.lvl}:${row.speed ?? ''}`;
    let out = groups.get(key);
    if (!out) {
      out = {
        lvl:row.lvl, speed:row.speed, w:0, d:0, l:0, gf:0, ga:0, n:0,
        matchSec:row.matchSec, avgSteps:0, setpieces:{}, sampleEvents:[],
        eventTotals:{}, movement:{
          count:0, sum:0, max:0, bins:[0,0,0,0],
          halfCount:[0,0], halfSum:[0,0]
        }, secs:0
      };
      groups.set(key, out);
    }
    out.w += row.w; out.d += row.d; out.l += row.l;
    out.gf += row.gf; out.ga += row.ga;
    out.avgSteps += row.avgSteps * row.n; out.n += row.n;
    out.secs = Math.max(out.secs, row.secs);
    if (!out.sampleEvents.length) out.sampleEvents = row.sampleEvents;
    for (const [name, value] of Object.entries(row.setpieces))
      out.setpieces[name] = (out.setpieces[name] || 0) + value;
    for (const [name, value] of Object.entries(row.eventTotals))
      out.eventTotals[name] = (out.eventTotals[name] || 0) + value;
    const m = row.movement, om = out.movement;
    om.count += m.count; om.sum += m.sum; om.max = Math.max(om.max, m.max);
    for (let i = 0; i < 4; i++) om.bins[i] += m.bins[i];
    for (let i = 0; i < 2; i++) {
      om.halfCount[i] += m.halfCount[i]; om.halfSum[i] += m.halfSum[i];
    }
  }
  return Array.from(groups.values()).map(row => {
    row.avgSteps /= row.n;
    return row;
  }).sort((a, b) => a.lvl - b.lvl || (a.speed || 0) - (b.speed || 0));
}

function printNormalResults(rows) {
  console.log('\n난이도  승  무  패   승률(95% CI)          득점  실점  총득점/경기  목표');
  console.log('─'.repeat(76));
  for (const r of rows) {
    const [lo, hi] = wilson(r.w, r.n);
    const total = (r.gf + r.ga) / r.n;
    const target = TARGET_WIN[r.lvl];
    const hit = target / 100 >= lo && target / 100 <= hi ? '충족' : '벗어남';
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)}  ` +
      `${String(r.w).padStart(3)} ${String(r.d).padStart(3)} ${String(r.l).padStart(3)}   ` +
      `${pct(r.w / r.n)}% (${pct(lo)}~${pct(hi)}%)  ` +
      `${(r.gf / r.n).toFixed(2).padStart(5)} ${(r.ga / r.n).toFixed(2).padStart(5)}  ` +
      `${total.toFixed(2).padStart(10)}  ` +
      `${String(target).padStart(3)}% ${hit}`
    );
  }

  const allGoals = rows.reduce((s, r) => s + r.gf + r.ga, 0) /
                   rows.reduce((s, r) => s + r.n, 0);
  console.log('─'.repeat(76));
  console.log(
    `전체 경기당 총 득점 ${allGoals.toFixed(2)} ` +
    `(목표 ${TARGET_GOALS[0]}~${TARGET_GOALS[1]})`
  );

  console.log('\n슛 분류 (양 팀 합계)');
  console.log('난이도  슛/경기  슛득점 비슛(운반/공격루즈/자책)  성공률  비슛비율  블록');
  for (const r of rows) {
    const s = r.eventTotals;
    const goals = s.shotGoals + s.nonShotGoals;
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)}  ${(s.shots / r.n).toFixed(2).padStart(7)} ` +
      `${String(s.shotGoals).padStart(6)} ${String(s.nonShotGoals).padStart(4)}` +
      `(${String(s.carryGoals).padStart(2)}/${String(s.attackingLooseGoals).padStart(3)}` +
      `/${String(s.ownGoals).padStart(3)})  ` +
      `${pct(s.shotGoals / Math.max(1, s.shots))}% ` +
      `${pct(s.nonShotGoals / Math.max(1, goals))}%  ` +
      `${(s.blocks / r.n).toFixed(2).padStart(7)}`
    );
  }

  console.log('\n이동 속도 (play 상태·22명 시간 가중)');
  console.log('난이도  평균   최고   걷기   조깅   달리기 스프린트  전반   후반');
  for (const r of rows) {
    const m = r.movement, count = Math.max(1, m.count);
    const avg = m.sum / count;
    const shares = m.bins.map(n => n / count * 100);
    const first = m.halfSum[0] / Math.max(1, m.halfCount[0]);
    const second = m.halfSum[1] / Math.max(1, m.halfCount[1]);
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)}  ${avg.toFixed(2).padStart(5)} ` +
      `${m.max.toFixed(2).padStart(6)} ` +
      `${shares.map(v => v.toFixed(1).padStart(6)).join(' ')}  ` +
      `${first.toFixed(2).padStart(5)} ${second.toFixed(2).padStart(6)}`
    );
  }

  const width = rows.reduce((m, r) => {
    const [lo, hi] = wilson(r.w, r.n);
    return Math.max(m, hi - lo);
  }, 0);
  if (width > 0.2) {
    console.log(
      `\n주의: 신뢰구간 폭이 최대 ±${(width / 2 * 100).toFixed(0)}%p 입니다. ` +
      `난이도 간 차이를 판정하려면 -n 을 200 이상으로 올리세요.`
    );
  }
}

function printSweepResults(rows) {
  console.log('\nspeed   승  무  패   승률(95% CI)          득점  실점  총득점/경기');
  console.log('─'.repeat(72));
  for (const r of rows) {
    const [lo, hi] = wilson(r.w, r.n);
    const total = (r.gf + r.ga) / r.n;
    console.log(
      `${r.speed.toFixed(2)}  ` +
      `${String(r.w).padStart(3)} ${String(r.d).padStart(3)} ${String(r.l).padStart(3)}   ` +
      `${pct(r.w / r.n)}% (${pct(lo)}~${pct(hi)}%)  ` +
      `${(r.gf / r.n).toFixed(2).padStart(5)} ${(r.ga / r.n).toFixed(2).padStart(5)}  ` +
      `${total.toFixed(2).padStart(10)}`
    );
  }
  console.log('─'.repeat(72));

  let steepest = null;
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].w / rows[i].n - rows[i - 1].w / rows[i - 1].n;
    if (!steepest || Math.abs(delta) > Math.abs(steepest.delta)) {
      steepest = { from:rows[i - 1].speed, to:rows[i].speed, delta };
    }
  }
  if (steepest) {
    console.log(
      `가장 큰 인접 변화 ${steepest.from.toFixed(2)}→${steepest.to.toFixed(2)}: ` +
      `${(steepest.delta * 100).toFixed(1)}%p`
    );
  }
}

async function main() {
  let opt;
  try {
    opt = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message) + '\n\n' + HELP);
    process.exitCode = 2;
    return;
  }
  if (opt.help) { process.stdout.write(HELP); return; }
  if (opt.selfTest) {
    const result = createSimulation(opt.seed).selfTest();
    const ok = Object.values(result).every(Boolean);
    console.log('결정론 규칙 검사 ' + (ok ? '통과' : '실패'));
    console.log(JSON.stringify(result));
    if (!ok) process.exitCode = 1;
    return;
  }

  if (opt.sweepSpeed) {
    console.log('동네 축구 speed 스윕');
    console.log(`  경기 수  speed 값당 ${opt.n}`);
    console.log(`  시드     ${opt.seed} (각 speed 에서 같은 난수열로 초기화)`);
    console.log(`  사람 자리 봇  ${LEVEL_NAMES[opt.botLevel]} 수준`);
    console.log(`  병렬 작업 ${workerLimit(SWEEP_SPEEDS.length)}개`);
    const jobs = SWEEP_SPEEDS.map(speed => ({
      lvl:1, speed, n:opt.n, seed:opt.seed, botLevel:opt.botLevel,
      gkReach:opt.gkReach, opponentSpeed:opt.opponentSpeed,
      homeTeam:opt.homeTeam, awayTeam:opt.awayTeam
      ,homeTactic:opt.homeTactic, awayTactic:opt.awayTactic, matchSec:opt.matchSec
    }));
    const rows = await runJobs(jobs, (row, done, total) => {
      console.log(
        `  [${done}/${total}] speed ${row.speed.toFixed(2)} 완료 ` +
        `(${row.secs.toFixed(1)}초)`
      );
    });
    printSweepResults(rows);
    return;
  }

  console.log('동네 축구 밸런스 측정');
  console.log(`  경기 수  난이도당 ${opt.n}`);
  console.log(`  시드     ${opt.seed} (청크별 파생 시드를 난이도마다 동일 적용)`);
  console.log(`  사람 자리 봇  ${LEVEL_NAMES[opt.botLevel]} 수준`);
  if (opt.gkReach !== null) console.log(`  골키퍼 도달 배수 ${opt.gkReach}`);
  if (opt.opponentSpeed !== null) console.log(`  상대 이동 배수 ${opt.opponentSpeed}`);
  console.log(`  팀       ${opt.homeTeam} vs ${opt.awayTeam}`);
  console.log(`  전술     ${opt.homeTactic} vs ${opt.awayTactic}`);
  if (opt.matchSec !== null) console.log(`  경기 길이 재정의 ${opt.matchSec}초`);
  const chunks = measurementChunks(opt.n);
  const jobs = opt.levels.flatMap(lvl => chunks.map((n, chunk) => ({
    lvl, n, chunk, seed:chunkSeed(opt.seed, chunk), botLevel:opt.botLevel,
    gkReach:opt.gkReach, opponentSpeed:opt.opponentSpeed,
    homeTeam:opt.homeTeam, awayTeam:opt.awayTeam,
    homeTactic:opt.homeTactic, awayTactic:opt.awayTactic, matchSec:opt.matchSec
  })));
  console.log(`  병렬 작업 ${workerLimit(jobs.length)}개 · 난이도당 ${chunks.length}청크`);
  const parts = await runJobs(jobs, (row, done, total) => {
    console.log(
      `  [${done}/${total}] ${LEVEL_NAMES[row.lvl]} ${row.n}경기 청크 완료 ` +
      `(${row.secs.toFixed(1)}초)`
    );
  });
  const rows = combineRows(parts);
  console.log(`  경기 길이 ${rows[0].matchSec}초`);
  console.log(`  평균 step 호출 ${Math.round(rows.reduce((s, r) => s + r.avgSteps, 0) / rows.length)}`);
  console.log('  경기당 세트피스 ' + Object.keys(rows[0].setpieces).map(type => {
    const avg = rows.reduce((s, r) => s + (r.setpieces[type] || 0) / r.n, 0) / rows.length;
    return `${type}=${avg.toFixed(1)}`;
  }).join(' '));
  if (rows[0].n === 1) console.log('  이벤트 표본 ' + JSON.stringify(rows[0].sampleEvents));
  const decisionKeys = ['offsides', 'offsideChecks', 'offsideMarks', 'fouls', 'cards'];
  console.log('  경기당 판정 ' + decisionKeys.map(key => {
    const avg = rows.reduce((s, r) => s + r.eventTotals[key] / r.n, 0) / rows.length;
    return `${key}=${avg.toFixed(2)}`;
  }).join(' '));
  console.log('  난이도별 오프사이드 ' + rows.map(r =>
    `${LEVEL_NAMES[r.lvl]}=${(r.eventTotals.offsides / r.n).toFixed(2)}`
  ).join(' '));
  printNormalResults(rows);
}

if (isMainThread) {
  main().catch(error => {
    console.error('측정 실패:', error && error.stack || error);
    process.exitCode = 1;
  });
} else if (workerData && workerData.kind === 'batch') {
  try {
    parentPort.postMessage({ ok:true, row:runBatch(workerData.job) });
  } catch (error) {
    parentPort.postMessage({ ok:false, error:String(error && error.stack || error) });
  }
}
