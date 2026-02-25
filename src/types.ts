// kborg 共有型定義
// Orchestrator が管理 — エージェント間インターフェースの単一ソース・オブ・トゥルース

export interface Item {
  id: string;
  source: string;
  url: string;
  url_hash: string;
  title: string;
  summary_short: string;
  summary_long: string;
  tags: string[];       // D1 には JSON 文字列で格納、取り出し時にパース
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

// Ingest パイプライン内部の引き渡し型
export interface IngestContext {
  id: string;
  url: string;
  title: string;
  cleanText: string;
  r2Path: string;
}

// Portal API レスポンス型
export interface ItemsListResponse {
  items: Item[];
  nextCursor: string | null;
}

export interface IngestResponse {
  id: string;
  title: string;
  summary_short: string;
  base_score: number;
  status: string;
}

export interface DuplicateResponse {
  id: string;
  duplicate: true;
  message: string;
}
