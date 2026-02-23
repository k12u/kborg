# kborg 技術設計書 v1.0

GOAL.md（目的定義）および DESIGN.md（基本設計 v0.1）を踏まえた実装レベルの技術設計。

---

## 1. システム概要

**kborg** は「認知負債を増やさずに思考をアップデートし続ける装置」である。

ブックマークされた外部情報を自動で取得・要約・評価・ベクトル化し、
個人と組織の両方に向けた「関心の地図」としてブラウズ・検索可能にする。

### 技術スタック

| レイヤー | サービス | 用途 |
|---------|---------|------|
| Compute | Cloudflare Workers | Ingest API, Portal API |
| DB | Cloudflare D1 | メタデータ・スコア・状態 |
| Storage | Cloudflare R2 | clean text 原本 (gzip) |
| Vector | Cloudflare Vectorize | embedding 保存・類似検索 |
| Frontend | Cloudflare Pages | Portal SPA |
| LLM | Anthropic Claude API | 要約・スコア・タグ生成 |

---

## 2. アーキテクチャ

```text
[Webhook / Browser Extension / CLI]
         │
         ▼
┌─────────────────────────────────────┐
│  Ingest Worker                      │
│  POST /api/ingest                   │
│  ┌───────────┐                      │
│  │ URL受信    │                      │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ HTML取得   │ fetch(url)          │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ clean text │ HTMLタグ除去         │
│  │ 抽出      │ Readability的処理    │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ R2保存    │ gzip圧縮 clean text  │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ LLM処理   │ Claude API           │
│  │ ・要約生成 │ summary_short (≤80字)│
│  │ ・要約詳細 │ summary_long (≤400字)│
│  │ ・タグ生成 │ tags[] (≤5個)       │
│  │ ・スコア   │ personal / org      │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ embedding │ Vectorize embedding  │
│  │ 生成      │ model で生成         │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ novelty   │ 既存との最大類似度   │
│  │ 算出      │ から逆算             │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ D1保存    │ メタ・スコア一括     │
│  └─────┬─────┘                      │
│        ▼                            │
│  ┌───────────┐                      │
│  │ Vectorize │ embedding + metadata │
│  │ upsert    │                      │
│  └───────────┘                      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Portal Worker (API)                │
│  GET  /api/items         Browse     │
│  GET  /api/items/:id     Detail     │
│  GET  /api/search        Vector検索 │
│  PATCH /api/items/:id    状態変更   │
│  GET  /api/org           組織View   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Portal Frontend (Pages SPA)        │
│  - Browse (重要順 / 時系列)          │
│  - Search (セマンティック検索)        │
│  - Detail (原文表示)                 │
│  - Org View (組織向けフィルタ)        │
└─────────────────────────────────────┘
```

---

## 3. データ設計

### 3.1 D1 スキーマ

```sql
CREATE TABLE items (
  id            TEXT PRIMARY KEY,        -- sha256(normalized_url)
  source        TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'extension' | 'webhook'
  url           TEXT NOT NULL,
  url_hash      TEXT NOT NULL UNIQUE,    -- sha256(normalized_url) = id と同値、明示的制約用
  title         TEXT NOT NULL DEFAULT '',
  summary_short TEXT NOT NULL DEFAULT '', -- ≤80字の一行要約
  summary_long  TEXT NOT NULL DEFAULT '', -- ≤400字の詳細要約
  tags          TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  personal_score REAL NOT NULL DEFAULT 0.0, -- 0.0〜1.0
  org_score      REAL NOT NULL DEFAULT 0.0, -- 0.0〜1.0
  novelty        REAL NOT NULL DEFAULT 0.0, -- 0.0〜1.0
  base_score     REAL NOT NULL DEFAULT 0.0, -- 計算値: 0.5*personal + 0.3*org + 0.2*novelty
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'muted' | 'archived'
  pin           INTEGER NOT NULL DEFAULT 0,     -- 0 or 1
  r2_path       TEXT NOT NULL DEFAULT '',
  content_hash  TEXT NOT NULL DEFAULT '', -- sha256(clean_text) 重複検出用
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  processed_at  TEXT DEFAULT NULL
);

CREATE INDEX idx_items_created_at ON items(created_at DESC);
CREATE INDEX idx_items_base_score ON items(base_score DESC);
CREATE INDEX idx_items_org_score  ON items(org_score DESC);
CREATE INDEX idx_items_status     ON items(status);
```

