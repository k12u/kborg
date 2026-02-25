import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleIngest } from '../../src/ingest/handler.js';
import type { Env, Item } from '../../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── ヘルパー ──────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'test-secret-key';
const TEST_URL = 'https://example.com/article';

function makeRequest(opts: {
  url?: string;
  source?: string;
  apiKey?: string;
  body?: unknown;
  rawBody?: string;
} = {}): Request {
  const { url: bodyUrl = TEST_URL, source, apiKey = TEST_API_KEY, body, rawBody } = opts;
  const bodyStr = rawBody !== undefined ? rawBody : JSON.stringify(body ?? { url: bodyUrl, ...(source ? { source } : {}) });
  return new Request('https://worker.example/api/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: bodyStr,
  });
}

function mockFetch(html: string, contentType = 'text/html') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(html, { headers: { 'content-type': contentType } }))
  );
}

function itemToRow(item: Item): Record<string, unknown> {
  return { ...item, tags: JSON.stringify(item.tags) };
}

function makeDb(existingItem: Item | null = null): D1Database {
  return {
    prepare: (sql: string) => {
      const stmt = {
        bind: (..._args: unknown[]) => stmt,
        first: async () => {
          if (sql.includes('url_hash') && existingItem) return itemToRow(existingItem);
          if (sql.includes('url_hash')) return null;
          if (sql.includes('user_profile')) return { interests: '[]' };
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({}),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeBucket(): R2Bucket {
  return { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket;
}

function makeAi(scoringJson?: string): Ai {
  const defaultScoring = JSON.stringify({
    title: 'AI Title', summary_short: 'Short', summary_long: 'Long',
    tags: ['test'], personal_score: 0.7, org_score: 0.6,
  });
  return {
    run: vi.fn().mockImplementation(async (model: string) => {
      if (model.includes('llama')) return { response: scoringJson ?? defaultScoring };
      return { data: [[0.1, 0.2, 0.3]] };
    }),
  } as unknown as Ai;
}

function makeVectorize(): VectorizeIndex {
  return {
    query: vi.fn().mockResolvedValue({ matches: [] }),
    upsert: vi.fn().mockResolvedValue(undefined),
  } as unknown as VectorizeIndex;
}

function makeEnv(existingItem: Item | null = null, scoringJson?: string): Env {
  return {
    DB: makeDb(existingItem),
    BUCKET: makeBucket(),
    AI: makeAi(scoringJson),
    VECTORIZE: makeVectorize(),
    API_KEY: TEST_API_KEY,
  } as Env;
}

// ──────────────────────────────────────────────────────────────────────────────
// 認証
// ──────────────────────────────────────────────────────────────────────────────
describe('認証', () => {
  it('Authorization ヘッダーなしは 401', async () => {
    const req = makeRequest({ apiKey: '' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('誤った API キーは 401', async () => {
    const req = makeRequest({ apiKey: 'wrong-key' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// バリデーション
// ──────────────────────────────────────────────────────────────────────────────
describe('バリデーション', () => {
  it('不正な JSON ボディは 400', async () => {
    const req = makeRequest({ rawBody: 'not json' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('url フィールドなしは 400', async () => {
    const req = makeRequest({ rawBody: '{}' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('url');
  });

  it('不正な URL 形式は 400', async () => {
    const req = makeRequest({ url: 'not-a-url' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 重複チェック
// ──────────────────────────────────────────────────────────────────────────────
describe('重複チェック', () => {
  it('既存アイテムがある場合は 200 と duplicate フラグを返す', async () => {
    const existing: Item = {
      id: 'existing-id',
      source: 'manual',
      url: TEST_URL,
      url_hash: 'some-hash',
      title: 'Existing',
      summary_short: 's',
      summary_long: 'l',
      tags: [],
      personal_score: 0.5,
      org_score: 0.5,
      novelty: 0.5,
      base_score: 0.5,
      status: 'active',
      pin: 0,
      r2_path: '',
      created_at: '2026-02-24T00:00:00Z',
      processed_at: null,
    };
    const req = makeRequest();
    const res = await handleIngest(req, makeEnv(existing));
    expect(res.status).toBe(200);
    const body = await res.json() as { duplicate: boolean; id: string };
    expect(body.duplicate).toBe(true);
    expect(body.id).toBe('existing-id');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// fetch エラー
// ──────────────────────────────────────────────────────────────────────────────
describe('fetch エラー', () => {
  it('fetch がネットワークエラーの場合は 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const req = makeRequest();
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(502);
  });

  it('非対応 content-type は 502', async () => {
    mockFetch('<binary>', 'application/pdf');
    const req = makeRequest();
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(502);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 正常系
// ──────────────────────────────────────────────────────────────────────────────
describe('正常系', () => {
  it('新規 URL は 201 と IngestResponse を返す', async () => {
    mockFetch(
      '<html><head><title>Test Article</title></head><body><article><p>Content</p></article></body></html>'
    );
    const req = makeRequest();
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.title).toBeDefined();
    expect(body.base_score).toBeDefined();
    expect(body.status).toBe('active');
  });

  it('source を明示した場合はそのまま保存される', async () => {
    mockFetch('<html><body><article><p>content</p></article></body></html>');
    const req = makeRequest({ source: 'slack' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(201);
  });

  it('base_score = 0.5*personal + 0.3*org + 0.2*novelty で計算される', async () => {
    mockFetch('<html><body><p>content</p></body></html>');
    const scoring = JSON.stringify({
      title: 't', summary_short: 's', summary_long: 'l', tags: [],
      personal_score: 0.8, org_score: 0.4,
    });
    // novelty=1.0 (Vectorize が空なので)
    const env = makeEnv(null, scoring);
    const req = makeRequest();
    const res = await handleIngest(req, env);
    const body = await res.json() as { base_score: number };
    // 0.5*0.8 + 0.3*0.4 + 0.2*1.0 = 0.4 + 0.12 + 0.2 = 0.72
    expect(body.base_score).toBeCloseTo(0.72, 2);
  });

  it('text/plain コンテンツも処理できる', async () => {
    mockFetch('This is plain text content.', 'text/plain');
    const req = makeRequest({ url: 'https://example.com/doc.txt' });
    const res = await handleIngest(req, makeEnv());
    expect(res.status).toBe(201);
  });
});
