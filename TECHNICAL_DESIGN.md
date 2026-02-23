# kborg 技術設計書 v1.1

GOAL.md（目的定義）および DESIGN.md（基本設計 v0.1）を踏まえた実装レベルの技術設計。

---

## 1. 背景と設計方針

本システムの目的は「記事を保存すること」ではなく、**認知負債を増やさずに思考を継続的に更新すること**にある。保存（Archive）は手段であり、最終成果は以下の4点。

- 取りこぼし不安の低減（全保存）
- 意思決定精度の向上（要約・スコア・検索）
- 組織還元の仕組み化（org向け抽出）
- 未読負債の軽減（露出制御）

このために、**保存の完全性**と**表示の選別性**を分離して設計する。

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

## 2. スコープ

### 2.1 In Scope（v1）

- Webhook経由でURLを受け取り、本文を抽出して保存
- LLM要約、タグ付け、スコア算出（personal/org/novelty）
- D1へのメタ保存、R2への本文保存、Vectorizeへのembedding保存
- Portalでの主要閲覧導線
  - Browse（重要順）
  - Recent（時系列）
  - Org View（組織向け抽出）
  - Similar（類似記事）
- status（active/muted/archived）による露出制御

### 2.2 Out of Scope（v1）

- 高度なクラスタリング/トピックモデリング
- 自動再スコアリングの定期バッチ
- 大規模DWH/BI連携
- HTML完全保存とレンダリング再現
- コンテンツ更新検知・差分管理

---

## 3. アーキテクチャ

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
│  │ URL正規化  │ UTM除去・正規化      │
│  │ 重複判定   │ url_hash で D1検索   │
│  └─────┬─────┘                      │
│        ▼ (新規のみ続行)              │
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
│  GET  /api/items/:id/similar        │
│  GET  /api/search        Vector検索 │
│  PATCH /api/items/:id    状態変更   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Portal Frontend (Pages SPA)        │
│  - Browse (重要順 / 時系列)          │
│  - Search (セマンティック検索)        │
│  - Detail (原文表示)                 │
│  - Org View (組織向けフィルタ)        │
└─────────────────────────────────────┘
```

### コンポーネント責務

- **Worker (Ingest)**: 正規化、抽出、推論、保存の直列パイプライン
- **D1**: 表示・制御の基準となるメタデータ
- **R2**: 再利用可能な本文アーカイブ
- **Vectorize**: 類似検索とnovelty計算補助
- **Worker (Portal API)**: 画面要件に応じた取得ロジック

---

## 4. データ設計

### 4.1 D1 スキーマ

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
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  processed_at  TEXT DEFAULT NULL
);

CREATE INDEX idx_items_created_at ON items(created_at DESC);
CREATE INDEX idx_items_base_score ON items(base_score DESC);
CREATE INDEX idx_items_org_score  ON items(org_score DESC);
CREATE INDEX idx_items_status     ON items(status);
```

**重複検出**: `url_hash` のみで判定する。`content_hash` は持たない。

- 入力経路が単一（Webhook）のため、URL単位の冪等性で十分
- 「全保存」の設計思想上、content_hashによる誤判定（ペイウォール、ボイラープレート一致）で取りこぼすリスクを排除
- コンテンツ更新の検知・再処理は Out of Scope

### 4.2 R2 オブジェクト構造

- Key format: `content/{yyyy}/{mm}/{id}.txt.gz`
- Content-Encoding: gzip
- Content-Type: text/plain; charset=utf-8
- Metadata: `url`, `processed_at`
- clean text上限: **30KB**（超過時はtruncate）

### 4.3 Vectorize

- Index名: `kborg-items`
- Dimensions: Cloudflare Vectorize の `@cf/baai/bge-base-en-v1.5` モデル準拠 = **768次元**
- Distance metric: **cosine**
- Metadata: `{ source: string, created_at: string }`（必要最小限）

---

## 5. 処理フロー

### 5.1 Ingestionフロー

1. URL受信
2. URL正規化（UTM等除去、末尾スラッシュ正規化、パラメータソート、fragment除去）
3. `url_hash = sha256(normalized_url)` で重複確認
   - 既存なら既存レコード返却（200 OK）
4. `fetch(url)` でHTML取得（タイムアウト: 10秒）
5. clean text抽出（script/style/nav除外）
6. 長文トリム（30KB上限）
7. R2保存（gzip圧縮）
8. LLMで要約/タグ/score生成（単一プロンプト）
9. embedding生成（summary_longベース）
10. novelty計算（既存近傍との類似度から導出）
11. `base_score` 確定
12. D1保存
13. Vectorize保存