### 3.2 R2 オブジェクト構造

```
kborg/
  items/
    {id}/
      clean.txt.gz    -- gzip圧縮 clean text
```

- Key format: `items/{id}/clean.txt.gz`
- Content-Encoding: gzip
- Content-Type: text/plain; charset=utf-8
- clean text上限: **30KB**（超過時はtruncate、元の長さをD1に記録）

### 3.3 Vectorize

- Index名: `kborg-items`
- Dimensions: Cloudflare Vectorize の `@cf/baai/bge-base-en-v1.5` モデル準拠 = **768次元**
- Distance metric: **cosine**
- Metadata: `{ source: string, created_at: string }`

---

## 4. API 設計

### 4.1 Ingest API

```
POST /api/ingest
Authorization: Bearer {API_KEY}
Content-Type: application/json

{
  "url": "https://example.com/article",
  "source": "extension"    // optional, default: "manual"
}
```

**レスポンス**

```json
// 201 Created
{
  "id": "a1b2c3...",
  "title": "記事タイトル",
  "summary_short": "一行要約",
  "base_score": 0.72,
  "status": "active"
}

// 200 OK (重複)
{
  "id": "a1b2c3...",
  "duplicate": true,
  "message": "Already ingested"
}
```

**処理フロー**

1. URL正規化（末尾スラッシュ、パラメータソート、fragment除去）
2. `url_hash = sha256(normalized_url)` で重複チェック
3. 重複なら既存レコード返却
4. `fetch(url)` でHTML取得（タイムアウト: 10秒）
5. clean text抽出（後述）
6. `content_hash = sha256(clean_text)` で内容重複チェック
7. R2に gzip圧縮して保存
8. Claude APIで要約・スコア・タグ生成（後述）
9. Vectorize embedding modelでembedding生成
10. 既存embeddingと比較してnovelty算出
11. `base_score` 計算
12. D1にINSERT
13. Vectorizeにupsert

### 4.2 Portal API

```
GET /api/items?view={browse|recent|org}&page=1&limit=20
```

| view | フィルタ | ソート |
|------|---------|--------|
| browse (default) | status=active | pin DESC, base_score DESC |
| recent | status=active | created_at DESC |
| org | status=active AND org_score >= 0.6 | org_score DESC |

```
GET /api/items/:id
```
- D1からメタデータ取得
- R2からclean text取得（オンデマンド解凍）

```
GET /api/search?q={query}&limit=10
```
1. queryをembedding化
2. Vectorizeで類似検索（topK=limit）
3. 返却されたIDでD1からメタデータ取得
4. status=muted/archivedを除外

```
PATCH /api/items/:id
Authorization: Bearer {API_KEY}
Content-Type: application/json

{
  "status": "muted",    // optional
  "pin": 1              // optional
}
```

---

## 5. 未決事項への設計判断

DESIGN.md セクション9 の未決事項に対する具体的な設計判断。

### 5.1 personal_score の定義

**方針: LLMプロファイルマッチング**

ユーザーの関心領域をプロファイルとしてD1に保存し、LLMがコンテンツとプロファイルの合致度を判定する。

```sql
CREATE TABLE user_profile (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  interests  TEXT NOT NULL DEFAULT '[]',  -- JSON: ["distributed systems", "investment", "org design", ...]
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

LLMプロンプト（スコア算出部分）:

```
Given the user's interest profile: {interests}
Rate how relevant this article is to the user on a scale of 0.0 to 1.0.

Article title: {title}
Article content (first 2000 chars): {content_truncated}

Return a JSON object: { "personal_score": 0.0-1.0, "reasoning": "..." }
```

- 初期プロファイルは手動設定（5〜15キーワード）
- 将来的に高スコア記事からの自動プロファイル更新を検討

### 5.2 org_score の定義

**方針: 固定テーマリスト + LLM判定**

```sql
CREATE TABLE org_themes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  theme TEXT NOT NULL,         -- "AI/ML infrastructure", "developer productivity", etc.
  weight REAL NOT NULL DEFAULT 1.0
);
```

LLMプロンプト:

```
Given the organization's priority themes:
{themes_list}

Rate how relevant this article is to the organization on a scale of 0.0 to 1.0.

