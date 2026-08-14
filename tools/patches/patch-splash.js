// 일빵 런처: 로딩 스플래시 제거.
// 언패킹 3.3초 동안 거대한 '일빵' SVG + 베이지 여백이 뜨던 것을
// 앱과 같은 다크 배경(#152528) 빈 화면으로 바꾼다.
//
// 'Unpacking...' 배지는 DOM 에 남겨두고 숨기기만 한다 — 압축 해제가
// 실패했을 때 setStatus('Error ...') 가 유일한 사용자 피드백이라,
// 지워버리면 실패가 조용한 빈 화면으로 끝난다.
const fs = require('fs');

const path = require('path');
// 어느 디렉터리에서 부르든 저장소 루트의 원본을 잡는다.
const FILE = path.join(__dirname, '..', '..', '일빵-런처-확정안.html');

function sub(src, label, from, to) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] 매칭 ${n}건 (1건이어야 함)`);
  return src.split(from).join(to);
}

let html = fs.readFileSync(FILE, 'utf8');

// 1. 바탕색을 앱과 통일 (베이지 → 다크)
html = sub(html, 'body-bg',
  `    body { background: #faf9f5; display: flex;`,
  `    body { background: #152528; display: flex;`);

// 2. 배지는 기본 숨김
html = sub(html, 'loading-hidden',
  `    #__bundler_loading { position: fixed;`,
  `    #__bundler_loading { display: none; position: fixed;`);

// 3. 스플래시 전용 CSS 제거
html = sub(html, 'thumbnail-css',
  `    #__bundler_thumbnail { position: fixed; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #faf9f5; z-index: 9999; }
    #__bundler_thumbnail svg { width: 100%; height: 100%; object-fit: contain; }
`, '');

// 4. 스플래시 마크업 제거
html = sub(html, 'thumbnail-div',
  `  <div id="__bundler_thumbnail"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#152528"></rect><text x="50" y="62" font-family="Jua, sans-serif" font-size="28" fill="#F58A5E" text-anchor="middle">일빵</text></svg></div>
`, '');

// 5. 오류 메시지는 여전히 보이게 (배지를 숨겼으므로 오류 시 되살린다)
html = sub(html, 'setStatus',
  `  function setStatus(msg) { if (loading) loading.textContent = msg; }`,
  `  function setStatus(msg) {
    if (!loading) return;
    loading.textContent = msg;
    // 정상 진행 상황은 감춘 채로, 실패만 드러낸다.
    if (/^Error/.test(msg)) loading.style.display = 'block';
  }`);

fs.writeFileSync(FILE, html);
console.log('OK  → 스플래시 제거, 바탕 #152528 |', (fs.statSync(FILE).size / 1048576).toFixed(2) + 'MB');
