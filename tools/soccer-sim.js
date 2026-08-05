#!/usr/bin/env node
// 동네 축구 밸런스 측정 — 명령줄 진입점.
//
// games/soccer/js/ 의 게임 파일을 vm 에 올리고 readHuman 만 봇으로
// 갈아끼운 뒤 실제 step(1/60) 을 반복 호출해 난이도별 승률을 낸다.
// 브라우저 requestAnimationFrame 은 백그라운드에서 초당 1회로 스로틀되므로
// 쓰지 않는다.
//
//   node tools/soccer-sim.js              # 난이도별 30경기
//   node tools/soccer-sim.js -n 200       # 200경기 (밸런스 변경 시 권장)
//   node tools/soccer-sim.js -l 1         # 보통 난이도만
//   node tools/soccer-sim.js --self-test
//
// Node 내장 모듈만 쓴다 (게임과 같은 무의존 원칙).

const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const {
  GAME, TARGET_WIN, TARGET_GOALS, LEVEL_NAMES, SWEEP_SPEEDS, TACTIC_PRESETS,
  mulberry32, readGameFiles, readGameSource, makeSandbox, createSimulation,
  stampIsFresh, restamp
} = require('./soccer-runtime.js');
const {
  wilson, pct, combineRows, printNormalResults, printSweepResults
} = require('./soccer-report.js');

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
    else if (a === '--restamp') o.restamp = true;
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
      --restamp        js/ 를 고친 뒤 index.html 의 캐시 무효화 ?v= 갱신
  -h, --help           이 도움말
`;

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
    offsides:0, offsideChecks:0, offsideMarks:0, fouls:0, cards:0,
    headers:0, headGoals:0, deflections:0, crosses:0, gkClaims:0
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
  if (opt.restamp) { console.log('스탬프 갱신: ?v=' + restamp()); return; }
  if (opt.selfTest) {
    // 각 파일이 독립 스크립트라 'use strict' 도 파일마다 있어야 한다.
    // 주석·빈 줄은 지시어 프롤로그를 깨지 않으므로 건너뛰고 첫 문장을 본다.
    const notStrict = readGameFiles().filter(f => {
      const first = f.code.split(/\r?\n/)
        .map(l => l.trim())
        .find(l => l && !l.startsWith('//'));
      return first !== "'use strict';";
    }).map(f => f.name);
    const result = createSimulation(opt.seed).selfTest();
    result.everyFileStrict = notStrict.length === 0;
    if (notStrict.length) result.notStrict = notStrict;
    // js/ 를 고치고 index.html 의 ?v= 를 안 바꾸면 브라우저가 옛 파일을
    // 계속 쓴다. 배포 뒤에는 옛 JS 와 새 JS 가 섞여 더 나쁘다.
    result.versionStampFresh = stampIsFresh();
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

// 게임 런타임 부팅 부품을 공유한다. soccer-lab.js 가 같은 스텁을 쓴다 —

if (require.main !== module && isMainThread) {
  // 라이브러리로 require 된 경우에는 측정을 실행하지 않는다.
} else if (isMainThread) {
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