Article title: {title}
Article summary: {summary_long}

Return a JSON object: { "org_score": 0.0-1.0, "matched_themes": [...] }
```

- org_themesは管理画面またはAPI経由で更新
- テーマ数の上限: 20

### 5.3 novelty 算出方法

**方針: 直近embeddings との最大cosine類似度の逆数**

```
novelty = 1.0 - max_similarity

ここで:
  max_similarity = max(cosine_sim(new_embedding, existing_embedding_i))
  対象: 直近100件のembedding (Vectorize query, topK=5)
```

- topK=5の最近傍検索を実行
- 最も類似度の高いものの値を採用
- 類似度0.95以上 → novelty = 0.05（ほぼ重複コンテンツ）
- 類似度0.3以下 → novelty = 0.7（完全に新規トピック）

### 5.4 clean text の上限

**方針: 30KB truncate + embedding は要約ベース**

- clean text は最大30KB（約15,000文字）で切り詰め
- R2にはtruncated版を保存
- embedding生成には `summary_long`（≤400字）を使用
  - 理由: 要約の方がノイズが少なく、embedding品質が高い
  - コスト的にも要約ベースが有利
- truncateした場合は D1に `truncated: true` フラグを追加しない（clean textが十分長い場合でも要約で本質は捉えられるため不要）

### 5.5 タグ設計

**方針: AI生成 + 制御語彙（soft constraint）**

```sql
CREATE TABLE tag_vocabulary (
  tag       TEXT PRIMARY KEY,
  category  TEXT DEFAULT NULL,  -- "tech", "business", "domain", etc.
  usage_count INTEGER NOT NULL DEFAULT 0
);
```

LLMプロンプト:

```
Generate up to 5 tags for this article.

Preferred tags (use these when applicable):
{existing_tags_top_50}

Article title: {title}
Article summary: {summary_long}

Rules:
- Use lowercase, hyphen-separated (e.g., "distributed-systems")
- Prefer existing tags over new ones
- Max 5 tags
- Return JSON array: ["tag1", "tag2", ...]
```

- 既存タグの上位50件（usage_count順）をLLMに渡し、語彙の収束を促す
- 新規タグも許容するが、既存タグを優先
- タグの後編集はPATCH APIで可能

### 5.6 組織共有の方式

**方針: Phase 1 は Portal 内 org view のみ。Phase 2 で Digest 生成。**

Phase 1:
- `/api/items?view=org` で org_score >= 0.6 のアイテムを返却
- Portal SPA に Org タブを設置

Phase 2（将来）:
- Cron Trigger（週次）で org_score 上位記事を集約
- Claude APIで週次ダイジェスト生成
- Slack Webhook で配信

### 5.7 将来拡張性

**方針: D1前提で設計、移行パスは確保**

- D1の実用上限: 数万件（10万件程度まで性能劣化なし）
- それ以上のスケールが必要になった場合:
  - D1のSQLスキーマはPostgreSQL互換に近いため移行容易
  - R2 / Vectorize は独立しており影響なし
- 現時点では過度な抽象化は行わない
- DB操作は `repository` パターンで薄くラップし、将来の差し替えに備える

---

## 6. LLM 統合設計

### 6.1 単一プロンプトでの一括処理

Ingest時のLLM呼び出しは**1リクエスト**に統合する（コスト・レイテンシ最適化）。

```
You are a knowledge curation assistant.

Analyze the following article and return a JSON object.

User interests: {user_interests}
Organization themes: {org_themes}

Article URL: {url}
Article title: {title}
Article content (first 3000 chars):
---
{content_truncated}
---

Return ONLY a JSON object with these fields:
{
  "title": "article title (use original if adequate, improve if needed)",
  "summary_short": "one-line summary, max 80 characters",
  "summary_long": "detailed summary, max 400 characters",
  "tags": ["tag1", "tag2", ...],  // max 5, lowercase, hyphen-separated
  "personal_score": 0.0-1.0,
  "org_score": 0.0-1.0
}

