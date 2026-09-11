#!/usr/bin/env node
// Keep the launcher carousel controls visible after Match 3 is added.
// patch-hero.js hid this row while the catalog had one live game.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const MARK = '/* ilb-match3 */';
const RULES = `${MARK}
/* Match 3 adds a second live game, so the hero carousel must remain usable. */
.ilb-hero-panel > div:last-child { display: flex !important; }
/* The catalog now has more than one genre; keep the live metadata visible. */
.ilb-hero-panel > div:nth-child(3) { visibility: visible !important; }
.ilb-hero-panel > div:nth-child(3)::before { content: none !important; }
`;

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

function block(html) {
  const open = '<script type="__bundler/template">';
  const start = html.indexOf(open);
  if (start < 0) throw new Error('template 블록을 찾지 못했습니다.');
  const bodyStart = start + open.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) throw new Error('template 블록의 끝을 찾지 못했습니다.');
  return { start, end: end + '</script>'.length, bodyStart, end, value: JSON.parse(html.slice(bodyStart, end)) };
}

function validate(html) {
  const template = block(html);
  if (template.value.split(MARK).length - 1 !== 1) throw new Error('Match 3 스타일 표식이 정확히 한 번이어야 합니다.');
  if (!template.value.includes('display: flex !important')) throw new Error('Match 3 캐러셀 스타일을 찾지 못했습니다.');
  if (!template.value.includes('visibility: visible !important')) throw new Error('Match 3 장르 표시 스타일을 찾지 못했습니다.');
  const manifestOpen = '<script type="__bundler/manifest">';
  const manifestStart = html.indexOf(manifestOpen);
  if (manifestStart < 0) throw new Error('manifest 블록을 찾지 못했습니다.');
  const manifestBody = manifestStart + manifestOpen.length;
  const manifestEnd = html.indexOf('</script>', manifestBody);
  JSON.parse(html.slice(manifestBody, manifestEnd));
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(SRC, 'utf8');
  const current = block(html);
  if (current.value.includes(MARK)) {
    const markerPos = current.value.indexOf(MARK);
    const styleStart = current.value.lastIndexOf('<style>', markerPos);
    const styleEnd = current.value.indexOf('</style>', markerPos);
    if (styleStart < 0 || styleEnd < 0) throw new Error('Match 3 스타일 블록 경계를 찾지 못했습니다.');
    const desired = `<style>${RULES}</style>`;
    const normalized = current.value.slice(0, styleStart) + desired + current.value.slice(styleEnd + '</style>'.length);
    if (normalized !== current.value) {
      if (check) {
        console.log('수정이 필요합니다.');
        return;
      }
      const packed = html.slice(0, current.start) +
        `<script type="__bundler/template">${jsonForScript(normalized)}</script>` +
        html.slice(current.end);
      validate(packed);
      fs.writeFileSync(SRC, packed);
      fs.writeFileSync(OUT, packed);
      console.log('수정 완료: Match 3 캐러셀 스타일 블록');
      return;
    }
    validate(html);
    console.log('이미 적용되어 있습니다.');
    return;
  }
  if (check) {
    console.log('아직 적용되지 않았습니다.');
    return;
  }
  const anchor = '<link rel="stylesheet" href="community/board.css">';
  const matches = current.value.split(anchor).length - 1;
  if (matches !== 1) throw new Error(`삽입 위치 매칭 ${matches}건 (1건이어야 함)`);
  const next = current.value.replace(anchor, `<style>${RULES}</style>${anchor}`);
  const packed = html.slice(0, current.start) +
    `<script type="__bundler/template">${jsonForScript(next)}</script>` +
    html.slice(current.end);
  validate(packed);
  fs.writeFileSync(SRC, packed);
  fs.writeFileSync(OUT, packed);
  console.log('적용 완료: Match 3 캐러셀 컨트롤 표시');
}

main();
