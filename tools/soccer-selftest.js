#!/usr/bin/env node
// 셀프테스트 본문 — 게임 스코프 안에서 도는 통과/실패 검사.
//
// soccer-harness.js 가 500줄을 넘어서 분리했다. 여기 있는 것은 그쪽
// 템플릿 문자열에 그대로 끼워지는 **문자열**이다. 게임 스코프에서 돌므로
// teams·ball·POSES 같은 전역을 그대로 쓴다.
//
// 수치를 뽑는 것이 아니라 깨진 것을 잡는 장치다 (CLAUDE.md 참조).

const SELF_TEST = `
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
        P_MAX === 190 && P_FRICTION === 4 && B_MAX === 800 &&
        TOUCH_V === 120 && PASS_V === 340 && SHOOT_V === 660 && GOAL_H === 146 &&
        GK_REACH_MUL === 6 && TACKLE_TRIGGER === 32 && SHOT_BLOCK_REACH === 36 &&
        teams[0].concat(teams[1]).every(function (p) {
          return p.speedMul <= 1;
        });
      // ── 공 높이(z) 물리 ────────────────────────────────────────
      var ballHeightConstants = GRAVITY === 9.81 * M && CROSSBAR === 2.44 * M &&
        BOUNCE_Z === .5 && FOOT_H === 10 && GK_HIGH_H === 52 &&
        ROLL_A === 24 && Math.abs(AIR_K - 0.01354 / M) < 1e-12;

      var dtq = 1 / 60;
      function launch(z0, vz0, vx0) {
        ball.owner = null; ball.lastTouch = null; ball.freeCd = 0;
        ball.x = FW / 2; ball.y = FH / 2;
        ball.vx = vx0 || 0; ball.vy = 0; ball.z = z0; ball.vz = vz0;
      }

      // 감속 모델을 한 프레임 단위로 직접 검증한다.
      //   지면 a = ROLL_A + AIR_K·v²   공중 a = AIR_K·v²
      function decelOf(z, speed) {
        launch(z, 0, speed);
        var before = Math.hypot(ball.vx, ball.vy);
        updateBall(dtq);
        // 지면이면 중력·바운스가 개입하지 않도록 z 를 유지한 채 수평만 본다.
        return (before - Math.hypot(ball.vx, ball.vy)) / dtq;
      }
      var vTest = 300;
      var groundExpect = ROLL_A + AIR_K * vTest * vTest;
      var airExpect = AIR_K * vTest * vTest;
      var dragModel =
        Math.abs(decelOf(0, vTest) - groundExpect) / groundExpect < .02 &&
        Math.abs(decelOf(200, vTest) - airExpect) / airExpect < .05;

      // 공기 저항이 수직 성분에도 걸리므로 정점과 체공이 진공보다 낮고 짧다.
      // 그러면서도 과도하게 죽지는 않아야 한다.
      startMatch('1p');
      var vz0 = GRAVITY * 1.01;
      launch(0, vz0);
      var apex = 0, flight = 0;
      for (var q = 0; q < 900; q++) {
        updateBall(dtq); flight += dtq;
        if (ball.z > apex) apex = ball.z;
        if (ball.z <= 0 && q > 2) break;
      }
      var vacApex = vz0 * vz0 / (2 * GRAVITY), vacFlight = 2 * vz0 / GRAVITY;
      var ballistic = apex > 0 && apex < vacApex && apex > vacApex * .6 &&
        flight > 0 && flight < vacFlight && flight > vacFlight * .7;

      // 느린 공은 구름 저항이 지배해 금방 선다. 지수 감쇠에서는 속도에
      // 비례해 감속해 20초씩 굴러가는 꼬리가 남았다.
      launch(0, 0, 2 * M);                    // 2m/s
      var slowT = 0, slowX = ball.x;
      for (var q4 = 0; q4 < 900; q4++) {
        updateBall(dtq); slowT += dtq;
        if (ball.vx === 0) break;
      }
      var slowBallStops = slowT < 4 && (ball.x - slowX) < 5 * M;

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

      // 공중에는 구름 저항이 없어 같은 속도에서 수평 감속이 더 작다.
      // 차이는 정확히 ROLL_A 만큼이다.
      var airLighterThanGround = decelOf(0, 300) - decelOf(200, 300) > ROLL_A * .9;

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

      // 높이 구간별 접촉. 매번 깨끗한 상태에서 한 번만 collide 시킨다 —
      // 같은 선수로 연달아 부르면 앞 접촉이 남긴 trapCd 가 다음 판정을 막는다.
      function bandTouch(z, useGK) {
        startMatch('1p');
        var q = useGK ? teams[0][0] : teams[0][9];
        q.x = FW / 2; q.y = FH / 2; q.vx = q.vy = 0;
        q.trapCd = q.headCd = q.kickCd = q.tackleT = q.blockT = 0;
        ball.owner = null; ball.lastTouch = null; ball.freeCd = 0;
        ball.x = q.x + 4; ball.y = q.y; ball.vx = ball.vy = 0;
        ball.z = z; ball.vz = 0;
        collide(q);
        return { owned:ball.owner === q, touched:ball.lastTouch === q,
                 speed:Math.hypot(ball.vx, ball.vy), headCd:q.headCd };
      }
      var footBand = bandTouch(FOOT_H, false);
      var chestBand = bandTouch(CHEST_H, false);
      var headBand = bandTouch(HEAD_H, false);
      var aboveHead = bandTouch(HEAD_H + 1, false);
      var gkHigh = bandTouch(HEAD_H + 1, true);

      // 발은 잡고, 가슴은 튕기고, 헤딩은 헤딩하고, 그 위는 필드 선수가 못 닿는다.
      var footTraps = footBand.owned;
      var chestDeflects = !chestBand.owned && chestBand.touched && chestBand.speed > 0;
      var headHeads = !headBand.owned && headBand.touched && headBand.headCd > 0;
      var aboveHeadUntouched = !aboveHead.touched && aboveHead.speed === 0;
      var gkReachesHigh = gkHigh.touched;

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

      // ── 스프라이트 포즈 ────────────────────────────────────────────
      // 장수가 2 이상인 포즈는 모든 프레임에 도달할 수 있어야 한다.
      // 진행도를 낼 근거(poseT / 게임 타이머 / 보폭)가 없으면 프레임 0 에
      // 굳는다. 실제로 tackle·block·gk-claim 이 그렇게 굳어 있었다.
      var poseTarget = teams[0][9];
      var poseFramesReachable = true, poseUnreachable = [];
      for (var poseName in POSES) {
        var slot = POSES[poseName], first = slot[0], count = slot[1];
        if (count < 2) continue;
        var hit = {};
        for (var k = 0; k <= 40; k++) {
          var q = k / 40;
          poseTarget.poseT = POSE_DUR[poseName] ? POSE_DUR[poseName] * (1 - q) : 0;
          if (POSE_TIMER[poseName]) {
            poseTarget[POSE_TIMER[poseName][0]] = POSE_TIMER[poseName][1] * (1 - q);
          }
          poseTarget.stride = q * (POSE_STRIDE[poseName] || 7) * count * 2;
          ball.x = poseTarget.x + q * poseTarget.reach * 3;
          ball.y = poseTarget.y;
          hit[poseFrame(poseTarget, poseName)] = 1;
        }
        for (var f = 0; f < count; f++) {
          if (!hit[first + f]) {
            poseFramesReachable = false;
            poseUnreachable.push(poseName + '[' + f + ']');
          }
        }
      }
      poseTarget.poseT = 0; poseTarget.stride = 0;
      poseTarget.tackleT = 0; poseTarget.blockT = 0;

      // 시트에 실제로 있는 칸만 가리켜야 한다. sprite-gen.py 의 SHEET 와
      // POSES 가 어긋나면 빈 칸이나 옆 포즈를 그린다.
      var poseColumns = 0, poseSlotsValid = true;
      for (var nameB in POSES) poseColumns += POSES[nameB][1];
      for (var nameC in POSES) {
        if (POSES[nameC][0] < 0 || POSES[nameC][0] + POSES[nameC][1] > poseColumns) {
          poseSlotsValid = false;
        }
      }
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
        ballHeightConstants:ballHeightConstants,
        bounceDecay:bounceDecay, dragModel:dragModel, ballistic:ballistic,
        slowBallStops:slowBallStops, airLighterThanGround:airLighterThanGround,
        crossbar:crossbar,
        footTraps:footTraps, chestDeflects:chestDeflects, headHeads:headHeads,
        aboveHeadUntouched:aboveHeadUntouched, gkReachesHigh:gkReachesHigh,
        movementPaces:movementPaces,
        collisionRadius:collisionRadius, separatedDrawScale:separatedDrawScale,
        cameraViewportStable:cameraViewportStable,
        matchLengthMigration:matchLengthMigration,
        formationsValid:formationsValid, ratingsOrdered:ratingsOrdered,
        tournamentValid:tournamentValid, shootoutRules:shootoutRules,
        storageMigrated:storageMigrated, leagueSchedule:leagueSchedule,
        leagueRanking:leagueRanking, seasonValid:seasonValid,
        leagueCompleted:leagueCompleted, seasonToCup:seasonToCup,
        recordsSummary:recordsSummary,
        poseFramesReachable:poseFramesReachable,
        poseUnreachableList:poseUnreachable.join(',') || true,
        poseSlotsValid:poseSlotsValid
      };
`;

module.exports = { SELF_TEST };
