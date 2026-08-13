'use strict';
// embed.js — 런처 안 커뮤니티 섹션에 게시판을 붙인다.
//
// 런처(index.html)는 외부 도구가 재생성하는 번들이라 **안에 코드를 넣으면
// 사라진다.** 그래서 번들에는 <script src> 한 줄만 패치로 넣고(patch-
// community.js), 실제 동작은 전부 여기 — 번들 밖 파일 — 에 둔다.
// 재생성되면 그 한 줄만 다시 넣으면 되고 이 파일은 손댈 일이 없다.
//
// 01-api.js, 02-board.js 뒤에 로드된다. 독립 페이지와 **같은 부품**을 쓴다.

(function () {
  const SEC = 'sec-community';
  const MOUNT = 'cb-mount';           // 우리가 심은 표시

  // 런처는 React 로 나중에 그려진다. 섹션이 생길 때까지 기다린다.
  function waitFor(check, done, tries = 100) {
    const got = check();
    if (got) { done(got); return; }
    if (tries <= 0) return;           // 조용히 포기 — 런처는 계속 돌아야 한다
    setTimeout(() => waitFor(check, done, tries - 1), 100);
  }

  let board = null;

  function mount(sec) {
    if (sec.querySelector('#' + MOUNT)) return;   // 이미 붙어 있다

    // 번들이 그린 더미 글 목록. 실제 게시판과 무관하므로 우리 것으로
    // 갈아끼운다. (CSS 로 숨기기도 하지만 여기서도 확실히 지운다)
    const dummy = sec.querySelector('.ilb-post');
    const holder = dummy ? dummy.parentElement : sec;
    for (const d of [...sec.querySelectorAll('.ilb-post')]) d.remove();

    const box = document.createElement('div');
    box.id = MOUNT;

    const list = document.createElement('div');
    list.className = 'cb-list';
    const pager = document.createElement('nav');
    pager.className = 'cb-pager';
    pager.setAttribute('aria-label', '페이지');
    box.append(list, pager);
    holder.append(box);

    // 런처 카드 모양(.ilb-post)을 같이 입혀 섹션 안에서 이질감이 없게 한다.
    // 주소는 건드리지 않는다 — 런처의 ?page= 를 게시판이 바꾸면 안 된다.
    board = createBoard({ list, pager, cardClass: 'ilb-post', syncUrl: false });
    board.load(1);
  }

  // 「글 쓰기」는 patch-community.js 가 <a href="community/"> 로 만들어 뒀다.
  // 런처 안에서는 이동하지 않고 그 자리에서 창을 연다. href 는 그대로 둬서
  // 이 스크립트가 실패해도 독립 페이지로 갈 수 있게 남긴다.
  function hijackWrite(sec) {
    const btn = sec.querySelector('.ilbbang-asset-write');
    if (!btn || btn.dataset.cbBound) return;
    btn.dataset.cbBound = '1';
    btn.addEventListener('click', e => {
      if (!board) return;             // 아직 준비 전이면 링크대로 이동
      e.preventDefault();
      board.openWrite();
    });
  }

  waitFor(() => document.getElementById(SEC), sec => {
    mount(sec);
    hijackWrite(sec);

    // React 가 섹션을 다시 그리면 우리 것이 지워질 수 있다. 사라지면
    // 다시 붙인다 — 안 그러면 탭을 옮겼다 오면 목록이 비어 버린다.
    new MutationObserver(() => {
      const live = document.getElementById(SEC);
      if (!live) return;
      if (!live.querySelector('#' + MOUNT)) mount(live);
      hijackWrite(live);
    }).observe(sec.parentElement || document.body, { childList: true, subtree: true });
  });
})();
