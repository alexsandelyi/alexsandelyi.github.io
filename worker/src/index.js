// index.js — 커뮤니티 게시판 API (Cloudflare Worker).
//
// 규격은 루트 CLAUDE.md 「커뮤니티 게시판」. 도우미는 util.js.
//
//   GET    /api/posts?page=1     목록 10개 + 총 개수
//   GET    /api/posts/:id        글 하나
//   POST   /api/posts            작성
//   PATCH  /api/posts/:id        수정 (글 비밀번호)
//   DELETE /api/posts/:id        삭제 (글 비밀번호 또는 관리자 비밀번호)
//   POST   /api/posts/:id/report 신고
//
// 로그인이 없다. 신원 대신 글마다 받은 비밀번호로 본인을 확인한다.

import {
  PAGE_SIZE, REASON_MAX, THROTTLE_RETAIN_SEC,
  json, fail, cors,
  sha256, randomHex, hashPw, hashIp, sameHash,
  cleanPost, tooMany, note, turnstileOk, publicPost
} from './util.js';

// 페이지 번호처럼 1 이상이어야 하는 값.
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

// 설정값. **0 을 유효한 값으로 받는다** — 대기 시간 0 은 「대기 없음」이라는
// 뜻이지 「설정 안 함」이 아니다. num() 을 그대로 썼더니 0 이 기본값 60 으로
// 되살아나 시험에서 글이 하나만 써졌다.
const cfg = (v, d) => {
  if (v === undefined || v === null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

// ── 목록 ────────────────────────────────────────────────────────────
async function listPosts(env, url) {
  const want = Math.max(1, Math.floor(num(url.searchParams.get('page'), 1)));

  const cnt = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM posts WHERE deleted = 0'
  ).first();
  const total = cnt && cnt.n ? cnt.n : 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // 없는 페이지를 달라고 하면 빈 화면 대신 마지막으로 당긴다.
  const page = Math.min(want, pages);

  const { results } = await env.DB.prepare(
    `SELECT id, title, body, author, created_at, updated_at
       FROM posts WHERE deleted = 0
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`
  ).bind(PAGE_SIZE, (page - 1) * PAGE_SIZE).all();

  return json({ posts: (results || []).map(publicPost), page, pages, total }, env);
}

async function getPost(env, id) {
  const row = await env.DB.prepare(
    'SELECT * FROM posts WHERE id = ? AND deleted = 0'
  ).bind(id).first();
  if (!row) return fail('글을 찾을 수 없습니다', env, 404);
  return json(publicPost(row), env);
}

// ── 작성 ────────────────────────────────────────────────────────────
async function createPost(env, req, ip) {
  let input;
  try { input = await req.json(); } catch (e) { return fail('잘못된 요청입니다', env, 400); }

  const clean = cleanPost(input);
  if (clean.error) return fail(clean.error, env, 400);

  if (!await turnstileOk(env, input && input.turnstile, ip)) {
    return fail('사람인지 확인하지 못했습니다. 다시 시도해 주세요', env, 403);
  }

  const ipHash = await hashIp(env.IP_SALT || '', ip);
  const cooldown = cfg(env.POST_COOLDOWN_SEC, 60);
  if (await tooMany(env.DB, 'post:' + ipHash, cooldown, 1)) {
    return fail(`너무 자주 올리고 있습니다. ${cooldown}초 뒤에 다시 시도해 주세요`, env, 429);
  }

  const salt = randomHex(16);
  const pwHash = await hashPw(salt, env.PEPPER || '', clean.value.pw);
  const now = Date.now();

  const res = await env.DB.prepare(
    `INSERT INTO posts (title, body, author, created_at, ip_hash, pw_salt, pw_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(clean.value.title, clean.value.body, clean.value.author,
    now, ipHash, salt, pwHash).run();

  await note(env.DB, 'post:' + ipHash);

  const id = res.meta && res.meta.last_row_id;
  return json({
    id,
    title: clean.value.title,
    body: clean.value.body,
    author: clean.value.author,
    created_at: now,
    updated_at: null
  }, env, 201);
}

// ── 본인 확인 ───────────────────────────────────────────────────────
// 글 비밀번호가 맞거나, 관리자 비밀번호면 통과. 틀린 시도는 세어서 막는다.
// 4자리 비밀번호는 반복 시도로 금방 뚫린다.
//
// **두 가지를 센다.** IP 별 제한만 두면 주소를 바꿔가며 얼마든지 두들길 수
// 있다 — IP 당 5회면 2000개로 4자리 1만 가지를 전부 시도할 수 있고, IPv6
// 에서는 어렵지 않다. 그래서 글 하나에 대한 전체 시도도 함께 센다.
//
// 창은 THROTTLE_RETAIN_SEC 로 자른다. 그보다 길게 잡으면 기록이 먼저
// 지워져 제한이 조용히 풀린다 (util.js 참조).
async function authorize(env, row, given, ipHash) {
  const ipKey = `pw:${row.id}:${ipHash}`;
  const allKey = `pw:${row.id}`;
  const cap = (v, d) => Math.min(cfg(v, d), THROTTLE_RETAIN_SEC);
  const limit = cfg(env.PW_TRY_LIMIT, 5);
  const windowSec = cap(env.PW_TRY_WINDOW_SEC, 600);
  const allLimit = cfg(env.PW_TRY_LIMIT_ALL, 60);
  const allWindowSec = cap(env.PW_TRY_WINDOW_ALL_SEC, 3600);

  if (await tooMany(env.DB, ipKey, windowSec, limit)) {
    return { error: '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요', status: 429 };
  }

  const pw = String(given || '');
  // 관리자는 전체 잠금에 걸리지 않는다. 걸리면 누군가 일부러 글을 두들겨
  // 잠가둔 상태에서 신고 처리를 못 한다. IP 제한은 위에서 이미 받았으므로
  // 관리자 비밀번호 자체를 무한히 시도할 수는 없다.
  if (env.ADMIN_PW && pw && sameHash(await sha256(pw), await sha256(env.ADMIN_PW))) {
    return { admin: true };
  }

  if (await tooMany(env.DB, allKey, allWindowSec, allLimit)) {
    return { error: '이 글에 시도가 너무 많았습니다. 잠시 후 다시 시도해 주세요', status: 429 };
  }
  const hash = await hashPw(row.pw_salt, env.PEPPER || '', pw);
  if (sameHash(hash, row.pw_hash)) return { admin: false };

  await note(env.DB, ipKey, allKey);
  return { error: '비밀번호가 맞지 않습니다', status: 403 };
}

async function loadForAuth(env, id) {
  return env.DB.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0')
    .bind(id).first();
}

async function editPost(env, req, id, ip) {
  let input;
  try { input = await req.json(); } catch (e) { return fail('잘못된 요청입니다', env, 400); }

  const row = await loadForAuth(env, id);
  if (!row) return fail('글을 찾을 수 없습니다', env, 404);

  const clean = cleanPost(input);
  if (clean.error) return fail(clean.error, env, 400);

  const ipHash = await hashIp(env.IP_SALT || '', ip);
  const ok = await authorize(env, row, input.pw, ipHash);
  if (ok.error) return fail(ok.error, env, ok.status);

  const now = Date.now();
  await env.DB.prepare(
    'UPDATE posts SET title = ?, body = ?, author = ?, updated_at = ? WHERE id = ?'
  ).bind(clean.value.title, clean.value.body, clean.value.author, now, id).run();

  return json({ id, ...clean.value, pw: undefined, updated_at: now }, env);
}

async function deletePost(env, req, id, ip) {
  let input = {};
  try { input = await req.json(); } catch (e) { /* 본문 없이 와도 된다 */ }

  const row = await loadForAuth(env, id);
  if (!row) return fail('글을 찾을 수 없습니다', env, 404);

  const ipHash = await hashIp(env.IP_SALT || '', ip);
  const ok = await authorize(env, row, input.pw, ipHash);
  if (ok.error) return fail(ok.error, env, ok.status);

  // 지우지 않고 표시만 한다. 실수를 되돌릴 수 있고 신고 처리 이력이 남는다.
  await env.DB.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').bind(id).run();
  return json({ ok: true, id }, env);
}

async function reportPost(env, req, id, ip) {
  let input = {};
  try { input = await req.json(); } catch (e) { /* 이유 없이 와도 된다 */ }

  const row = await loadForAuth(env, id);
  if (!row) return fail('글을 찾을 수 없습니다', env, 404);

  const ipHash = await hashIp(env.IP_SALT || '', ip);
  // 같은 사람이 같은 글을 반복 신고하지 못하게 한다.
  if (await tooMany(env.DB, `report:${id}:${ipHash}`, 86400, 1)) {
    return fail('이미 신고한 글입니다', env, 429);
  }

  const reason = String(input.reason || '').trim().slice(0, REASON_MAX);
  await env.DB.prepare(
    'INSERT INTO reports (post_id, reason, ip_hash, created_at) VALUES (?, ?, ?, ?)'
  ).bind(id, reason, ipHash, Date.now()).run();
  await note(env.DB, `report:${id}:${ipHash}`);

  return json({ ok: true }, env);
}

// ── 라우팅 ──────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ip = req.headers.get('cf-connecting-ip') || '';

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    const m = url.pathname.match(/^\/api\/posts(?:\/(\d+))?(?:\/(report))?\/?$/);
    if (!m) return fail('없는 주소입니다', env, 404);
    const id = m[1] ? Number(m[1]) : null;
    const sub = m[2] || null;

    try {
      if (sub === 'report') {
        if (req.method !== 'POST') return fail('허용되지 않는 메서드입니다', env, 405);
        return await reportPost(env, req, id, ip);
      }
      if (id == null) {
        if (req.method === 'GET') return await listPosts(env, url);
        if (req.method === 'POST') return await createPost(env, req, ip);
        return fail('허용되지 않는 메서드입니다', env, 405);
      }
      if (req.method === 'GET') return await getPost(env, id);
      if (req.method === 'PATCH') return await editPost(env, req, id, ip);
      if (req.method === 'DELETE') return await deletePost(env, req, id, ip);
      return fail('허용되지 않는 메서드입니다', env, 405);
    } catch (e) {
      // 내부 오류 메시지를 그대로 내보내면 표 이름 같은 것이 새어 나간다.
      console.error(e && e.stack || e);
      return fail('서버 오류가 발생했습니다', env, 500);
    }
  }
};
