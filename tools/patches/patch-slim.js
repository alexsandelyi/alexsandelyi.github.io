#!/usr/bin/env node
// 일빵 런처 슬림화 패치 (게임 2종 + 뮤직비디오 전용):
//   1. Launcher.jsx 에서 숨김 섹션(케이 무비/케이 팝/커뮤니티), AI 토론장 탭,
//      미사용 네비 버튼 4개, 숨김 배지·저장 버튼 제거 (Draft1~5.jsx 미변경)
//   2. template 에서 community/ 스크립트, 미사용 Google Fonts(IBM Plex Mono, Jua),
//      우회 숨김 CSS(/* ilb-hero */, /* ilb-match3 */), Babel 스크립트 제거 및
//      하단 마운트 코드를 일반 React.createElement 스크립트로 교체
//   3. manifest 에서 Babel 번들(5cf0590c-...) 제거 (~860KB 축소)
//   4. 외곽 HTML 의 미사용 clickable-v2(6종)/lettering-v1(3종) CSS·JS 제거
//
//   node tools/patches/patch-slim.js           # 원본에 적용하고 index.html 로 복사
//   node tools/patches/patch-slim.js --check   # 적용 여부만 보고 종료

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');

const BABEL_UUID = '5cf0590c-e6d2-4b06-9aaa-8d3d0da3436d';
const DS_MARKER = '// ui_kits/homepage/Launcher.jsx';
const DS_END_MARKER = '// ui_kits/homepage/LauncherTones.jsx';
const SLIM_LAUNCHER_MARK = "const SECS = [['게임', 'sec-game']];";

function sub(src, label, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 매칭 ${n}건 (1건이어야 함)`);
  return src.split(from).join(to);
}

function extractBlock(html, type) {
  const open = `<script type="__bundler/${type}">`;
  const start = html.indexOf(open);
  if (start < 0) throw new Error(`${type} 블록을 찾지 못했습니다`);
  const bodyStart = start + open.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) throw new Error(`${type} 블록 끝을 찾지 못했습니다`);
  return { start: bodyStart, end, json: html.slice(bodyStart, end) };
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── 1. Launcher.jsx 슬림화 ────────────────────────────────────────────
const OLD_LAUNCHER_CONSTS =
  `const MOVIES = [{\n` +
  `  title: '왕의 서고',\n` +
  `  genre: '사극 · 시대극',\n` +
  `  meta: '세트 12'\n` +
  `}, {\n` +
  `  title: '서울 1988',\n` +
  `  genre: '드라마 · 레트로',\n` +
  `  meta: '세트 8'\n` +
  `}, {\n` +
  `  title: '해무',\n` +
  `  genre: '스릴러 · 해양',\n` +
  `  meta: '세트 5'\n` +
  `}];\n` +
  `const KPOP = [{\n` +
  `  title: '데뷔 무대 라이트팩',\n` +
  `  genre: '무대 조명',\n` +
  `  meta: '프리셋 24'\n` +
  `}, {\n` +
  `  title: '아이돌 의상 세트',\n` +
  `  genre: '의상 · 소품',\n` +
  `  meta: '파츠 31'\n` +
  `}, {\n` +
  `  title: '팬덤 응원봉',\n` +
  `  genre: '소품',\n` +
  `  meta: '파츠 6'\n` +
  `}];\n` +
  `const POSTS = [{\n` +
  `  author: '@minji',\n` +
  `  title: '저잣거리 러너 만든 과정 공유합니다',\n` +
  `  meta: '댓글 42 · 3시간 전'\n` +
  `}, {\n` +
  `  author: '@talchum_kr',\n` +
  `  title: '탈춤 모션 12종 올렸어요. 자유롭게 쓰세요',\n` +
  `  meta: '댓글 18 · 어제'\n` +
  `}, {\n` +
  `  author: '@stage_kim',\n` +
  `  title: '무대 조명 프리셋 쓰는 법',\n` +
  `  meta: '댓글 9 · 2일 전'\n` +
  `}];\n` +
  `const SECS = [['게임', 'sec-game'], ['케이 무비', 'sec-kmovie'], ['케이 팝', 'sec-kpop'], ['커뮤니티', 'sec-community']];`;

const NEW_LAUNCHER_CONSTS = SLIM_LAUNCHER_MARK;

const OLD_STATE_LINE = `  const [i, setI] = React.useState(0);\n`;
const NEW_STATE_LINE = ``;

const OLD_GO_HOME =
  `  const goHome = () => {\n` +
  `    setActive('게임');\n` +
  `    setI(0);\n` +
  `    clearMvHash();`;

const NEW_GO_HOME =
  `  const goHome = () => {\n` +
  `    setActive('게임');\n` +
  `    clearMvHash();`;

const OLD_HELPERS =
  `  const label = t => /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      font: 'var(--text-label)',\n` +
  `      letterSpacing: 'var(--tr-wide)',\n` +
  `      color: 'var(--text-muted)',\n` +
  `      marginBottom: 'var(--sp-4)'\n` +
  `    }\n` +
  `  }, t);\n` +
  `  const head = (title, right) => /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-head",\n` +
  `    style: {\n` +
  `      display: 'flex',\n` +
  `      alignItems: 'baseline',\n` +
  `      justifyContent: 'space-between',\n` +
  `      marginBottom: 'var(--sp-5)'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("h2", {\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-700)/1 var(--font-display)',\n` +
  `      color: 'var(--text-strong)'\n` +
  `    }\n` +
  `  }, title), right);\n` +
  `  const rail = items => /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-rail",\n` +
  `    style: {\n` +
  `      display: 'flex',\n` +
  `      gap: 'var(--sp-4)'\n` +
  `    }\n` +
  `  }, items.map(x => /*#__PURE__*/React.createElement("div", {\n` +
  `    key: x.title,\n` +
  `    className: "ilb-rail-item",\n` +
  `    style: {\n` +
  `      flex: 1,\n` +
  `      borderRadius: 'var(--r-md)',\n` +
  `      overflow: 'hidden',\n` +
  `      border: 'var(--bw-hair) solid var(--border-subtle)',\n` +
  `      background: 'var(--bg-raised)'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      aspectRatio: '16/10',\n` +
  `      background: 'var(--media)',\n` +
  `      display: 'grid',\n` +
  `      placeItems: 'center',\n` +
  `      font: 'var(--text-label)',\n` +
  `      letterSpacing: 'var(--tr-widest)',\n` +
  `      color: 'var(--text-faint)'\n` +
  `    }\n` +
  `  }, "IMAGE"), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      padding: 'var(--sp-4)'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      font: 'var(--fw-bold) var(--fs-300)/1.35 var(--font-body-strong)',\n` +
  `      color: 'var(--text-strong)'\n` +
  `    }\n` +
  `  }, x.title), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      display: 'flex',\n` +
  `      justifyContent: 'space-between',\n` +
  `      marginTop: 6,\n` +
  `      font: 'var(--text-body-sm)',\n` +
  `      color: 'var(--text-muted)'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("span", null, x.genre), /*#__PURE__*/React.createElement("span", {\n` +
  `    style: {\n` +
  `      font: 'var(--text-code)'\n` +
  `    }\n` +
  `  }, x.meta))))));\n`;

