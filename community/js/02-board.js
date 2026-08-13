'use strict';
// 02-board.js — 재사용 가능한 게시판 부품.
//
// 독립 페이지(community/)와 런처 안 커뮤니티 섹션이 **같은 코드**를 쓴다.
// 두 벌로 만들면 한쪽만 고치는 일이 반드시 생긴다.
//
// 01-api.js 가 먼저 로드된다. 스타일은 community/board.css.
//
// **사용자 글은 절대 innerHTML 로 넣지 않는다.** textContent 만 쓴다.
// 로그인 없는 게시판이라 아무나 제목에 <script> 를 넣을 수 있다.

function cbEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;      // 항상 textContent
  return e;
}

function cbTime(ms) {
  const d = new Date(ms), now = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.toDateString() === now.toDateString()
    ? `${p(d.getHours())}:${p(d.getMinutes())}`
    : `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// 페이지가 많아도 번호를 다 그리지 않는다 — 현재 주변만.
function cbPageNums(page, pages, span) {
  const out = [];
  let from = Math.max(1, page - span);
  let to = Math.min(pages, page + span);
  if (to - from < span * 2) {
    from = Math.max(1, to - span * 2);
    to = Math.min(pages, from + span * 2);
  }
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

// 글쓰기 창을 만든다. 두 곳에서 같은 창을 쓰므로 HTML 에 적지 않고
// 여기서 만든다 — 한쪽 페이지에만 넣어두면 다른 쪽에서 빠진다.
//
// <dialog> 를 쓰는 이유: Esc 닫기·포커스 가둠·배경 차단을 브라우저가
// 해준다. 직접 만들면 접근성에서 반드시 뭔가 빠진다.
function cbMakeDialog(onDone) {
  const dlg = cbEl('dialog', 'cb-dlg');
  const form = cbEl('form', 'cb-form');
  form.setAttribute('novalidate', '');
  form.append(cbEl('h2', null, '글 쓰기'));

  const field = (labelText, node, countId, hint) => {
    const lab = cbEl('label');
    lab.append(document.createTextNode(labelText));
    if (hint) lab.append(cbEl('span', 'cb-hint', hint));
    if (countId) { const c = cbEl('span', 'cb-count'); c.dataset.for = countId; lab.append(c); }
    lab.htmlFor = node.id;
    form.append(lab, node);
  };

  const uid = 'cb' + Math.random().toString(36).slice(2, 8);
  const author = cbEl('input'); author.id = uid + 'a'; author.placeholder = '익명';
  author.autocomplete = 'off';
  const title = cbEl('input'); title.id = uid + 't'; title.autocomplete = 'off';
  const body = cbEl('textarea'); body.id = uid + 'b'; body.rows = 8;
  const pw = cbEl('input'); pw.id = uid + 'p'; pw.type = 'password';
  pw.autocomplete = 'new-password';

  field('이름 ', author, 'a');
  field('제목 ', title, 't');
  field('내용 ', body, 'b');
  field('비밀번호 ', pw, null, '이 글을 지울 때 씁니다');

  form.append(cbEl('p', 'cb-warn',
    '쓰던 비밀번호를 넣지 마세요. 글 하나를 지우는 용도이고 계정 ' +
    '비밀번호만큼 안전하게 보관하지 않습니다.'));

  const err = cbEl('p', 'cb-err'); err.hidden = true;
  form.append(err);

  const actions = cbEl('div', 'cb-actions');
  const cancel = cbEl('button', 'cb-btn cb-btn-quiet', '취소');
  cancel.type = 'button';
  const submit = cbEl('button', 'cb-btn', '올리기');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(actions);
  dlg.append(form);
  document.body.append(dlg);

  // 글자 수. 한도가 있는데 얼마나 남았는지 안 보이면 답답하다.
  const counts = [[author, Api.AUTHOR_MAX, 'a'], [title, Api.TITLE_MAX, 't'],
                  [body, Api.BODY_MAX, 'b']];
  const paint = () => {
    for (const [input, max, id] of counts) {
      const out = form.querySelector(`.cb-count[data-for="${id}"]`);
      const n = [...input.value].length;
      out.textContent = n + '/' + max;
      out.classList.toggle('over', n > max);
    }
  };
  for (const [input] of counts) input.addEventListener('input', paint);

  let sending = false;
  const setErr = m => { err.textContent = m || ''; err.hidden = !m; };

  cancel.addEventListener('click', () => { if (!sending) dlg.close(); });
  // Esc 는 <dialog> 가 처리하지만 전송 중에는 막아야 한다.
  dlg.addEventListener('cancel', e => { if (sending) e.preventDefault(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;                       // 두 번 눌러도 한 번만
    setErr('');
    sending = true;
    submit.disabled = true;
    submit.textContent = '올리는 중…';
    try {
      await Api.create({ author: author.value, title: title.value,
                         body: body.value, pw: pw.value });
      dlg.close();
      onDone();
    } catch (ex) {
      setErr(ex.message || '올리지 못했습니다');
    } finally {
      sending = false;
      submit.disabled = false;
      submit.textContent = '올리기';
    }
  });

  return {
    open() {
      setErr('');
      form.reset();
      paint();
      dlg.showModal();
      title.focus();
    }
  };
}

// 글 내용을 보는 창. 목록 응답에 본문이 이미 들어 있어 추가 요청 없이 띄운다.
//
// 본문은 textContent 로 넣고 줄바꿈은 CSS(white-space:pre-wrap)로 살린다.
// <br> 로 바꿔 innerHTML 에 넣으면 그 순간 XSS 가 열린다.
//
// 삭제도 여기서 한다. 로그인이 없으므로 글을 쓸 때 정한 비밀번호가 본인이
// 자기 글을 지우는 **유일한 수단**이다. 이게 없으면 한번 올린 글을 아무도
// 못 지운다.
function cbMakeViewDialog(onDeleted) {
  const dlg = cbEl('dialog', 'cb-dlg cb-view');
  const box = cbEl('div', 'cb-form');
  const title = cbEl('h2', 'cb-view-title');
  const meta = cbEl('p', 'cb-view-meta');
  const body = cbEl('div', 'cb-view-body');

  // 삭제 확인 줄. 평소에는 접어 둔다 — 늘 펴 두면 실수로 지우기 쉽고,
  // 읽으러 온 사람에게 비밀번호 칸부터 보이는 것도 이상하다.
  const confirm = cbEl('div', 'cb-del');
  const uid = 'cbd' + Math.random().toString(36).slice(2, 8);
  const pwLab = cbEl('label', null, '비밀번호 ');
  pwLab.htmlFor = uid;
  const pw = cbEl('input'); pw.id = uid; pw.type = 'password';
  pw.autocomplete = 'off';
  const doDel = cbEl('button', 'cb-btn cb-btn-danger', '삭제');
  doDel.type = 'button';
  const noDel = cbEl('button', 'cb-btn cb-btn-quiet', '취소');
  noDel.type = 'button';
  const row = cbEl('div', 'cb-del-row');
  row.append(pw, doDel, noDel);
  confirm.append(pwLab, row);
  confirm.hidden = true;

  const err = cbEl('p', 'cb-err'); err.hidden = true;

  const actions = cbEl('div', 'cb-actions');
  const del = cbEl('button', 'cb-btn cb-btn-quiet cb-del-open', '삭제');
  del.type = 'button';
  const close = cbEl('button', 'cb-btn cb-btn-quiet', '닫기');
  close.type = 'button';
  actions.append(del, close);
  box.append(title, meta, body, confirm, err, actions);
  dlg.append(box);
  document.body.append(dlg);

  let cur = null;
  let sending = false;
  const setErr = m => { err.textContent = m || ''; err.hidden = !m; };

  function fold() {
    confirm.hidden = true;
    del.hidden = false;
    pw.value = '';
    setErr('');
  }

  del.addEventListener('click', () => {
    confirm.hidden = false;
    del.hidden = true;
    pw.focus();
  });
  noDel.addEventListener('click', () => { if (!sending) { fold(); del.focus(); } });

  async function remove() {
    if (sending || !cur) return;
    if (!pw.value) { setErr('비밀번호를 입력하세요'); pw.focus(); return; }
    setErr('');
    sending = true;
    doDel.disabled = true;
    doDel.textContent = '지우는 중…';
    try {
      await Api.remove(cur.id, pw.value);
      dlg.close();
      onDeleted();
    } catch (ex) {
      // 틀린 비밀번호면 창을 닫지 않는다 — 다시 칠 수 있어야 한다.
      setErr(ex.message || '지우지 못했습니다');
      pw.select();
    } finally {
      sending = false;
      doDel.disabled = false;
      doDel.textContent = '삭제';
    }
  }

  doDel.addEventListener('click', remove);
  // 비밀번호 칸에서 Enter — 폼이 아니라서 브라우저가 해주지 않는다.
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); remove(); } });

  close.addEventListener('click', () => { if (!sending) dlg.close(); });
  // 배경을 눌러도 닫히게 한다. <dialog> 는 기본으로 안 닫힌다.
  dlg.addEventListener('click', e => { if (e.target === dlg && !sending) dlg.close(); });
  dlg.addEventListener('cancel', e => { if (sending) e.preventDefault(); });

  return {
    open(p) {
      cur = p;
      fold();
      title.textContent = p.title;
      const when = cbTime(p.created_at) +
        (p.updated_at ? ' (수정 ' + cbTime(p.updated_at) + ')' : '');
      meta.textContent = (p.author || '익명') + ' · ' + when + ' · #' + p.id;
      body.textContent = p.body;
      dlg.showModal();
      close.focus();
    }
  };
}

// ── 게시판 ──────────────────────────────────────────────────────────
// listEl / pagerEl / countEl 을 받아 그 안에 그린다. 어디에 붙이든 같다.
//
// syncUrl 이 참이면 주소에 ?page= 를 반영한다. 독립 페이지에서는 켜고,
// 런처 안에서는 끈다 — 런처의 주소를 게시판이 마음대로 바꾸면 안 된다.
function createBoard(opts) {
  const listEl = opts.list;
  const pagerEl = opts.pager || null;
  const countEl = opts.count || null;
  const syncUrl = !!opts.syncUrl;
  const cardClass = opts.cardClass || '';       // 런처에서는 'ilb-post' 를 얹는다
  let page = 1;

  const dialog = cbMakeDialog(() => load(1));   // 새 글은 맨 앞이므로 1페이지
  // 지운 뒤에는 보던 페이지를 다시 부른다. 마지막 글을 지워 그 페이지가
  // 사라지면 서버가 마지막 페이지로 당겨주고 load() 가 주소를 맞춘다.
  const viewer = cbMakeViewDialog(() => load(page));

  function setCount(t) { if (countEl) countEl.textContent = t; }
  function clearPager() { if (pagerEl) pagerEl.replaceChildren(); }

  function showLoading() {
    listEl.replaceChildren(cbEl('p', 'cb-state', '불러오는 중…'));
    clearPager(); setCount('');
  }

  function showEmpty() {
    const box = cbEl('div', 'cb-state');
    box.append(cbEl('p', null, '아직 글이 없습니다.'));
    box.append(cbEl('p', 'cb-sub', '첫 글을 남겨보세요.'));
    listEl.replaceChildren(box);
    clearPager(); setCount('0개');
  }

  function showError(e) {
    const box = cbEl('div', 'cb-state cb-state-error');
    box.append(cbEl('p', null, e.message || '글을 불러오지 못했습니다'));
    const retry = cbEl('button', 'cb-btn cb-btn-quiet', '다시 시도');
    retry.type = 'button';
    retry.addEventListener('click', () => load(page));
    box.append(retry);
    listEl.replaceChildren(box);
    clearPager(); setCount('');
  }

  function renderPosts(posts) {
    const frag = document.createDocumentFragment();
    for (const p of posts) {
      // <button> 으로 만든다. div 에 클릭만 달면 키보드·스크린리더로는
      // 누를 수 없다. 모양은 board.css 가 버튼 기본값을 지운다.
      const card = cbEl('button', ('cb-post ' + cardClass).trim());
      card.type = 'button';
      card.addEventListener('click', () => viewer.open(p));
      card.append(cbEl('span', 'cb-avatar'));
      const mid = cbEl('span', 'cb-main');
      mid.append(cbEl('span', 'cb-title', p.title));
      const meta = cbEl('span', 'cb-meta');
      meta.append(cbEl('span', null, p.author || '익명'));
      meta.append(cbEl('span', 'cb-dot', '·'));
      meta.append(cbEl('span', null, cbTime(p.created_at)));
      mid.append(meta);
      card.append(mid, cbEl('span', 'cb-id', '#' + p.id));
      frag.append(card);
    }
    listEl.replaceChildren(frag);
  }

  function renderPager(at, pages, total) {
    setCount(total + '개');
    if (!pagerEl) return;
    pagerEl.replaceChildren();
    if (pages <= 1) return;
    const add = (label, target, current) => {
      const b = cbEl('button', 'cb-page' + (current ? ' is-current' : ''), label);
      b.type = 'button';
      if (current) b.setAttribute('aria-current', 'page');
      if (target == null) b.disabled = true;
      else b.addEventListener('click', () => go(target));
      pagerEl.append(b);
    };
    add('‹', at > 1 ? at - 1 : null);
    const nums = cbPageNums(at, pages, 2);
    if (nums[0] > 1) {
      add('1', 1);
      if (nums[0] > 2) pagerEl.append(cbEl('span', 'cb-gap', '…'));
    }
    for (const n of nums) add(String(n), n, n === at);
    if (nums[nums.length - 1] < pages) {
      if (nums[nums.length - 1] < pages - 1) pagerEl.append(cbEl('span', 'cb-gap', '…'));
      add(String(pages), pages);
    }
    add('›', at < pages ? at + 1 : null);
  }

  function writeUrl(n, replace) {
    if (!syncUrl) return;
    const url = new URL(location.href);
    if (n <= 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(n));
    history[replace ? 'replaceState' : 'pushState']({ page: n }, '', url);
  }

  function go(n) { writeUrl(n, false); load(n); }

  async function load(n) {
    page = n;
    showLoading();
    try {
      const data = await Api.list(n);
      // 서버가 마지막 페이지로 당겨줬으면 주소도 맞춘다 (?page=999 대응)
      if (data.page !== n) { page = data.page; writeUrl(data.page, true); }
      if (!data.total) { showEmpty(); return; }
      renderPosts(data.posts);
      renderPager(data.page, data.pages, data.total);
    } catch (e) {
      showError(e);
    }
  }

  return { load, go, openWrite: dialog.open, page: () => page };
}
