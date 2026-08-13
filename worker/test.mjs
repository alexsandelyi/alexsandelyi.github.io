// Worker 검증 — 진짜 스키마 위에서 fetch 핸들러를 통째로 돌린다.
//
//   node --experimental-sqlite worker/test.mjs
//
// D1 대신 node:sqlite 를 쓰고, D1 의 prepare/bind/all/first/run/batch 만
// 얇게 흉내 낸다. SQL 과 라우팅·검증·권한 로직은 배포될 코드 그대로다.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './src/index.js';

// ── D1 흉내 ─────────────────────────────────────────────────────────
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const wrap = sql => {
    let args = [];
    const stmt = db.prepare(sql);
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() {
        const r = stmt.run(...args);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
      }
    };
    return api;
  };
  return {
    prepare: wrap,
    async batch(list) { for (const s of list) await s.run(); }
  };
}

const env = {
  DB: makeDb(),
  ALLOW_ORIGIN: 'https://ilbbang.com',
  POST_COOLDOWN_SEC: '0',            // 시험 중에는 대기 없이
  PW_TRY_LIMIT: '5',
  PW_TRY_WINDOW_SEC: '600',
  PEPPER: 'test-pepper',
  IP_SALT: 'test-salt',
  ADMIN_PW: 'admin-secret'
  // TURNSTILE_SECRET 없음 → 검사 건너뜀 (util.js 주석 참조)
};

const BASE = 'https://api.ilbbang.com';
let fails = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'OK  ' : 'FAIL') + '  ' + label +
    (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
}

