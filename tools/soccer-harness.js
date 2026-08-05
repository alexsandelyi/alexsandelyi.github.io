#!/usr/bin/env node
// 게임 스코프 안에서 도는 측정 하네스.
//
// 게임 파일들을 실행한 뒤 같은 컨텍스트에서 이 스크립트를 돌린다.
// readHuman 을 봇으로 갈아끼우고 __sim 으로 조작 창구를 연다.
// 파일로 분리한 이유는 코드 파일 500줄 규칙 때문이다.

// ── 하네스 ──────────────────────────────────────────────────────────
// 게임 소스와 같은 스코프에 이어 붙인다. readHuman 은 함수 선언이라
// 같은 스코프에서 재할당할 수 있고, step() 은 바뀐 쪽을 호출한다.
const { SELF_TEST } = require('./soccer-selftest.js');

const HARNESS = `
'use strict';
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
          cards: matchStats.cards.slice(),
          headers: matchStats.headers.slice(),
          headGoals: matchStats.headGoals.slice(),
          deflections: matchStats.deflections.slice(),
          crosses: matchStats.crosses.slice(),
          gkClaims: matchStats.gkClaims.slice()
        }
      };
    },
    matchSec: MATCH_SEC,
    levelNames: LEVELS.map(function (l) { return l.name; }),
    strictMode: (function () { return this === undefined; })(),
    // 셀프테스트 본문은 soccer-selftest.js 에 있다 — 이 파일이 500줄을
    // 넘어서 나눴다. 템플릿 문자열이라 그대로 끼워 넣으면 된다.
    selfTest: function () {
${SELF_TEST}    }
  };
})();
`;

module.exports = { HARNESS };
