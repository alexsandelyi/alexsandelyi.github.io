#!/usr/bin/env node
// 일빵 런처: 좌측 레일(모바일 하단 탭바)의 게임 아이콘 바로 아래에
// 뮤직비디오(utubeinfo/) 메뉴 아이콘(lucide 'youtube')을 추가한다.
//
//   node tools/patches/patch-musicvideo.js           # 원본에 적용하고 index.html 로 복사
//   node tools/patches/patch-musicvideo.js --check   # 적용 여부만 보고 종료

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');

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

const OLD_NAV_BLOCK =
  `  }, [['gamepad-2', '게임'], ['shopping-bag', 'links_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    onClick: () => sec === 'links_page' ? (window.location.href = 'links.html') : (sec && go(sec)),`;

const NEW_NAV_BLOCK =
  `  }, [['gamepad-2', '게임'], ['youtube', 'mv_page'], ['shopping-bag', 'links_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map(([n, sec]) => /*#__PURE__*/React.createElement("button", {\n` +
  `    key: n,\n` +
  `    title: sec === 'mv_page' ? '뮤직비디오' : sec === 'links_page' ? '추천 아이템' : (sec || undefined),\n` +
  `    'aria-label': sec === 'mv_page' ? '뮤직비디오' : sec === 'links_page' ? '추천 아이템' : (sec || undefined),\n` +
  `    onClick: () => sec === 'mv_page' ? (window.location.href = 'utubeinfo/') : sec === 'links_page' ? (window.location.href = 'links.html') : (sec && go(sec)),`;

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

  const alreadyJs = launcher.includes("'mv_page'");
  const alreadyCss = html.includes('.ilb-navlist > button:nth-child(7)');
  if (alreadyJs && alreadyCss) {
    console.log('이미 뮤직비디오 메뉴 패치가 적용돼 있습니다.');
    return;
  }
  if (check) {
    console.log('뮤직비디오 메뉴 패치가 아직 적용되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  // 1. Launcher.jsx 구간만 치환 (Draft1~5.jsx 미변경)
  const updatedLauncher = sub(launcher, 'Launcher.jsx navlist', OLD_NAV_BLOCK, NEW_NAV_BLOCK);
  const updatedDs = dsFull.slice(0, lStart) + updatedLauncher + dsFull.slice(lEnd);
  entry.data = zlib.gzipSync(Buffer.from(updatedDs, 'utf8'), { level: 9 }).toString('base64');
  entry.compressed = true;

  // 2. manifest 재포장 (</ 이스케이프)
  const encodedManifest = jsonForScript(manifest);
  html = html.slice(0, manBlock.start) + encodedManifest + html.slice(manBlock.end);

  // 3. 숨김 nth-child CSS를 3..6 -> 4..7 로 갱신 (게임, 뮤직비디오, 추천아이템 3개 표시)
  // CRLF/LF 줄바꿈 차이에 안전하게 대응
  const crlf = html.includes('\r\n');
  const oldCss = crlf ? OLD_HIDE_CSS.replace(/\n/g, '\r\n') : OLD_HIDE_CSS;
  const newCss = crlf ? NEW_HIDE_CSS.replace(/\n/g, '\r\n') : NEW_HIDE_CSS;
  html = sub(html, 'ilb-navlist hide css', oldCss, newCss);

  // 4. 되읽기 검증: manifest & template JSON 파싱 확인
  const checkMan = JSON.parse(extractBlock(html, 'manifest').json);
  const checkDs = zlib.gunzipSync(Buffer.from(checkMan[dsId].data, 'base64')).toString('utf8');
  if (!checkDs.includes("window.location.href = 'utubeinfo/'")) {
    throw new Error('되읽기 검증 실패: utubeinfo/ 링크가 없습니다');
  }
  const checkTpl = JSON.parse(extractBlock(html, 'template').json);
  if (typeof checkTpl !== 'string' || !checkTpl.includes('ilb-navlist')) {
    throw new Error('되읽기 검증 실패: template 파싱 이상');
  }

  fs.writeFileSync(SRC, html, 'utf8');
  fs.writeFileSync(OUT, html, 'utf8');
  console.log('적용 완료: 좌측 레일 뮤직비디오(utubeinfo/) 메뉴 아이콘 추가');
  console.log(`크기: ${html.length} bytes`);
}

main();
