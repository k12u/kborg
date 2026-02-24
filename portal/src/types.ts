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

export interface ItemsListResponse {
  items: Item[];
  nextCursor: string | null;
}
