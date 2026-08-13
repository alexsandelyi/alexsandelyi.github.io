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
      const card = cbEl('article', ('cb-post ' + cardClass).trim());
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
