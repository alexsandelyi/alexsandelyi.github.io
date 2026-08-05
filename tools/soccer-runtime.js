#!/usr/bin/env node
// 게임 런타임 부팅 부품 — 소스 추출, 브라우저 스텁, vm 컨텍스트 생성.
//
// soccer-sim.js 와 soccer-lab.js 가 함께 쓴다. 복사해 두면 스텁 구멍이
// 한쪽에만 생긴다 (실제로 style.setProperty 로 겪었다).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { HARNESS } = require('./soccer-harness.js');

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
// 게임 코드는 games/soccer/js/ 의 여러 파일로 나뉘어 있고, index.html 이
// 클래식 <script src> 로 순서대로 불러온다. 클래식 스크립트는 전역
// 스코프를 공유하므로 파일을 그 순서대로 이어 붙이면 브라우저와 같은
// 하나의 스코프가 된다. 모듈로 나눴다면 이 방식이 통하지 않는다.
function readGameFiles() {
  const html = fs.readFileSync(GAME, 'utf8');
  const dir = path.dirname(GAME);
  const body = html.replace(/<!--[\s\S]*?-->/g, '');   // 주석 안의 <script 는 무시

  const files = [...body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m => m[1]);
  if (!files.length) {
    throw new Error(`${GAME} 에서 <script src> 를 찾지 못했습니다`);
  }
  // 인라인 <script> 가 섞이면 로드 순서가 어긋나 조용히 일부만 실행된다.
  if (/<script\b(?![^>]*\bsrc=)/.test(body)) {
    throw new Error('인라인 <script> 가 있습니다. 코드는 js/ 파일에만 둡니다');
  }

  return files.map(rel => {
    // 캐시 무효화용 ?v=... 가 붙어 있다. 경로에서 떼어낸다.
    const clean = rel.split('?')[0];
    const file = path.join(dir, clean);
    if (!fs.existsSync(file)) {
      throw new Error(`${clean} 을 찾을 수 없습니다 (index.html 이 참조 중)`);
    }
    return { name:clean, code:fs.readFileSync(file, 'utf8') };
  });
}

// js/ 내용으로 만든 캐시 무효화 스탬프. 파일을 고치면 값이 바뀌므로
// index.html 의 ?v= 도 함께 갱신해야 한다. 안 하면 브라우저가 옛 파일을
// 계속 쓰고, 배포 뒤에는 옛 JS 와 새 JS 가 섞인다.
function jsStamp() {
  const dir = path.join(path.dirname(GAME), 'js');
  const h = crypto.createHash('sha256');
  for (const name of fs.readdirSync(dir).sort()) {
    h.update(fs.readFileSync(path.join(dir, name)));
  }
  return h.digest('hex').slice(0, 8);
}

// index.html 에 박힌 스탬프가 현재 js/ 와 맞는지.
function stampIsFresh() {
  const html = fs.readFileSync(GAME, 'utf8');
  const want = jsStamp();
  const found = [...html.matchAll(/src="js\/[^"?]+\?v=([0-9a-f]+)"/g)]
    .map(m => m[1]);
  return found.length > 0 && found.every(v => v === want);
}

// 스탬프를 현재 js/ 값으로 다시 박는다.
function restamp() {
  const html = fs.readFileSync(GAME, 'utf8');
  const v = jsStamp();
  const out = html.replace(/(src="js\/[^"?]+)(\?v=[0-9a-f]+)?(")/g,
    (m, a, q, z) => a + '?v=' + v + z);
  fs.writeFileSync(GAME, out);
  return v;
}

// 이어 붙인 한 덩어리. 파일 경계를 신경 쓰지 않는 곳에서 쓴다.
function readGameSource() {
  return readGameFiles()
    .map(f => `// ═══ ${f.name} ═══\n${f.code}`).join('\n');
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
  // style 은 CSS 커스텀 속성(--charge)을 setProperty 로 쓴다. 빈 객체로 두면
  // 브라우저에서만 돌고 시뮬레이터에서 죽는다.
  const makeStyle = () => {
    const s = {
      setProperty(k, v) { s[k] = v; },
      removeProperty(k) { delete s[k]; },
      getPropertyValue(k) { return s[k] === undefined ? '' : String(s[k]); }
    };
    return s;
  };
  const makeEl = () => ({
    style: makeStyle(), dataset: {}, textContent: '', innerHTML: '', value: '',
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

// ── 실행 ────────────────────────────────────────────────────────────
function createSimulation(seed) {
  const sandbox = makeSandbox(mulberry32(seed));
  const context = vm.createContext(sandbox);

  // Math.random 은 게임 소스가 로드되는 시점(buildTeams)부터 쓰이므로
  // 앞에서 먼저 갈아끼운다.
  vm.runInContext('Math.random = __rand;', context, { filename:'soccer-seed.js' });

  // 파일을 하나로 이어 붙이지 않고 브라우저처럼 한 장씩 실행한다.
  // 이어 붙이면 함수 호이스팅이 전체에 걸쳐 동작해, 뒤 파일의 함수를 앞
  // 파일이 최상위에서 참조하는 버그를 놓친다. 실제로 그렇게 놓친 적이
  // 있다(11-hud.js 가 12-practice.js 의 startPractice 를 참조).
  // 클래식 스크립트는 전역 렉시컬 스코프를 공유하므로 const 는 그대로 보인다.
  for (const f of readGameFiles()) {
    vm.runInContext(f.code, context, { filename:f.name });
  }
  vm.runInContext(HARNESS, context, { filename:'harness.js' });
  return sandbox.__sim;
}

module.exports = {
  GAME, TARGET_WIN, TARGET_GOALS, LEVEL_NAMES, SWEEP_SPEEDS, TACTIC_PRESETS,
  mulberry32, readGameFiles, readGameSource, makeSandbox, createSimulation,
  jsStamp, stampIsFresh, restamp
};
