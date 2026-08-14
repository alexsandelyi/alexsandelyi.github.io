// 런처의 커뮤니티 「글 쓰기」 버튼을 실제 게시판(community/)에 연결한다.
//
// ⚠️ 이 패치는 index.html 번들 **안의 gzip 자산**을 고친다. 원본 도구가
// 번들을 다시 생성하면 사라지므로 재생성 후 다시 돌린다.
// 적용 순서: patch-hanji.js → patch-hero.js → patch-community.js
//
//   node tools/patches/patch-community.js           # 적용하고 index.html 로 복사
//   node tools/patches/patch-community.js --check   # 적용 여부만 보고 종료
//
// patch-gamelink.js 와 같은 방식이다. <button> + onClick 이 아니라
// as:'a' + href 로 두면 새 탭 열기·가운데 클릭·주소 복사가 다 동작한다.
// 이미지 플레이트를 씌우는 외부 패치는 태그가 아니라 글자로 대상을 찾으므로
// <a> 로 바꿔도 버튼 그림은 그대로 유지된다 (플레이 버튼에서 확인된 사실).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');   // tools/patches/ → 저장소 루트
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');

const OLD = `React.createElement(__ds_scope.Button, {
    variant: "secondary",
    size: "sm"
  }, "\\uAE00 \\uC4F0\\uAE30")`;

const NEW = `React.createElement(__ds_scope.Button, {
    as: 'a',
    href: 'community/',
    variant: "secondary",
    size: "sm"
  }, "\\uAE00 \\uC4F0\\uAE30")`;

// 번들에는 **이 네 줄만** 넣는다. 실제 동작은 전부 community/ 안의 파일에
// 있다 — 번들이 재생성되면 이 줄만 다시 넣으면 되고 로직은 손댈 일이 없다.
// defer 로 두는 이유: 런처 React 가 먼저 그려져야 섹션을 찾을 수 있다.
const TAGS = [
  '<link rel="stylesheet" href="community/board.css">',
  '<script src="community/js/01-api.js" defer></script>',
  '<script src="community/js/02-board.js" defer></script>',
  '<script src="community/js/embed.js" defer></script>'
].join('');

function sub(src, label, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 매칭 ${n}건 (1건이어야 함)`);
  return src.split(from).join(to);
}

function main() {
  const check = process.argv.includes('--check');
  let html = fs.readFileSync(SRC, 'utf8');

  const manMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
  if (!manMatch) throw new Error('manifest 를 찾지 못했습니다');
  const manifest = JSON.parse(manMatch[1]);
  const DS_ID = Object.keys(manifest)
    .find(k => manifest[k].mime === 'application/javascript');
  if (!DS_ID) throw new Error('디자인 시스템 자산을 찾지 못했습니다');

  const entry = manifest[DS_ID];
  const buf = Buffer.from(entry.data, 'base64');
  let ds = entry.compressed ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

  if (ds.includes("href: 'community/'")) {
    console.log('이미 적용돼 있습니다.');
    if (check) return;
    throw new Error('중복 적용을 막습니다. 재생성된 원본에서 다시 돌리세요');
  }
  if (check) { console.log('아직 적용되지 않았습니다.'); return; }

  // Launcher.jsx 구간만 고친다. 같은 자산에 Draft1~5.jsx 가 있고 코드가
  // 거의 같아서, 전체로 치환하면 여러 건이 매칭된다.
  const LSTART = ds.indexOf('// ui_kits/homepage/Launcher.jsx');
  const LEND = ds.indexOf('// ui_kits/homepage/LauncherTones.jsx');
  if (LSTART < 0 || LEND < LSTART) throw new Error('Launcher.jsx 구간을 못 찾았습니다');

  let L = ds.slice(LSTART, LEND);
  L = sub(L, '글 쓰기 버튼', OLD, NEW);
  ds = ds.slice(0, LSTART) + L + ds.slice(LEND);

  entry.data = zlib.gzipSync(Buffer.from(ds, 'utf8'), { level: 9 }).toString('base64');
  entry.compressed = true;

  // 다시 포장. JSON.stringify 결과를 인라인 <script> 에 그대로 넣으면
  // </script> 에서 파서가 조기 종료하므로 </ 를 이스케이프한다.
  const encoded = JSON.stringify(manifest).replace(/<\//g, '<\\u002F');
  const open = html.indexOf('<script type="__bundler/manifest">');
  const mStart = html.indexOf('>', open) + 1;
  const mEnd = html.indexOf('</script>', mStart);
  let out = html.slice(0, mStart) + encoded + html.slice(mEnd);

  // 템플릿에 스크립트 네 줄을 넣는다. manifest 를 먼저 바꿔 길이가
  // 달라졌으므로 위치를 **다시 찾는다** — 미리 잰 오프셋을 쓰면 어긋난다.
  const tOpen = out.indexOf('<script type="__bundler/template">');
  const tStart = out.indexOf('>', tOpen) + 1;
  const tEnd = out.indexOf('</script>', tStart);
  let tpl = JSON.parse(out.slice(tStart, tEnd));
  tpl = sub(tpl, '게시판 스크립트', '</head>', TAGS + '</head>');
  const tplEncoded = JSON.stringify(tpl).replace(/<\//g, '<\\u002F');
  out = out.slice(0, tStart) + tplEncoded + out.slice(tEnd);

  // 되읽어 검증 — manifest·template 이 다시 파싱되고 자산이 풀리는지
  const rOpen = out.indexOf('<script type="__bundler/manifest">');
  const rStart = out.indexOf('>', rOpen) + 1;
  const back = JSON.parse(out.slice(rStart, out.indexOf('</script>', rStart)));
  const rd = zlib.gunzipSync(Buffer.from(back[DS_ID].data, 'base64')).toString('utf8');
  if (!rd.includes("href: 'community/'")) throw new Error('되읽기 검증 실패: 링크');
  const vOpen = out.indexOf('<script type="__bundler/template">');
  const vStart = out.indexOf('>', vOpen) + 1;
  const vTpl = JSON.parse(out.slice(vStart, out.indexOf('</script>', vStart)));
  if (!vTpl.includes('community/js/embed.js')) throw new Error('되읽기 검증 실패: 스크립트');

  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);            // 원본과 바이트 동일해야 한다
  console.log('적용 완료');
  console.log('  「글 쓰기」 → community/ 링크 (런처에서는 embed.js 가 가로채 창을 연다)');
  console.log('  게시판 스크립트 4줄 주입');
  console.log('  크기  %d → %d bytes', html.length, out.length);
}

main();
