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
//   node tools/soccer-sim.js --sweep-speed # 보통 speed 0.84~0.94, 각 200경기
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
const TARGET_GOALS = [5, 6];            // 경기당 총 득점 목표 범위
const LEVEL_NAMES = ['쉬움', '보통', '어려움'];
const SWEEP_SPEEDS = Array.from({ length:11 }, (_, i) => (84 + i) / 100);

// ── 인자 ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { n:null, seed:1, levels:[0, 1, 2], botLevel:1, sweepSpeed:false };
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
    else if (a === '--sweep-speed') o.sweepSpeed = true;
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
  return o;
}

const HELP = `동네 축구 밸런스 측정

  -n, --matches <수>   난이도당 경기 수 (기본 30)
  -l, --level <0|1|2>  한 난이도만 측정 (0=쉬움, 1=보통, 2=어려움)
      --seed <정수>    난수 시드 (기본 1). 같은 시드면 결과가 재현된다
      --bot <0|1|2>    사람 자리를 대신하는 봇의 수준 (기본 1=보통)
      --sweep-speed    보통 speed 0.84~0.94를 0.01 간격으로 측정
                       기본 경기 수는 속도값당 200 (-n으로 변경 가능)
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

  __sim = {
    setBotLevel: function (n) { botLevel = n; },
    setLevelSpeed: function (n, speed) { LEVELS[n].speed = speed; },
    run: function (lvl) {
      level = lvl;
      startMatch('1p');
      var dt = 1/60, steps = 0;
      var MAX = 60 * 60 * 30;            // 안전장치: 30분 분량
      while (state !== 'end' && steps < MAX) {
        botDt = dt;
        step(dt);
        steps++;
      }
      if (steps >= MAX) throw new Error('경기가 끝나지 않았습니다 (무한 루프)');
      return { gf: score[0], ga: score[1], steps: steps };
    },
    matchSec: MATCH_SEC,
    levelNames: LEVELS.map(function (l) { return l.name; }),
    levelSpeeds: LEVELS.map(function (l) { return l.speed; })
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
  const full = 'Math.random = __rand;\n' + src + '\n' + HARNESS;
  vm.runInContext(full, context, { filename:'soccer.js' });
  return sandbox.__sim;
}

function runBatch(job) {
  const sim = createSimulation(job.seed);
  sim.setBotLevel(job.botLevel);
  if (job.speed !== undefined) sim.setLevelSpeed(job.lvl, job.speed);

  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  const t0 = Date.now();
  for (let i = 0; i < job.n; i++) {
    const r = sim.run(job.lvl);
    gf += r.gf; ga += r.ga;
    if (r.gf > r.ga) w++; else if (r.gf === r.ga) d++; else l++;
  }
  return {
    lvl:job.lvl, speed:job.speed, w, d, l, gf, ga, n:job.n,
    matchSec:sim.matchSec, secs:(Date.now() - t0) / 1000
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

  if (opt.sweepSpeed) {
    console.log('동네 축구 speed 스윕');
    console.log(`  경기 수  speed 값당 ${opt.n}`);
    console.log(`  시드     ${opt.seed} (각 speed 에서 같은 난수열로 초기화)`);
    console.log(`  사람 자리 봇  ${LEVEL_NAMES[opt.botLevel]} 수준`);
    console.log(`  병렬 작업 ${workerLimit(SWEEP_SPEEDS.length)}개`);
    const jobs = SWEEP_SPEEDS.map(speed => ({
      lvl:1, speed, n:opt.n, seed:opt.seed, botLevel:opt.botLevel
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
  console.log(`  시드     ${opt.seed} (각 난이도에서 같은 난수열로 초기화)`);
  console.log(`  사람 자리 봇  ${LEVEL_NAMES[opt.botLevel]} 수준`);
  console.log(`  병렬 작업 ${workerLimit(opt.levels.length)}개`);
  const jobs = opt.levels.map(lvl => ({
    lvl, n:opt.n, seed:opt.seed, botLevel:opt.botLevel
  }));
  const rows = await runJobs(jobs, (row, done, total) => {
    console.log(
      `  [${done}/${total}] ${LEVEL_NAMES[row.lvl]} ${row.n}경기 완료 ` +
      `(${row.secs.toFixed(1)}초)`
    );
  });
  console.log(`  경기 길이 ${rows[0].matchSec}초`);
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
