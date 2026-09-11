#!/usr/bin/env node
// Add the finished standalone Match 3 web build to the launcher catalog.
// Run after patch-gamelink.js; the latter supplies the live soccer entry and
// the link-aware play button. The generated game files live in games/match3/.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const GAME_URL = 'games/match3/';
const GAME_TITLE = '과일 친구 매치 3';

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

function extractManifest(html) {
  const open = '<script type="__bundler/manifest">';
  const start = html.indexOf(open);
  if (start < 0) throw new Error('manifest 블록을 찾지 못했습니다.');
  const bodyStart = start + open.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) throw new Error('manifest 블록의 끝을 찾지 못했습니다.');
  return { start, end: end + '</script>'.length, bodyStart, end, manifest: JSON.parse(html.slice(bodyStart, end)) };
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
  const block = extractManifest(html);
  const bundle = findDataBundle(block.manifest);
  const matches = bundle.source.split(`url: '${GAME_URL}'`).length - 1;
  if (matches !== 1 || !bundle.source.includes(`title: '${GAME_TITLE}'`)) {
    throw new Error(`Match 3 카탈로그 검증 실패 (url ${matches}건).`);
  }
  if (html.includes('<script type="__bundler/template">')) {
    const templateOpen = '<script type="__bundler/template">';
    const templateStart = html.indexOf(templateOpen) + templateOpen.length;
    const templateEnd = html.indexOf('</script>', templateStart);
    JSON.parse(html.slice(templateStart, templateEnd));
  }
  return bundle;
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(SRC, 'utf8');
  const block = extractManifest(html);
  const bundle = findDataBundle(block.manifest);
  const marker = `url: '${GAME_URL}'`;
  const existing = bundle.source.split(marker).length - 1;
  if (existing === 1) {
    validate(html);
    console.log('이미 적용되어 있습니다.');
    if (!check) console.log('검증 완료:', GAME_URL);
    return;
  }
  if (check) {
    console.log('아직 적용되지 않았습니다.');
    return;
  }
  if (existing !== 0) throw new Error(`기존 Match 3 URL 매칭 ${existing}건 (0 또는 1건이어야 함)`);

  const anchor = `}, {\n  title: '저잣거리 러너',`;
  const addition = `}, {\n  title: '${GAME_TITLE}',\n  genre: '퍼즐 · 캐주얼',\n  plays: '0',\n  author: '@ilbbang',\n  url: '${GAME_URL}'${anchor}`;
  const occurrences = bundle.source.split(anchor).length - 1;
  if (occurrences !== 1) throw new Error(`GAMES 삽입 위치 매칭 ${occurrences}건 (1건이어야 함)`);

  const updated = bundle.source.replace(anchor, addition);
  block.manifest[bundle.id].data = zlib.gzipSync(Buffer.from(updated, 'utf8'), { level: 9 }).toString('base64');
  const packed = html.slice(0, block.start) +
    `<script type="__bundler/manifest">${jsonForScript(block.manifest)}</script>` +
    html.slice(block.end);
  validate(packed);
  fs.writeFileSync(SRC, packed);
  fs.writeFileSync(OUT, packed);
  console.log('적용 완료:', GAME_TITLE, '→', GAME_URL);
  console.log('원본·배포본:', Buffer.byteLength(packed, 'utf8'), 'bytes');
}

main();
