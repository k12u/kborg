以下は、ここまでの議論を踏まえた **基本設計まとめ（v0.1）** です。
Cloudflare（Workers + D1 + Vectorize + R2）前提、clean textのみ保存、低コスト重視。

---

# 1. 目的再定義

## 目的

* 外部情報を **全保存（Archive）**
* Portalで **browse → drill down**
* 時間が経っても重要記事は残す
* 不要マーキングで露出制御
* 組織向けView抽出

## 非目的（現時点）

* 大規模データ分析
* 高度クラスタリング
* フルテキストエンジン最適化
* データウェアハウス化

---

# 2. 全体アーキテクチャ

```text
Webhook
  ↓
Cloudflare Worker
  ├─ HTML取得 → clean text抽出
  ├─ R2保存（原文）
  ├─ LLMで要約 + スコア算出
  ├─ embedding生成
  ├─ D1保存（メタ）
  └─ Vectorize保存（embedding）
  
Portal (Pages + Worker API)
  ├─ Browse
  ├─ 検索（Vectorize）
  └─ Drill down（R2取得）
```

---

# 3. データ設計

## 3.1 D1（メタデータ）

### items テーブル

* id = sha256(normalized_url)
* source
* url
* url_hash（unique）
* title
* summary_short
* summary_long
* tags (JSON)
* personal_score
* org_score
* novelty
* base_score
* status (active/muted/archived)
* pin (0/1)
* r2_path
* created_at
* processed_at
* content_hash

### インデックス

* created_at DESC
* base_score DESC
* org_score DESC
* status
* UNIQUE(url_hash)

---

## 3.2 R2

保存内容：

* clean_text（gzip圧縮）
* 将来再embedding可能な原本

---

## 3.3 Vectorize

* id
* embedding
* 軽量metadata（source程度）

用途：

* 類似検索
* novelty算出

---

# 4. スコア設計

## 4.1 保存時確定

```
base_score =
  0.5 * personal_score
+ 0.3 * org_score
+ 0.2 * novelty
```

base_scoreは固定値。

## 4.2 表示時

デフォルトBrowse：

```
ORDER BY pin DESC, base_score DESC
```

最近View：

```
ORDER BY created_at DESC
```

減衰は基本使わない（A前提）。

---

# 5. 状態管理

status列：

* active：通常表示
* muted：デフォルト非表示（不要）
* archived：保管のみ

削除はしない。

---

# 6. 主要View

## 6.1 Browse（重要順）

* status=active
* base_score DESC

## 6.2 最近

* created_at DESC

## 6.3 組織向け

* status=active
* org_score > threshold

## 6.4 類似検索

* Vectorize → id
* D1で詳細取得

---

# 7. コスト構造

* R2：低コストストレージ
* D1：軽量SQL
* Vectorize：dimension課金
* Workers：従量

数千〜数万件規模で非常に低コスト。

---

# 8. 技術的前提

* clean_textのみ保存（HTMLは保存しない）
* embeddingは保存時のみ生成
* 再計算は手動トリガー
* UUIDではなくURL hash採用

---

# 9. 未決事項（重要）

## ① personal_scoreの定義

* LLMに「あなたの関心にどれだけ近いか」を評価させる？
* 直近保存テーマとのembedding距離で算出？
* ハイブリッド？

---

## ② org_scoreの定義

* 会社テーマを固定リスト化？
* LLM判断？
* タグマッチ？

---

## ③ novelty算出方法

* 直近N件との最大類似度？
* 同タグ密度？
* 単純距離閾値？

---

## ④ clean_textの上限

* 20KB truncate？
* 長文は分割保存？
* embeddingは全文？要約のみ？

---

## ⑤ タグ設計

* 完全AI生成？
* 固定語彙制限？
* 後編集許可？

---

## ⑥ 組織共有の方式

* Portal内にorg View？
* 自動Digest生成？
* Slack連携？

---

## ⑦ 将来拡張性

* Postgresへ移行可能設計にするか？
* D1で数万超えたらどうするか？

---

# 10. 現時点での設計思想

* 保存は完全
* 露出は制御
* スコアは安定
* 状態と評価は分離
* 過度な分析はしない