const OLD_NAV_ARRAY =
  `  }, [['gamepad-2', '게임'], ['youtube', 'mv_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    title: sec === 'mv_page' ? '뮤직비디오' : (sec || undefined),\n` +
  `    'aria-label': sec === 'mv_page' ? '뮤직비디오' : (sec || undefined),\n` +
  `    onClick: () => sec === 'mv_page' ? openMv() : (sec && go(sec)),`;

const NEW_NAV_ARRAY =
  `  }, [['gamepad-2', '게임'], ['youtube', 'mv_page']].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    title: sec === 'mv_page' ? '뮤직비디오' : (sec || undefined),\n` +
  `    'aria-label': sec === 'mv_page' ? '뮤직비디오' : (sec || undefined),\n` +
  `    onClick: () => sec === 'mv_page' ? openMv() : (sec && go(sec)),`;

const OLD_AI_TAB =
  `), /*#__PURE__*/React.createElement("a", {\n` +
  `    href: "ai-discussion/",\n` +
  `    "aria-label": "AI 토론장",\n` +
  `    style: {\n` +
  `      padding: '4px 0',\n` +
  `      cursor: 'pointer',\n` +
  `      font: 'var(--fw-regular) var(--fs-400)/1 var(--font-body)',\n` +
  `      color: 'var(--text-muted)',\n` +
  `      borderBottom: 'var(--bw-bold) solid transparent',\n` +
  `      textDecoration: 'none'\n` +
  `    }\n` +
  `  }, "AI 토론장"))),`;

const NEW_AI_TAB = `))),`;

