# 技術設計書: Personal/Org Intelligence Dashboard（v0.2）

## 1. 背景と設計方針

本システムの目的は「記事を保存すること」ではなく、**認知負債を増やさずに思考を継続的に更新すること**にある。保存（Archive）は手段であり、最終成果は以下の4点。

- 取りこぼし不安の低減（全保存）
- 意思決定精度の向上（要約・スコア・検索）
- 組織還元の仕組み化（org向け抽出）
- 未読負債の軽減（露出制御）

このために、**保存の完全性**と**表示の選別性**を分離して設計する。

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

---

## 3. アーキテクチャ

```text
[Input]
Webhook (URL)
  ↓
[Ingestion Worker]
1) URL正規化 / 重複判定
2) HTML取得
3) clean text抽出
4) R2保存（clean text gzip）
5) LLM要約・タグ・score推定
6) embedding生成
7) D1 upsert
8) Vectorize upsert
  ↓
[Portal API Worker]
- Browse/Recent/Org/Similarの各クエリ
- Drill downでR2本文取得
  ↓
[UI]
Pages (一覧 + 詳細)
```

### 3.1 コンポーネント責務

- **Worker (Ingestion)**: 正規化、抽出、推論、保存の直列パイプライン
- **D1**: 表示・制御の基準となるメタデータ
- **R2**: 再利用可能な本文アーカイブ
- **Vectorize**: 類似検索とnovelty計算補助
- **Worker (Portal API)**: 画面要件に応じた取得ロジック

---

## 4. データ設計

## 4.1 D1 スキーマ

### `items`

| カラム | 型 | 説明 |
|---|---|---|
| id | TEXT (PK) | `sha256(normalized_url)` |
| source | TEXT | 取得元識別子 |
| url | TEXT | 元URL |
| url_hash | TEXT UNIQUE | 正規化URLハッシュ |
| title | TEXT | 記事タイトル |
| summary_short | TEXT | 短要約 |
| summary_long | TEXT | 長要約 |
| tags | TEXT(JSON) | タグ配列 |
| personal_score | REAL | 個人関心スコア |
| org_score | REAL | 組織価値スコア |
| novelty | REAL | 新規性スコア |
| base_score | REAL | 固定総合スコア |
| status | TEXT | `active/muted/archived` |
| pin | INTEGER | 0/1 |
| r2_path | TEXT | 本文保存先 |
| created_at | TEXT | 初回作成時刻 |
| processed_at | TEXT | 処理完了時刻 |
| content_hash | TEXT | clean textハッシュ |

### 推奨インデックス

- `idx_items_created_at(created_at DESC)`
- `idx_items_base_score(base_score DESC)`
- `idx_items_org_score(org_score DESC)`
- `idx_items_status(status)`
- `uq_items_url_hash(url_hash)`

## 4.2 R2 オブジェクト

- キー: `content/{yyyy}/{mm}/{id}.txt.gz`
- 本文: clean text（UTF-8, gzip）
- メタ: `url`, `content_hash`, `processed_at`

## 4.3 Vectorize

- id: `items.id`と一致
- vector: embedding
- metadata: `source`, `created_at`（必要最小限）

---

## 5. 処理フロー

## 5.1 Ingestionフロー

1. URL受信
2. URL正規化（UTM等除去、末尾スラッシュ正規化）
3. `url_hash`重複確認
   - 既存なら`processed_at`更新のみ（オプション）
4. HTML取得
5. clean text抽出（script/style/nav除外）
6. 長文トリム（上限超過時）
7. R2保存
8. LLMで要約/タグ/score候補生成
9. embedding生成
10. novelty計算（既存近傍との類似度から導出）
11. base_score確定
12. D1保存
13. Vectorize保存

## 5.2 base_score

```text
base_score =
  0.5 * personal_score
+ 0.3 * org_score
+ 0.2 * novelty
```

- `base_score`は保存時に固定（再計算は明示操作のみ）

## 5.3 status遷移

- 初期値: `active`
- `active -> muted`: 不要だが保持
- `active/muted -> archived`: 保管専用
- 論理削除は行わない（可観測性と再利用性を優先）

---

## 6. API設計（Portal Worker）

## 6.1 一覧系

- `GET /api/items?view=browse&cursor=...`
  - 条件: `status='active'`
  - 並び: `pin DESC, base_score DESC, created_at DESC`
- `GET /api/items?view=recent&cursor=...`
  - 並び: `created_at DESC`
- `GET /api/items?view=org&threshold=0.65&cursor=...`
  - 条件: `status='active' AND org_score >= threshold`

## 6.2 詳細系

- `GET /api/items/:id`
  - D1メタ + R2本文参照キーを返す
- `GET /api/items/:id/content`
  - R2本文を返す（gzip decode済み）

## 6.3 類似検索

- `GET /api/items/:id/similar?topK=20`
  - Vectorizeで近傍探索
  - D1から該当idをまとめて解決

## 6.4 更新系

- `PATCH /api/items/:id/status`
  - body: `{ "status": "active|muted|archived" }`
- `PATCH /api/items/:id/pin`
  - body: `{ "pin": 0|1 }`

---

## 7. 非機能要件

- **コスト最適化**: R2中心保存、D1は軽量メタ、Vectorizeは最小メタのみ
- **可用性**: Ingestion失敗時は段階リトライ（取得/LLM/embedding）
- **冪等性**: `url_hash`と`id`で重複登録防止
- **監査性**: 処理ステップごとにログを残す
- **移行性**: 将来Postgres移行を想定し、SQL依存を限定

---

## 8. エラー処理方針

- HTML取得失敗: `status='archived'`で最小レコード作成は行わず、DLQへ
- 抽出失敗: 元HTMLサイズ/種別をログし中断
- LLM失敗: フォールバック要約（先頭N文字）+ score暫定値
- embedding失敗: D1/R2は確定、再実行キューへ
- Vectorize失敗: D1側に`vector_status='pending'`相当を保持（実装時追加）

---

## 9. 未決事項と意思決定プロトコル

## 9.1 未決事項

1. `personal_score`定義（関心プロファイルベース vs 埋め込み距離）
2. `org_score`定義（固定評価軸 vs LLM判定）
3. `novelty`算出式（max類似度逆数 vs 分位点）
4. clean text上限（20KB/50KB）と分割方針
5. タグ語彙（自由生成/制約語彙）
6. 組織共有方式（Portal固定View/定期Digest/Slack）

## 9.2 決定手順

- 各論点をADR（Architecture Decision Record）1件ずつで管理
- 1週間の試験運用で計測（精度/満足度/運用負荷）
- 閾値を満たす案を採用

---

## 10. 実装ロードマップ

### Phase 1（MVP, 1〜2週間）

- Ingestion Worker基本実装
- D1/R2/Vectorize接続
- Browse/Recent/Detail最小UI

### Phase 2（運用化, +1〜2週間）

- Org View
- Similar検索
- status/pin操作
- 失敗再実行キュー

### Phase 3（最適化）

- score定義の改善
- ダッシュボード（保存数・再利用率・org採用率）
- ADR反映による継続改善

---

## 11. 受け入れ基準

- URL投入から一覧反映までが通常3分以内
- 重複URL投入で重複レコードが作成されない
- Browseで上位結果の主観妥当率が70%以上
- muted/archivedがデフォルト一覧に出ない
- Similar検索が上位10件で関連性を維持

