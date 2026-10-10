-- D1 schema for antares-comments. Apply with:
--   npx wrangler d1 execute antares-comments --remote --file=schema.sql
-- (and --local for `wrangler dev`). Safe to re-run.

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,                -- c_ + 12 base-36 chars
  page        TEXT NOT NULL,                   -- /blog/<slug>/
  parent      TEXT,                            -- top-level comment it answers
  name        TEXT NOT NULL,
  email       TEXT,                            -- only kept when reply emails are on
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('published', 'pending')),
  owner       INTEGER NOT NULL DEFAULT 0,      -- 1 = the site owner, via /admin
  moderation  TEXT,                            -- why it was held, if it was
  ip_hash     TEXT,                            -- salted SHA-256, for rate limits
  created_at  INTEGER NOT NULL,                -- ms since epoch
  notified    INTEGER NOT NULL DEFAULT 0       -- reply email sent to the parent's author
);
CREATE INDEX IF NOT EXISTS comments_by_page ON comments (page, status, created_at);
CREATE INDEX IF NOT EXISTS comments_by_ip ON comments (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS reactions (
  page        TEXT NOT NULL,
  kind        TEXT NOT NULL,                   -- one of the REACTIONS var
  voter       TEXT NOT NULL,                   -- salted hash of the browser's visitor id
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (page, kind, voter)
);
CREATE INDEX IF NOT EXISTS reactions_by_ip ON reactions (page, kind, ip_hash);
