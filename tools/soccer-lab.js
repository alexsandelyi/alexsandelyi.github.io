#!/usr/bin/env node
// 동네 축구 기능 실측 — 선수 한 명을 경기장에 놓고 개별 기능을 잰다.
//
// soccer-sim.js 의 200경기 통합 측정은 "총득점 0.47" 같은 결과만 준다.
// 어느 기능이 어떻게 동작해서 그 결과가 나왔는지는 안 보인다. 이 도구는
// 나머지 21명을 치우고 한 기능씩 격리해서 실제 수치를 뽑는다.
//
//   node tools/soccer-lab.js                # 전체
//   node tools/soccer-lab.js dribble shot   # 일부만
//   node tools/soccer-lab.js --list
//   node tools/soccer-lab.js --seed 7
//
// 게임 런타임은 soccer-sim.js 와 같은 부품을 쓴다. 복사하면 스텁 구멍이
// 한쪽에만 생긴다 (실제로 style.setProperty 로 겪었다).

const vm = require('vm');
const { readGameSource, makeSandbox, mulberry32 } = require('./soccer-sim.js');

// ── 게임 스코프 안에서 도는 실측 하네스 ────────────────────────────
const LAB = `
;(function () {
  // step() 은 inp.targetSpeed 로 목표 속도를 받는다(3단계 이동 모델).
  // 이 필드를 빼면 선수가 제자리에 선다 — 실제로 그 버그를 냈다.
  var input = { ax:0, ay:0, targetSpeed:0, sprint:false, human:true };
  readHuman = function (i) {
    return i === 0 ? input : { ax:0, ay:0, targetSpeed:0, human:true };
  };

  var DT = 1 / 60;

  // 측정 대상만 남기고 나머지는 구석에 세워 고정한다. aiT 를 크게 줘서
  // AI 가 목표를 다시 잡지 않게 하고, 매 프레임 제자리로 되돌린다.
  var keepList = [];
  function park() {
    for (var s = 0; s < 2; s++) for (var j = 0; j < teams[s].length; j++) {
      var q = teams[s][j];
      if (keepList.indexOf(q) >= 0) continue;
      q.x = 30 + j * 9; q.y = 30 + s * 40;
      q.vx = q.vy = 0; q.aiT = 1e9; q.aiTx = q.x; q.aiTy = q.y;
      q.tackleT = 0; q.blockT = 0; q.gkClaim = false;
    }
  }

  // startMatch() 가 buildTeams() 로 선수 객체를 새로 만든다. 그래서
  // 대상 선수는 반드시 scene() '뒤에' 받아야 한다. 인덱스로 받아 돌려주는
  // 이유가 그것이다 — 미리 잡아두면 고아 객체가 되어 step() 이 무시한다.
  function scene(picks) {
    level = 1;
    startMatch('1p');
    var kept = (picks || []).map(function (pk) { return teams[pk[0]][pk[1]]; });
    keepList = kept;
    park();
    setpiece = null; offside = null; state = 'play';
    input = { ax:0, ay:0, targetSpeed:0, sprint:false, human:true };
    return kept;
  }

  function clearCds(p) {
    p.kickCd = p.trapCd = p.tackleCd = p.tackleT = p.headCd = p.blockT = 0;
    p.actShoot = p.actPass = p.actThrough = 0;
    p.shootHeld = false; p.shootCharge = 0; p.gkClaim = false;
  }

  function freeBall(x, y, z, vx, vy, vz) {
    ball.owner = null; ball.lastTouch = null; ball.freeCd = 0;
    ball.x = ball.prevX = x; ball.y = ball.prevY = y; ball.z = z;
    ball.vx = vx || 0; ball.vy = vy || 0; ball.vz = vz || 0;
    ball.shotSide = -1; ball.shotCounted = false;
    ball.blockCounted = false; ball.headShot = false;
  }

  // 선수 없이 공만 적분한다. 궤적 물리를 격리해서 본다.
  function flyBall(maxSec) {
    var t = 0, apex = ball.z, bounces = 0, x0 = ball.x, y0 = ball.y;
    var n = Math.round((maxSec || 8) * 60);
    for (var i = 0; i < n; i++) {
      var prevVz = ball.vz;
      updateBall(DT); t += DT;
      if (ball.z > apex) apex = ball.z;
      if (ball.z === 0 && prevVz < -12) bounces++;
      if (ball.x < 0 || ball.x > FW || ball.y < 0 || ball.y > FH) break;
      if (ball.z === 0 && ball.vx === 0 && ball.vy === 0) break;
    }
    return { t:t, apex:apex, bounces:bounces,
             dist:Math.hypot(ball.x - x0, ball.y - y0) };
  }

  globalThis.__lab = {
    K: { M:M, FW:FW, FH:FH, GOAL_H:GOAL_H, CROSSBAR:CROSSBAR, GRAVITY:GRAVITY,
         P_MAX:P_MAX, OWNER_SPEED:OWNER_SPEED, PASS_V:PASS_V, SHOOT_V:SHOOT_V,
         FOOT_H:FOOT_H, CHEST_H:CHEST_H, HEAD_H:HEAD_H, GK_HIGH_H:GK_HIGH_H,
         TRAP_V:TRAP_V, TRAP_R:TRAP_R, PA_D:PA_D, PA_W:PA_W, R_PLAYER:R_PLAYER,
         SPEED_WALK:SPEED_WALK, SPEED_JOG:SPEED_JOG, SPEED_RUN:SPEED_RUN,
         SPEED_SPRINT:SPEED_SPRINT, HEAD_V:typeof HEAD_V === 'number' ? HEAD_V : null,
         GK_CLEAR_V:typeof GK_CLEAR_V === 'number' ? GK_CLEAR_V : null },

  // ── 1. 드리블 ────────────────────────────────────────────────
  dribble: function (sprint) {
    var p = scene([[0, 9]])[0];
    p.x = 300; p.y = FH / 2; p.vx = p.vy = 0; p.energy = 1;
    clearCds(p);
    ctrl[0] = p;
    ball.owner = p; ball.z = 0; ball.vz = 0;
    ball.x = p.x + 40; ball.y = p.y;
    input = { ax:1, ay:0, sprint:!!sprint, human:true,
              targetSpeed:sprint ? SPEED_SPRINT : SPEED_RUN };
    var x0 = p.x, top = 0, lost = -1, gapSum = 0, n = 0;
    for (var i = 0; i < 300; i++) {          // 5초
      park(); ctrl[0] = p;
      step(DT);
      if (state !== 'play') break;
      var sp = Math.hypot(p.vx, p.vy);
      if (sp > top) top = sp;
      if (ball.owner === p) {
        gapSum += Math.hypot(ball.x - p.x, ball.y - p.y); n++;
      } else if (lost < 0) lost = i / 60;
    }
    return { dist:p.x - x0, top:top, held:ball.owner === p,
             lostAt:lost, gap:n ? gapSum / n : 0, energy:p.energy };
  },

  // ── 2. 킥 궤적 (파워별) ──────────────────────────────────────
  kick: function (kind, power) {
    var p = scene([[0, 9]])[0];
    p.x = 700; p.y = FH / 2; p.vx = p.vy = 0;
    clearCds(p);
    p.aimX = 1; p.aimY = 0; p.manualAim = true;
    ball.owner = p; ball.x = p.x + 40; ball.y = p.y; ball.z = 0; ball.vz = 0;
    kickOwned(p, kind, power);
    var v0 = Math.hypot(ball.vx, ball.vy), vz0 = ball.vz;
    var r = flyBall(10);
    return { v0:v0, vz0:vz0, apex:r.apex, t:r.t, dist:r.dist, bounces:r.bounces };
  },

  // ── 3. 골문 앞 슛 (거리별 · GK 유무) ─────────────────────────
  shootAt: function (distM, power, withGK) {
    var picked = scene(withGK ? [[0, 9], [1, 0]] : [[0, 9]]);
    var p = picked[0], gk = picked[1];
    var goalX = attackDir[0] === 1 ? FW : 0;
    p.x = goalX - attackDir[0] * distM * M; p.y = FH / 2;
    p.vx = p.vy = 0; clearCds(p);
    p.manualAim = false;
    if (withGK) { gk.x = goalX - attackDir[0] * 60; gk.y = FH / 2; clearCds(gk); }
    ball.owner = p; ball.x = p.x + attackDir[0] * 40; ball.y = p.y;
    ball.z = 0; ball.vz = 0;
    kickOwned(p, 'shoot', power);
    var maxZ = 0, saved = false;
    for (var i = 0; i < 240; i++) {
      if (withGK) { park(); } else { park(); }
      step(DT);
      if (ball.z > maxZ) maxZ = ball.z;
      if (withGK && ball.lastTouch === gk) saved = true;
      if (state !== 'play') break;
    }
    return { scored:score[0] > 0, saved:saved, maxZ:maxZ, end:state };
  },

  // ── 4. 트래핑 한계 (공 속도 × 높이) ──────────────────────────
  trap: function (speed, z) {
    var p = scene([[0, 9]])[0];
    p.x = 700; p.y = FH / 2; p.vx = p.vy = 0; clearCds(p);
    freeBall(p.x - 60, p.y, z, speed, 0, 0);
    for (var i = 0; i < 60; i++) {
      updateBall(DT);
      collide(p);
      if (ball.owner === p) return { owned:true, frames:i };
      if (ball.x > p.x + 80) break;
    }
    return { owned:false, touched:ball.lastTouch === p,
             outSpeed:Math.hypot(ball.vx, ball.vy) };
  },

  // ── 5. 높이 구간 접촉 ────────────────────────────────────────
  band: function (z, useGK) {
    var p = scene([useGK ? [0, 0] : [0, 9]])[0];
    p.x = 700; p.y = FH / 2; p.vx = p.vy = 0; clearCds(p);
    freeBall(p.x + 4, p.y, z, 0, 0, 0);
    collide(p);
    return { owned:ball.owner === p, touched:ball.lastTouch === p, isGK:!!p.isGK,
             speed:Math.hypot(ball.vx, ball.vy), vz:ball.vz, headCd:p.headCd };
  },

  // ── 6. 헤딩 (공격 / 수비) ────────────────────────────────────
  header: function (attackingThird) {
    var p = scene([[0, 9]])[0];
    var goalX = attackDir[0] === 1 ? FW : 0;
    p.x = attackingThird ? goalX - attackDir[0] * 200 : FW / 2;
    p.y = FH / 2; p.vx = p.vy = 0; clearCds(p);
    freeBall(p.x + 4, p.y, (FOOT_H + HEAD_H) / 2 + 8, 0, 0, 0);
    collide(p);
    var v = Math.hypot(ball.vx, ball.vy);
    var toGoal = Math.atan2(FH / 2 - p.y, goalX - p.x);
    var ang = Math.atan2(ball.vy, ball.vx);
    var diff = Math.abs(Math.atan2(Math.sin(ang - toGoal), Math.cos(ang - toGoal)));
    return { v:v, vz:ball.vz, offGoalRad:diff, isShot:ball.shotSide === 0,
             headCd:p.headCd, owned:ball.owner === p };
  },

  // ── 7. GK 하이볼 판단 ────────────────────────────────────────
  // 결정(gkClaim)과 실제 캐치를 나눠 본다. matchStats.gkClaims 는 캐치만
  // 세므로 통합 측정에서는 둘을 구분할 수 없다.
  gkHigh: function (landM, flightSec) {
    var gk = scene([[0, 0]])[0];
    var goalX = attackDir[0] === 1 ? 0 : FW;   // gk 가 지키는 골문
    gk.x = goalX + (attackDir[0] === 1 ? 1 : -1) * 60;
    gk.y = FH / 2; gk.vx = gk.vy = 0; clearCds(gk);
    // 낙하 지점이 골문에서 landM 미터가 되도록 크로스를 만든다.
    var landX = goalX + (attackDir[0] === 1 ? 1 : -1) * landM * M;
    var vz = GRAVITY * flightSec / 2;
    var startX = landX - (attackDir[0] === 1 ? 1 : -1) * 300;
    var vx = ((landX - startX) / flightSec);
    freeBall(startX, FH / 2 + 200, 1, vx, -200 / flightSec, vz);
    var claimed = false, caught = false;
    for (var i = 0; i < Math.round((flightSec + 1.5) * 60); i++) {
      park();
      step(DT);
      if (gk.gkClaim) claimed = true;
      if (ball.lastTouch === gk) { caught = true; break; }
      if (state !== 'play') break;
    }
    var land = { x:landX, y:FH / 2 };
    return { claimed:claimed, caught:caught,
             // 게임이 실제로 부르는 판정과, GK 가 지키는 박스 판정을 나눠 본다.
             boxAsChecked:inPenaltyArea(gk.side, land.x, land.y),
             boxDefended:inPenaltyArea(1 - gk.side, land.x, land.y),
             gkMoved:Math.hypot(gk.x - (goalX + (attackDir[0] === 1 ? 1 : -1) * 60),
                                gk.y - FH / 2) };
  },

  // ── 8. 공 물리 ───────────────────────────────────────────────
  roll: function (speed, vz) {
    scene([]);
    freeBall(200, FH / 2, 0, speed, 0, vz || 0);
    var r = flyBall(30);
    return r;
  }
  };
})();
`;