Preferred tags: {existing_tags_top_50}
```

- Model: `claude-sonnet-4-20250514`（コスト・品質バランス）
- Max tokens: 1024
- Temperature: 0

### 6.2 コスト見積もり

| 項目 | 概算 |
|------|------|
| Input: ~3500 tokens/記事 | ~$0.01/記事 |
| Output: ~200 tokens/記事 | ~$0.002/記事 |
| 月100記事の場合 | ~$1.2/月 |

---

## 7. Clean Text 抽出

### 7.1 処理パイプライン

```typescript
async function extractCleanText(html: string): Promise<string> {
  // 1. script, style, nav, header, footer タグを除去
  // 2. 主要コンテンツ領域を推定（article, main, .content 等）
  // 3. HTMLタグを除去
  // 4. 連続空白・改行を正規化
  // 5. 30KB上限でtruncate
  return cleanText;
}
```

### 7.2 利用ライブラリ

- Workers環境で動作する軽量HTML解析: `HTMLRewriter`（Cloudflare組み込み）
- 追加ライブラリなしで実装可能

---

## 8. 認証・セキュリティ

### 8.1 API認証

- Ingest API / PATCH API: `Authorization: Bearer {API_KEY}` ヘッダー
- API_KEY は Workers の環境変数（Secret）に格納
- Portal の読み取り系API: 初期はAPIキー同一、将来的にはCookieベース認証を検討

### 8.2 CORS

- Portal Pages のオリジンのみ許可
- preflight対応

### 8.3 Rate Limiting

- Cloudflare Rate Limiting（Free Tier）で基本防御
- Ingest: 60 req/min
- Portal API: 300 req/min

---

## 9. プロジェクト構成

```
kborg/
├── GOAL.md
├── DESIGN.md
├── TECHNICAL_DESIGN.md
├── wrangler.toml             -- Workers設定
├── src/
│   ├── index.ts              -- Worker エントリポイント、ルーティング
│   ├── ingest/
│   │   ├── handler.ts        -- POST /api/ingest ハンドラ
│   │   ├── fetcher.ts        -- URL取得・clean text抽出
│   │   ├── scoring.ts        -- LLM呼び出し・スコア算出
│   │   └── embedding.ts      -- Vectorize embedding生成・novelty算出
│   ├── portal/
│   │   ├── items.ts          -- GET/PATCH /api/items ハンドラ
│   │   └── search.ts         -- GET /api/search ハンドラ
│   ├── repository/
│   │   ├── d1.ts             -- D1操作の薄いラッパー
│   │   ├── r2.ts             -- R2操作の薄いラッパー
│   │   └── vectorize.ts      -- Vectorize操作の薄いラッパー
│   ├── llm/
│   │   └── claude.ts         -- Claude API クライアント
│   └── utils/
│       ├── url.ts            -- URL正規化・ハッシュ
│       └── html.ts           -- clean text抽出
├── portal/                   -- Pages SPA (別途設計)
│   ├── index.html
│   └── ...
├── schema/
│   └── migrations/
│       └── 0001_init.sql     -- D1初期マイグレーション
└── test/
    └── ...
```

---

## 10. 実装フェーズ

### Phase 1: Core Ingest（MVP）

- [ ] wrangler.toml 設定（D1, R2, Vectorize バインディング）
- [ ] D1マイグレーション（items テーブル）
- [ ] URL正規化・ハッシュ関数
- [ ] HTML取得・clean text抽出
- [ ] R2保存
- [ ] Claude API統合（要約・タグ・スコア）
- [ ] Vectorize embedding保存
- [ ] Novelty算出
- [ ] POST /api/ingest 実装
- [ ] 基本テスト

### Phase 2: Portal API

- [ ] GET /api/items（browse / recent / org ビュー）
- [ ] GET /api/items/:id（詳細 + R2 clean text）
- [ ] GET /api/search（Vectorize類似検索）
- [ ] PATCH /api/items/:id（status / pin 変更）
- [ ] user_profile / org_themes テーブル・API

### Phase 3: Portal Frontend

- [ ] Pages SPA 基盤
- [ ] Browse画面（カードリスト、スコアバッジ、ピン）
- [ ] 検索画面（セマンティック検索UI）
- [ ] 詳細画面（要約 + 原文展開）
- [ ] Org View
- [ ] 状態変更UI（mute / archive / pin）

### Phase 4: 運用・拡張

- [ ] Browser Extension（ワンクリックIngest）
- [ ] Cron Trigger（週次 org digest）
- [ ] Slack連携
- [ ] プロファイル自動更新
- [ ] タグ統計・分析ダッシュボード
