# 커뮤니티 게시판 — 설계

**상태: 설계 확정, 구현 전** (2026-08-13).

누구나 글을 쓰고 누구나 읽는다. 한 페이지에 10개.

## 왜 별도 페이지인가

런처 번들(`index.html`) 안의 커뮤니티 섹션에는 「글 쓰기」 버튼이 있지만
아무 동작도 없고 글 목록도 더미다. **거기에 기능을 넣으면 안 된다** —
번들은 외부 도구가 재생성하므로 손으로 넣은 코드는 다음 재생성 때 사라진다
(루트 `CLAUDE.md`). `games/soccer/` 와 같이 번들 밖 독립 페이지로 만들고,
런처의 「커뮤니티」 버튼 연결만 `tmp/patch-*.js` 로 처리한다.

## 구조

```
community/            정적 프런트 — GitHub Pages 가 서빙
  index.html
  js/01-api.js        서버 통신. **저장소를 바꾸려면 이 파일만 갈아끼운다**
  js/02-list.js       목록·페이지네이션
  js/03-write.js      작성 폼
  js/04-view.js       글 상세

worker/               Cloudflare Worker — Pages 가 서빙하지 않는다
  src/index.js        라우팅·검증
  schema.sql          D1 테이블
  wrangler.toml
```

`js/` 를 번호로 나누고 클래식 `<script src>` 로 부르는 것은 축구 게임과
같다 — 빌드가 필요 없다.

## 호스팅 — 서브도메인을 쓴다

| 이름 | 가리키는 곳 | Cloudflare 프록시 |
|---|---|---|
| `ilbbang.com` | GitHub Pages | **끔** (지금 그대로) |
| `www.ilbbang.com` | GitHub Pages | **끔** |
| `api.ilbbang.com` | Worker | **켬** (Worker 는 프록시가 필요) |

**기존 설정을 건드리지 않는 것이 요점이다.** `ilbbang.com/api/*` 로 Worker
경로를 잡으려면 apex 에 프록시를 켜야 하는데, 그러면 GitHub Pages 의 인증서
갱신(90일마다 HTTP 검증)에 위험이 생긴다. 지금 잘 도는 것을 굳이 흔들지
않는다.

대신 출처가 달라지므로 **CORS** 가 필요하다. Worker 가
`Access-Control-Allow-Origin: https://ilbbang.com` 을 붙인다.

## 데이터 모델

```sql
CREATE TABLE posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  author     TEXT    NOT NULL,          -- 표시용 이름
  created_at INTEGER NOT NULL,          -- epoch ms
  ip_hash    TEXT    NOT NULL,          -- 원문 IP 는 저장하지 않는다
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_posts_list ON posts (deleted, created_at DESC, id DESC);
```

**원문 IP 를 저장하지 않는다.** 서버 쪽 소금값과 함께 해시해서 넣고, 속도
제한과 악용 추적에만 쓴다. 개인정보를 필요 이상으로 들고 있지 않는다.

**지우지 않고 `deleted` 를 세운다.** 실수로 지운 것을 되돌릴 수 있고,
신고 처리 이력이 남는다.

## API

| 메서드 | 경로 | 내용 |
|---|---|---|
| `GET` | `/api/posts?page=1` | 목록 10개 + 총 개수 |
| `GET` | `/api/posts/:id` | 글 하나 |
| `POST` | `/api/posts` | 작성 (Turnstile 토큰 필요) |
| `POST` | `/api/posts/:id/report` | 신고 |
| `DELETE` | `/api/posts/:id` | 삭제 (관리자 비밀번호) |

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
| **삭제 수단** | 관리자 비밀번호로 언제든 지울 수 있어야 한다 |
| **신고 버튼** | 남의 글을 받는 이상 필요하다 |

**XSS 는 타협하지 않는다.** 사용자 글을 `innerHTML` 에 넣지 않는다.
`textContent` 만 쓴다. 이것 하나로 대부분의 사고가 막힌다.

**비밀은 저장소에 넣지 않는다.** 이 저장소는 Public 이다. 관리자 비밀번호,
Turnstile 비밀키, IP 소금값은 전부 `wrangler secret put` 으로 Cloudflare 에
둔다. 코드에는 이름만 남는다.

## 프런트 동작

- 주소에 `?page=2` 를 반영한다 — 새로고침·뒤로가기·링크 공유가 된다
- 한 페이지 **10개 고정**
- **로딩 / 빈 목록 / 오류** 세 상태를 각각 그린다. 서버가 죽었을 때
  빈 화면만 나오면 원인을 알 수 없다
- 작성은 목록 위의 「글 쓰기」로 연다

## 만드는 순서

1. D1 만들고 스키마 넣기 — 로컬에서 `wrangler d1 execute --local` 로 확인
2. Worker 의 `GET /api/posts` 만 먼저. 더미 데이터로 목록·페이지네이션 완성
3. 프런트 목록 화면 (로딩·빈·오류 포함)
4. `POST /api/posts` + Turnstile + 속도 제한 + 서버 검증
5. 삭제·신고
6. `api.ilbbang.com` 연결, CORS 확인
7. 런처 「커뮤니티」 버튼 연결 (`tmp/patch-*.js`)

## 검증

- 글 0개 / 1개 / 10개 / 11개 / 137개에서 페이지 번호가 맞는가
- `?page=999` 처럼 없는 페이지에 들어가면 어떻게 되는가
- 제목에 `<script>` 를 넣어도 실행되지 않는가
- 같은 사람이 연속으로 쓰면 막히는가
- 서버가 죽었을 때 화면에 오류가 뜨는가
- 모바일 세로에서 목록·작성 폼이 쓸 만한가
