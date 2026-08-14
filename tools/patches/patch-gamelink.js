// 런처의 '플레이' 버튼을 실제 게임(games/soccer/)에 연결한다.
//
// ⚠️ 이 패치는 index.html 번들 내부를 고친다. 원본 도구가 번들을 다시
// 생성하면 사라진다. 영구 반영은 그쪽 소스에서 GAMES 에 url 을 넣는 것이
// 맞다. (작업 중 두 번 재생성된 이력이 있다)
//
// 버튼은 as:'a' + href 로 만든다. <button> + onClick 이 아니라 링크로 두면
// 새 탭 열기·가운데 클릭·주소 복사가 다 동작한다. 이미지 플레이트를 씌우는
// 외부 패치는 태그가 아니라 글자('플레이')로 대상을 찾으므로
// (선택자: 'button, a, [role="button"], [role="link"]') <a> 로 바꿔도
// 버튼 이미지는 그대로 유지된다.
const fs = require('fs');
const zlib = require('zlib');

const path = require('path');
// 어느 디렉터리에서 부르든 저장소 루트의 원본을 잡는다.
const FILE = path.join(__dirname, '..', '..', '일빵-런처-확정안.html');

function jsonForScript(v) {
  return JSON.stringify(v).replace(/<\//g, '<\\u002F');
}
function sub(src, label, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 매칭 ${n}건 (1건이어야 함)`);
  return src.split(from).join(to);
}

let html = fs.readFileSync(FILE, 'utf8');
const manMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
const manifest = JSON.parse(manMatch[1]);
const DS_ID = Object.keys(manifest).find(k => manifest[k].mime === 'application/javascript');
if (!DS_ID) throw new Error('디자인 시스템 번들을 못 찾음');

const dsFull = zlib.gunzipSync(Buffer.from(manifest[DS_ID].data, 'base64')).toString('utf8');

// ── 1. GAMES 에 실제 게임을 첫 항목으로 넣는다 ────────────────────────
// 첫 항목이 히어로에 기본 노출되므로, 열자마자 동작하는 버튼이 보인다.
let ds = sub(dsFull, 'GAMES', `const GAMES = [{
  title: '저잣거리 러너',`, `const GAMES = [{
  title: '동네 축구',
  genre: '스포츠 · 대전',
  plays: '0',
  author: '@ilbbang',
  url: 'games/soccer/'
}, {
  title: '저잣거리 러너',`);

// ── 2. 플레이 버튼을 링크로 ───────────────────────────────────────────
// url 이 없는 목업 게임은 disabled 로 둔다(투명도 .42 + not-allowed).
// 눌러도 아무 일 없는 버튼보다 '아직 없다'가 드러나는 편이 낫다.
const LSTART = ds.indexOf('// ui_kits/homepage/Launcher.jsx');
const LEND = ds.indexOf('// ui_kits/homepage/palettes.js');
if (LSTART < 0 || LEND < LSTART) throw new Error('Launcher.jsx 구간을 못 찾음');
let L = ds.slice(LSTART, LEND);

L = sub(L, '플레이 버튼', `React.createElement(__ds_scope.Button, {
    iconLeft: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "play",
      size: 18
    })
  }, "\\uD50C\\uB808\\uC774")`, `React.createElement(__ds_scope.Button, {
    as: g.url ? 'a' : 'button',
    href: g.url,
    disabled: !g.url,
    title: g.url ? undefined : '아직 준비 중입니다',
    iconLeft: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "play",
      size: 18
    })
  }, "\\uD50C\\uB808\\uC774")`);

ds = ds.slice(0, LSTART) + L + ds.slice(LEND);

manifest[DS_ID].data = zlib.gzipSync(Buffer.from(ds, 'utf8'), { level: 9 }).toString('base64');

// ── 다시 포장 (매니페스트가 템플릿보다 앞) ─────────────────────────────
const man2 = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
html = html.slice(0, man2.index) +
       `<script type="__bundler/manifest">` + jsonForScript(manifest) + `</script>` +
       html.slice(man2.index + man2[0].length);

fs.writeFileSync(FILE, html);
console.log('OK  →', FILE, (fs.statSync(FILE).size / 1048576).toFixed(2) + 'MB');
