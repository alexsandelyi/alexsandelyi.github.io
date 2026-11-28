#!/usr/bin/env node
// 일빵 런처: 게임 섹션(#sec-game)을 01/02 캐러셀 전환 대신
// 과일 친구 매치 3 아래에 동네 축구가 바로 이어지는 위아래 2단 목록으로 표시한다.
//
//   node tools/patches/patch-game-stack.js           # 원본에 적용하고 index.html 로 복사
//   node tools/patches/patch-game-stack.js --check   # 적용 여부만 보고 종료

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const CSS_MARK = '/* ilb-game-stack */';

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

const OLD_GAME_VAR =
  `  const [i, setI] = React.useState(0);\n` +
  `  const g = __ds_scope.GAMES[i];`;

const NEW_GAME_VAR =
  `  const [i, setI] = React.useState(0);`;

const OLD_SEC_GAME =
  `  }, /*#__PURE__*/React.createElement("section", {\n` +
  `    id: "sec-game"\n` +
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero",\n` +
  `    style: {\n` +
  `      borderRadius: 'var(--r-xl)',\n` +
  `      overflow: 'hidden',\n` +
  `      border: 'var(--bw-hair) solid var(--border-subtle)',\n` +
  `      background: 'var(--bg-raised)',\n` +
  `      display: 'grid',\n` +
  `      gridTemplateColumns: '1fr 400px'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero-media " + (g.url === 'games/match3/' ? 'ilb-hero-media-match3' : ''),\n` +
  `    style: {\n` +
  `      aspectRatio: '16/9',\n` +
  `      background: 'var(--media)',\n` +
  `      display: 'grid',\n` +
  `      placeItems: 'center',\n` +
  `      font: 'var(--text-label)',\n` +
  `      letterSpacing: 'var(--tr-widest)',\n` +
  `      color: 'var(--text-faint)'\n` +
  `    }\n` +
  `  }, "GAMEPLAY IMAGE"), /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero-panel",\n` +
  `    style: {\n` +
  `      padding: 'var(--sp-8)',\n` +
  `      display: 'grid',\n` +
  `      alignContent: 'center',\n` +
  `      gap: 'var(--sp-4)'\n` +
  `    }\n` +
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
  `  }, "\\uC800\\uC7A5")), /*#__PURE__*/React.createElement("div", {\n` +
  `    style: {\n` +
  `      display: 'flex',\n` +
  `      gap: 'var(--sp-2)',\n` +
  `      marginTop: 'var(--sp-4)'\n` +
  `    }\n` +
  `  }, __ds_scope.GAMES.map((x, k) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: x.title,\n` +
  `    onClick: () => setI(k),\n` +
  `    style: {\n` +
  `      width: k === i ? 36 : 10,\n` +
  `      height: 10,\n` +
  `      borderRadius: 'var(--r-pill)',\n` +
  `      border: 'none',\n` +
  `      cursor: 'pointer',\n` +
  `      background: k === i ? 'var(--accent)' : 'var(--chip-off)',\n` +
  `      transition: 'var(--t-control)'\n` +
  `    }\n` +
  `  })))))), /*#__PURE__*/React.createElement("section", {`;

const NEW_SEC_GAME =
  `  }, /*#__PURE__*/React.createElement("section", {\n` +
  `    id: "sec-game",\n` +
  `    className: "ilb-game-stack"\n` +
  `  }, __ds_scope.GAMES.map(g => /*#__PURE__*/React.createElement("div", {\n` +
  `    key: g.url || g.title,\n` +
  `    className: "ilb-hero",\n` +
  `    style: {\n` +
  `      borderRadius: 'var(--r-xl)',\n` +
  `      overflow: 'hidden',\n` +
  `      border: 'var(--bw-hair) solid var(--border-subtle)',\n` +
  `      background: 'var(--bg-raised)',\n` +
  `      display: 'grid',\n` +
  `      gridTemplateColumns: '1fr 400px'\n` +
  `    }\n` +
  `  }, /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero-media " + (g.url === 'games/match3/' ? 'ilb-hero-media-match3' : ''),\n` +
  `    style: {\n` +
  `      aspectRatio: '16/9',\n` +
  `      background: 'var(--media)',\n` +
  `      display: 'grid',\n` +
  `      placeItems: 'center',\n` +
  `      font: 'var(--text-label)',\n` +
  `      letterSpacing: 'var(--tr-widest)',\n` +
  `      color: 'var(--text-faint)'\n` +
  `    }\n` +
  `  }, "GAMEPLAY IMAGE"), /*#__PURE__*/React.createElement("div", {\n` +
  `    className: "ilb-hero-panel",\n` +
  `    style: {\n` +
  `      padding: 'var(--sp-8)',\n` +
  `      display: 'grid',\n` +
  `      alignContent: 'center',\n` +
  `      gap: 'var(--sp-4)'\n` +
  `    }\n` +
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
  `  }, "\\uC800\\uC7A5")))))), /*#__PURE__*/React.createElement("section", {`;

const STACK_STYLE = `<style>${CSS_MARK}
#sec-game.ilb-game-stack{
  display:grid;
  gap:28px;
}
.ilb-hero-panel{
  word-break:keep-all;
}
.ilb-hero-panel>.ilb-hero-actions{
  display:flex !important;
}
@media (min-width:1024px){
  .ilb-scroll{
    padding-top:24px !important;
    padding-bottom:40px !important;
  }
  #sec-game.ilb-game-stack .ilb-hero-media{
    height:clamp(236px,34vh,340px) !important;
  }
}
@media (min-width:768px) and (max-width:1023px){
  #sec-game.ilb-game-stack{
    gap:28px;
  }
  #sec-game.ilb-game-stack .ilb-hero-media{
    height:min(34vh,280px) !important;
  }
}
@media (max-width:767px){
  #sec-game.ilb-game-stack{
    gap:24px;
  }
}
</style>`;

