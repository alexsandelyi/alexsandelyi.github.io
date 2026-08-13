'use strict';
// 02-list.js — 목록과 페이지네이션.
//
// 클래식 <script> 라 전역 스코프를 공유한다. 01-api.js 가 먼저 로드된다.
//
// **사용자 글은 절대 innerHTML 로 넣지 않는다.** textContent 만 쓴다.
// 이것 하나로 XSS 대부분이 막힌다 — 로그인 없는 게시판이라 아무나 제목에
// <script> 를 넣을 수 있다.

const listEl = document.getElementById('list');
const pagerEl = document.getElementById('pager');
const countEl = document.getElementById('count');

let currentPage = 1;

// 주소의 ?page= 를 읽는다. 없거나 이상하면 1.
function pageFromUrl() {
  const n = Number(new URLSearchParams(location.search).get('page'));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;      // 항상 textContent
  return e;
}

function timeText(ms) {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const p = n => String(n).padStart(2, '0');
  return sameDay
    ? `${p(d.getHours())}:${p(d.getMinutes())}`
    : `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// ── 상태 셋을 각각 그린다 ───────────────────────────────────────────
// 로딩·빈 목록·오류를 구분하지 않으면, 서버가 죽었을 때 그냥 빈 화면이
// 나와서 원인을 알 수 없다.
function showLoading() {
  listEl.replaceChildren(el('p', 'state', '불러오는 중…'));
  pagerEl.replaceChildren();
  countEl.textContent = '';
}

function showEmpty() {
  const box = el('div', 'state');
  box.append(el('p', null, '아직 글이 없습니다.'));
  box.append(el('p', 'state-sub', '첫 글을 남겨보세요.'));
  listEl.replaceChildren(box);
  pagerEl.replaceChildren();
  countEl.textContent = '0개';
}

function showError(err) {
  const box = el('div', 'state state-error');
  box.append(el('p', null, err.message || '글을 불러오지 못했습니다'));
  const retry = el('button', 'btn btn-quiet', '다시 시도');
  retry.addEventListener('click', () => load(currentPage));
  box.append(retry);
  listEl.replaceChildren(box);
  pagerEl.replaceChildren();
  countEl.textContent = '';
}

// ── 목록 ────────────────────────────────────────────────────────────
function renderPosts(posts) {
  const frag = document.createDocumentFragment();
  for (const p of posts) {
    const card = el('article', 'post');
    card.append(el('span', 'post-avatar'));

    const mid = el('span', 'post-main');
    mid.append(el('span', 'post-title', p.title));
    const meta = el('span', 'post-meta');
    meta.append(el('span', null, p.author || '익명'));
    meta.append(el('span', 'dot', '·'));
    meta.append(el('span', null, timeText(p.created_at)));
    mid.append(meta);
    card.append(mid);

    card.append(el('span', 'post-id', '#' + p.id));
    frag.append(card);
  }
  listEl.replaceChildren(frag);
}

// 페이지가 많아도 번호를 다 그리지 않는다 — 현재 주변만.
function pageNumbers(page, pages, span) {
  const out = [];
  let from = Math.max(1, page - span);
  let to = Math.min(pages, page + span);
  // 끝에 붙었을 때도 같은 개수를 보여준다
  if (to - from < span * 2) {
    from = Math.max(1, to - span * 2);
    to = Math.min(pages, from + span * 2);
  }
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function renderPager(page, pages, total) {
  countEl.textContent = total + '개';
  pagerEl.replaceChildren();
  if (pages <= 1) return;

  const add = (label, target, opts) => {
    const b = el('button', 'page' + (opts && opts.current ? ' is-current' : ''), label);
    if (opts && opts.current) b.setAttribute('aria-current', 'page');
    if (target == null) b.disabled = true;
    else b.addEventListener('click', () => go(target));
    pagerEl.append(b);
  };

  add('‹', page > 1 ? page - 1 : null);
  const nums = pageNumbers(page, pages, 2);
  if (nums[0] > 1) {
    add('1', 1);
    if (nums[0] > 2) pagerEl.append(el('span', 'page-gap', '…'));
  }
  for (const n of nums) add(String(n), n, { current: n === page });
  if (nums[nums.length - 1] < pages) {
    if (nums[nums.length - 1] < pages - 1) pagerEl.append(el('span', 'page-gap', '…'));
    add(String(pages), pages);
  }
  add('›', page < pages ? page + 1 : null);
}

// ── 이동 ────────────────────────────────────────────────────────────
// 주소에 반영해야 새로고침·뒤로가기·링크 공유가 된다.
function go(page) {
  const url = new URL(location.href);
  if (page <= 1) url.searchParams.delete('page');
  else url.searchParams.set('page', String(page));
  history.pushState({ page }, '', url);
  load(page);
}

async function load(page) {
  currentPage = page;
  showLoading();
  try {
    const data = await Api.list(page);
    // 서버가 마지막 페이지로 당겨줬으면 주소도 맞춘다 (?page=999 대응)
    if (data.page !== page) {
      currentPage = data.page;
      const url = new URL(location.href);
      if (data.page <= 1) url.searchParams.delete('page');
      else url.searchParams.set('page', String(data.page));
      history.replaceState({ page: data.page }, '', url);
    }
    if (!data.total) { showEmpty(); return; }
    renderPosts(data.posts);
    renderPager(data.page, data.pages, data.total);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError(err);
  }
}

addEventListener('popstate', () => load(pageFromUrl()));
load(pageFromUrl());
