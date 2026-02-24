-- kborg D1 初期マイグレーション
-- TECHNICAL_DESIGN.md セクション4.1, 8.1, 8.2, 8.5 参照

CREATE TABLE items (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL DEFAULT 'manual',
  url           TEXT NOT NULL,
  url_hash      TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL DEFAULT '',
  summary_short TEXT NOT NULL DEFAULT '',
  summary_long  TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  personal_score REAL NOT NULL DEFAULT 0.0,
  org_score      REAL NOT NULL DEFAULT 0.0,
  novelty        REAL NOT NULL DEFAULT 0.0,
  base_score     REAL NOT NULL DEFAULT 0.0,
  status        TEXT NOT NULL DEFAULT 'active',
  pin           INTEGER NOT NULL DEFAULT 0,
  r2_path       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  processed_at  TEXT DEFAULT NULL
);

CREATE INDEX idx_items_created_at ON items(created_at DESC);
CREATE INDEX idx_items_base_score ON items(base_score DESC);
CREATE INDEX idx_items_org_score  ON items(org_score DESC);
CREATE INDEX idx_items_status     ON items(status);

CREATE TABLE user_profile (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  interests  TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 初期プロファイル（空）
INSERT INTO user_profile (id, interests) VALUES (1, '[]');

CREATE TABLE org_themes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  theme  TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE tag_vocabulary (
  tag         TEXT PRIMARY KEY,
  category    TEXT DEFAULT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0
);
