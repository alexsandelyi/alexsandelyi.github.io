#!/usr/bin/env node
// Add the standalone AI discussion room link beside the community tab.
// Only the Launcher.jsx slice is changed; all discussion behavior lives in ai-discussion/.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');
const ROOM = path.join(ROOT, 'ai-discussion', 'index.html');

const OLD = `  }, n)))), /*#__PURE__*/React.createElement("div", {`;
const NEW = `  }, n)), /*#__PURE__*/React.createElement("a", {
    href: "ai-discussion/",
    "aria-label": "AI 토론장",
    style: {
      padding: '4px 0',
      cursor: 'pointer',
      font: 'var(--fw-regular) var(--fs-400)/1 var(--font-body)',
      color: 'var(--text-muted)',
      borderBottom: 'var(--bw-bold) solid transparent',
      textDecoration: 'none'
    }
  }, "AI 토론장"))), /*#__PURE__*/React.createElement("div", {`;

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return text.replace(from, to);
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\u002F');
}

function extract(html, type) {
  const open = html.indexOf(`<script type="__bundler/${type}">`);
  if (open < 0) throw new Error(`${type} block not found`);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  return { start, end, json: html.slice(start, end) };
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(ROOM)) throw new Error('ai-discussion/index.html is missing');

  const html = fs.readFileSync(SRC, 'utf8');
  const manifestBlock = extract(html, 'manifest');
  const manifest = JSON.parse(manifestBlock.json);
  const dsId = Object.keys(manifest).find(k => manifest[k].mime === 'application/javascript');
  if (!dsId) throw new Error('application/javascript bundle not found');

  const entry = manifest[dsId];
  const bytes = Buffer.from(entry.data, 'base64');
  const dsFull = entry.compressed
    ? zlib.gunzipSync(bytes).toString('utf8')
    : bytes.toString('utf8');
  const launchStart = dsFull.indexOf('// ui_kits/homepage/Launcher.jsx');
  const launchEnd = dsFull.indexOf('// ui_kits/homepage/LauncherTones.jsx');
  if (launchStart < 0 || launchEnd < launchStart) throw new Error('Launcher.jsx range not found');
  const launcher = dsFull.slice(launchStart, launchEnd);

  if (launcher.includes('href: "ai-discussion/"')) {
    console.log('AI discussion link already applied');
    if (check) return;
    throw new Error('AI discussion link already applied');
  }
  if (check) {
    console.log('AI discussion link is not applied');
    return;
  }

  const updatedLauncher = replaceOnce(launcher, OLD, NEW, 'AI discussion tab');
  const updatedDs = dsFull.slice(0, launchStart) + updatedLauncher + dsFull.slice(launchEnd);
  entry.data = zlib.gzipSync(Buffer.from(updatedDs, 'utf8'), { level: 9 }).toString('base64');
  entry.compressed = true;

  const encodedManifest = jsonForScript(manifest);
  const withManifest = html.slice(0, manifestBlock.start) + encodedManifest + html.slice(manifestBlock.end);
  const templateBlock = extract(withManifest, 'template');
  const template = JSON.parse(templateBlock.json);
  const finalManifest = JSON.parse(extract(withManifest, 'manifest').json);
  const finalEntry = finalManifest[dsId];
  const roundTripDs = zlib.gunzipSync(Buffer.from(finalEntry.data, 'base64')).toString('utf8');
  if (!roundTripDs.includes('href: "ai-discussion/"')) {
    throw new Error('round-trip validation failed: launcher link');
  }
  JSON.parse(templateBlock.json);

  const out = withManifest;
  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);
  console.log('AI discussion tab applied beside community');
  console.log(`source/deploy bytes: ${out.length}`);
}

main();