const OLD_HERO_PANEL_AND_HIDDEN_SECS =
  `  }, /*#__PURE__*/React.createElement("span", {\n` +
  `    style: {\n` +
  `      justifySelf: 'start'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement(__ds_scope.Badge, {\n` +
  `    tone: "gold"\n` +
  `  }, "\\uC774\\uBC88 \\uC8FC \\uCD94\\uCC9C")), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-800)/1 var(--font-display)',\n` +
  `      color: 'var(--text-strong)'\n` +
  `    }\n` +
  `  }, g.title), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      font: 'var(--text-body-md)',\n` +
  `      color: 'var(--text-muted)'\n` +
  `    }\n` +
  `  }, g.genre, " \\xB7 ", g.author, " \\xB7 ", g.plays, " \\uD50C\\uB808\\uC774"), /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero-actions",\n` +
  `    style: {\n` +
  `      display: 'flex',\n` +
  `      gap: 'var(--sp-3)',\n` +
  `      marginTop: 'var(--sp-2)'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {\n` +
  `    as: g.url ? 'a' : 'button',\n` +
  `    href: g.url,\n` +
  `    disabled: !g.url,\n` +
  `    title: g.url ? undefined : '아직 준비 중입니다',\n` +
  `    iconLeft: /*#__PURE__*/React.createElement(__ds_scope.Icon, {\n` +
  `      name: "play",\n` +
  `      size: 18\n` +
  `    })\n` +
  `  }, "\\uD50C\\uB808\\uC774"), /*#__PURE__*/React.createElement(__ds_scope.Button, {\n` +
  `    variant: "secondary",\n` +
  `    iconLeft: /*#__PURE__*/React.createElement(__ds_scope.Icon, {\n` +
  `      name: "bookmark",\n` +
  `      size: 18\n` +
  `    })\n` +
  `  }, "\\uC800\\uC7A5")))))), /*#__PURE__*/React.createElement("section", {\n` +
  `    id: "sec-kmovie"\n` +
  `  }, head('케이 무비', /*#__PURE__*/React.createElement("a", {\n` +
  `    href: "#"\n` +
  `  }, "\\uC804\\uCCB4 \\uBCF4\\uAE30")), label('사극 · 드라마 세트와 소품'), rail(MOVIES)), /*#__PURE__*/React.createElement("section", {\n` +
  `    id: "sec-kpop"\n` +
  `  }, head('케이 팝', /*#__PURE__*/React.createElement("a", {\n` +
  `    href: "#"\n` +
  `  }, "\\uC804\\uCCB4 \\uBCF4\\uAE30")), label('무대 · 의상 · 응원 소품'), rail(KPOP)), /*#__PURE__*/React.createElement("section", {\n` +
  `    id: "sec-community"\n` +
  `  }, head('커뮤니티', /*#__PURE__*/React.createElement(__ds_scope.Button, {\n` +
  `    as: 'a',\n` +
  `    href: 'community/',\n` +
  `    variant: "secondary",\n` +
  `    size: "sm"\n` +
  `  }, "\\uAE00 \\uC4F0\\uAE30")), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      display: 'grid',\n` +
  `      gap: 'var(--sp-2)'\n` +
  `    }\n` +
  `  }, POSTS.map(p => /*#__PURE__*/React.createElement(__ds_scope.Card, {\n` +
  `    key: p.title,\n` +
  `    variant: "soft",\n` +
  `    pad: 16,\n` +
  `    className: "ilb-post",\n` +
  `    style: {\n` +
  `      background: 'var(--bg-raised)',\n` +
  `      display: 'grid',\n` +
  `      gridTemplateColumns: '38px 1fr auto',\n` +
  `      gap: 'var(--sp-4)',\n` +
  `      alignItems: 'center'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("span", {\n` +
  `    style: {\n` +
  `      width: 38,\n` +
  `      height: 38,\n` +
  `      borderRadius: 'var(--r-pill)',\n` +
  `      background: 'var(--chip-off)'\n` +
  `    }\n` +
  `  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {\n` +
  `    style: {\n` +
  `      display: 'block',\n` +
  `      font: 'var(--fw-bold) var(--fs-300)/1.35 var(--font-body-strong)',\n` +
  `      color: 'var(--text-strong)'\n` +
  `    }\n` +
  `  }, p.title), /*#__PURE__*/React.createElement("span", {\n` +
  `    style: {\n` +
  `      font: 'var(--text-body-sm)',\n` +
  `      color: 'var(--text-muted)'\n` +
  `    }\n` +
  `  }, p.author, " \\xB7 ", p.meta)), /*#__PURE__*/React.createElement(__ds_scope.Icon, {\n` +
  `    name: "chevron-right",\n` +
  `    size: 18,\n` +
  `    color: "var(--text-muted)"\n` +
  `  })))))), active === 'mv_page' ?`;

