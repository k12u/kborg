# kborg エージェントチーム設計

TECHNICAL_DESIGN.md の実装フェーズに基づく、5エージェント並列実装チームの構成定義。

---

## `/codex` スキルの使いどころ

各エージェントは `/codex <prompt>` を使って Codex に実装を委譲できる。

**委譲に適したタスクの条件**

| 条件 | 理由 |
|---|---|
| 仕様がドキュメントに完全に記述されている | プロンプトに仕様を転記するだけで実装可能 |
| ファイル単位で完結している | 他ファイルへの影響範囲が小さく、レビューが容易 |
| 判断・設計の余地がない | Codex が自律実行しても意図からはずれない |
| ボイラープレートや変換処理が多い | SQL/型定義/ラッパー関数など人手で書くコストが高い |

**委譲に適さないタスクの条件**

- 複数ファイルを横断する設計判断が必要なもの
- 他エージェントの成果物とのインターフェース合意が未確定なもの
- エラーハンドリング方針がまだ決まっていないもの

---

## 概要

| エージェント | 主担当領域 | 開始タイミング |
|---|---|---|
| Orchestrator | インフラ基盤・統合 | 最初 |
| Ingest Agent | URL取得・clean text抽出・R2保存 | インフラ確定後 |
| AI/Embedding Agent | LLM統合・スコア算出・Vectorize | インフラ確定後 |
| Portal API Agent | Portal Worker全API・D1ラッパー | D1スキーマ確定後 |
| Frontend Agent | Cloudflare Pages SPA | API型定義確定後 |

---

## 各エージェント詳細

### 1. Orchestrator

**役割**: チーム全体の調整、インフラ基盤整備、最終統合

**担当ファイル**
- `wrangler.toml` — Workers設定、D1/R2/Vectorize/AIバインディング
- `schema/migrations/0001_init.sql` — D1初期マイグレーション（items, user_profile, org_themes, tag_vocabulary）
- `src/index.ts` — Worker エントリポイント、全ルーティング統合

**責務**
- `wrangler.toml` のバインディング定義を最初に確定し、全エージェントに共有する
- D1スキーマ（TECHNICAL_DESIGN.md セクション4.1）をマイグレーションファイルとして実装する
- 各エージェントの成果物をレビューし、`src/index.ts` へのルーティング統合を行う
- 型定義ファイル（`src/types.ts`）を管理し、エージェント間の型共有を担う
- コンフリクト解消と最終動作確認を担当する

**完了基準**
- `wrangler deploy` が通る
- D1マイグレーションが適用できる
- 全エンドポイントがルーティングされ疎通する

**Codex委譲候補**

```
/codex TECHNICAL_DESIGN.md のセクション4.1のDDLをそのまま schema/migrations/0001_init.sql として実装してください。items/user_profile/org_themes/tag_vocabulary の4テーブルとインデックスをすべて含めること。
```

```
/codex TECHNICAL_DESIGN.md のエージェント間インターフェースセクションに記載された Item 型と Env 型を src/types.ts として実装してください。TypeScript、export あり。
```

---

### 2. Ingest Agent

**役割**: URL受信からR2保存までのデータ取得パイプライン実装

**担当ファイル**
- `src/utils/url.ts` — URL正規化（UTM除去・末尾スラッシュ・fragment除去）・sha256ハッシュ
- `src/utils/html.ts` — clean text抽出（HTMLRewriter使用、30KB truncate）
- `src/ingest/fetcher.ts` — `fetch(url)` 実行（タイムアウト10秒）、clean text抽出呼び出し
- `src/repository/r2.ts` — R2保存（gzip圧縮、Key: `content/{yyyy}/{mm}/{id}.txt.gz`）
- `src/ingest/handler.ts` — `POST /api/ingest` ハンドラ（重複判定・パイプライン起動）

**責務**
- URL正規化の仕様はTECHNICAL_DESIGN.md セクション5.1（ステップ1〜3）に従う
- `HTMLRewriter`（Cloudflare組み込み）で `script/style/nav/header/footer` を除去し、`article/main/.content` 領域を優先抽出する
- clean textは最大30KB（約15,000文字）でtruncateする
- R2のメタデータに `url` と `processed_at` を付与する
- エラー時は中断してログ記録（DLQ記録はOrchestratorと調整）

**他エージェントへの依存**
- Orchestratorが確定した `wrangler.toml` のR2バインディング名を使用する
- Orchestratorが確定したD1スキーマの `url_hash` カラムを使って重複判定する

**完了基準**
- 任意のURLを投入してR2にclean textが保存される
- 同じURLを2回投入しても重複レコードが作成されない

**Codex委譲候補**

```
/codex src/utils/url.ts を実装してください。仕様: URLを受け取り、UTMパラメータ除去・末尾スラッシュ正規化・fragment除去・クエリパラメータのキーソートを行い正規化URLを返す normalizeUrl 関数と、sha256(normalizedUrl) を返す hashUrl 関数をexportすること。Cloudflare Workers環境（Web Crypto API使用可）。TypeScript。
```

