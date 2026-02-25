# kborg テスト進捗

最終更新: 2026-02-24

## ユニットテスト（vitest + @cloudflare/vitest-pool-workers）

### ✅ 完了（184 テスト / 11 ファイル）

| ファイル | テスト数 | 主な検証内容 |
|---|---|---|
| `src/utils/url.ts` | 27 | UTM 除去・末尾スラッシュ・fragment 除去・クエリソート・SHA-256 ハッシュ冪等性 |
| `src/utils/html.ts` | 44 | extractCleanText（HTMLRewriter）・extractPlainText・extractMarkdownText（記法除去・truncate）|
| `src/ingest/fetcher.ts` | 16 | content-type ルーティング（html/plain/markdown/x-markdown）・タイトル抽出・エラー伝播 |
| `src/ingest/scoring.ts` | 13 | JSON 抽出・スコアクランプ（0〜1）・フォールバック・型ガード |
| `src/ingest/embedding.ts` | 8 | novelty = 1 − max_similarity・自己除外・マッチなし=1.0 |
| `src/ingest/handler.ts` | 12 | 認証（401）・バリデーション（400）・重複（200）・正常系（201）・fetch エラー（502）|
| `src/repository/r2.ts` | 8 | gzip 圧縮保存・gzip 展開ラウンドトリップ・カスタムメタデータ・存在しないキー例外 |
| `src/repository/d1.ts` | 18 | CRUD・tags JSON 変換・cursor ページネーション（browse/recent/org）・status/pin 更新 |
| `src/portal/items.ts` | 14 | handleItemsList・handleItemDetail（404）・handleItemContent・handleItemSimilar・handleItemStatus・handleItemPin（認証・バリデーション）|
| `src/portal/search.ts` | 10 | クエリ検証（400）・muted/archived フィルタ・limit クランプ（1〜50）|
| `src/index.ts` | 14 | CORS preflight（204）・全ルート委譲・未知パス（404）・例外→500 |

### ❌ ユニットテスト未作成

| ファイル | 理由・備考 |
|---|---|
| `src/llm/workers-ai.ts` | AI binding の薄いラッパー。他テストのモック内で間接的に検証済み。実 AI を呼ぶ結合テストは未実施 |
| `src/repository/vectorize.ts` | Vectorize binding の薄いラッパー。他テストのモック内で間接的に検証済み |
| `portal/src/**` | Vite + vanilla TS SPA。ブラウザ UI のため vitest 対象外。手動確認のみ |

---

## 結合・受け入れテスト

### ✅ 本番環境手動確認（curl）

デプロイ先: `https://kborg.minoru-cloudflare-fdxz9b.workers.dev`

| # | 項目 | 結果 |
|---|---|---|
| 1 | CORS preflight OPTIONS → 204 | ✅ |
| 2 | GET /api/items | ✅ |
| 3 | POST /api/ingest 認証なし → 401 | ✅ |
| 4 | POST /api/ingest 誤キー → 401 | ✅ |
| 5 | POST /api/ingest 不正 URL → 400 | ✅ |
| 6 | POST /api/ingest 正常系 → 201（LLM スコアリング・R2・Vectorize）| ✅ |
| 7 | 重複 URL 再 ingest → 200 duplicate | ✅ |
| 8 | GET /api/items/:id | ✅ |
| 9 | GET /api/search?q=… | ✅ |
| 10 | 未知パス → 404 | ✅ |
| 11 | PATCH /api/items/:id/status | ✅ |
| 12 | PATCH /api/items/:id/pin | ✅ |
| 13 | GET /api/items/:id/content（R2 gzip 展開）| ✅ |
| 14 | GET /api/items/:id/similar（Vectorize 類似検索）| ✅ |
| 15 | フロントエンド https://kborg-portal.pages.dev 表示 | ✅ |

### ❌ 未実施テスト

| 種別 | 内容 |
|---|---|
| 自動 E2E | デプロイ済み環境に対する curl スクリプト / Playwright 等の自動化 |
| フロントエンド | ブラウザ操作（タブ切替・検索・詳細表示・status/pin 変更）の自動テスト |
| AI 品質 | LLM スコアリング結果の精度・一貫性検証 |
| 負荷テスト | 同時 ingest、大量アイテム時のページネーション性能 |
| エラー回復 | AI unavailable / Vectorize タイムアウト時のフォールバック動作（本番環境で）|
| セキュリティ | API_KEY ローテーション手順・CORS オリジン制限（現在 `*`）|