const NEW_HERO_PANEL_AND_MV =
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-800)/1 var(--font-display)',\n` +
  `      color: 'var(--text-strong)'\n` +
  `    }\n` +
  `  }, g.title), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      font: 'var(--text-body-md)',\n` +
  `      color: 'var(--text-muted)'\n` +
  `    }\n` +
  `  }, g.genre, " \\xB7 ", g.author, " \\xB7 ", g.plays, " \\uD50C\\uB808\\uC774"), /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero-actions",\n` +
  `    style: {\n` +
  `      display: 'flex',\n` +
  `      gap: 'var(--sp-3)',\n` +
  `      marginTop: 'var(--sp-2)'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {\n` +
  `    as: g.url ? 'a' : 'button',\n` +
  `    href: g.url,\n` +
  `    disabled: !g.url,\n` +
  `    title: g.url ? undefined : '아직 준비 중입니다',\n` +
  `    iconLeft: /*#__PURE__*/React.createElement(__ds_scope.Icon, {\n` +
  `      name: "play",\n` +
  `      size: 18\n` +
  `    })\n` +
  `  }, "\\uD50C\\uB808\\uC774"))))))), active === 'mv_page' ?`;

// ── 2. template 치환 블록 ─────────────────────────────────────────────
const OLD_BABEL_SCRIPT_TAG =
  `<script src="${BABEL_UUID}" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>\n`;

const OLD_FONT_HREF =
  `https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=IBM+Plex+Mono:wght@400&family=Jua&family=Noto+Sans+KR:wght@300;400;500;700&display=swap`;
const NEW_FONT_HREF =
  `https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Noto+Sans+KR:wght@300;400;500;700&display=swap`;

const OLD_COMMUNITY_TAGS =
  `<link rel="stylesheet" href="community/board.css"><script src="community/js/01-api.js" defer></script><script src="community/js/02-board.js" defer></script><script src="community/js/embed.js" defer></script>\n`;

const OLD_MOUNT_SCRIPT =
  `<script type="text/babel">\n` +
  `const NS=window.DesignSystem_bed870;\n` +
  `const P=NS.PALETTES?NS.PALETTES[1]:{vars:{}};\n` +
  `const palette={...P,vars:{...P.vars,'--font-display':'"Noto Sans KR","Apple SD Gothic Neo",sans-serif','--font-body':'"Gowun Dodum","Apple SD Gothic Neo",sans-serif','--font-body-strong':'"Noto Sans KR","Apple SD Gothic Neo",sans-serif','--font-code':'"IBM Plex Mono",ui-monospace,monospace','--accent':'#8E5F06','--accent-hover':'#A87209','--accent-press':'#6E4A04','--accent-soft':'#F5EBD2'}};\n` +
  `const L=NS.Launcher;\n` +
  `ReactDOM.createRoot(document.getElementById('root')).render(<div id="stage"><div>{L?<L palette={palette}/>:null}</div></div>);\n` +
  `</script>`;

const NEW_MOUNT_SCRIPT =
  `<script>\n` +
  `const NS=window.DesignSystem_bed870;\n` +
  `const P=NS.PALETTES?NS.PALETTES[1]:{vars:{}};\n` +
  `const palette={...P,vars:{...P.vars,'--font-display':'"Noto Sans KR","Apple SD Gothic Neo",sans-serif','--font-body':'"Gowun Dodum","Apple SD Gothic Neo",sans-serif','--font-body-strong':'"Noto Sans KR","Apple SD Gothic Neo",sans-serif','--accent':'#8E5F06','--accent-hover':'#A87209','--accent-press':'#6E4A04','--accent-soft':'#F5EBD2'}};\n` +
  `const L=NS.Launcher;\n` +
  `ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',{id:'stage'},React.createElement('div',null,L?React.createElement(L,{palette:palette}):null)));\n` +
  `</script>`;

