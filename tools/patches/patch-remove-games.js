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

  // data.js 영역 찾기
  const DSTART = ds.indexOf('// ui_kits/homepage/data.js');
  const DEND = ds.indexOf('// ui_kits/homepage/palettes.js');
  let D = ds.slice(DSTART, DEND);

  // GAMES 배열 수정 - "저잣거리 러너" 부터 끝까지 제거
  if (!D.includes("title: '저잣거리 러너'")) {
    console.log('이미 3~6번 게임이 삭제돼 있습니다.');
    return;
  }

  // "url: 'games/soccer/'\n}, {" 부터 배열 끝(];) 까지 찾기
  // wait, formatting might vary, so let's do a substring replace
  const cutStart = D.indexOf("}, {\n  title: '저잣거리 러너'");
  if (cutStart === -1) throw new Error("저잣거리 러너 를 찾지 못했습니다.");
  const cutEnd = D.indexOf("}];", cutStart);
  if (cutEnd === -1) throw new Error("GAMES 배열의 끝을 찾지 못했습니다.");

  const beforeCut = D.slice(0, cutStart);
  const afterCut = D.slice(cutEnd + 2); // keep "];"

  const newD = beforeCut + "\n}" + afterCut; // closing the soccer object

  ds = ds.slice(0, DSTART) + newD + ds.slice(DEND);

  entry.data = zlib.gzipSync(Buffer.from(ds, 'utf8'), { level: 9 }).toString('base64');
  entry.compressed = true;

  const encoded = JSON.stringify(manifest).replace(/<\//g, '<\\u002F');
  const open = html.indexOf('<script type="__bundler/manifest">');
  const mStart = html.indexOf('>', open) + 1;
  const mEnd = html.indexOf('</script>', mStart);
  let out = html.slice(0, mStart) + encoded + html.slice(mEnd);

  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);
  console.log('적용 완료: 불필요한 3~6번 게임 에셋 삭제');
}

main();
