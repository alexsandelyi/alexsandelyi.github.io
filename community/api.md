# 커뮤니티 API — 서버 설계

**상태: 코드 완성, 배포 전** (2026-08-13).

Cloudflare Workers + D1. 화면 쪽과 전체 개요는
[README.md](README.md) 참조. 이 문서가 200줄을 넘어서 나눴다.

## 데이터 모델

```sql
CREATE TABLE posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  author     TEXT    NOT NULL DEFAULT '익명',
  created_at INTEGER NOT NULL,          -- epoch ms
  ip_hash    TEXT    NOT NULL,          -- 원문 IP 는 저장하지 않는다
  pw_salt    TEXT    NOT NULL,          -- 글마다 다르게
  pw_hash    TEXT    NOT NULL,          -- 본인 삭제용. 평문 저장 안 함
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_posts_list ON posts (deleted, created_at DESC, id DESC);
```

**원문 IP 를 저장하지 않는다.** 서버 쪽 소금값과 함께 해시해서 넣고, 속도
제한과 악용 추적에만 쓴다. 개인정보를 필요 이상으로 들고 있지 않는다.

**지우지 않고 `deleted` 를 세운다.** 실수로 지운 것을 되돌릴 수 있고,
신고 처리 이력이 남는다.

## 로그인이 없으므로 글마다 비밀번호를 받는다

글쓴이가 「내가 썼다」를 증명할 방법이 없다. 한국 익명 게시판이 오래 쓰는
방식을 그대로 쓴다 — **글 쓸 때 비밀번호를 같이 받아 본인 수정·삭제에
쓴다.** 이게 없으면 오타 하나 고치는 것도, 본인이 올린 개인정보를 스스로
지우는 것도 못 한다.

관리자 비밀번호는 이것과 별개이고 모든 글을 지울 수 있다.

**해시는 SHA-256 + 글마다 다른 소금값 + 서버 후추값**으로 한다. bcrypt 나
반복 많은 PBKDF2 를 쓰지 않는 이유는 **Workers 무료 플랜의 CPU 한도가
호출당 10ms** 라 반복 해싱이 한도를 넘기기 때문이다.

이 약한 해시를 받아들이는 근거는 **이게 계정 비밀번호가 아니라 글 하나를
지우는 코드**라는 것이다. 대신 화면에 **「쓰던 비밀번호를 넣지 마세요」**를
반드시 띄운다. 재사용하면 우리 약한 해시가 남의 계정 위험이 된다.

## API

| 메서드 | 경로 | 내용 |
|---|---|---|
| `GET` | `/api/posts?page=1` | 목록 10개 + 총 개수 |
| `GET` | `/api/posts/:id` | 글 하나 |
| `POST` | `/api/posts` | 작성 (Turnstile 토큰 필요) |
| `POST` | `/api/posts/:id/report` | 신고 |
| `DELETE` | `/api/posts/:id` | 삭제 (글 비밀번호 **또는** 관리자 비밀번호) |
| `PATCH` | `/api/posts/:id` | 수정 (글 비밀번호) |

```json
{ "posts": [ ... ], "page": 1, "pages": 14, "total": 137 }
```

**커서가 아니라 오프셋을 쓴다.** 게시판은 「3페이지로」가 필요하고, 글이
수천 개 수준이면 `LIMIT 10 OFFSET n` 이 느려지지 않는다. 수만 개가 되면
그때 커서로 바꾼다.

`total` 을 위한 `COUNT(*)` 는 행을 전부 읽는다. D1 무료 한도가 하루 500만
행 읽기라 작은 게시판에서는 문제없지만, **글이 많아지면 여기가 먼저
터진다.** 그때는 개수를 별도 행에 캐시한다.

## 악용 대책 — 없으면 며칠 만에 스팸으로 덮인다

공개 사이트의 인증 없는 쓰기 엔드포인트는 봇이 금방 찾아낸다. 아래는
선택이 아니라 전제다.

| 대책 | 내용 |
|---|---|
| **Turnstile** | Cloudflare 캡차. 무료이고 같은 벤더라 붙이기 쉽다 |
| **속도 제한** | 같은 `ip_hash` 로 N분에 1개 |
| **길이 제한** | 제목 100자 / 본문 2000자. **서버에서 검증한다** |
| **삭제 수단** | 글 비밀번호로 본인이, 관리자 비밀번호로 내가 지운다 |
| **비밀번호 시도 제한** | 같은 글에 반복 시도하면 막는다. 안 그러면 4자리는 금방 뚫린다 |
| **신고 버튼** | 남의 글을 받는 이상 필요하다 |

**XSS 는 타협하지 않는다.** 사용자 글을 `innerHTML` 에 넣지 않는다.
`textContent` 만 쓴다. 이것 하나로 대부분의 사고가 막힌다.

**비밀은 저장소에 넣지 않는다.** 이 저장소는 Public 이다. 관리자 비밀번호,
Turnstile 비밀키, IP 소금값은 전부 `wrangler secret put` 으로 Cloudflare 에
둔다. 코드에는 이름만 남는다.

## 프런트 동작

- 주소에 `?page=2` 를 반영한다 — 새로고침·뒤로가기·링크 공유가 된다
- 한 페이지 **10개 고정**
- **로딩 / 빈 목록 / 오류**를 각각 그린다. 서버가 죽었을 때 빈 화면만
  나오면 원인을 알 수 없다
- 작성은 목록 위의 「글 쓰기」로 연다

## Worker 검증 — 배포 없이 돈다

`worker/test.mjs` 가 **진짜 스키마 위에서 fetch 핸들러를 통째로** 돌린다.
D1 대신 Node 내장 `node:sqlite` 를 쓰고 `prepare/bind/all/first/run/batch`
만 얇게 흉내 낸다 — SQL·라우팅·검증·권한 로직은 배포될 코드 그대로다.

```bash
node worker/test.mjs
```

46항목. 페이지네이션, 내부 열 유출, 서버측 입력 검증, 비밀번호 수정·삭제,
시도 횟수 차단, 연속 작성 제한, 신고, 라우팅·CORS, SQL 주입까지 본다.
