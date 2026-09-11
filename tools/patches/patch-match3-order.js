#!/usr/bin/env node
// Put Match 3 in the first launcher slot. Run after patch-match3.js.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const GAME_TITLE = '과일 친구 매치 3';
const GAME_URL = 'games/match3/';
const SOCCER_TITLE = '동네 축구';
const SOCCER_URL = 'games/soccer/';

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
  return { start, end: end + '</script>'.length, value: JSON.parse(html.slice(bodyStart, end)) };
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
  const bundle = findDataBundle(block.value);
  const listStart = bundle.source.indexOf('const GAMES = [');
  const listEnd = bundle.source.indexOf('];', listStart);
  if (listStart < 0 || listEnd < 0) throw new Error('GAMES 목록 경계를 찾지 못했습니다.');
  const list = bundle.source.slice(listStart, listEnd);
  const matchPos = list.indexOf(`title: '${GAME_TITLE}'`);
  const soccerPos = list.indexOf(`title: '${SOCCER_TITLE}'`);
  if (matchPos < 0 || soccerPos < 0 || matchPos >= soccerPos) {
    throw new Error('Match 3가 GAMES 목록의 첫 항목이 아닙니다.');
  }
  if ((list.match(new RegExp(`url: '${GAME_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g')) || []).length !== 1) {
    throw new Error('Match 3 URL이 정확히 한 번이어야 합니다.');
  }
  JSON.parse(extractTemplate(html));
  return bundle;
}

function extractTemplate(html) {
  const open = '<script type="__bundler/template">';
  const start = html.indexOf(open);
  if (start < 0) throw new Error('template 블록을 찾지 못했습니다.');
  const bodyStart = start + open.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end < 0) throw new Error('template 블록의 끝을 찾지 못했습니다.');
  return html.slice(bodyStart, end);
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(SRC, 'utf8');
  const block = extractManifest(html);
  const bundle = findDataBundle(block.value);
  const listStart = bundle.source.indexOf('const GAMES = [');
  const listEnd = bundle.source.indexOf('];', listStart);
  if (listStart < 0 || listEnd < 0) throw new Error('GAMES 목록 경계를 찾지 못했습니다.');
  const list = bundle.source.slice(listStart, listEnd);
  const matchTitle = `title: '${GAME_TITLE}'`;
  const soccerTitle = `title: '${SOCCER_TITLE}'`;
  const matchPos = list.indexOf(matchTitle);
  const soccerPos = list.indexOf(soccerTitle);
  if (matchPos < 0 || soccerPos < 0) throw new Error('Match 3 또는 축구 항목을 찾지 못했습니다.');
  if (matchPos < soccerPos) {
    validate(html);
    console.log('이미 Match 3가 1번입니다.');
    return;
  }
  if (check) {
    console.log('Match 3 순서 변경이 필요합니다.');
    return;
  }

  const matchStart = bundle.source.lastIndexOf('{', listStart + matchPos);
  const soccerStart = bundle.source.lastIndexOf('{', listStart + soccerPos);
  const matchNext = bundle.source.indexOf(`}, {\n  title: '저잣거리 러너',`, matchStart);
  const soccerNext = bundle.source.indexOf(`\n}, {\n  title: '${GAME_TITLE}',`, soccerStart);
  if (matchStart < 0 || soccerStart < 0 || matchNext < 0 || soccerNext < 0) {
    throw new Error('첫 두 게임의 경계를 찾지 못했습니다.');
  }
  const soccerObject = bundle.source.slice(soccerStart, soccerNext + 2);
  const matchObject = bundle.source.slice(matchStart, matchNext + 1);
  const regionStart = Math.min(soccerStart, matchStart);
  const regionEnd = Math.max(matchNext + 1, soccerNext + 2);
  const region = bundle.source.slice(regionStart, regionEnd);
  const expected = soccerObject + ', ' + matchObject;
  if (region !== expected) throw new Error('예상한 축구·Match 3 순서와 실제 번들이 다릅니다.');
  const updatedSource = bundle.source.slice(0, regionStart) + matchObject + ', ' + soccerObject + bundle.source.slice(regionEnd);
  block.value[bundle.id].data = zlib.gzipSync(Buffer.from(updatedSource, 'utf8'), { level: 9 }).toString('base64');
  const packed = html.slice(0, block.start) +
    `<script type="__bundler/manifest">${jsonForScript(block.value)}</script>` +
    html.slice(block.end);
  validate(packed);
  fs.writeFileSync(SRC, packed);
  fs.writeFileSync(OUT, packed);
  console.log('적용 완료: Match 3를 1번으로 이동');
}

main();