function normalizeMarkedStyle(tpl) {
  const pos = tpl.indexOf(CSS_MARK);
  if (pos < 0) return sub(tpl, 'template ilb-game-stack css', '</head>', STACK_STYLE + '</head>');
  const open = tpl.lastIndexOf('<style>', pos);
  const close = tpl.indexOf('</style>', pos);
  if (open < 0 || close < 0) throw new Error('기존 ilb-game-stack 스타일 경계를 찾지 못했습니다');
  return tpl.slice(0, open) + STACK_STYLE + tpl.slice(close + '</style>'.length);
}

function main() {
  const check = process.argv.includes('--check');
  let html = fs.readFileSync(SRC, 'utf8');

  const manBlock = extractBlock(html, 'manifest');
  const manifest = JSON.parse(manBlock.json);
  const dsId = Object.keys(manifest).find(k => {
    if (manifest[k].mime !== 'application/javascript') return false;
    const s = zlib.gunzipSync(Buffer.from(manifest[k].data, 'base64')).toString('utf8');
    return s.includes('// ui_kits/homepage/Launcher.jsx');
  });
  if (!dsId) throw new Error('Launcher.jsx 번들을 찾지 못했습니다');

  const entry = manifest[dsId];
  const buf = Buffer.from(entry.data, 'base64');
  const dsFull = entry.compressed ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

  const lStart = dsFull.indexOf('// ui_kits/homepage/Launcher.jsx');
  const lEnd = dsFull.indexOf('// ui_kits/homepage/LauncherTones.jsx');
  if (lStart < 0 || lEnd < lStart) throw new Error('Launcher.jsx 구간을 찾지 못했습니다');
  const launcher = dsFull.slice(lStart, lEnd);

  const tplBlockInitial = extractBlock(html, 'template');
  const tplInitial = JSON.parse(tplBlockInitial.json);

  const alreadyJs = launcher.includes('className: "ilb-game-stack"') && launcher.includes('className: "ilb-hero-actions"');
  const alreadyCss = tplInitial.includes(STACK_STYLE);

  if (alreadyJs && alreadyCss) {
    console.log('이미 게임 2단 한눈에 보기 패치가 적용돼 있습니다.');
    return;
  }
  if (check) {
    console.log('게임 2단 한눈에 보기 패치가 아직 적용되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  // 1. Launcher.jsx 구간만 치환 (Draft1~5.jsx 미변경)
  let updatedLauncher = launcher;
  if (!alreadyJs) {
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx game var', OLD_GAME_VAR, NEW_GAME_VAR);
    updatedLauncher = sub(updatedLauncher, 'Launcher.jsx sec-game stack', OLD_SEC_GAME, NEW_SEC_GAME);

    const updatedDs = dsFull.slice(0, lStart) + updatedLauncher + dsFull.slice(lEnd);
    entry.data = zlib.gzipSync(Buffer.from(updatedDs, 'utf8'), { level: 9 }).toString('base64');
    entry.compressed = true;

    const encodedManifest = jsonForScript(manifest);
    html = html.slice(0, manBlock.start) + encodedManifest + html.slice(manBlock.end);
  }

  // 2. template 블록에 2단 간격·높이 CSS 반영 (기존 블록이 다르면 갱신)
  if (!alreadyCss) {
    const tplBlock = extractBlock(html, 'template');
    let tpl = JSON.parse(tplBlock.json);
    tpl = normalizeMarkedStyle(tpl);
    const encodedTpl = jsonForScript(tpl);
    html = html.slice(0, tplBlock.start) + encodedTpl + html.slice(tplBlock.end);
  }

  // 3. 되읽기 검증: manifest & template JSON 파싱, JS 구문 검사 및 Draft1~5.jsx 미변경 확인
  const checkMan = JSON.parse(extractBlock(html, 'manifest').json);
  const checkDs = zlib.gunzipSync(Buffer.from(checkMan[dsId].data, 'base64')).toString('utf8');
  new Function(checkDs);
  const checkLStart = checkDs.indexOf('// ui_kits/homepage/Launcher.jsx');
  const checkLEnd = checkDs.indexOf('// ui_kits/homepage/LauncherTones.jsx');
  if (checkDs.slice(0, checkLStart) !== dsFull.slice(0, lStart) || checkDs.slice(checkLEnd) !== dsFull.slice(lEnd)) {
    throw new Error('되읽기 검증 실패: Launcher.jsx 외 구간이 변경되었습니다');
  }
  const checkLauncher = checkDs.slice(checkLStart, checkLEnd);
  if (checkLauncher.split('className: "ilb-game-stack"').length - 1 !== 1) {
    throw new Error('되읽기 검증 실패: ilb-game-stack 매칭 수가 1이 아닙니다');
  }
  if (checkLauncher.includes('onClick: () => setI(k)')) {
    throw new Error('되읽기 검증 실패: 01/02 페이저 버튼이 남아 있습니다');
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

  console.log('적용 완료: 게임 섹션 위아래 2단 한눈에 보기 (과일 친구 매치 3 + 동네 축구)');
  console.log(`크기: ${Buffer.byteLength(html, 'utf8')} bytes`);
  console.log(`SHA-256: ${hOut}`);
}

main();