function boot(seed) {
  const src = readGameSource();
  const sandbox = makeSandbox(mulberry32(seed));
  const context = vm.createContext(sandbox);
  vm.runInContext('Math.random = __rand;', context, { filename:'seed.js' });
  vm.runInContext(src + '\n' + LAB, context, { filename:'soccer.js' });
  return sandbox.__lab;
}

// ── 출력 ────────────────────────────────────────────────────────────
let L, M_;
const m = (u) => (u / M_).toFixed(2);
const kmh = (u) => (u / M_ * 3.6).toFixed(1);
const pad = (s, n) => String(s).padStart(n);

const SECTIONS = {
  dribble(){
    console.log('\n── 1. 드리블 (5초 직진, 골목 FC 9번) ──');
    console.log('  모드      이동거리   최고속도   공 간격  소유유지  체력');
    for (const [label, sprint] of [['일반', false], ['스프린트', true]]) {
      const r = L.dribble(sprint);
      console.log(
        `  ${label.padEnd(8)}${pad(m(r.dist), 7)}m ${pad(kmh(r.top), 8)}km/h ` +
        `${pad(m(r.gap), 7)}m  ${(r.held ? '  유지' : ' ' + r.lostAt.toFixed(1) + 's 상실')}` +
        `  ${(r.energy * 100).toFixed(0)}%`
      );
    }
    const base = L.K.P_MAX / M_ * 3.6;
    console.log(`  기준: P_MAX ${base.toFixed(1)}km/h · 소유 중 배수 ${L.K.OWNER_SPEED}`);
  },

  kick(){
    console.log('\n── 2. 킥 궤적 (파워별, 정면) ──');
    for (const kind of ['pass', 'through', 'shoot']) {
      console.log(`  ${kind}`);
      console.log('    파워   초속도    수직속도   정점    체공   도달거리  바운스');
      for (const power of [0.25, 0.5, 0.75, 1.0]) {
        const r = L.kick(kind, power);
        console.log(
          `    ${power.toFixed(2)}  ${pad(kmh(r.v0), 6)}km/h ${pad(r.vz0.toFixed(0), 7)} ` +
          `${pad(m(r.apex), 7)}m ${pad(r.t.toFixed(2), 6)}s ${pad(m(r.dist), 8)}m ${pad(r.bounces, 6)}`
        );
      }
    }
    console.log(`  기준: 크로스바 ${m(L.K.CROSSBAR)}m · SHOOT_V ${kmh(L.K.SHOOT_V)}km/h`);
  },

  shoot(){
    console.log('\n── 3. 골문 앞 슛 (파워 0.6) ──');
    console.log('  거리   GK없음      GK있음      최고높이   비고');
    for (const d of [6, 11, 18, 25, 35]) {
      const a = L.shootAt(d, 0.6, false);
      const b = L.shootAt(d, 0.6, true);
      const over = a.maxZ > L.K.CROSSBAR ? '크로스바 위로' : '';
      console.log(
        `  ${pad(d, 3)}m  ${(a.scored ? '득점' : '무득점').padEnd(10)} ` +
        `${(b.scored ? '득점' : b.saved ? 'GK 선방' : '무득점').padEnd(11)} ` +
        `${pad(m(a.maxZ), 7)}m  ${over}`
      );
    }
  },

  trap(){
    console.log('\n── 4. 트래핑 한계 (O=소유, ·=튕김, -=무접촉) ──');
    const speeds = [50, 100, 200, 300, 450, 600];
    const zs = [0, 5, 10, 20, 30, 40, 50];
    console.log('    높이\\속도  ' + speeds.map(s => pad(kmh(s), 6)).join(' '));
    for (const z of zs) {
      const cells = speeds.map(s => {
        const r = L.trap(s, z);
        return pad(r.owned ? 'O' : r.touched ? '·' : '-', 6);
      });
      console.log(`  ${pad(m(z), 6)}m(${pad(z,2)})  ` + cells.join(' '));
    }
    console.log(`  기준: TRAP_V ${kmh(L.K.TRAP_V)}km/h · FOOT_H ${m(L.K.FOOT_H)}m`);
  },

  band(){
    console.log('\n── 5. 높이 구간 접촉 ──');
    console.log('   높이(m)   필드선수         골키퍼');
    for (const z of [0, 10, 11, 30, 31, 46, 47, 52, 53]) {
      const f = L.band(z, false), g = L.band(z, true);
      const desc = (r) => r.owned ? '소유' : !r.touched ? '무접촉'
        : r.isGK ? '캐치·펀트 ' + kmh(r.speed) + 'km/h'
        : r.headCd > 0 ? '헤딩 ' + kmh(r.speed) + 'km/h'
        : '튕김 ' + kmh(r.speed) + 'km/h';
      console.log(`  ${pad(m(z), 7)}   ${desc(f).padEnd(16)} ${desc(g)}`);
    }
    console.log(`  구간: 발 ≤${L.K.FOOT_H} · 가슴 ≤${L.K.CHEST_H} · 헤딩 ≤${L.K.HEAD_H} · GK ≤${L.K.GK_HIGH_H}`);
  },

  header(){
    console.log('\n── 6. 헤딩 ──');
    console.log('  위치        결과속도   수직속도  골문 방향 오차  슛집계');
    for (const [label, third] of [['공격 3분의 1', true], ['중원', false]]) {
      const r = L.header(third);
      console.log(
        `  ${label.padEnd(12)}${pad(kmh(r.v), 6)}km/h ${pad(r.vz.toFixed(0), 8)} ` +
        `${pad((r.offGoalRad * 180 / Math.PI).toFixed(0), 12)}°  ${r.isShot ? 'O' : '-'}`
      );
    }
    console.log(`  헤딩 후 소유 전환: ${L.header(true).owned ? 'O (드리블 가능 — 설계 위반)' : '없음 (설계대로)'}`);
  },

  gk(){
    console.log('\n── 7. GK 하이볼 판단 (낙하 지점별) ──');
    console.log('  낙하거리  체공  GK가 지키는 박스  게임이 검사한 박스  결정  캐치');
    let mismatch = 0;
    for (const [land, t] of [[4, 1.0], [8, 1.2], [8, 2.0], [12, 1.5], [12, 2.5], [18, 2.0], [25, 2.5]]) {
      const r = L.gkHigh(land, t);
      if (r.boxDefended !== r.boxAsChecked) mismatch++;
      console.log(
        `  ${pad(land, 6)}m ${pad(t.toFixed(1), 5)}s ${pad(r.boxDefended ? 'O' : '-', 14)} ` +
        `${pad(r.boxAsChecked ? 'O' : '-', 17)} ${pad(r.claimed ? 'O' : '-', 5)} ${pad(r.caught ? 'O' : '-', 5)}`
      );
    }
    console.log(`  조건: 박스 안 && 체공>0.25s && 거리 < SPEED_RUN(${kmh(L.K.SPEED_RUN)}km/h) × 체공 × (0.70~1.20)`);
    console.log('  gkClaims 카운터는 "캐치"만 센다 — 결정만 하고 못 잡으면 0으로 남는다.');
    if (mismatch) {
      console.log(`  ** 두 박스 판정이 ${mismatch}건 어긋난다. inPenaltyArea(side,…) 는`);
      console.log('     "side 가 공격하는 박스" 를 뜻하는데 GK 판단이 그대로 자기 side 로 부른다.');
    }
  },

  ball(){
    console.log('\n── 8. 공 물리 ──');
    console.log('  초속도    수직속도   정점     도달거리  체공    바운스');
    for (const [v, vz] of [[300, 0], [300, 100], [300, 250], [300, 400], [600, 0], [600, 250]]) {
      const r = L.roll(v, vz);
      console.log(
        `  ${pad(kmh(v), 6)}km/h ${pad(vz, 8)} ${pad(m(r.apex), 7)}m ` +
        `${pad(m(r.dist), 8)}m ${pad(r.t.toFixed(1), 6)}s ${pad(r.bounces, 6)}`
      );
    }
  }
};

function main() {
  const argv = process.argv.slice(2);
  let seed = 1;
  const want = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') seed = +argv[++i];
    else if (argv[i] === '--list') {
      console.log('구간: ' + Object.keys(SECTIONS).join(' '));
      return;
    } else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log('node tools/soccer-lab.js [구간...] [--seed N]\n구간: ' +
        Object.keys(SECTIONS).join(' '));
      return;
    } else want.push(argv[i]);
  }
  for (const w of want) {
    if (!SECTIONS[w]) throw new Error(`알 수 없는 구간: ${w} (--list 로 확인)`);
  }

  L = boot(seed);
  M_ = L.K.M;
  console.log('동네 축구 기능 실측 — 선수 1명 격리');
  console.log(`  시드 ${seed} · 1m = ${M_}단위 · 나머지 21명은 구석에 고정`);

  for (const name of (want.length ? want : Object.keys(SECTIONS))) SECTIONS[name]();
  console.log('');
}

main();