// ── 3. 외곽 HTML assetControls 블록 ───────────────────────────────────
const OLD_OUTER_UNUSED_CSS =
  `        .ilbbang-asset-movie {\n` +
  `          --asset-url: url("./assets/clickable-v2/movie.webp");\n` +
  `          width: 118px !important;\n` +
  `          height: 36px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-kpop {\n` +
  `          --asset-url: url("./assets/clickable-v2/kpop.webp");\n` +
  `          width: 112px !important;\n` +
  `          height: 34px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-community {\n` +
  `          --asset-url: url("./assets/clickable-v2/community.webp");\n` +
  `          width: 118px !important;\n` +
  `          height: 36px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-play {\n` +
  `          --asset-url: url("./assets/clickable-v2/play.webp");\n` +
  `          width: 132px !important;\n` +
  `          height: 44px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-save {\n` +
  `          --asset-url: url("./assets/clickable-v2/save.webp");\n` +
  `          width: 124px !important;\n` +
  `          height: 36px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-view-all {\n` +
  `          --asset-url: url("./assets/clickable-v2/view-all.webp");\n` +
  `          width: 108px !important;\n` +
  `          height: 32px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-view-all::after {\n` +
  `          color: #152528;\n` +
  `          font-size: 12px;\n` +
  `          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);\n` +
  `        }\n\n` +
  `        .ilbbang-asset-write {\n` +
  `          --asset-url: url("./assets/clickable-v2/write.webp");\n` +
  `          width: 118px !important;\n` +
  `          height: 38px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-play::after,\n` +
  `        .ilbbang-asset-save::after,\n` +
  `        .ilbbang-asset-write::after {\n` +
  `          font-size: 14px;\n` +
  `        }\n\n` +
  `        .ilbbang-lettering-heading {\n` +
  `          --lettering-url: none;\n` +
  `          display: block !important;\n` +
  `          flex: 0 0 auto !important;\n` +
  `          margin: 0 !important;\n` +
  `          padding: 0 !important;\n` +
  `          background-color: transparent !important;\n` +
  `          background-image: var(--lettering-url) !important;\n` +
  `          background-position: left center !important;\n` +
  `          background-repeat: no-repeat !important;\n` +
  `          background-size: contain !important;\n` +
  `          color: transparent !important;\n` +
  `          font-size: 0 !important;\n` +
  `          line-height: 0 !important;\n` +
  `          text-shadow: none !important;\n` +
  `        }\n\n` +
  `        .ilbbang-lettering-k-movie {\n` +
  `          --lettering-url: url("./assets/lettering-v1/k-movie.webp");\n` +
  `          width: 162px !important;\n` +
  `          height: 44px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-lettering-k-pop {\n` +
  `          --lettering-url: url("./assets/lettering-v1/k-pop.webp");\n` +
  `          width: 142px !important;\n` +
  `          height: 45px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-lettering-community {\n` +
  `          --lettering-url: url("./assets/lettering-v1/community.webp");\n` +
  `          width: 162px !important;\n` +
  `          height: 45px !important;\n` +
  `        }\n\n` +
  `        @media (max-width: 720px) {\n` +
  `          .ilbbang-asset-nav {\n` +
  `            width: 90px !important;\n` +
  `            height: 29px !important;\n` +
  `          }\n\n` +
  `          .ilbbang-asset-nav::after {\n` +
  `            font-size: 11px;\n` +
  `          }\n\n` +
  `          .ilbbang-asset-play {\n` +
  `            width: 114px !important;\n` +
  `            height: 38px !important;\n` +
  `          }\n\n` +
  `          .ilbbang-asset-save {\n` +
  `            width: 106px !important;\n` +
  `            height: 31px !important;\n` +
  `          }\n\n` +
  `          .ilbbang-lettering-k-movie,\n` +
  `          .ilbbang-lettering-community {\n` +
  `            width: 132px !important;\n` +
  `            height: 36px !important;\n` +
  `          }\n\n` +
  `          .ilbbang-lettering-k-pop {\n` +
  `            width: 116px !important;\n` +
  `            height: 37px !important;\n` +
  `          }\n` +
  `        }\n\n` +
  `        .ilb-navlist > button:nth-child(3),\n` +
  `        .ilb-navlist > button:nth-child(4),\n` +
  `        .ilb-navlist > button:nth-child(5),\n` +
  `        .ilb-navlist > button:nth-child(6) {\n` +
  `          display: none !important;\n` +
  `        }\n\n` +
  `        a[href="ai-discussion/"] {\n` +
  `          display: none !important;\n` +
  `        }\n`;

const NEW_OUTER_CSS =
  `        .ilbbang-asset-play {\n` +
  `          --asset-url: url("./assets/clickable-v2/play.webp");\n` +
  `          width: 132px !important;\n` +
  `          height: 44px !important;\n` +
  `        }\n\n` +
  `        .ilbbang-asset-play::after {\n` +
  `          font-size: 14px;\n` +
  `        }\n\n` +
  `        @media (max-width: 720px) {\n` +
  `          .ilbbang-asset-nav {\n` +
  `            width: 90px !important;\n` +
  `            height: 29px !important;\n` +
  `          }\n\n` +
  `          .ilbbang-asset-nav::after {\n` +
  `            font-size: 11px;\n` +
  `          }\n\n` +
  `          .ilbbang-asset-play {\n` +
  `            width: 114px !important;\n` +
  `            height: 38px !important;\n` +
  `          }\n` +
  `        }\n`;

