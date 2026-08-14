#!/usr/bin/env node
// 일빵 런처 — 어두운 청자 → 밝은 한지 편집디자인.
//
// index.html 은 외부 도구가 재생성하는 자체 압축 해제 번들이다. 번들 안에
// 손으로 넣은 변경은 다음 재생성 때 사라진다. 그래서 이 스크립트로 만든다 —
// 재생성 뒤 다시 돌리면 같은 변경이 다시 적용된다.
//
//   node tools/patches/patch-hanji.js           # 원본에 적용하고 index.html 로 복사
//   node tools/patches/patch-hanji.js --check   # 적용 여부만 보고 종료
//
// 바꾸는 곳은 번들의 template 블록 하나뿐이다. gzip 자산(cefd19e8)은
// 건드리지 않는다 — 팔레트 선택과 폰트 주입이 template 의 babel 블록에
// 있어서 자산을 다시 포장할 필요가 없다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');   // tools/patches/ → 저장소 루트
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const MARK = '/* ilb-hanji */';           // 중복 적용 감지용

// ── 치환 헬퍼 — 매칭 수를 반드시 확인한다 ──────────────────────────
function sub(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: ${n}건 매칭 (1건이어야 함)`);
  return text.replace(from, to);
}

// ── 1. 폰트 ────────────────────────────────────────────────────────
// AGENTS.md 는 웹폰트 재포함을 금지하지만 이번은 사용자 명시 요청이다.
// Jua / Gowun Dodum / Noto Sans KR / IBM Plex Mono 넷 다 OFL·Apache 다.
const FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2' +
    '?family=Gowun+Dodum' +
    '&family=IBM+Plex+Mono:wght@400' +
    '&family=Jua' +
    '&family=Noto+Sans+KR:wght@300;400;500;700' +
    '&display=swap">'
].join('');

// ── 2. 팔레트 — hanji + 금색 액센트 ────────────────────────────────
// PALETTES 순서: 0 ondol · 1 hanji · 2 noeul · 3 daenamu · 4 cheongja
// hanji 의 나머지 16개 값은 이미 목표와 같아서 액센트 4개만 덮어쓴다.
const OLD_MOUNT = "const P=NS.PALETTES?NS.PALETTES[4]:{vars:{}};";
const NEW_MOUNT = "const P=NS.PALETTES?NS.PALETTES[1]:{vars:{}};";

const OLD_FONTS =
  "'--font-display':'\"Apple SD Gothic Neo\",\"Malgun Gothic\",system-ui,sans-serif'," +
  "'--font-body':'\"Apple SD Gothic Neo\",\"Malgun Gothic\",system-ui,sans-serif'," +
  "'--font-body-strong':'\"Apple SD Gothic Neo\",\"Malgun Gothic\",system-ui,sans-serif'";
const NEW_FONTS =
  "'--font-display':'\"Noto Sans KR\",\"Apple SD Gothic Neo\",sans-serif'," +
  "'--font-body':'\"Gowun Dodum\",\"Apple SD Gothic Neo\",sans-serif'," +
  "'--font-body-strong':'\"Noto Sans KR\",\"Apple SD Gothic Neo\",sans-serif'," +
  "'--font-code':'\"IBM Plex Mono\",ui-monospace,monospace'," +
  // 적색을 전부 빼고 금색 하나만 남긴다.
  "'--accent':'#8E5F06','--accent-hover':'#A87209'," +
  "'--accent-press':'#6E4A04','--accent-soft':'#F5EBD2'";

// ── 3. 한지 편집디자인 CSS ─────────────────────────────────────────
const CSS = `
<style>${MARK}
/* body 는 여전히 옛 청자색(#152528)이라, 지면이 비는 자리마다 어두운
   색이 드러난다. 오버스크롤·짧은 페이지·뷰포트 불일치에서 보인다.
   테마 색도 밝은 쪽으로 알려 주소창 톤이 어긋나지 않게 한다. */
html,body{background:#F4EFE4 !important}

/* ── 지면: 한지 텍스처 ────────────────────────────────────────────
   900px 그대로 반복한다. 축소하면 결이 뭉쳐 선처럼 보인다.
   무손실 WebP 다 — PNG 2.5MB 를 907KB 로 줄였고 픽셀은 완전히 같다.
   손실 압축은 q95 에서도 청색 채널의 결이 11% 평탄해져 쓰지 않았다. */
.ilb-root{
  background-color:#F4EFE4 !important;
  background-image:url("assets/texture/hanji.webp") !important;
  background-repeat:repeat !important;
  background-size:900px 900px !important;
}
/* 텍스처는 지면에만. 미디어 웰·카드 위로 덮지 않는다. */
.ilb-nav,.ilb-topbar,.ilb-rail-item,.ilb-hero-panel,.ilb-post{
  background-image:none !important;
}

/* ── 타이포 ──────────────────────────────────────────────────────
   제목은 굵게 하지 않는다. 크기로 존재감을 낸다. */
.ilb-hero-panel h1,.ilb-hero-panel h2{
  font-family:"Noto Sans KR",sans-serif !important;
  font-weight:300 !important;
  font-size:clamp(40px,4.6vw,68px) !important;
  line-height:1.08 !important;
  letter-spacing:-.035em !important;
  color:#0E0C0B !important;
}
/* 레터링 판(.ilbbang-lettering-heading)은 제외한다. 그 h2 는 글자를
   숨기고 background-image 로 간판을 그리는데, color·font-size 를 씌우면
   숨겨둔 검은 글자가 되살아나 판과 겹친다. 실제로 그렇게 깨뜨렸다. */
.ilb-head h2:not(.ilbbang-lettering-heading){
  font-family:"Noto Sans KR",sans-serif !important;
  font-weight:300 !important;
  font-size:clamp(28px,2.8vw,40px) !important;
  line-height:1.12 !important;
  letter-spacing:-.03em !important;
  color:#0E0C0B !important;
}
/* 판 뒤의 글자는 확실히 감춘다 — 원본이 숨기던 방식이 무엇이든 덮이지
   않게. 스크린리더는 계속 읽는다. */
.ilbbang-lettering-heading{
  color:transparent !important;
  font-size:0 !important;
  line-height:0 !important;
}
.ilb-scroll{font-family:"Gowun Dodum",sans-serif;font-size:16px;line-height:1.72}

/* ── 섹션 헤더: 굵은 룰 ──────────────────────────────────────────
   01·02·03 번호는 뺐다 — 레터링 간판이 이미 섹션을 구분하고, 번호가
   판 왼쪽에 떠서 오히려 어수선했다(사용자 확인). */
.ilb-head{
  align-items:flex-end !important;
  gap:var(--sp-4);
  padding-bottom:12px;
  border-bottom:1px solid #0E0C0B;
  margin-bottom:var(--sp-6) !important;
}
/* space-between 이라 제목이 가운데로 밀렸다. 왼쪽에 01+제목을 붙이고
   마지막 액션만 오른쪽 끝으로 보낸다. */
.ilb-head{justify-content:flex-start !important}
.ilb-head>*:last-child{margin-left:auto}

/* ── 5열: gap 대신 세로 헤어라인 ──────────────────────────────── */
.ilb-rail{gap:1px !important;background:#EAE3D6}
.ilb-rail-item{
  border:0 !important;border-radius:0 !important;
  background:#FCFAF6 !important;
}

/* ── 히어로: 좌 / 세로 룰 / 우 ─────────────────────────────────── */
@media (min-width:1024px){
  .ilb-hero{
    grid-template-columns:1.35fr 1px .95fr !important;
    /* 열 간격 0 - 미디어는 꽉 찬 이미지라 세로 룰 사이로 카드 배경이
       비치면 어긋나 보인다. 룰에 딱 붙이고, 오른쪽 여백은 패널의
       padding 이 만든다. */
    column-gap:0 !important;
    row-gap:0 !important;
    align-items:stretch !important;
  }
  /* 세로 룰. grid-row 를 반드시 준다 — 열만 지정하면 자동 배치가 1행
     col2 로 돌아가지 못하고 2행으로 밀려난다. 그러면 높이 0 짜리
     둘째 행이 생기고 행 간격(32px)이 카드 아래 빈 띠로 남는다. */
  .ilb-hero::after{content:"";display:block;background:#EAE3D6;
    grid-column:2;grid-row:1}
  .ilb-hero>*:last-child{grid-column:3}
}
/* 흰 카드는 .ilb-hero-panel 이 아니라 .ilb-hero 자체가 깔고 있었다.
   지우지 않으면 세로 룰이 흰 바탕에 묻혀 안 보인다. */
.ilb-hero{
  background:transparent !important;
  border-radius:0 !important;
  box-shadow:none !important;
  overflow:visible !important;
}
.ilb-hero-panel{
  background:transparent !important;border:0 !important;
  /* 열 간격을 0 으로 바꿨으므로 세로 룰과의 간격을 여기서 만든다.
     다른 변과 같은 값이라야 글이 가운데 있는 것처럼 보인다. */
  padding-left:var(--sp-8) !important;
}

/* ── 왼쪽 레일: 채운 배경 없이 선만, 활성은 금색 막대 ──────────── */
.ilb-nav{background:transparent !important}
/* 데스크톱에서만 오른쪽 선. 767 이하에서는 하단 탭바가 되므로 위쪽 선만
   남기고 오른쪽 선을 지운다 — 안 지우면 화면 끝에 세로선이 남는다. */
@media (min-width:768px){
  .ilb-nav{border-right:1px solid #EAE3D6 !important}
}
@media (max-width:767px){
  .ilb-nav{
    border-right:0 !important;
    border-top:1px solid #EAE3D6 !important;
  }
  /* 탭바에서는 활성 막대를 왼쪽이 아니라 위쪽에 둔다 */
  .ilb-navlist>button[style*="var(--accent)"]::before{
    left:22% !important;right:22% !important;
    top:0 !important;bottom:auto !important;
    width:auto !important;height:3px !important;
  }
}
/* 레일 항목은 button 이고 활성 여부를 aria 가 아니라 인라인
   background:var(--accent) 로만 표시한다. 그래서 그 인라인 값을 선택자로
   쓴다 — 채움을 지우고 왼쪽 3px 금색 막대로 바꾼다. */
.ilb-navlist>button{position:relative;border-radius:0 !important}
.ilb-navlist>button[style*="var(--accent)"]{
  background:transparent !important;
}
.ilb-navlist>button[style*="var(--accent)"]::before{
  content:"";position:absolute;left:0;top:14%;bottom:14%;
  width:3px;background:#8E5F06;
}
/* 아이콘은 svg 가 아니라 mask-image + background 색이다. 활성 아이콘이
   background:var(--accent-fg)(흰색)라, 금색 판을 없애면 한지 지면에
   흰 글씨가 되어 사라진다. 배경색을 금색으로 바꿔야 보인다. */
.ilb-navlist>button[style*="var(--accent)"]>span{
  background:#8E5F06 !important;
}

/* ── 히어로 페이저: 점 → 01 02 03 + 헤어라인 ────────────────────
   페이저는 자식 없는 button 이라 ::before 로 숫자를 넣을 수 있다.
   덕분에 gzip 자산을 다시 포장하지 않아도 된다. 활성 여부는 인라인
   background:var(--accent) 로만 구분되므로 그걸 선택자로 쓴다. */
.ilb-hero-panel div:has(> button[style*="--r-pill"]){
  counter-reset:ilbpg;
  gap:20px !important;
  align-items:center !important;
  border-top:1px solid #EAE3D6;
  padding-top:12px;
  margin-top:24px !important;
}
.ilb-hero-panel button[style*="--r-pill"]{
  counter-increment:ilbpg;
  width:auto !important;height:auto !important;
  min-width:0 !important;padding:0 !important;
  background:transparent !important;border-radius:0 !important;
  font-family:"IBM Plex Mono",monospace;
  font-size:13px;letter-spacing:.14em;line-height:1;
  color:#8A8177;position:relative;
}
.ilb-hero-panel button[style*="--r-pill"]::before{
  content:counter(ilbpg,decimal-leading-zero);
}
.ilb-hero-panel button[style*="--r-pill"][style*="var(--accent)"]{
  color:#8E5F06 !important;
}
.ilb-hero-panel button[style*="--r-pill"][style*="var(--accent)"]::after{
  content:"";position:absolute;left:0;right:0;bottom:-13px;
  height:2px;background:#8E5F06;
}

/* ── 간격 ────────────────────────────────────────────────────────── */
/* 읽는 영역 상한 1440 → 1760px (2026-08-05 사용자 결정).
   1920 에서 좌우 여백이 194px → 34px 로 줄고 히어로가 1425 → 1716px 이
   된다. 상한을 아주 없애지는 않는다 — 2560 같은 초광폭에서 히어로
   미디어가 높이 상한(440px) 때문에 2.7:1 로 납작해진다. */
@media (min-width:1024px){
  .ilb-scroll{gap:96px !important}
  .ilb-topbar,.ilb-scroll{
    padding-left:max(56px,calc((100% - 1760px) / 2)) !important;
    padding-right:max(56px,calc((100% - 1760px) / 2)) !important;
  }
}

/* ── 표면: 은은한 그림자 ───────────────────────────────────────── */
.ilb-hero-media,.ilb-rail-item{
  box-shadow:0 4px 12px rgba(36,30,25,.08);
}
/* 도장 그림자는 커뮤니티 목록 한 곳에만 */
.ilb-post{
  border:1.5px solid #241E19 !important;
  border-radius:0 !important;
  box-shadow:4px 4px 0 #241E19 !important;
  background:#FCFAF6 !important;
}

/* ── 간판 플레이트: 밝은 지면에서 뜨도록 그림자만 ───────────────
   어두운 배경에 그려진 그림이라 판을 깔지 않고 그림자로 띄운다.
   레터링은 자체 외곽선이 있어 그림자를 주지 않는다. */
/* 플레이트는 img 가 아니라 background-image 를 쓰는 .ilbbang-asset-* 다.
   실측 크기(play 132×44 등)는 원본 규칙이 이미 잡고 있으므로 건드리지
   않고 그림자·상호작용만 얹는다. */
.ilbbang-asset-button{
  transition:transform .15s ease,filter .15s ease;
  filter:drop-shadow(0 3px 8px rgba(36,30,25,.3));
}
/* 헤더·레일의 작은 플레이트는 그림자를 약하게.
   선택된 탭은 원본이 청자 액센트(#F58A5E) 글로우를 걸어둔다. 더 구체적인
   선택자라 !important 로 눌러야 밝은 지면의 금색 톤과 어긋나지 않는다. */
.ilbbang-asset-nav,.ilbbang-asset-view-all,
.ilbbang-asset-nav.is-selected{
  filter:drop-shadow(0 2px 6px rgba(36,30,25,.26)) !important;
}
.ilbbang-asset-nav.is-selected{
  filter:drop-shadow(0 2px 7px rgba(142,95,6,.34)) brightness(1.06) !important;
}
.ilbbang-asset-button:hover{
  transform:translateY(-2px);
  filter:drop-shadow(0 4px 10px rgba(36,30,25,.32)) brightness(1.08) saturate(1.06);
}
.ilbbang-asset-button:active{transform:translateY(1px) scale(.985)}
/* 레터링은 자체 외곽선이 있어 밝은 지면에서도 읽힌다 — 그림자·판 없음 */
.ilbbang-lettering-heading{filter:none !important;background-color:transparent !important}
</style>`;

// ── 실행 ────────────────────────────────────────────────────────────
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

  tpl = sub(tpl, OLD_MOUNT, NEW_MOUNT, '팔레트 cheongja→hanji');
  tpl = sub(tpl, OLD_FONTS, NEW_FONTS, '폰트·액센트 변수');
  const META = '<meta name="theme-color" content="#F4EFE4">';
  tpl = sub(tpl, '</head>', META + FONT_LINKS + CSS + '</head>', '폰트 링크와 테마 CSS');

  // JSON.stringify 결과를 인라인 <script> 에 그대로 넣으면 </script> 에서
  // 파서가 조기 종료해 번들이 깨진다. </ 를 반드시 이스케이프한다.
  const encoded = JSON.stringify(tpl).replace(/<\//g, '<\\u002F');
  const out = html.slice(0, start) + encoded + html.slice(end);

  // 되읽어 검증 — 템플릿·manifest 가 다시 파싱되는지
  const round = extractTemplate(out);
  const back = JSON.parse(round.json);
  if (!back.includes(MARK)) throw new Error('되읽기 검증 실패: 표식이 없습니다');
  const mo = out.indexOf('<script type="__bundler/manifest">');
  const ms = out.indexOf('>', mo) + 1, me = out.indexOf('</script>', ms);
  JSON.parse(out.slice(ms, me));

  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);            // 원본과 바이트 동일해야 한다
  console.log('적용 완료');
  console.log('  팔레트  cheongja → hanji, 액센트 적색 → 금색 #8E5F06');
  console.log('  폰트    Noto Sans KR / Gowun Dodum / IBM Plex Mono / Jua');
  console.log('  텍스처  assets/texture/hanji.png 900px 반복');
  console.log('  크기    %d → %d bytes', html.length, out.length);
}

main();