### 5.2 base_score

```text
base_score =
  0.5 * personal_score + 0.3 * org_score + 0.2 * novelty
```

- `base_score`は保存時に固定（再計算は明示操作のみ）

### 5.3 status遷移

- 初期値: `active`
- `active -> muted`: 不要だが保持
- `active/muted -> archived`: 保管専用
- 論理削除は行わない（可観測性と再利用性を優先）

---

## 6. API 設計（Portal Worker）

### 6.1 Ingest API

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

### 6.2 一覧系

```
GET /api/items?view={browse|recent|org}&cursor=...&limit=20
```

| view | フィルタ | ソート |
|------|---------|--------|
| browse (default) | status=active | pin DESC, base_score DESC, created_at DESC |
| recent | （全status） | created_at DESC |
| org | status=active AND org_score >= threshold | org_score DESC |

- ページネーション: cursor方式（`cursor` = 前ページ最後のソートキー）
- org view の `threshold` はクエリパラメータで指定可（default: 0.6）

### 6.3 詳細系

```
GET /api/items/:id
```
- D1メタデータを返却

```
GET /api/items/:id/content
```
- R2本文を返却（gzip decode済み）

### 6.4 類似検索

```
GET /api/items/:id/similar?topK=20
```
- Vectorizeで近傍探索
- D1から該当idをまとめて解決

```
GET /api/search?q={query}&limit=10
```
1. queryをembedding化
2. Vectorizeで類似検索（topK=limit）
3. 返却されたIDでD1からメタデータ取得
4. status=muted/archivedを除外

### 6.5 更新系

```
PATCH /api/items/:id/status
Authorization: Bearer {API_KEY}
Content-Type: application/json

{ "status": "active|muted|archived" }
```

```
PATCH /api/items/:id/pin
Authorization: Bearer {API_KEY}
Content-Type: application/json

{ "pin": 0|1 }
```

---

## 7. エラー処理方針

| ステップ | 失敗時の挙動 |
|---------|-------------|
| HTML取得 | レコード作成せず中断。DLQ（Dead Letter Queue）へ記録 |
| clean text抽出 | 元HTMLサイズ/種別をログし中断 |
| LLM呼び出し | フォールバック: 先頭N文字を要約に、score暫定値 0.5 を設定 |
| embedding生成 | D1/R2は確定保存し、再実行キューへ投入 |
| Vectorize保存 | D1/R2は確定保存し、再実行キューへ投入 |

- 各ステップの成否をログに記録（監査性の確保）
- Ingestion失敗時は段階リトライ（取得→LLM→embedding の各段階で独立）

---

## 8. 未決事項への設計判断

DESIGN.md セクション9 の未決事項に対する具体的な設計判断。

### 8.1 personal_score の定義

**方針: LLMプロファイルマッチング**

ユーザーの関心領域をプロファイルとしてD1に保存し、LLMがコンテンツとプロファイルの合致度を判定する。

```sql
CREATE TABLE user_profile (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  interests  TEXT NOT NULL DEFAULT '[]',  -- JSON: ["distributed systems", "investment", "org design", ...]
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

- 初期プロファイルは手動設定（5〜15キーワード）
- 将来的に高スコア記事からの自動プロファイル更新を検討

### 8.2 org_score の定義

**方針: 固定テーマリスト + LLM判定**

```sql
CREATE TABLE org_themes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  theme TEXT NOT NULL,         -- "AI/ML infrastructure", "developer productivity", etc.
  weight REAL NOT NULL DEFAULT 1.0
);
```

- org_themesは管理画面またはAPI経由で更新
- テーマ数の上限: 20

### 8.3 novelty 算出方法

**方針: 直近embeddings との最大cosine類似度の逆数**

```
novelty = 1.0 - max_similarity

ここで:
  max_similarity = max(cosine_sim(new_embedding, existing_embedding_i))
  対象: Vectorize query topK=5