const OLD_OUTER_JS =
  `      const assetControls = {\n` +
  `        '게임': { slug: 'game', nav: true },\n` +
  `        '케이 무비': { slug: 'movie', nav: true },\n` +
  `        '케이 팝': { slug: 'kpop', nav: true },\n` +
  `        '커뮤니티': { slug: 'community', nav: true },\n` +
  `        '플레이': { slug: 'play' },\n` +
  `        '저장': { slug: 'save' },\n` +
  `        '전체 보기': { slug: 'view-all' },\n` +
  `        '글 쓰기': { slug: 'write' }\n` +
  `      };\n` +
  `      const letteringHeadings = {\n` +
  `        '케이 무비': 'k-movie',\n` +
  `        '케이 팝': 'k-pop',\n` +
  `        '커뮤니티': 'community'\n` +
  `      };\n` +
  `      let selectedAssetNav = 'game';\n\n` +
  `      const normalizedLabel = (value) =>\n` +
  `        String(value || '').replace(/\\s+/g, ' ').trim();\n\n` +
  `      const decorateAssetControls = () => {\n` +
  `        for (const control of document.querySelectorAll(\n` +
  `          'button, a, [role="button"], [role="link"]'\n` +
  `        )) {\n` +
  `          const label = normalizedLabel(\n` +
  `            control.innerText || control.textContent\n` +
  `          );\n` +
  `          const config = assetControls[label];\n` +
  `          if (!config) continue;\n\n` +
  `          control.classList.add(\n` +
  `            'ilbbang-asset-button',\n` +
  `            \`ilbbang-asset-\${config.slug}\`\n` +
  `          );\n` +
  `          if (config.nav) control.classList.add('ilbbang-asset-nav');\n` +
  `          control.dataset.assetLabel = label;\n` +
  `          if (!control.getAttribute('aria-label')) {\n` +
  `            control.setAttribute('aria-label', label);\n` +
  `          }\n` +
  `          control.classList.toggle(\n` +
  `            'is-selected',\n` +
  `            Boolean(config.nav && config.slug === selectedAssetNav)\n` +
  `          );\n\n` +
  `          if (['movie', 'kpop', 'community'].includes(config.slug)) {\n` +
  `            control.style.setProperty('display', 'none', 'important');\n` +
  `            const wrapper = control.closest('li, .ilb-rail-item');\n` +
  `            if (wrapper) wrapper.style.setProperty('display', 'none', 'important');\n` +
  `          }\n` +
  `        }\n\n` +
  `        for (const heading of document.querySelectorAll('h1, h2, h3')) {\n` +
  `          const label = normalizedLabel(\n` +
  `            heading.innerText || heading.textContent\n` +
  `          );\n` +
  `          const slug = letteringHeadings[label];\n` +
  `          if (!slug) continue;\n\n` +
  `          heading.classList.add(\n` +
  `            'ilbbang-lettering-heading',\n` +
  `            \`ilbbang-lettering-\${slug}\`\n` +
  `          );\n` +
  `          if (!heading.getAttribute('aria-label')) {\n` +
  `            heading.setAttribute('aria-label', label);\n` +
  `          }\n\n` +
  `          if (['k-movie', 'k-pop', 'community'].includes(slug)) {\n` +
  `            const section = heading.closest('section');\n` +
  `            if (section) {\n` +
  `              section.style.setProperty('display', 'none', 'important');\n` +
  `            }\n` +
  `          }\n` +
  `        }\n` +
  `      };`;

const NEW_OUTER_JS =
  `      const assetControls = {\n` +
  `        '게임': { slug: 'game', nav: true },\n` +
  `        '플레이': { slug: 'play' }\n` +
  `      };\n` +
  `      let selectedAssetNav = 'game';\n\n` +
  `      const normalizedLabel = (value) =>\n` +
  `        String(value || '').replace(/\\s+/g, ' ').trim();\n\n` +
  `      const decorateAssetControls = () => {\n` +
  `        for (const control of document.querySelectorAll(\n` +
  `          'button, a, [role="button"], [role="link"]'\n` +
  `        )) {\n` +
  `          const label = normalizedLabel(\n` +
  `            control.innerText || control.textContent\n` +
  `          );\n` +
  `          const config = assetControls[label];\n` +
  `          if (!config) continue;\n\n` +
  `          control.classList.add(\n` +
  `            'ilbbang-asset-button',\n` +
  `            \`ilbbang-asset-\${config.slug}\`\n` +
  `          );\n` +
  `          if (config.nav) control.classList.add('ilbbang-asset-nav');\n` +
  `          control.dataset.assetLabel = label;\n` +
  `          if (!control.getAttribute('aria-label')) {\n` +
  `            control.setAttribute('aria-label', label);\n` +
  `          }\n` +
  `          control.classList.toggle(\n` +
  `            'is-selected',\n` +
  `            Boolean(config.nav && config.slug === selectedAssetNav)\n` +
  `          );\n` +
  `        }\n` +
  `      };`;

function removeMarkedStyleBlock(tpl, mark, label) {
  const pos = tpl.indexOf(mark);
  if (pos < 0) throw new Error(`[${label}] 블록을 찾지 못했습니다`);
  const open = tpl.lastIndexOf('<style>', pos);
  const close = tpl.indexOf('</style>', pos);
  if (open < 0 || close < 0) throw new Error(`[${label}] <style> 경계를 찾지 못했습니다`);
  if (tpl.indexOf(mark, pos + mark.length) >= 0) throw new Error(`[${label}] 블록이 중복되었습니다`);
  return tpl.slice(0, open) + tpl.slice(close + '</style>'.length);
}