```
/codex src/repository/r2.ts を実装してください。仕様: Cloudflare R2バインディング(BUCKET)を受け取り、gzip圧縮したclean textを `content/{yyyy}/{mm}/{id}.txt.gz` のキーで保存する saveContent 関数と、取得してgzip展開して返す getContent 関数をexportすること。R2オブジェクトのcustom metadataに url と processed_at を付与する。TypeScript、Env型は src/types.ts からimport。
```

---

### 3. AI/Embedding Agent

**役割**: LLM統合、スコア算出、embedding生成、Vectorize保存

**担当ファイル**
- `src/llm/workers-ai.ts` — Workers AIクライアント（llama-3.1-70b / bge-base-en-v1.5 呼び出し）
- `src/ingest/scoring.ts` — 単一プロンプトでの要約・タグ・personal_score・org_score生成
- `src/ingest/embedding.ts` — summary_longベースのembedding生成、novelty算出（topK=5）
- `src/repository/vectorize.ts` — Vectorize upsert（id, embedding, 軽量metadata）

**責務**
- LLM呼び出しは1記事あたり**1リクエスト**に統合する（TECHNICAL_DESIGN.md セクション9.2のプロンプト仕様に従う）
- `personal_score` はuser_profileのinterestsとのLLMマッチング、`org_score` はorg_themesとのLLMマッチングで算出する
- `novelty = 1.0 - max_cosine_similarity`（topK=5の近傍で最大類似度を使用）
- `base_score = 0.5 * personal_score + 0.3 * org_score + 0.2 * novelty`
- LLM呼び出し失敗時のフォールバック: 要約=先頭N文字、score暫定値=0.5
- embedding生成失敗時: D1/R2は確定保存し再実行キューへ

**他エージェントへの依存**
- OrchestratorのD1スキーマ（user_profile, org_themesテーブル）を参照する
- Ingest Agentから渡されるclean textとtitleを入力とする

**完了基準**
- LLMレスポンスから title/summary_short/summary_long/tags/personal_score/org_score が取得できる
- Vectorizeにembeddingが保存され、noveltyが算出される
- LLM失敗時にフォールバック値で処理が継続する

**Codex委譲候補**

```
/codex src/llm/workers-ai.ts を実装してください。仕様: Cloudflare Workers AIバインディング(AI)を使い、@cf/meta/llama-3.1-70b-instruct モデルでチャット補完を呼び出す runChat(ai, messages) 関数と、@cf/baai/bge-base-en-v1.5 モデルでembeddingを生成する runEmbedding(ai, text) 関数をexportすること。temperature=0、max_tokens=1024。TypeScript。
```

```
/codex src/repository/vectorize.ts を実装してください。仕様: VectorizeIndexバインディングを受け取り、id/embedding/metadata({source, created_at})をupsertする upsertVector 関数と、topKの近傍IDリストを返す querySimilar(embedding, topK) 関数をexportすること。TypeScript、Env型は src/types.ts からimport。
```

---

### 4. Portal API Agent

**役割**: Portal Worker全API実装、D1ラッパー

**担当ファイル**
- `src/repository/d1.ts` — D1操作の薄いラッパー（insert/select/update）
- `src/portal/items.ts` — Browse/Recent/Org/Detail API
- `src/portal/search.ts` — Vectorize類似検索 + D1メタデータ解決

**責務**

