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

function main() {
  let html = fs.readFileSync(SRC, 'utf8');

  const manMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
  if (!manMatch) throw new Error('manifest 를 찾지 못했습니다');
  const manifest = JSON.parse(manMatch[1]);
  const DS_ID = Object.keys(manifest)
    .find(k => manifest[k].mime === 'application/javascript');

  const entry = manifest[DS_ID];
  const buf = Buffer.from(entry.data, 'base64');
  let ds = entry.compressed ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

  if (ds.includes("'shopping-bag'")) {
    console.log('이미 링크 아이콘 패치가 적용돼 있습니다.');
    // We will just proceed to rewrite it to be safe, or we can just bypass
  }

  const LSTART = ds.indexOf('// ui_kits/homepage/Launcher.jsx');
  const LEND = ds.indexOf('// ui_kits/homepage/LauncherTones.jsx');
  let L = ds.slice(LSTART, LEND);

  // 사이드바 아이콘 배열 수정 (아이콘만 추가, SECS는 건드리지 않음)
  // 이전 패치 상태일 수도 있으니 안전하게 치환
  L = L.replace(
    /\s*\[\s*\['gamepad-2',\s*'게임'\].*?\]\.map/, 
    " [['gamepad-2', '게임'], ['shopping-bag', 'links_page'], ['clapperboard', '케이 무비'], ['music', '케이 팝'], ['users', '커뮤니티'], ['settings', null]].map"
  );
  
  // onClick 래핑: sec === 'links_page' 이면 이동
  L = L.replace(
    /onClick:\s*\(\)\s*=>\s*sec\s*&&\s*go\(sec\)/,
    "onClick: () => sec === 'links_page' ? (window.location.href = 'links.html') : (sec && go(sec))"
  );

  // 이전 패치로 들어갔던 sec-links 제거 (존재한다면)
  if (L.includes('id: "sec-links"')) {
    L = L.replace(/\/\*#__PURE__\*\/React\.createElement\("section", {\s*id: "sec-links"[\s\S]*?(?=\/\*#__PURE__\*\/React\.createElement\("section", {\s*id: "sec-kmovie")/m, '');
  }
  
  // SECS 배열 원래대로 복구 (이전 패치 롤백)
  L = L.replace(
    /const SECS = \[\['게임', 'sec-game'\], \['추천 아이템', 'sec-links'\], \['케이 무비', 'sec-kmovie'\], \['케이 팝', 'sec-kpop'\], \['커뮤니티', 'sec-community'\]\];/,
    "const SECS = [['게임', 'sec-game'], ['케이 무비', 'sec-kmovie'], ['케이 팝', 'sec-kpop'], ['커뮤니티', 'sec-community']];"
  );

  ds = ds.slice(0, LSTART) + L + ds.slice(LEND);

  entry.data = zlib.gzipSync(Buffer.from(ds, 'utf8'), { level: 9 }).toString('base64');
  entry.compressed = true;

  const encoded = JSON.stringify(manifest).replace(/<\//g, '<\\u002F');
  const open = html.indexOf('<script type="__bundler/manifest">');
  const mStart = html.indexOf('>', open) + 1;
  const mEnd = html.indexOf('</script>', mStart);
  let out = html.slice(0, mStart) + encoded + html.slice(mEnd);

  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);
  console.log('적용 완료: 추천 아이템 링크 섹션 패치');
}

main();