function main() {
  const check = process.argv.includes('--check');
  let html = fs.readFileSync(SRC, 'utf8');

  const manBlock = extractBlock(html, 'manifest');
  const manifest = JSON.parse(manBlock.json);
  const dsId = Object.keys(manifest).find(k => {
    if (manifest[k].mime !== 'application/javascript') return false;
    const s = zlib.gunzipSync(Buffer.from(manifest[k].data, 'base64')).toString('utf8');
    return s.includes(DS_MARKER);
  });
  if (!dsId) throw new Error('Launcher.jsx 번들을 찾지 못했습니다');

  const entry = manifest[dsId];
  const buf = Buffer.from(entry.data, 'base64');
  const dsFull = entry.compressed ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

  const lStart = dsFull.indexOf(DS_MARKER);
  const lEnd = dsFull.indexOf(DS_END_MARKER);
  if (lStart < 0 || lEnd < lStart) throw new Error('Launcher.jsx 구간을 찾지 못했습니다');
  const launcher = dsFull.slice(lStart, lEnd);

  const tplInitial = JSON.parse(extractBlock(html, 'template').json);

  const alreadyLauncher =
    launcher.includes(SLIM_LAUNCHER_MARK) &&
    !launcher.includes('sec-kmovie') &&
    !launcher.includes('ai-discussion/');
  const alreadyNoBabel =
    !(BABEL_UUID in manifest) &&
    !tplInitial.includes(BABEL_UUID) &&
    !tplInitial.includes('type="text/babel"');
  const alreadyNoDeadTpl =
    !tplInitial.includes('community/board.css') &&
    !tplInitial.includes('/* ilb-hero */') &&
    !tplInitial.includes('/* ilb-match3 */') &&
    !tplInitial.includes('IBM+Plex+Mono') &&
    !tplInitial.includes('&family=Jua');
  const alreadyOuter =
    !html.includes('lettering-v1') &&
    !html.includes('ilbbang-asset-movie') &&
    !html.includes('ai-discussion/');

  if (alreadyLauncher && alreadyNoBabel && alreadyNoDeadTpl && alreadyOuter) {
    console.log('이미 런처 슬림화 패치가 적용돼 있습니다.');
    return;
  }
  if (check) {
    console.log('런처 슬림화 패치가 아직 적용되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  // 1. Launcher.jsx 구간만 슬림화 (Draft1~5.jsx 미변경)
  if (!alreadyLauncher) {
    let updatedLauncher = launcher;
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx consts', OLD_LAUNCHER_CONSTS, NEW_LAUNCHER_CONSTS);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx state i', OLD_STATE_LINE, NEW_STATE_LINE);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx goHome', OLD_GO_HOME, NEW_GO_HOME);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx helpers', OLD_HELPERS, '');
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx navlist', OLD_NAV_ARRAY, NEW_NAV_ARRAY);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx ai-discussion tab', OLD_AI_TAB, NEW_AI_TAB);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx hero panel + hidden sections', OLD_HERO_PANEL_AND_HIDDEN_SECS, NEW_HERO_PANEL_AND_MV);

    const updatedDs = dsFull.slice(0, lStart) + updatedLauncher + dsFull.slice(lEnd);
    entry.data = zlib.gzipSync(Buffer.from(updatedDs, 'utf8'), { level: 9 }).toString('base64');
    entry.compressed = true;
  }

  // 2. template 정리 (community 4줄, 미사용 폰트, /* ilb-hero */, /* ilb-match3 */, Babel)
  const tplBlock = extractBlock(html, 'template');
  let tpl = JSON.parse(tplBlock.json);
  if (tpl.includes('community/board.css')) {
    tpl = sub(tpl, 'template community tags', OLD_COMMUNITY_TAGS, '');
  }
  if (tpl.includes(OLD_FONT_HREF)) {
    tpl = sub(tpl, 'template Google Fonts', OLD_FONT_HREF, NEW_FONT_HREF);
  }
  if (tpl.includes('/* ilb-hero */')) {
    tpl = removeMarkedStyleBlock(tpl, '/* ilb-hero */', 'template ilb-hero');
  }
  if (tpl.includes('/* ilb-match3 */')) {
    tpl = removeMarkedStyleBlock(tpl, '/* ilb-match3 */', 'template ilb-match3');
  }
  if (tpl.includes(BABEL_UUID)) {
    tpl = sub(tpl, 'template Babel script tag', OLD_BABEL_SCRIPT_TAG, '');
  }
  if (tpl.includes('type="text/babel"')) {
    tpl = sub(tpl, 'template mount script', OLD_MOUNT_SCRIPT, NEW_MOUNT_SCRIPT);
  }

  // 3. 최종 template 에서 미참조 확인 후 Babel 항목 삭제
  if (tpl.includes(BABEL_UUID)) {
    throw new Error('template 에 Babel UUID 참조가 아직 남아 있어 삭제할 수 없습니다');
  }
  delete manifest[BABEL_UUID];

  // manifest / template 재포장 (script 블록 위치에 유의하여 각각 교체)
  const encodedManifest = jsonForScript(manifest);
  html = html.slice(0, manBlock.start) + encodedManifest + html.slice(manBlock.end);

  const tplBlockAfterMan = extractBlock(html, 'template');
  const encodedTpl = jsonForScript(tpl);
  html = html.slice(0, tplBlockAfterMan.start) + encodedTpl + html.slice(tplBlockAfterMan.end);

  // 4. 외곽 HTML 의 미사용 asset 스타일 및 JS 분기 정리
  if (!alreadyOuter) {
    const crlf = html.includes('\r\n');
    const norm = s => (crlf ? s.replace(/\n/g, '\r\n') : s);
    html = sub(html, 'outer unused asset CSS', norm(OLD_OUTER_UNUSED_CSS), norm(NEW_OUTER_CSS));
    html = sub(html, 'outer assetControls JS', norm(OLD_OUTER_JS), norm(NEW_OUTER_JS));
  }

  // 5. 되읽기 검증: JSON 파싱, JS 구문, Draft1~5.jsx 무변경, 잔여 참조 부재
  const checkMan = JSON.parse(extractBlock(html, 'manifest').json);
  if (BABEL_UUID in checkMan) throw new Error('되읽기 검증 실패: manifest 에 Babel 이 남아 있습니다');
  const checkDs = zlib.gunzipSync(Buffer.from(checkMan[dsId].data, 'base64')).toString('utf8');
  new Function(checkDs);
  const checkLStart = checkDs.indexOf(DS_MARKER);
  const checkLEnd = checkDs.indexOf(DS_END_MARKER);
  if (checkDs.slice(0, checkLStart) !== dsFull.slice(0, lStart) || checkDs.slice(checkLEnd) !== dsFull.slice(lEnd)) {
    throw new Error('되읽기 검증 실패: Launcher.jsx 외 구간이 변경되었습니다');
  }
  const checkL = checkDs.slice(checkLStart, checkLEnd);
  for (const forbidden of ['sec-kmovie', 'sec-kpop', 'sec-community', 'ai-discussion/', 'MOVIES', 'KPOP', 'POSTS', 'bookmark']) {
    if (checkL.includes(forbidden)) throw new Error(`되읽기 검증 실패: Launcher.jsx 에 ${forbidden} 잔여`);
  }
  if (!checkL.includes('mvStamp') || !checkL.includes('ilb-mv-frame') || !checkL.includes('ilb-game-stack')) {
    throw new Error('되읽기 검증 실패: 뮤직비디오/게임 2단 핵심 코드가 누락되었습니다');
  }
  const checkTpl = JSON.parse(extractBlock(html, 'template').json);
  for (const forbidden of ['community/', 'IBM+Plex+Mono', 'Jua', '/* ilb-hero */', '/* ilb-match3 */', 'text/babel', BABEL_UUID]) {
    if (checkTpl.includes(forbidden)) throw new Error(`되읽기 검증 실패: template 에 ${forbidden} 잔여`);
  }
  if (!checkTpl.includes('React.createElement(L,{palette:palette})')) {
    throw new Error('되읽기 검증 실패: 일반 JS 마운트 코드가 누락되었습니다');
  }
  for (const forbidden of ['lettering-v1', 'ilbbang-asset-movie', 'ilbbang-asset-save', 'ai-discussion/']) {
    if (html.includes(forbidden)) throw new Error(`되읽기 검증 실패: 외곽 HTML 에 ${forbidden} 잔여`);
  }

  fs.writeFileSync(SRC, html, 'utf8');
  fs.copyFileSync(SRC, OUT);

  const hSrc = sha256(fs.readFileSync(SRC));
  const hOut = sha256(fs.readFileSync(OUT));
  if (hSrc !== hOut) throw new Error('동기화 검증 실패: 원본과 index.html 해시 불일치');

  console.log('적용 완료: 런처 슬림화 (Babel/community/AI토론/미사용 WebP·폰트 제거)');
  console.log(`크기: ${Buffer.byteLength(html, 'utf8')} bytes`);
  console.log(`SHA-256: ${hOut}`);
}

main();
