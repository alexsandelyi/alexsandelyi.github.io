'use strict';
// 01-api.js — 서버 통신 계층.
//
// **저장소를 바꾸려면 이 파일만 갈아끼운다.** 목록·작성 화면은 여기가
// 무엇으로 구현됐는지 모른다. 지금은 Cloudflare Worker 가 아직 없어서
// 브라우저 안의 가짜 저장소로 돈다 (API_BASE 가 비어 있을 때).
//
// 규격은 루트 CLAUDE.md 「커뮤니티 게시판」.

// Worker 주소. 배포 후 'https://api.ilbbang.com' 를 넣으면 진짜 서버를 쓴다.
// 비어 있으면 아래 가짜 저장소로 돈다.
const API_BASE = '';

// Turnstile 사이트 키. **비밀이 아니다** — 브라우저에 그대로 실려 나가는
// 값이라 Public 저장소에 있어도 된다. 짝이 되는 비밀키만
// `wrangler secret put TURNSTILE_SECRET` 으로 Cloudflare 에 둔다.
//
// **이 값과 Worker 의 TURNSTILE_SECRET 은 항상 같이 채우고 같이 비운다.**
// 둘 다 비면 검사 없이 도는 로컬 개발이고, 둘 다 차면 운영이다. 비밀키만
// 넣으면 Worker 가 토큰을 요구하는데 화면이 위젯을 안 띄워서 **글쓰기가
// 100% 403 으로 막힌다.** 사이트 키만 넣으면 위젯만 뜨고 검사는 안 된다.
const TURNSTILE_SITE_KEY = '';

const PAGE_SIZE = 10;
const TITLE_MAX = 100;
const BODY_MAX = 2000;
const AUTHOR_MAX = 20;

// 화면이 받는 오류는 항상 이 모양이다 — 어디서 났든 같게 다룬다.
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 0;
  }
}

// ── 가짜 저장소 ─────────────────────────────────────────────────────
// 서버가 생기기 전에 화면과 흐름을 완성하려고 둔다. 진짜 서버와 **같은
// 모양의 응답**을 돌려주는 것이 요점이다 — 그래야 나중에 갈아끼울 때
// 화면 코드를 안 고친다.
const FAKE_KEY = 'ilb.community.posts';

function fakeLoad() {
  try {
    const raw = localStorage.getItem(FAKE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function fakeSave(rows) {
  try { localStorage.setItem(FAKE_KEY, JSON.stringify(rows)); } catch (e) { /* 무시 */ }
}

function fakeList(page) {
  const rows = fakeLoad().filter(p => !p.deleted)
    .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const at = Math.min(Math.max(1, page), pages);
  return {
    posts: rows.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE),
    page: at, pages, total
  };
}

// 가짜 저장소도 비밀번호를 **해시로** 들고 확인한다. 평문으로 두면
// localStorage 를 열어보는 것만으로 남의 글을 지울 수 있고, 틀린 비밀번호
// 경로를 시험할 수도 없다. (진짜 확인은 Worker 가 소금·후추와 함께 한다)
async function fakeHash(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fake:' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fakeCreate(input) {
  const rows = fakeLoad();
  const id = rows.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const post = {
    id,
    title: input.title,
    body: input.body,
    author: input.author || '익명',
    created_at: Date.now(),
    deleted: 0
  };
  rows.push({ ...post, pw_hash: await fakeHash(input.pw) });
  fakeSave(rows);
  return post;                        // 해시는 돌려주지 않는다
}

async function fakeRemove(id, pw) {
  const rows = fakeLoad();
  const row = rows.find(p => p.id === id && !p.deleted);
  if (!row) throw new ApiError('글을 찾을 수 없습니다', 404);
  if (row.pw_hash !== await fakeHash(pw)) {
    throw new ApiError('비밀번호가 맞지 않습니다', 403);
  }
  // 지우지 않고 표시만 한다 — 진짜 서버와 같은 방식.
  row.deleted = 1;
  fakeSave(rows);
  return { ok: true, id };
}

// ── 공통 ────────────────────────────────────────────────────────────
function validate(input) {
  const title = (input.title || '').trim();
  const body = (input.body || '').trim();
  const author = (input.author || '').trim();
  const pw = input.pw || '';
  if (!title) throw new ApiError('제목을 입력하세요', 400);
  if (title.length > TITLE_MAX) throw new ApiError(`제목은 ${TITLE_MAX}자까지입니다`, 400);
  if (!body) throw new ApiError('내용을 입력하세요', 400);
  if (body.length > BODY_MAX) throw new ApiError(`내용은 ${BODY_MAX}자까지입니다`, 400);
  if (author.length > AUTHOR_MAX) throw new ApiError(`이름은 ${AUTHOR_MAX}자까지입니다`, 400);
  if (pw.length < 4) throw new ApiError('비밀번호는 4자 이상이어야 합니다', 400);
  return { title, body, author, pw };
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, options);
  } catch (e) {
    // 네트워크 자체가 안 되는 경우. 화면에 원인을 보여줘야 한다.
    throw new ApiError('서버에 연결하지 못했습니다', 0);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
  if (!res.ok) {
    throw new ApiError((data && data.error) || '요청이 실패했습니다', res.status);
  }
  return data;
}

// ── 밖으로 내보내는 것 ──────────────────────────────────────────────
const Api = {
  PAGE_SIZE, TITLE_MAX, BODY_MAX, AUTHOR_MAX, ApiError,
  live: !!API_BASE,
  TURNSTILE_SITE_KEY,

  async list(page) {
    const at = Number(page) > 0 ? Math.floor(Number(page)) : 1;
    if (!API_BASE) {
      // 진짜 서버처럼 약간 늦게 준다 — 로딩 표시가 실제로 보이는지 확인용.
      await new Promise(r => setTimeout(r, 120));
      return fakeList(at);
    }
    return request('/api/posts?page=' + at, { method: 'GET' });
  },

  async create(input) {
    const clean = validate(input);
    if (!API_BASE) {
      await new Promise(r => setTimeout(r, 120));
      return fakeCreate(clean);
    }
    return request('/api/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 토큰은 validate() 가 돌려주는 값이 아니라 위젯이 준 것이라 따로
      // 붙인다. 가짜 저장소로 돌 때는 여기까지 오지 않는다.
      body: JSON.stringify({ ...clean, turnstile: input.turnstile || '' })
    });
  },

  // 글 비밀번호(또는 관리자 비밀번호)로 지운다. 로그인이 없으므로 이게
  // 본인이 자기 글을 지우는 유일한 수단이다.
  async remove(id, pw) {
    if (!pw) throw new ApiError('비밀번호를 입력하세요', 400);
    if (!API_BASE) {
      await new Promise(r => setTimeout(r, 120));
      return fakeRemove(id, pw);
    }
    return request('/api/posts/' + id, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pw })
    });
  },

  // 가짜 저장소에 시험용 글을 채운다. 화면 검증에만 쓴다.
  // 비밀번호는 전부 '1234' 로 둔다 — 삭제까지 시험할 수 있게.
  async _seed(n) {
    const hash = await fakeHash('1234');
    const rows = [];
    for (let i = 1; i <= n; i++) {
      rows.push({
        id: i,
        title: '시험용 글 ' + i,
        body: '내용 ' + i,
        author: i % 3 === 0 ? '익명' : '사용자' + i,
        created_at: Date.now() - (n - i) * 60000,
        deleted: 0,
        pw_hash: hash
      });
    }
    fakeSave(rows);
  },
  _clear() { fakeSave([]); }
};