```

- topK=5の最近傍検索を実行
- 最も類似度の高いものの値を採用
- 類似度0.95以上 → novelty = 0.05（ほぼ重複コンテンツ）
- 類似度0.3以下 → novelty = 0.7（完全に新規トピック）

### 8.4 clean text の上限

**方針: 30KB truncate + embedding は要約ベース**

- clean text は最大30KB（約15,000文字）で切り詰め
- R2にはtruncated版を保存
- embedding生成には `summary_long`（≤400字）を使用
  - 理由: 要約の方がノイズが少なく、embedding品質が高い
  - コスト的にも要約ベースが有利

### 8.5 タグ設計

**方針: AI生成 + 制御語彙（soft constraint）**

```sql
CREATE TABLE tag_vocabulary (
  tag       TEXT PRIMARY KEY,
  category  TEXT DEFAULT NULL,  -- "tech", "business", "domain", etc.
  usage_count INTEGER NOT NULL DEFAULT 0
);
```

- 既存タグの上位50件（usage_count順）をLLMに渡し、語彙の収束を促す
- 新規タグも許容するが、既存タグを優先
- タグの後編集はPATCH APIで可能

### 8.6 組織共有の方式

**方針: Phase 1 は Portal 内 org view のみ。Phase 2 で Digest 生成。**

Phase 1:
- `/api/items?view=org` で org_score >= 0.6 のアイテムを返却
- Portal SPA に Org タブを設置

Phase 2（将来）:
- Cron Trigger（週次）で org_score 上位記事を集約
- Claude APIで週次ダイジェスト生成
- Slack Webhook で配信

### 8.7 将来拡張性

**方針: D1前提で設計、移行パスは確保**

- D1の実用上限: 数万件（10万件程度まで性能劣化なし）
- D1のSQLスキーマはPostgreSQL互換に近いため移行容易
- R2 / Vectorize は独立しており影響なし
- 現時点では過度な抽象化は行わない
- DB操作は `repository` パターンで薄くラップし、将来の差し替えに備える

---

## 9. LLM 統合設計

### 9.1 単一プロンプトでの一括処理

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

### 9.2 コスト見積もり

| 項目 | 概算 |
|------|------|
| Input: ~3500 tokens/記事 | ~$0.01/記事 |
| Output: ~200 tokens/記事 | ~$0.002/記事 |
| 月100記事の場合 | ~$1.2/月 |

---

## 10. Clean Text 抽出

### 10.1 処理パイプライン

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

### 10.2 利用ライブラリ

- Workers環境で動作する軽量HTML解析: `HTMLRewriter`（Cloudflare組み込み）
- 追加ライブラリなしで実装可能

---

## 11. 認証・セキュリティ

### 11.1 API認証

- Ingest API / PATCH API: `Authorization: Bearer {API_KEY}` ヘッダー
- API_KEY は Workers の環境変数（Secret）に格納
- Portal の読み取り系API: 初期はAPIキー同一、将来的にはCookieベース認証を検討

### 11.2 CORS

- Portal Pages のオリジンのみ許可
- preflight対応

### 11.3 Rate Limiting

- Cloudflare Rate Limiting（Free Tier）で基本防御
- Ingest: 60 req/min
- Portal API: 300 req/min

---

## 12. 非機能要件

- **コスト最適化**: R2中心保存、D1は軽量メタ、Vectorizeは最小メタのみ
- **可用性**: Ingestion失敗時は段階リトライ（取得/LLM/embedding）
- **冪等性**: `url_hash`で重複登録防止
- **監査性**: 処理ステップごとにログを残す
- **移行性**: 将来Postgres移行を想定し、SQL依存を限定

---

## 13. プロジェクト構成

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

## 14. 実装フェーズ

### Phase 1: Core Ingest（MVP, 1〜2週間）

- [ ] wrangler.toml 設定（D1, R2, Vectorize バインディング）
- [ ] D1マイグレーション（items テーブル）
- [ ] URL正規化・ハッシュ関数
- [ ] HTML取得・clean text抽出
- [ ] R2保存
- [ ] Claude API統合（要約・タグ・スコア）
- [ ] Vectorize embedding保存
- [ ] Novelty算出
- [ ] POST /api/ingest 実装
- [ ] Browse/Recent/Detail 最小UI
- [ ] 基本テスト

### Phase 2: Portal（運用化, +1〜2週間）

- [ ] GET /api/items（browse / recent / org ビュー）
- [ ] GET /api/items/:id（詳細 + R2 clean text）
- [ ] GET /api/items/:id/similar（類似検索）
- [ ] GET /api/search（Vectorize類似検索）
- [ ] PATCH /api/items/:id（status / pin 変更）
- [ ] user_profile / org_themes テーブル・API
- [ ] 失敗再実行キュー

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
- [ ] ダッシュボード（保存数・再利用率・org採用率）

---

## 15. 受け入れ基準

- URL投入から一覧反映までが通常3分以内
- 重複URL投入で重複レコードが作成されない
- Browseで上位結果の主観妥当率が70%以上
- muted/archivedがデフォルト一覧に出ない
- Similar検索が上位10件で関連性を維持

---

## 16. 意思決定プロトコル

- 各未決論点をADR（Architecture Decision Record）1件ずつで管理
- 1週間の試験運用で計測（精度/満足度/運用負荷）
- 閾値を満たす案を採用
