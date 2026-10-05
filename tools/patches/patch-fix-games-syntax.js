const fs = require('fs');
const zlib = require('zlib');
const html = fs.readFileSync('일빵-런처-확정안.html','utf8');
const mMatch = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
const m = JSON.parse(mMatch[1]);
const dsId = Object.keys(m).find(k => m[k].mime === 'application/javascript');
const buf = Buffer.from(m[dsId].data, 'base64');
let ds = m[dsId].compressed ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

ds = ds.replace(
  "url: 'games/soccer/'\n\n};\nconst CHIPS",
  "url: 'games/soccer/'\n}];\nconst CHIPS"
);

m[dsId].data = zlib.gzipSync(Buffer.from(ds, 'utf8'), { level: 9 }).toString('base64');
m[dsId].compressed = true;

const encoded = JSON.stringify(m).replace(/<\//g, '<\\u002F');
const out = html.slice(0, mMatch.index) + '<script type="__bundler/manifest">' + encoded + '</script>' + html.slice(mMatch.index + mMatch[0].length);

fs.writeFileSync('일빵-런처-확정안.html', out);
fs.writeFileSync('index.html', out);
console.log('Fixed GAMES array syntax error');
