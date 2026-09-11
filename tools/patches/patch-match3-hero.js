#!/usr/bin/env node
// Use the Match 3 start artwork for the launcher hero when that game is selected.
// The soccer artwork remains the default for the other catalog entries.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const GAME_URL = 'games/match3/';
const ASSET = 'games/match3/menu/start_bg_match3.webp';
const CLASS = 'ilb-hero-media-match3';
const MARK = '/* ilb-match3-hero */';
const MEDIA_CLASS = `className: "ilb-hero-media " + (g.url === '${GAME_URL}' ? '${CLASS}' : ''),`;
const RULES = `${MARK}
/* The Match 3 catalog entry has its own sign artwork; soccer keeps the default. */
.ilb-hero-media.${CLASS}{
  background-image:url("${ASSET}") !important;
  background-size:cover !important;
  background-position:center 42% !important;
  background-repeat:no-repeat !important;
}`;

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

function extractBlock(html, type) {
  const open = `<script type="__bundler/${type}">`;
  const start = html.indexOf(open);
  if (start < 0) throw new Error(`${type} 블록을 찾지 못했습니다.`);
  const bodyStart = start + open.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) throw new Error(`${type} 블록의 끝을 찾지 못했습니다.`);
  return { start, end: end + '</script>'.length, bodyStart, bodyEnd: end, value: JSON.parse(html.slice(bodyStart, end)) };
}

function findDataBundle(manifest) {
  for (const [id, entry] of Object.entries(manifest)) {
    if (entry.mime !== 'application/javascript') continue;
    const source = zlib.gunzipSync(Buffer.from(entry.data, 'base64')).toString('utf8');
    if (source.includes('const GAMES =')) return { id, entry, source };
  }
  throw new Error('GAMES 데이터 번들을 찾지 못했습니다.');
}

function validate(html) {
  const template = extractBlock(html, 'template');
  const manifest = extractBlock(html, 'manifest');
  const bundle = findDataBundle(manifest.value);
  if ((bundle.source.split(MEDIA_CLASS).length - 1) !== 1) {
    throw new Error('Match 3 히어로 클래스가 정확히 한 번이어야 합니다.');
  }
  if (template.value.split(MARK).length - 1 !== 1 || !template.value.includes(ASSET)) {
    throw new Error('Match 3 간판 스타일 검증에 실패했습니다.');
  }
  return { template, manifest, bundle };
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(SRC, 'utf8');
  const current = validatePartial(html);
  const hasClass = current.bundle.source.includes(MEDIA_CLASS);
  const hasStyle = current.template.value.includes(MARK);

  if (hasClass || hasStyle) {
    if (!hasClass || !hasStyle) throw new Error('Match 3 간판 패치가 일부만 적용되어 있습니다.');
    validate(html);
    console.log('이미 적용되어 있습니다.');
    return;
  }
  if (check) {
    console.log('아직 적용되지 않았습니다.');
    return;
  }

  const oldClass = 'className: "ilb-hero-media",';
  const classMatches = current.bundle.source.split(oldClass).length - 1;
  if (classMatches !== 1) throw new Error(`히어로 미디어 클래스 매칭 ${classMatches}건 (1건이어야 함)`);
  const updatedSource = current.bundle.source.replace(oldClass, MEDIA_CLASS);
  const anchor = '</style>\n<script src="5a7a50a6-3d01-426d-ae06-d7bfd03d53d6"';
  const anchorMatches = current.template.value.split(anchor).length - 1;
  if (anchorMatches !== 1) throw new Error(`간판 스타일 삽입 위치 매칭 ${anchorMatches}건 (1건이어야 함)`);
  const updatedTemplate = current.template.value.replace(anchor, `</style>\n<style>${RULES}</style>\n<script src="5a7a50a6-3d01-426d-ae06-d7bfd03d53d6"`);

  current.manifest.value[current.bundle.id].data = zlib.gzipSync(Buffer.from(updatedSource, 'utf8'), { level: 9 }).toString('base64');
  const withManifest = html.slice(0, current.manifest.start) +
    `<script type="__bundler/manifest">${jsonForScript(current.manifest.value)}</script>` +
    html.slice(current.manifest.end);
  const templateAfterManifest = extractBlock(withManifest, 'template');
  const packed = withManifest.slice(0, templateAfterManifest.start) +
    `<script type="__bundler/template">${jsonForScript(updatedTemplate)}</script>` +
    withManifest.slice(templateAfterManifest.end);
  validate(packed);
  fs.writeFileSync(SRC, packed);
  fs.writeFileSync(OUT, packed);
  console.log('적용 완료:', ASSET);
  console.log('원본·배포본:', Buffer.byteLength(packed, 'utf8'), 'bytes');
}

function validatePartial(html) {
  const template = extractBlock(html, 'template');
  const manifest = extractBlock(html, 'manifest');
  return { template, manifest, bundle: findDataBundle(manifest.value) };
}

main();