**実装するエンドポイント**（TECHNICAL_DESIGN.md セクション6）

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/items` | browse/recent/org ビュー（cursor pagination, limit=20） |
| `GET` | `/api/items/:id` | D1メタデータ取得 |
| `GET` | `/api/items/:id/content` | R2本文取得（gzip decode済み） |
| `GET` | `/api/items/:id/similar` | Vectorize近傍 → D1解決 |
| `GET` | `/api/search` | query embedding → Vectorize → D1 |
| `PATCH` | `/api/items/:id/status` | status変更（active/muted/archived） |
| `PATCH` | `/api/items/:id/pin` | pin変更（0/1） |

- cursor paginationはソートキー（base_score, created_at）を使用する
- org viewの `threshold` はクエリパラメータで指定可（デフォルト0.6）
- 読み取り系APIの型定義を先行して `src/types.ts` に追加し、Frontend Agentと共有する

**他エージェントへの依存**
- OrchestratorのD1スキーマ確定後に開始する
- Ingest Agent / AI Agentが実装するパイプラインの出力（D1レコード構造）を前提とする

**完了基準**
- browse/recent/org各viewでアイテム一覧が返却される
- similar/searchでVectorize経由の類似結果が返却される
- status/pin PATCHが反映される

**Codex委譲候補**

```
/codex src/repository/d1.ts を実装してください。仕様: Cloudflare D1バインディング(DB)を受け取る薄いラッパー。insertItem(db, item: Item)、getItemByUrlHash(db, urlHash)、getItems(db, {view, cursor, limit})、updateItemStatus(db, id, status)、updateItemPin(db, id, pin) をexportすること。viewはbrowse/recent/orgに対応し、TECHNICAL_DESIGN.md セクション6.2のソート仕様に従う。TypeScript、Item型は src/types.ts からimport。
```

---

### 5. Frontend Agent

**役割**: Cloudflare Pages SPA（ブラウザUI）全体

**担当ファイル**
- `portal/index.html` — SPAエントリポイント
- `portal/` 以下の全ファイル（フレームワーク選定はエージェント判断）

**責務**

**実装する画面**

| 画面 | 説明 |
|---|---|
| Browse | カードリスト表示（base_score順）、ピンバッジ、スコア表示 |
| Recent | 時系列表示（created_at順） |
| Org View | org_score >= threshold のフィルタ表示 |
| Detail | summary_short/long + 原文展開（R2 content取得） |
| Search | セマンティック検索UI（クエリ入力 → `/api/search`） |
| 状態変更 | mute / archive / pin のワンクリック操作 |

- Portal API AgentがAPIの型定義を確定させてから実装を開始する
- APIが未実装の間はモックデータで画面を先行実装してよい
- フレームワーク: 軽量であれば何でも可（Vanilla TS / Preact / Vue 等、React不要）
- Cloudflare Pages へのデプロイ設定（`wrangler.toml` の `[pages]` セクション）はOrchestratorと協議する

**他エージェントへの依存**
- Portal API Agentが公開する型定義（`src/types.ts` または OpenAPI仕様）
- OrchestratorのCORS設定（`portal/` オリジンの許可）

**完了基準**
- Browse画面でアイテム一覧が表示され、スクロールでページネーションされる
- 検索クエリ入力で類似記事が返却される
- 詳細画面で要約と原文が確認できる
- mute/archive/pin操作がAPIに反映される

**Codex委譲候補**

```
/codex portal/ 以下にVanilla TypeScript + Viteで Cloudflare Pages SPA の雛形を作成してください。画面: Browse（カードリスト）・Recent・OrgView・Detail・Search の5画面をシングルページのハッシュルーティングで実装。APIベースURL は環境変数 VITE_API_BASE から取得。各画面はモックデータで動作すること。スタイルはインラインCSSで最小限。
```

---

## 実行順序と依存グラフ

```
[フェーズ1] Orchestrator が先行
  └─ wrangler.toml 確定
  └─ D1マイグレーション確定
  └─ src/types.ts 初版作成

[フェーズ2] 並列実行
  ├─ Ingest Agent      ← R2バインディング、D1スキーマを使用
  └─ AI/Embedding Agent ← D1スキーマ（user_profile, org_themes）を使用

[フェーズ3] 並列実行（フェーズ2と並走可能）
  └─ Portal API Agent  ← D1スキーマ確定で開始、Ingest/AIの完成を待たずにAPI骨格を実装可

[フェーズ4] Frontend Agent
  └─ Portal API Agentが型定義を公開したら開始（モックで先行実装も可）

[フェーズ5] Orchestrator による統合
  └─ 全エージェントの成果物を src/index.ts に統合
  └─ wrangler deploy で動作確認
```

---

## エージェント間のインターフェース

### Orchestrator → 全エージェント（先行共有）

```typescript
// src/types.ts（Orchestratorが先行作成）
export interface Item {
  id: string;
  source: string;
  url: string;
  url_hash: string;
  title: string;
  summary_short: string;
  summary_long: string;
  tags: string[];
  personal_score: number;
  org_score: number;
  novelty: number;
  base_score: number;
  status: 'active' | 'muted' | 'archived';
  pin: 0 | 1;
  r2_path: string;
  created_at: string;
  processed_at: string | null;
}

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  API_KEY: string;
}
```

### Ingest Agent → AI/Embedding Agent

```typescript
// ingest/handler.ts 内のパイプライン引き渡し
interface IngestContext {
  id: string;
  url: string;
  title: string;       // HTMLの<title>から取得
  cleanText: string;   // 30KB truncate済み
  r2Path: string;      // R2保存済みパス
}
```

### Portal API Agent → Frontend Agent

- `GET /api/items` のレスポンス型定義を `src/types.ts` に追加して共有する
- 画面実装前に型定義のスナップショットをFrontend Agentに連絡する

---

## 未決事項（各エージェントが判断してよいこと）

| 項目 | 担当 | 判断基準 |
|---|---|---|
| HTMLRewriterの主要コンテンツ抽出戦略 | Ingest Agent | `article > main > .content` の優先順位 |
| LLMプロンプトのチューニング | AI/Embedding Agent | JSON出力の安定性を優先 |
| novelty閾値の調整 | AI/Embedding Agent | 類似度0.95以上をほぼ重複と判定 |
| SPAフレームワーク選定 | Frontend Agent | Cloudflare Pagesで動作、バンドルサイズ最小 |
| cursorのエンコード方式 | Portal API Agent | base64エンコードされたソートキー複合値 |
