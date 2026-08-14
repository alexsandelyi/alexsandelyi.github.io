// util.js — 해시, 검증, 응답, 속도 제한.
//
// index.js 가 500줄을 넘지 않게 나눴다.

export const PAGE_SIZE = 10;
export const TITLE_MAX = 100;
export const BODY_MAX = 2000;
export const AUTHOR_MAX = 20;
export const PW_MIN = 4;
export const PW_MAX = 64;
export const REASON_MAX = 200;

// ── 응답 ────────────────────────────────────────────────────────────
// 프런트가 다른 출처(ilbbang.com)에 있으므로 CORS 헤더가 필요하다.
export function cors(env) {
  return {
    'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'origin'
  };
}

export function json(data, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(env) }
  });
}

export function fail(message, env, status = 400) {
  return json({ error: message }, env, status);
}

// ── 해시 ────────────────────────────────────────────────────────────
// SHA-256 이다. bcrypt 나 반복 많은 PBKDF2 를 쓰지 않는 이유는 Workers
// 무료 플랜의 CPU 한도가 호출당 10ms 라 반복 해싱이 한도를 넘기기
// 때문이다. 이게 계정 비밀번호가 아니라 글 하나를 지우는 코드라서
// 받아들이는 타협이고, 화면에 "쓰던 비밀번호를 넣지 마세요"를 띄운다.
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const hashPw = (salt, pepper, pw) => sha256(salt + ':' + pepper + ':' + pw);

// 원문 IP 는 저장하지 않는다. 속도 제한과 악용 추적에만 쓰는 해시다.
export const hashIp = (salt, ip) => sha256(salt + ':' + (ip || 'unknown'));

// 길이가 같은 16진 문자열 비교. 앞에서 다르다고 바로 끝내면 걸린 시간으로
// 몇 글자가 맞았는지 새어 나간다.
export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── 검증 ────────────────────────────────────────────────────────────
// **클라이언트 검증을 믿지 않는다.** 브라우저를 거치지 않고 바로 호출할 수
// 있으므로 서버에서 다시 본다.
export function cleanPost(input) {
  const title = String(input && input.title || '').trim();
  const body = String(input && input.body || '').trim();
  const author = String(input && input.author || '').trim() || '익명';
  const pw = String(input && input.pw || '');

  if (!title) return { error: '제목을 입력하세요' };
  if ([...title].length > TITLE_MAX) return { error: `제목은 ${TITLE_MAX}자까지입니다` };
  if (!body) return { error: '내용을 입력하세요' };
  if ([...body].length > BODY_MAX) return { error: `내용은 ${BODY_MAX}자까지입니다` };
  if ([...author].length > AUTHOR_MAX) return { error: `이름은 ${AUTHOR_MAX}자까지입니다` };
  if (pw.length < PW_MIN) return { error: `비밀번호는 ${PW_MIN}자 이상이어야 합니다` };
  if (pw.length > PW_MAX) return { error: `비밀번호가 너무 깁니다` };

  return { value: { title, body, author, pw } };
}

// ── 속도 제한 ───────────────────────────────────────────────────────
// throttle 표에 시도를 기록하고 최근 개수를 센다. 창 밖의 낡은 기록은
// 쓸 때마다 조금씩 지워 표가 무한정 커지지 않게 한다.
//
// **기록 보관 기간이 곧 셀 수 있는 최대 창이다.** 이보다 긴 창을 설정하면
// 기록이 먼저 지워져 제한이 조용히 풀린다. 그래서 이 값을 밖으로 내보내고
// index.js 가 설정값을 여기에 맞춰 자른다.
export const THROTTLE_RETAIN_SEC = 86400;

export async function tooMany(db, key, windowSec, limit) {
  const since = Date.now() - Math.min(windowSec, THROTTLE_RETAIN_SEC) * 1000;
  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM throttle WHERE key = ? AND at > ?'
  ).bind(key, since).first();
  return (row && row.n ? row.n : 0) >= limit;
}

// 키를 여러 개 받는다. 한 시도를 「이 IP 의 시도」와 「이 글의 시도」로
// 동시에 세야 해서다 — 두 번 부르면 batch 도 두 번이고 청소도 두 번이다.
export async function note(db, ...keys) {
  const now = Date.now();
  await db.batch([
    ...keys.map(k =>
      db.prepare('INSERT INTO throttle (key, at) VALUES (?, ?)').bind(k, now)),
    // 보관 기간이 지난 기록은 버린다. 매 쓰기마다 조금씩 치우는 방식이라
    // 따로 청소 작업을 돌릴 필요가 없다.
    db.prepare('DELETE FROM throttle WHERE at < ?')
      .bind(now - THROTTLE_RETAIN_SEC * 1000)
  ]);
}

// ── Turnstile ───────────────────────────────────────────────────────
// 봇의 대량 등록을 막는다. 비밀키가 설정돼 있지 않으면 검사를 건너뛴다 —
// 로컬 개발에서 키 없이 돌리기 위해서다. **운영에서는 반드시 넣는다.**
export async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form }
    );
    const data = await res.json();
    return !!(data && data.success);
  } catch (e) {
    // 검증 서버에 못 닿으면 통과시키지 않는다. 열어두면 그때만 노려서
    // 밀어 넣을 수 있다.
    return false;
  }
}

// 목록·상세로 나갈 때 내부용 열을 지운다. ip_hash 와 비밀번호 해시는
// 절대 밖으로 내보내지 않는다.
export function publicPost(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    author: row.author,
    created_at: row.created_at,
    updated_at: row.updated_at || null
  };
}
