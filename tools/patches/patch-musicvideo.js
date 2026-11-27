#!/usr/bin/env node
// 일빵 런처: 좌측 레일(모바일 하단 탭바)의 게임 아이콘 바로 아래에
// 뮤직비디오(utubeinfo/) 메뉴 아이콘(lucide 'youtube')을 추가하고,
// 런처 틀(좌측 레일 + 왼쪽 위 '일빵' 로고)을 유지한 채 오른쪽 영역에
// utubeinfo/ 를 표시한다. 왼쪽 위 '일빵' 로고 클릭 시 홈페이지 첫 화면으로 복귀한다.
//
//   node tools/patches/patch-musicvideo.js           # 원본에 적용하고 index.html 로 복사
//   node tools/patches/patch-musicvideo.js --check   # 적용 여부만 보고 종료

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const CSS_MARK = '/* ilb-mv */';

function sub(src, label, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 매칭 ${n}건 (1건이어야 함)`);
  return src.split(from).join(to);
}

function extractBlock(html, type) {
  const open = html.indexOf(`<script type="__bundler/${type}">`);
  if (open < 0) throw new Error(`${type} 블록을 찾지 못했습니다`);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  return { start, end, json: html.slice(start, end) };
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const OLD_STATE_GO =
  `  const [active, setActive] = React.useState('게임');\n` +
  `  const go = n => {\n` +
  `    setActive(n);`;

const NEW_STATE_GO =
  `  const [active, setActive] = React.useState(() => window.location.hash === '#mv' ? 'mv_page' : '게임');\n` +
  `  React.useEffect(() => {\n` +
  `    const syncHash = () => setActive(window.location.hash === '#mv' ? 'mv_page' : '게임');\n` +
  `    window.addEventListener('hashchange', syncHash);\n` +
  `    window.addEventListener('popstate', syncHash);\n` +
  `    return () => {\n` +
  `      window.removeEventListener('hashchange', syncHash);\n` +
  `      window.removeEventListener('popstate', syncHash);\n` +
  `    };\n` +
  `  }, []);\n` +
  `  const clearMvHash = () => {\n` +
  `    try {\n` +
  `      if (window.location.hash === '#mv') {\n` +
  `        history.pushState(null, '', window.location.pathname + window.location.search);\n` +
  `      }\n` +
  `    } catch {}\n` +
  `  };\n` +
  `  const goHome = () => {\n` +
  `    setActive('게임');\n` +
  `    setI(0);\n` +
  `    clearMvHash();\n` +
  `    if (scroller.current) {\n` +
  `      cancelAnimationFrame(raf.current);\n` +
  `      scroller.current.scrollTop = 0;\n` +
  `    }\n` +
  `  };\n` +
  `  const openMv = () => {\n` +
  `    setActive('mv_page');\n` +
  `    try {\n` +
  `      if (window.location.hash !== '#mv') history.pushState(null, '', '#mv');\n` +
  `    } catch {}\n` +
  `  };\n` +
  `  const go = n => {\n` +
  `    setActive(n);\n` +
  `    clearMvHash();`;

const OLD_ROOT =
  `  return /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-root",`;

const NEW_ROOT =
  `  return /*#__PURE__*/React.createElement("div", {\n` +
  `    className: active === 'mv_page' ? "ilb-root is-mv" : "ilb-root",`;

const OLD_LOGO =
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-logo",\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',\n` +
  `      color: 'var(--accent)'\n` +
  `    }\n` +
  `  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {`;

const NEW_LOGO =
  `  }, /*#__PURE__*/React.createElement("button", {\n` +
  `    type: "button",\n` +
  `    className: "ilb-logo",\n` +
  `    onClick: goHome,\n` +
  `    title: "일빵 홈으로",\n` +
  `    "aria-label": "일빵 홈으로",\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',\n` +
  `      color: 'var(--accent)',\n` +
  `      background: 'none',\n` +
  `      border: 'none',\n` +
  `      padding: 0,\n` +
  `      cursor: 'pointer'\n` +
  `    }\n` +
  `  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {`;

const OLD_LOGO_M =
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-logo-m",\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',\n` +
  `      color: 'var(--accent)',\n` +
  `      marginRight: 'var(--sp-6)',\n` +
  `      flex: '0 0 auto',\n` +
  `      display: 'none'\n` +
  `    }\n` +
  `  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {`;

const NEW_LOGO_M =
  `  }, /*#__PURE__*/React.createElement("button", {\n` +
  `    type: "button",\n` +
  `    className: "ilb-logo-m",\n` +
  `    onClick: goHome,\n` +
  `    title: "일빵 홈으로",\n` +
  `    "aria-label": "일빵 홈으로",\n` +
  `    style: {\n` +
  `      font: 'var(--fw-regular) var(--fs-500)/1 var(--font-display)',\n` +
  `      color: 'var(--accent)',\n` +
  `      marginRight: 'var(--sp-6)',\n` +
  `      flex: '0 0 auto',\n` +
  `      display: 'none',\n` +
  `      background: 'none',\n` +
  `      border: 'none',\n` +
  `      padding: 0,\n` +
  `      cursor: 'pointer'\n` +
  `    }\n` +
  `  }, "\\uC77C\\uBE75"), /*#__PURE__*/React.createElement("div", {`;

// 패치 v0 (뮤직비디오 아이콘 추가 전) 및 v1 (외부 페이지 이동 방식) 모두 지원
const OLD_NAV_BLOCK_V0 =
  `  }, [['gamepad-2', '게임'], ['shopping-bag', 'links_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    onClick: () => sec === 'links_page' ? (window.location.href = 'links.html') : (sec && go(sec)),`;

const OLD_NAV_BLOCK_V1 =
  `  }, [['gamepad-2', '게임'], ['youtube', 'mv_page'], ['shopping-bag', 'links_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    title: sec === 'mv_page' ? '뮤직비디오' : sec === 'links_page' ? '추천 아이템' : (sec || undefined),\n` +
  `    'aria-label': sec === 'mv_page' ? '뮤직비디오' : sec === 'links_page' ? '추천 아이템' : (sec || undefined),\n` +
  `    onClick: () => sec === 'mv_page' ? (window.location.href = 'utubeinfo/') : sec === 'links_page' ? (window.location.href = 'links.html') : (sec && go(sec)),`;

const NEW_NAV_BLOCK =
  `  }, [['gamepad-2', '게임'], ['youtube', 'mv_page'], ['shopping-bag', 'links_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    title: sec === 'mv_page' ? '뮤직비디오' : sec === 'links_page' ? '추천 아이템' : (sec || undefined),\n` +
  `    'aria-label': sec === 'mv_page' ? '뮤직비디오' : sec === 'links_page' ? '추천 아이템' : (sec || undefined),\n` +
  `    onClick: () => sec === 'mv_page' ? openMv() : sec === 'links_page' ? (window.location.href = 'links.html') : (sec && go(sec)),`;

const OLD_MAIN_END =
  `  }, p.author, " \\xB7 ", p.meta)), /*#__PURE__*/React.createElement(__ds_scope.Icon, {\n` +
  `    name: "chevron-right",\n` +
  `    size: 18,\n` +
  `    color: "var(--text-muted)"\n` +
  `  }))))))));\n` +
  `}\n` +
  `Object.assign(__ds_scope, { Launcher });`;

const NEW_MAIN_END =
  `  }, p.author, " \\xB7 ", p.meta)), /*#__PURE__*/React.createElement(__ds_scope.Icon, {\n` +
  `    name: "chevron-right",\n` +
  `    size: 18,\n` +
  `    color: "var(--text-muted)"\n` +
  `  })))))), active === 'mv_page' ? /*#__PURE__*/React.createElement("iframe", {\n` +
  `    className: "ilb-mv-frame",\n` +
  `    src: "utubeinfo/",\n` +
  `    title: "뮤직비디오",\n` +
  `    allow: "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write",\n` +
  `    allowFullScreen: true\n` +
  `  }) : null));\n` +
  `}\n` +
  `Object.assign(__ds_scope, { Launcher });`;

const OLD_HIDE_CSS =
  `        .ilb-navlist > button:nth-child(3),\n` +
  `        .ilb-navlist > button:nth-child(4),\n` +
  `        .ilb-navlist > button:nth-child(5),\n` +
  `        .ilb-navlist > button:nth-child(6) {\n` +
  `          display: none !important;\n` +
  `        }`;

const NEW_HIDE_CSS =
  `        .ilb-navlist > button:nth-child(4),\n` +
  `        .ilb-navlist > button:nth-child(5),\n` +
  `        .ilb-navlist > button:nth-child(6),\n` +
  `        .ilb-navlist > button:nth-child(7) {\n` +
  `          display: none !important;\n` +
  `        }`;

const MV_STYLE = `<style>${CSS_MARK}
.ilb-logo,.ilb-logo-m{
  cursor:pointer;
  transition:opacity .15s ease,transform .15s ease;
}
.ilb-logo:hover,.ilb-logo-m:hover{opacity:.78}
.ilb-logo:active,.ilb-logo-m:active{transform:scale(.96)}
.ilb-logo:focus-visible,.ilb-logo-m:focus-visible{
  outline:2px solid #8E5F06;
  outline-offset:4px;
  border-radius:4px;
}
.ilb-root.is-mv .ilb-scroll{display:none !important}
.ilb-mv-frame{
  width:100%;
  height:100%;
  min-height:0;
  border:0;
  display:block;
  background:#0f172a;
}
@media (min-width:768px){
  .ilb-root.is-mv .ilb-main{grid-template-rows:1fr !important}
  .ilb-root.is-mv .ilb-topbar{display:none !important}
}
@media (max-width:767px){
  .ilb-root.is-mv .ilb-main{grid-template-rows:auto 1fr !important}
  .ilb-root.is-mv .ilb-topbar{padding:12px 16px !important;min-height:48px}
  .ilb-root.is-mv .ilb-tabs{display:none !important}
}
</style>`;

function main() {
  const check = process.argv.includes('--check');
  let html = fs.readFileSync(SRC, 'utf8');

  const manBlock = extractBlock(html, 'manifest');
  const manifest = JSON.parse(manBlock.json);
  const dsId = Object.keys(manifest).find(k => manifest[k].mime === 'application/javascript');
  if (!dsId) throw new Error('application/javascript 번들을 찾지 못했습니다');

  const entry = manifest[dsId];
  const buf = Buffer.from(entry.data, 'base64');
  const dsFull = entry.compressed ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

  const lStart = dsFull.indexOf('// ui_kits/homepage/Launcher.jsx');
  const lEnd = dsFull.indexOf('// ui_kits/homepage/LauncherTones.jsx');
  if (lStart < 0 || lEnd < lStart) throw new Error('Launcher.jsx 구간을 찾지 못했습니다');
  const launcher = dsFull.slice(lStart, lEnd);

  const tplBlockInitial = extractBlock(html, 'template');
  const tplInitial = JSON.parse(tplBlockInitial.json);

  const alreadyJs = launcher.includes('ilb-mv-frame') && launcher.includes('onClick: goHome');
  const alreadyTplCss = tplInitial.includes(CSS_MARK);
  const alreadyHideCss = html.includes('.ilb-navlist > button:nth-child(7)');

  if (alreadyJs && alreadyTplCss && alreadyHideCss) {
    console.log('이미 뮤직비디오 메뉴(런처 임베드 + 일빵 홈 복귀) 패치가 적용돼 있습니다.');
    return;
  }
  if (check) {
    console.log('뮤직비디오 메뉴(런처 임베드 + 일빵 홈 복귀) 패치가 아직 적용되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  // 1. Launcher.jsx 구간만 치환 (Draft1~5.jsx 미변경)
  let updatedLauncher = launcher;
  if (!alreadyJs) {
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx state/go', OLD_STATE_GO, NEW_STATE_GO);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx root className', OLD_ROOT, NEW_ROOT);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx desktop logo', OLD_LOGO, NEW_LOGO);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx mobile logo', OLD_LOGO_M, NEW_LOGO_M);
    if (updatedLauncher.includes(OLD_NAV_BLOCK_V1)) {
      updatedLauncher = sub(updatedLauncher, 'Launcher.jsx navlist (v1->v2)', OLD_NAV_BLOCK_V1, NEW_NAV_BLOCK);
    } else {
      updatedLauncher = sub(updatedLauncher, 'Launcher.jsx navlist (v0->v2)', OLD_NAV_BLOCK_V0, NEW_NAV_BLOCK);
    }
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx mv iframe', OLD_MAIN_END, NEW_MAIN_END);

    const updatedDs = dsFull.slice(0, lStart) + updatedLauncher + dsFull.slice(lEnd);
    entry.data = zlib.gzipSync(Buffer.from(updatedDs, 'utf8'), { level: 9 }).toString('base64');
    entry.compressed = true;

    const encodedManifest = jsonForScript(manifest);
    html = html.slice(0, manBlock.start) + encodedManifest + html.slice(manBlock.end);
  }

  // 2. template 블록에 임베드 레이아웃 및 로고 포커스/호버 CSS 추가
  if (!alreadyTplCss) {
    const tplBlock = extractBlock(html, 'template');
    let tpl = JSON.parse(tplBlock.json);
    tpl = sub(tpl, 'template ilb-mv css', '</head>', MV_STYLE + '</head>');
    const encodedTpl = jsonForScript(tpl);
    html = html.slice(0, tplBlock.start) + encodedTpl + html.slice(tplBlock.end);
  }

  // 3. 숨김 nth-child CSS를 3..6 -> 4..7 로 갱신 (아직 미적용인 경우)
  if (!alreadyHideCss) {
    const crlf = html.includes('\r\n');
    const oldCss = crlf ? OLD_HIDE_CSS.replace(/\n/g, '\r\n') : OLD_HIDE_CSS;
    const newCss = crlf ? NEW_HIDE_CSS.replace(/\n/g, '\r\n') : NEW_HIDE_CSS;
    html = sub(html, 'ilb-navlist hide css', oldCss, newCss);
  }

  // 4. 되읽기 검증: manifest & template JSON 파싱, JS 구문 검사 및 Draft1~5.jsx 미변경 확인
  const checkMan = JSON.parse(extractBlock(html, 'manifest').json);
  const checkDs = zlib.gunzipSync(Buffer.from(checkMan[dsId].data, 'base64')).toString('utf8');
  new Function(checkDs);
  if (checkDs.split('ilb-mv-frame').length - 1 !== 1) {
    throw new Error('되읽기 검증 실패: ilb-mv-frame 매칭 수가 1이 아닙니다');
  }
  if (checkDs.split('onClick: goHome').length - 1 !== 2) {
    throw new Error('되읽기 검증 실패: ilb-logo / ilb-logo-m goHome 연결이 2건이 아닙니다');
  }
  const checkTpl = JSON.parse(extractBlock(html, 'template').json);
  if (typeof checkTpl !== 'string' || !checkTpl.includes(CSS_MARK)) {
    throw new Error('되읽기 검증 실패: template CSS 파싱 이상');
  }

  fs.writeFileSync(SRC, html, 'utf8');
  fs.copyFileSync(SRC, OUT);

  const hSrc = sha256(fs.readFileSync(SRC));
  const hOut = sha256(fs.readFileSync(OUT));
  if (hSrc !== hOut) throw new Error('동기화 검증 실패: 원본과 index.html 해시 불일치');

  console.log('적용 완료: 런처 틀 유지 뮤직비디오(utubeinfo/) + 왼쪽 위 일빵 홈 복귀');
  console.log(`크기: ${Buffer.byteLength(html, 'utf8')} bytes`);
  console.log(`SHA-256: ${hOut}`);
}

main();
