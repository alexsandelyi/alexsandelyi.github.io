// 일빵 런처: 웹폰트 서브셋 정리.
//  (1) 어디서도 참조되지 않는 Gowun Batang 패밀리 전체 제거
//  (4) 한글도 라틴/기호도 없는 CJK 한자 전용 서브셋 제거 (콘텐츠에 한자 0자)
// 그 뒤 템플릿에서 더 이상 참조되지 않는 매니페스트 항목을 버린다.
//
// 언패커는 Object.keys(manifest) 전체를 돌면서 atob 하고,
// 자산 하나당 650KB 템플릿을 통째로 split/join 한다.
// 즉 자산 개수가 로딩 시간에 그대로 비례한다.
const fs = require('fs');

const path = require('path');
// 어느 디렉터리에서 부르든 저장소 루트의 원본을 잡는다.
const FILE = path.join(__dirname, '..', '..', '일빵-런처-확정안.html');
const DROP_FAMILIES = ['Gowun Batang'];

// 인라인 <script> 안의 JSON은 '</' 를 이스케이프해야 한다 (조기 종료 방지)
function jsonForScript(v) {
  return JSON.stringify(v).replace(/<\//g, '<\\u002F');
}

// 남길 문자 영역: 라틴·기본기호·통화·문자기호 + 한글 전 영역
const KEEP_RANGES = [
  [0x0000, 0x02FF], [0x2000, 0x206F], [0x20A0, 0x20CF], [0x2100, 0x214F], // 라틴·기호
  [0x1100, 0x11FF], [0x3130, 0x318F], [0xA960, 0xA97F],                   // 한글 자모
  [0xAC00, 0xD7A3], [0xD7B0, 0xD7FF],                                     // 한글 음절
];

function parseRanges(block) {
  const m = block.match(/unicode-range:\s*([^;}]+)/);
  if (!m) return null;
  return m[1].split(',').map(x => x.trim()).map(x => {
    const p = x.replace(/^U\+/i, '').split('-');
    if (p[0].includes('?')) {
      return [parseInt(p[0].replace(/\?/g, '0'), 16), parseInt(p[0].replace(/\?/g, 'F'), 16)];
    }
    return [parseInt(p[0], 16), parseInt(p[1] || p[0], 16)];
  });
}

const overlaps = (rs) => rs.some(([a, b]) => KEEP_RANGES.some(([c, d]) => a <= d && c <= b));

let html = fs.readFileSync(FILE, 'utf8');

const tplMatch = html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
let tpl = JSON.parse(tplMatch[1]);
const manMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
const manifest = JSON.parse(manMatch[1]);

const before = { assets: Object.keys(manifest).length, faces: 0, bytes: 0 };
for (const k of Object.keys(manifest)) before.bytes += manifest[k].data.length * 0.75;

const dropped = { family: 0, cjk: 0 };
tpl = tpl.replace(/@font-face\s*\{[\s\S]*?\}\n?/g, (block) => {
  before.faces++;
  const fam = (block.match(/font-family:\s*'([^']+)'/) || [])[1];
  if (DROP_FAMILIES.includes(fam)) { dropped.family++; return ''; }
  const rs = parseRanges(block);
  if (rs && !overlaps(rs)) { dropped.cjk++; return ''; }
  return block;
});

// 남은 템플릿에서 실제로 참조되는 uuid 만 매니페스트에 남긴다.
// (Noto Sans KR 처럼 한 파일을 여러 @font-face 가 공유하는 경우가 있어
//  블록별로 지우면 안 되고 최종 템플릿 기준으로 판단해야 한다)
let removed = 0;
for (const uuid of Object.keys(manifest)) {
  if (!tpl.includes(uuid)) { delete manifest[uuid]; removed++; }
}

const after = { assets: Object.keys(manifest).length, bytes: 0 };
for (const k of Object.keys(manifest)) after.bytes += manifest[k].data.length * 0.75;

// ── 다시 포장 (템플릿이 매니페스트보다 뒤에 있으므로 템플릿 먼저) ──
html = html.slice(0, tplMatch.index) +
       `<script type="__bundler/template">` + jsonForScript(tpl) + `</script>` +
       html.slice(tplMatch.index + tplMatch[0].length);
const man2 = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
html = html.slice(0, man2.index) +
       `<script type="__bundler/manifest">` + jsonForScript(manifest) + `</script>` +
       html.slice(man2.index + man2[0].length);

fs.writeFileSync(FILE, html);

const MB = (n) => (n / 1048576).toFixed(2) + 'MB';
console.log(`@font-face   ${before.faces} → ${before.faces - dropped.family - dropped.cjk}`);
console.log(`  Gowun Batang 제거 ${dropped.family}개 / CJK 한자전용 제거 ${dropped.cjk}개`);
console.log(`자산         ${before.assets} → ${after.assets}개 (${removed}개 제거)`);
console.log(`자산 용량    ${MB(before.bytes)} → ${MB(after.bytes)}`);
console.log(`HTML 파일    ${MB(fs.statSync(FILE).size)}`);
