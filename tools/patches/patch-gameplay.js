#!/usr/bin/env node
// 런처 히어로의 빈 GAMEPLAY IMAGE 영역에 축구 게임플레이 이미지를 연결한다.
// 번들의 내부 자산을 다시 포장하지 않고, 재생 가능한 외부 WebP 경로를 CSS로
// 붙인다. 원본을 수정한 뒤 배포본을 같은 바이트로 동기화한다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const ASSET = 'assets/gameplay/soccer.webp';
const MARK = '/* ilb-gameplay */';
const BASE_STYLE_ANCHOR = '</style>\n<script src="5a7a50a6-3d01-426d-ae06-d7bfd03d53d6"';
const CSS_RULES = `${MARK}
/* 런처 히어로 미디어는 실제 축구 게임플레이 WebP를 외부 자산으로 사용한다. */
.ilb-hero-media{
  background-image:url("${ASSET}") !important;
  background-size:cover !important;
  background-position:center !important;
  background-repeat:no-repeat !important;
  color:transparent !important;
}`;

function sub(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: ${n}건 매칭 (1건이어야 함)`);
  return text.replace(from, to);
}

function extractBlock(html, type) {
  const open = html.indexOf(`<script type="__bundler/${type}">`);
  if (open < 0) throw new Error(`${type} 블록을 찾지 못했습니다.`);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  if (start <= 0 || end < 0) throw new Error(`${type} 블록 경계가 잘못되었습니다.`);
  return { start, end, json: html.slice(start, end) };
}

function validateBundle(html, expectedAsset) {
  const template = extractBlock(html, 'template');
  const templateValue = JSON.parse(template.json);
  if (!templateValue.includes(MARK)) {
    throw new Error('검증 실패: gameplay 패치 표식이 템플릿에 없습니다.');
  }
  if (!templateValue.includes(expectedAsset)) {
    throw new Error('검증 실패: 게임플레이 이미지 경로가 템플릿에 없습니다.');
  }
  if (templateValue.split(MARK).length - 1 !== 1) {
    throw new Error('검증 실패: gameplay 패치 표식이 중복되었습니다.');
  }
  JSON.parse(extractBlock(html, 'manifest').json);
}

function removeMarkedStyle(text) {
  const open = `<style>${MARK}`;
  const start = text.indexOf(open);
  const end = text.indexOf('</style>', start);
  if (start < 0 || end < 0) {
    throw new Error('기존 gameplay 스타일 블록을 찾지 못했습니다.');
  }
  if (text.indexOf(open, start + open.length) >= 0) {
    throw new Error('기존 gameplay 스타일 블록이 중복되었습니다.');
  }
  return text.slice(0, start) + text.slice(end + '</style>'.length);
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(path.join(ROOT, ASSET))) {
    throw new Error(`이미지 자산이 없습니다: ${ASSET}`);
  }

  const html = fs.readFileSync(SRC, 'utf8');
  const template = extractBlock(html, 'template');
  let templateValue = JSON.parse(template.json);

  if (templateValue.includes(MARK) && !process.argv.includes('--repair')) {
    console.log('이미 적용되어 있습니다.');
    validateBundle(html, ASSET);
    if (check) return;
    throw new Error('중복 적용을 막기 위해 중단했습니다.');
  }
  if (check) {
    console.log('아직 적용되지 않았습니다.');
    return;
  }

  if (templateValue.includes(MARK)) {
    templateValue = removeMarkedStyle(templateValue);
  }
  templateValue = sub(
    templateValue,
    BASE_STYLE_ANCHOR,
    `\n${CSS_RULES}\n${BASE_STYLE_ANCHOR}`,
    '게임플레이 이미지 CSS'
  );
  const encoded = JSON.stringify(templateValue).replace(/<\//g, '<\\u002F');
  const out = html.slice(0, template.start) + encoded + html.slice(template.end);

  // 템플릿과 manifest를 다시 파싱해 번들 구조가 유지됐는지 확인한다.
  validateBundle(out, ASSET);
  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);
  console.log('적용 완료');
  console.log('  자산: %s', ASSET);
  console.log('  원본·배포본: %d bytes', Buffer.byteLength(out, 'utf8'));
}

main();
