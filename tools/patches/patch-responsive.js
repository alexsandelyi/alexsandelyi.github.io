// 일빵 런처: 고정 1280x860 아트보드 → 반응형 전환 패치.
// 번들 HTML 안의 (1) DesignSystem 번들 안 Launcher.jsx 컴파일 결과와
// (2) 페이지 템플릿을 직접 고쳐 다시 포장한다.
const fs = require('fs');
const zlib = require('zlib');

const path = require('path');
// 어느 디렉터리에서 부르든 저장소 루트의 원본을 잡는다.
const FILE = path.join(__dirname, '..', '..', '일빵-런처-확정안.html');
const DS_ID = 'cefd19e8-01bb-486b-ab86-605dd6993828';

let html = fs.readFileSync(FILE, 'utf8');

// ── 정확히 한 번만 치환됐는지 확인하며 바꾼다 ──────────────────────────
// 인라인 <script> 안에 들어가는 JSON은 '</' 를 반드시 이스케이프해야 한다.
// (원본 번들러도 </script> 형태로 넣는다) 안 하면 파서가 스크립트를
// 조기 종료해서 남은 JSON이 그대로 HTML 로 새어나온다.
function jsonForScript(v) {
  return JSON.stringify(v).replace(/<\//g, '<\\u002F');
}

function sub(src, label, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 매칭 ${n}건 (1건이어야 함)`);
  return src.split(from).join(to);
}

// ══════════════════════════════════════════════════════════════════════
// 1. DesignSystem 번들: Launcher 에 className 부여 + 루트 크기 고정 해제
// ══════════════════════════════════════════════════════════════════════
const manMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
const manifest = JSON.parse(manMatch[1]);
const dsFull = zlib.gunzipSync(Buffer.from(manifest[DS_ID].data, 'base64')).toString('utf8');

// Draft1~5.jsx 가 Launcher 와 거의 같은 코드라 파일 전체로 치환하면 중복 매칭된다.
// 페이지가 실제로 쓰는 Launcher.jsx 구간만 잘라서 고친다.
const LSTART = dsFull.indexOf('// ui_kits/homepage/Launcher.jsx');
const LEND = dsFull.indexOf('// ui_kits/homepage/palettes.js');
if (LSTART < 0 || LEND < LSTART) throw new Error('Launcher.jsx 구간을 못 찾음');
const dsHead = dsFull.slice(0, LSTART);
const dsTail = dsFull.slice(LEND);
let ds = dsFull.slice(LSTART, LEND);

// 루트: width 1280 / height 860 고정 → 창을 채우는 100% / 100dvh
ds = sub(ds, 'root', `  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...palette.vars,
      width: 1280,
      height: 860,
      background: 'var(--bg-canvas)',
      fontFamily: 'var(--font-body)',
      display: 'grid',
      gridTemplateColumns: '92px 1fr'
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      background: 'var(--bg-surface)',`, `  return /*#__PURE__*/React.createElement("div", {
    className: "ilb-root",
    style: {
      ...palette.vars,
      width: '100%',
      height: '100dvh',
      background: 'var(--bg-canvas)',
      fontFamily: 'var(--font-body)',
      display: 'grid',
      gridTemplateColumns: '92px 1fr'
    }
  }, /*#__PURE__*/React.createElement("nav", {
    className: "ilb-nav",
    style: {
      background: 'var(--bg-surface)',`);

// 좌측 레일 로고 / 아이콘 목록
ds = sub(ds, 'logo', `  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',
      color: 'var(--accent)'
    }
  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 'var(--sp-4)',
      alignContent: 'start'
    }
  },`, `  }, /*#__PURE__*/React.createElement("div", {
    className: "ilb-logo",
    style: {
      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',
      color: 'var(--accent)'
    }
  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {
    className: "ilb-navlist",
    style: {
      display: 'grid',
      gap: 'var(--sp-4)',
      alignContent: 'start'
    }
  },`);

// 본문 컬럼 + 상단 탭바 (+ 모바일에서만 보이는 로고를 탭바에 추가)
ds = sub(ds, 'main/topbar', `  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      padding: 'var(--sp-8) var(--sp-10) var(--sp-5)',
      borderBottom: 'var(--bw-hair) solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--sp-6)'
    }
  },`, `  }))))), /*#__PURE__*/React.createElement("div", {
    className: "ilb-main",
    style: {
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ilb-topbar",
    style: {
      display: 'flex',
      alignItems: 'center',
      padding: 'var(--sp-8) var(--sp-10) var(--sp-5)',
      borderBottom: 'var(--bw-hair) solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ilb-logo-m",
    style: {
      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',
      color: 'var(--accent)',
      marginRight: 'var(--sp-6)',
      flex: '0 0 auto',
      display: 'none'
    }
  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {
    className: "ilb-tabs",
    style: {
      display: 'flex',
      gap: 'var(--sp-6)'
    }
  },`);

// 스크롤 영역
ds = sub(ds, 'scroller', `React.createElement("div", {
    ref: scroller,
    style: {
      position: 'relative',`, `React.createElement("div", {
    ref: scroller,
    className: "ilb-scroll",
    style: {
      position: 'relative',`);

// 히어로: 1fr 400px 2단 → 모바일에서 1단
ds = sub(ds, 'hero', `  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 'var(--r-xl)',
      overflow: 'hidden',
      border: 'var(--bw-hair) solid var(--border-subtle)',
      background: 'var(--bg-raised)',
      display: 'grid',
      gridTemplateColumns: '1fr 400px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      aspectRatio: '16/9',`, `  }, /*#__PURE__*/React.createElement("div", {
    className: "ilb-hero",
    style: {
      borderRadius: 'var(--r-xl)',
      overflow: 'hidden',
      border: 'var(--bw-hair) solid var(--border-subtle)',
      background: 'var(--bg-raised)',
      display: 'grid',
      gridTemplateColumns: '1fr 400px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ilb-hero-media",
    style: {
      aspectRatio: '16/9',`);

ds = sub(ds, 'hero-panel', `  }, "GAMEPLAY IMAGE"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--sp-8)',`, `  }, "GAMEPLAY IMAGE"), /*#__PURE__*/React.createElement("div", {
    className: "ilb-hero-panel",
    style: {
      padding: 'var(--sp-8)',`);

// 카드 레일 (케이 무비 / 케이 팝)
ds = sub(ds, 'rail', `  const rail = items => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--sp-4)'
    }
  }, items.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.title,
    style: {
      flex: 1,`, `  const rail = items => /*#__PURE__*/React.createElement("div", {
    className: "ilb-rail",
    style: {
      display: 'flex',
      gap: 'var(--sp-4)'
    }
  }, items.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.title,
    className: "ilb-rail-item",
    style: {
      flex: 1,`);

// 섹션 헤더
ds = sub(ds, 'head', `  const head = (title, right) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',`, `  const head = (title, right) => /*#__PURE__*/React.createElement("div", {
    className: "ilb-head",
    style: {
      display: 'flex',
      alignItems: 'baseline',`);

// 커뮤니티 글 카드
ds = sub(ds, 'post', `  }, POSTS.map(p => /*#__PURE__*/React.createElement(__ds_scope.Card, {
    key: p.title,
    variant: "soft",
    pad: 16,
    style: {`, `  }, POSTS.map(p => /*#__PURE__*/React.createElement(__ds_scope.Card, {
    key: p.title,
    variant: "soft",
    pad: 16,
    className: "ilb-post",
    style: {`);

manifest[DS_ID].data = zlib.gzipSync(Buffer.from(dsHead + ds + dsTail, 'utf8'), { level: 9 }).toString('base64');

// ══════════════════════════════════════════════════════════════════════
// 2. 템플릿: viewport meta + 반응형 CSS + 스케일 스크립트 제거
// ══════════════════════════════════════════════════════════════════════
const tplMatch = html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
let tpl = JSON.parse(tplMatch[1]);

tpl = sub(tpl, 'viewport', `<html lang="ko"><head><meta charset="utf-8">`,
  `<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`);

const RESPONSIVE_CSS = `html,body{height:100%}
body{margin:0;background:#152528}
#stage,#stage>div,#root{width:100%}

/* ── 런처 반응형 ─────────────────────────────────────────────
   원래 1280x860 고정 아트보드였고 transform:scale 로 축소만 했다.
   이제 실제 레이아웃이 창 크기를 따르므로 좌우/하단 여백이 없다. */
.ilb-root{width:100%;height:100dvh}
.ilb-scroll{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.ilb-rail-item{min-width:0}

/* 넓은 화면: 배경·레일·탭바는 창을 꽉 채우고 읽는 영역만 1440px 로 묶는다.
   (안 묶으면 히어로가 16/9 로 계속 늘어나 1920 에서 748px 까지 커진다) */
.ilb-topbar,.ilb-scroll{
  padding-left:max(var(--sp-10),calc((100% - 1440px) / 2)) !important;
  padding-right:max(var(--sp-10),calc((100% - 1440px) / 2)) !important;
}
/* max-height 로 묶으면 aspect-ratio 가 폭까지 줄여 칸에 빈틈이 생긴다.
   비율을 풀고 높이를 직접 준다. */
.ilb-hero-media{aspect-ratio:auto !important;height:min(46vh,440px) !important}

/* 노트북·태블릿: 히어로 세로 스택, 레일 줄바꿈 */
@media (max-width:1023px){
  .ilb-hero{grid-template-columns:1fr !important}
  .ilb-hero-media{height:min(40vh,340px) !important}
  .ilb-rail{flex-wrap:wrap !important}
  .ilb-rail>*{flex:1 1 260px !important}
  .ilb-topbar{padding:var(--sp-6) var(--sp-6) var(--sp-4) !important}
  .ilb-scroll{padding:var(--sp-6) var(--sp-6) var(--sp-12) !important}
}

/* 모바일: 좌측 아이콘 레일 → 하단 탭바 */
@media (max-width:767px){
  .ilb-root{grid-template-columns:1fr !important;
            grid-template-rows:minmax(0,1fr) auto !important}
  .ilb-main{grid-row:1 !important;min-width:0 !important}
  .ilb-nav{grid-row:2 !important;
           grid-template-rows:none !important;grid-template-columns:1fr !important;
           border-right:none !important;
           border-top:var(--bw-hair) solid var(--border-subtle) !important;
           gap:0 !important;
           padding:var(--sp-2) 0 calc(var(--sp-2) + env(safe-area-inset-bottom)) !important}
  .ilb-logo{display:none !important}
  .ilb-logo-m{display:block !important}
  .ilb-navlist{grid-auto-flow:column !important;grid-auto-columns:1fr !important;
               width:100% !important;justify-items:center !important;gap:0 !important}
  .ilb-topbar{padding:var(--sp-5) var(--sp-5) var(--sp-3) !important;
              overflow-x:auto !important;scrollbar-width:none !important}
  .ilb-topbar::-webkit-scrollbar{display:none}
  .ilb-tabs{flex:0 0 auto !important;gap:var(--sp-5) !important}
  .ilb-scroll{padding:var(--sp-5) var(--sp-5) var(--sp-10) !important;
              gap:var(--sp-10) !important}
  .ilb-hero-media{aspect-ratio:16/10 !important;height:auto !important}
  .ilb-hero-panel{padding:var(--sp-6) !important}
  .ilb-rail{flex-direction:column !important}
  .ilb-rail>*{flex:1 1 auto !important}
  .ilb-head{gap:var(--sp-4) !important}
  .ilb-post{grid-template-columns:32px 1fr auto !important;gap:var(--sp-3) !important}
}`;

tpl = sub(tpl, 'stage-css',
  `<style>body{margin:0;background:#152528}#stage{overflow-x:auto}#stage>div{width:1280px;overflow:hidden;margin-inline:auto}</style>`,
  `<style>\n${RESPONSIVE_CSS}\n</style>`);

// 1280 기준 축소 스케일러 제거 — 반응형에서는 해가 된다
// (ResizeObserver loop 경고와 높이 하드코딩의 원인이기도 했다)
tpl = sub(tpl, 'fit-script', `<script>
(function(){function fit(){var w=document.getElementById('stage');if(!w)return;var box=w.firstElementChild;if(!box)return;
var k=Math.min(1,w.clientWidth/1280);box.style.transform='scale('+k+')';box.style.transformOrigin='top left';
box.style.height=(box.firstElementChild?box.firstElementChild.offsetHeight*k:0)+'px';}
new ResizeObserver(fit).observe(document.body);window.addEventListener('load',fit);setInterval(fit,600);})();
</script>`, '');

// ══════════════════════════════════════════════════════════════════════
// 3. 다시 포장
// ══════════════════════════════════════════════════════════════════════
html = html.slice(0, tplMatch.index) +
       `<script type="__bundler/template">` + jsonForScript(tpl) + `</script>` +
       html.slice(tplMatch.index + tplMatch[0].length);

// 매니페스트가 템플릿보다 앞에 있으므로 템플릿 교체 후에 다시 찾는다
const man2 = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
html = html.slice(0, man2.index) +
       `<script type="__bundler/manifest">` + jsonForScript(manifest) + `</script>` +
       html.slice(man2.index + man2[0].length);

fs.writeFileSync(FILE, html);
console.log('OK  →', FILE, html.length, 'bytes');
