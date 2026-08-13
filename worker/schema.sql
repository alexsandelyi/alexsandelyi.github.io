-- 커뮤니티 게시판 D1 스키마.
-- 규격은 community/README.md.
--
--   npx wrangler d1 execute ilbbang-community --local  --file=worker/schema.sql
--   npx wrangler d1 execute ilbbang-community --remote --file=worker/schema.sql

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  author     TEXT    NOT NULL DEFAULT '익명',
  created_at INTEGER NOT NULL,          -- epoch ms
  updated_at INTEGER,                   -- 수정한 적 없으면 NULL
  ip_hash    TEXT    NOT NULL,          -- 원문 IP 는 저장하지 않는다
  pw_salt    TEXT    NOT NULL,          -- 글마다 다르게
  pw_hash    TEXT    NOT NULL,          -- 본인 수정·삭제용. 평문 저장 안 함
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- 목록 질의가 그대로 타는 순서다: deleted 로 거르고 최신순.
CREATE INDEX IF NOT EXISTS idx_posts_list
  ON posts (deleted, created_at DESC, id DESC);

-- 같은 사람이 연달아 쓰는지 볼 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_posts_ip
  ON posts (ip_hash, created_at DESC);

-- 속도 제한·비밀번호 시도 횟수를 한 표로 센다.
-- key 예: 'post:<ip_hash>', 'pw:<post_id>:<ip_hash>'
CREATE TABLE IF NOT EXISTS throttle (
  key TEXT    NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_throttle ON throttle (key, at);

-- 신고. 남의 글을 받는 이상 필요하다.
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL,
  reason     TEXT,
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_post ON reports (post_id, created_at DESC);
