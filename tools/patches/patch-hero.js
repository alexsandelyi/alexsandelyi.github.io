#!/usr/bin/env node
// 일빵 런처 히어로 정리 — 배지·저장 버튼·게임 번호 숨김.
//
// index.html 은 외부 도구가 재생성하는 자체 압축 해제 번들이다. 손으로 넣은
// 변경은 다음 재생성 때 사라지므로 이 스크립트로 만든다 — 재생성 뒤 다시
// 돌리면 같은 변경이 다시 적용된다. patch-hanji.js 다음에 돌린다.
//
//   node tools/patches/patch-hero.js           # 원본에 적용하고 index.html 로 복사
//   node tools/patches/patch-hero.js --check   # 적용 여부만 보고 종료
//
// 왜 CSS 인가: 지울 대상 셋이 전부 표시용이고, 마크업은 gzip 자산
// (cefd19e8) 안의 Launcher.jsx 에 있다. 자산을 다시 포장하면 위험이 큰데
// 얻는 게 없다 — template 블록에 규칙 몇 줄이면 끝난다.
//
// **게임 번호(01~05)는 숨기는 것이 기능적으로도 맞다.** 자동 순환은 없지만
// 3번을 누르면 존재하지 않는 「탈춤 배틀」로 바뀐다. 지금 게임은 하나다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');   // tools/patches/ → 저장소 루트
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const MARK = '/* ilb-hero */';            // 중복 적용 감지용

const CSS = `
<style>${MARK}
/* 히어로 정리 — 게임이 하나뿐이라 없는 것을 가리킨다.
   구조: .ilb-hero-panel > [배지] [제목] [부제] [버튼줄] [번호줄] */

/* 1. 「이번 주 추천」 배지 — 추천할 다른 게임이 없다 */
.ilb-hero-panel > span:first-child { display: none !important; }

/* 2. 「저장」 버튼 — 저장 기능이 없다 */
.ilb-hero-panel .ilbbang-asset-save { display: none !important; }

/* 3. 01~05 번호 — 2~5번은 없는 게임이라 누르면 빈 화면으로 간다.
      버튼만 든 마지막 줄이라 :last-child 로 잡는다. */
.ilb-hero-panel > div:last-child { display: none !important; }

/* 4. 부제에서 장르만 남긴다 — 「· 대전 · @ilbbang · 0 플레이」 제거.
      이 줄은 텍스트 노드 6개(장르·구분점·작성자·구분점·플레이수·"플레이")가
      이어 붙은 것이라 CSS 로 일부만 가릴 수 없다. 줄 전체를 감추고 장르를
      다시 얹는다.
      visibility 를 쓰는 이유: 글자 크기·색을 부모에서 그대로 물려받아
      테마가 바뀌어도 따라간다. font-size:0 이나 color:transparent 로 하면
      값을 여기 박아야 하고 한지 팔레트와 어긋난다.
      **글자는 코드에 박혀 있다.** 게임이 늘면 이 규칙을 걷어내야 한다. */
.ilb-hero-panel > div:nth-child(3) { position: relative; visibility: hidden; }
.ilb-hero-panel > div:nth-child(3)::before {
  content: '스포츠';
  visibility: visible;
  position: absolute;
  left: 0;
  top: 0;
}

/* 저장이 빠져 플레이 버튼만 남으므로 줄을 왼쪽으로 모은다 */
.ilb-hero-panel .ilbbang-asset-play { margin-right: 0; }

/* 5. 커뮤니티 섹션의 하드코딩된 가짜 글 3개.
      번들에 박힌 더미라 실제 게시판(/community/)과 아무 관계가 없고,
      눌러도 아무 데도 가지 않는다. 게임 번호 01~05 와 같은 문제다.
      들어가는 길은 「글 쓰기」 버튼이 맡는다 (patch-community.js).

      진짜 글은 community/js/embed.js 가 같은 자리에 그린다. 그 카드에도
      런처 모양을 입히려고 .ilb-post 를 함께 주므로, **:not(.cb-post) 로
      더미만 골라야 한다** — 안 그러면 진짜 글까지 같이 숨어서 섹션이
      제목만 남는다 (실제로 그렇게 만들었다가 잡았다).

      embed.js 가 더미를 DOM 에서 지우기도 하지만 이 규칙은 남긴다.
      스크립트가 못 뜨는 경우에도 가짜 글이 보이면 안 된다. */
#sec-community .ilb-post:not(.cb-post) { display: none !important; }
</style>`;

// ── 치환 헬퍼 — 매칭 수를 반드시 확인한다 ──────────────────────────
function sub(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: ${n}건 매칭 (1건이어야 함)`);
  return text.replace(from, to);
}

function extractTemplate(html) {
  const open = html.indexOf('<script type="__bundler/template">');
  if (open < 0) throw new Error('template 블록을 찾지 못했습니다');
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  return { start, end, json: html.slice(start, end) };
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(SRC, 'utf8');
  const { start, end, json } = extractTemplate(html);
  let tpl = JSON.parse(json);

  if (tpl.includes(MARK)) {
    console.log('이미 적용돼 있습니다.');
    if (check) return;
    throw new Error('중복 적용을 막습니다. 재생성된 원본에서 다시 돌리세요');
  }
  if (check) { console.log('아직 적용되지 않았습니다.'); return; }

  // 한지 패치가 먼저 들어가 있어야 클래스와 변수가 맞는다.
  if (!tpl.includes('/* ilb-hanji */')) {
    throw new Error('patch-hanji.js 를 먼저 돌리세요');
  }

  tpl = sub(tpl, '</head>', CSS + '</head>', '히어로 정리 CSS');

  // JSON.stringify 결과를 인라인 <script> 에 그대로 넣으면 </script> 에서
  // 파서가 조기 종료해 번들이 깨진다. </ 를 반드시 이스케이프한다.
  const encoded = JSON.stringify(tpl).replace(/<\//g, '<\\u002F');
  const out = html.slice(0, start) + encoded + html.slice(end);

  // 되읽어 검증 — 템플릿·manifest 가 다시 파싱되는지
  const round = extractTemplate(out);
  if (!JSON.parse(round.json).includes(MARK)) {
    throw new Error('되읽기 검증 실패: 표식이 없습니다');
  }
  const mo = out.indexOf('<script type="__bundler/manifest">');
  const ms = out.indexOf('>', mo) + 1, me = out.indexOf('</script>', ms);
  JSON.parse(out.slice(ms, me));

  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);            // 원본과 바이트 동일해야 한다
  console.log('적용 완료');
  console.log('  숨김  「이번 주 추천」배지 / 「저장」버튼 / 01~05 번호');
  console.log('  크기  %d → %d bytes', html.length, out.length);
}

main();