async function call(method, path, body, ip = '1.1.1.1') {
  const init = { method, headers: { 'cf-connecting-ip': ip } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await worker.fetch(new Request(BASE + path, init), env);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
  return { status: res.status, data, headers: res.headers };
}

const post = (over = {}, ip) =>
  call('POST', '/api/posts',
    { title: '제목', body: '내용', author: '글쓴이', pw: '1234', ...over }, ip);

// ── 검증 ────────────────────────────────────────────────────────────
console.log('— 목록과 페이지네이션 —');
{
  const r = await call('GET', '/api/posts');
  check('빈 목록', { s: r.status, total: r.data.total, pages: r.data.pages, n: r.data.posts.length },
    { s: 200, total: 0, pages: 1, n: 0 });
}
for (let i = 1; i <= 23; i++) await post({ title: '글 ' + i });
{
  const p1 = await call('GET', '/api/posts?page=1');
  check('23개 / 1페이지', { total: p1.data.total, pages: p1.data.pages, n: p1.data.posts.length },
    { total: 23, pages: 3, n: 10 });
  check('최신이 먼저', p1.data.posts[0].title, '글 23');
  const p3 = await call('GET', '/api/posts?page=3');
  check('마지막 페이지 개수', p3.data.posts.length, 3);
  const over = await call('GET', '/api/posts?page=999');
  check('?page=999 → 마지막으로 당김', over.data.page, 3);
  const zero = await call('GET', '/api/posts?page=0');
  check('?page=0 → 1', zero.data.page, 1);
  const abc = await call('GET', '/api/posts?page=abc');
  check('?page=abc → 1', abc.data.page, 1);
}

console.log('\n— 내부 값이 새지 않는가 —');
{
  const r = await call('GET', '/api/posts?page=1');
  const keys = Object.keys(r.data.posts[0]).sort();
  check('목록 응답의 열', keys, ['author', 'body', 'created_at', 'id', 'title', 'updated_at']);
  const one = await call('GET', '/api/posts/1');
  check('상세에 ip_hash·pw_hash 없음',
    ['ip_hash', 'pw_hash', 'pw_salt'].some(k => k in one.data), false);
}

console.log('\n— 서버측 입력 검증 (클라이언트를 거치지 않아도) —');
check('제목 없음', (await post({ title: '' })).data.error, '제목을 입력하세요');
check('공백만 제목', (await post({ title: '   ' })).data.error, '제목을 입력하세요');
check('내용 없음', (await post({ body: '' })).data.error, '내용을 입력하세요');
check('비밀번호 3자', (await post({ pw: '123' })).data.error, '비밀번호는 4자 이상이어야 합니다');
check('제목 101자', (await post({ title: '가'.repeat(101) })).data.error, '제목은 100자까지입니다');
check('본문 2001자', (await post({ body: '가'.repeat(2001) })).data.error, '내용은 2000자까지입니다');
check('이름 21자', (await post({ author: '가'.repeat(21) })).data.error, '이름은 20자까지입니다');
{
  const r = await post({ author: '' });
  check('이름 비우면 익명', r.data.author, '익명');
}

console.log('\n— 비밀번호로 수정·삭제 —');
let mine, beforeTotal;
{
  // 개수를 세지 말고 삭제 전후를 비교한다. 앞 절에서 글이 몇 개 생겼는지
  // 시험이 알 필요가 없다 — 처음엔 그걸 세다가 기대값을 틀렸다.
  beforeTotal = (await call('GET', '/api/posts')).data.total;
  const r = await post({ title: '내 글', pw: 'mypw1234' });
  mine = r.data.id;
  check('작성 201', r.status, 201);
  check('작성 후 총계 +1', (await call('GET', '/api/posts')).data.total, beforeTotal + 1);
}
check('틀린 비밀번호로 수정 거부',
  (await call('PATCH', `/api/posts/${mine}`, { title: '탈취', body: 'x', pw: 'wrong' })).status, 403);
check('틀린 비밀번호로 삭제 거부',
  (await call('DELETE', `/api/posts/${mine}`, { pw: 'wrong' })).status, 403);
{
  const r = await call('PATCH', `/api/posts/${mine}`,
    { title: '고친 제목', body: '고친 내용', author: '나', pw: 'mypw1234' });
  check('맞는 비밀번호로 수정', r.status, 200);
  const g = await call('GET', `/api/posts/${mine}`);
  check('수정 반영', g.data.title, '고친 제목');
  check('updated_at 기록됨', typeof g.data.updated_at === 'number', true);
}
check('관리자 비밀번호로 삭제',
  (await call('DELETE', `/api/posts/${mine}`, { pw: 'admin-secret' })).status, 200);
check('삭제된 글은 404', (await call('GET', `/api/posts/${mine}`)).status, 404);
{
  const r = await call('GET', '/api/posts?page=1');
  check('삭제 후 총계가 원래대로', r.data.total, beforeTotal);
  check('삭제된 글이 목록에 없음', r.data.posts.some(p => p.id === mine), false);
}

console.log('\n— 비밀번호 반복 시도 차단 —');
{
  const r = await post({ title: '표적', pw: 'secret99' });
  const target = r.data.id;
  let last = 0;
  for (let i = 0; i < 6; i++) {
    last = (await call('DELETE', `/api/posts/${target}`, { pw: 'x' + i }, '9.9.9.9')).status;
  }
  check('6번째 시도는 429', last, 429);
  check('맞는 비밀번호도 잠금 중엔 막힘',
    (await call('DELETE', `/api/posts/${target}`, { pw: 'secret99' }, '9.9.9.9')).status, 429);
  check('다른 IP 는 영향 없음',
    (await call('DELETE', `/api/posts/${target}`, { pw: 'secret99' }, '8.8.8.8')).status, 200);
}

console.log('\n— 연달아 쓰기 제한 —');
{
  env.POST_COOLDOWN_SEC = '60';
  await post({ title: '첫 글' }, '5.5.5.5');
  const second = await post({ title: '바로 두 번째' }, '5.5.5.5');
  check('같은 IP 연속 작성 429', second.status, 429);
  const other = await post({ title: '다른 사람' }, '6.6.6.6');
  check('다른 IP 는 됨', other.status, 201);
  env.POST_COOLDOWN_SEC = '0';
}

console.log('\n— 신고 —');
{
  const t = (await post({ title: '신고 대상' })).data.id;
  check('신고 성공', (await call('POST', `/api/posts/${t}/report`, { reason: '광고' }, '7.7.7.7')).status, 200);
  check('같은 사람 재신고 거부',
    (await call('POST', `/api/posts/${t}/report`, { reason: '또' }, '7.7.7.7')).status, 429);
  check('다른 사람은 됨',
    (await call('POST', `/api/posts/${t}/report`, {}, '7.7.7.8')).status, 200);
}

console.log('\n— 라우팅과 CORS —');
check('없는 주소 404', (await call('GET', '/api/nope')).status, 404);
check('없는 글 404', (await call('GET', '/api/posts/999999')).status, 404);
check('목록에 DELETE 405', (await call('DELETE', '/api/posts')).status, 405);
{
  const r = await call('OPTIONS', '/api/posts');
  check('OPTIONS 204', r.status, 204);
  check('CORS 출처 헤더', r.headers.get('access-control-allow-origin'), 'https://ilbbang.com');
}
check('깨진 JSON 400', (await (async () => {
  const res = await worker.fetch(new Request(BASE + '/api/posts', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{{{'
  }), env);
  return { status: res.status };
})()).status, 400);

console.log('\n— SQL 주입 시도 —');
{
  const r = await post({ title: "'); DROP TABLE posts;--", pw: '1234' });
  check('주입 문자열도 그냥 글자로 저장', r.status, 201);
  const l = await call('GET', '/api/posts?page=1');
  check('표가 살아 있음', l.data.total > 0, true);
  check('제목이 그대로 보존', l.data.posts[0].title, "'); DROP TABLE posts;--");
}

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exitCode = fails ? 1 : 0;
