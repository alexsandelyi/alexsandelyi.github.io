#!/usr/bin/env node
// Increase the contrast of the hanji theme's structural separators.
// This patch updates an already-packed bundle and keeps source/deploy in sync.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, '일빵-런처-확정안.html');
const OUT = path.join(ROOT, 'index.html');

function extractTemplate(html) {
  const open = html.indexOf('<script type="__bundler/template">');
  if (open < 0) throw new Error('template block not found');
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  if (start <= 0 || end < 0) throw new Error('template block is malformed');
  return { start, end, json: html.slice(start, end) };
}

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected 1 match, found ${count}`);
  }
  return text.replace(from, to);
}

const REPLACEMENTS = [
  [
    'html,body{background:#F4EFE4 !important}\n\n',
    'html,body{background:#F4EFE4 !important}\n.ilb-root{--border-subtle:#A69A87 !important}\n',
    'border token'
  ],
  [
    '.ilb-rail{gap:1px !important;background:#EAE3D6}',
    '.ilb-rail{gap:1px !important;background:#A69A87}',
    'rail separator'
  ],
  [
    '.ilb-hero::after{content:"";display:block;background:#EAE3D6;',
    '.ilb-hero::after{content:"";display:block;background:#A69A87;',
    'hero separator'
  ],
  [
    '.ilb-nav{border-right:1px solid #EAE3D6 !important}',
    '.ilb-nav{border-right:1px solid #A69A87 !important}',
    'desktop navigation separator'
  ],
  [
    'border-top:1px solid #EAE3D6 !important;',
    'border-top:1px solid #A69A87 !important;',
    'mobile navigation separator'
  ],
  [
    '  border-top:1px solid #EAE3D6;\n  padding-top:12px;',
    '  border-top:1px solid #A69A87;\n  padding-top:12px;',
    'pager separator'
  ]
];

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(SRC, 'utf8');
  const { start, end, json } = extractTemplate(html);
  let template = JSON.parse(json);

  const alreadyApplied = REPLACEMENTS.every(([from, to]) =>
    !template.includes(from) && template.includes(to)
  );
  if (alreadyApplied) {
    console.log('line contrast patch already applied');
    if (check) return;
    throw new Error('line contrast patch already applied');
  }
  if (check) {
    console.log('line contrast patch is not applied');
    return;
  }

  for (const [from, to, label] of REPLACEMENTS) {
    if (template.includes(to) && !template.includes(from)) continue;
    if (!template.includes(from) || template.includes(to)) {
      throw new Error(`${label}: partial or unexpected patch state`);
    }
    template = replaceOnce(template, from, to, label);
  }

  const encoded = JSON.stringify(template).replace(/<\//g, '<\\u002F');
  const out = html.slice(0, start) + encoded + html.slice(end);

  const round = extractTemplate(out);
  const parsedTemplate = JSON.parse(round.json);
  JSON.parse(out.slice(
    out.indexOf('>', out.indexOf('<script type="__bundler/manifest">')) + 1,
    out.indexOf('</script>', out.indexOf('<script type="__bundler/manifest">'))
  ));
  for (const [, to, label] of REPLACEMENTS) {
    if (!parsedTemplate.includes(to)) throw new Error(`${label}: round-trip validation failed`);
  }

  fs.writeFileSync(SRC, out);
  fs.writeFileSync(OUT, out);
  console.log('line contrast patch applied: #EAE3D6 -> #A69A87');
  console.log(`source/deploy bytes: ${out.length}`);
}

main();
