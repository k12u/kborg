import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index.js';
import type { Env, Item } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── モックファクトリ ──────────────────────────────────────────────────────────

const TEST_API_KEY = 'index-test-key';

function itemToRow(item: Item): Record<string, unknown> {
  return { ...item, tags: JSON.stringify(item.tags) };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-x',
    source: 'test',
    url: 'https://example.com/a',
    url_hash: 'hash-x',
    title: 'Title',
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
    ...overrides,
  };
}

function makeEnv(): Env {
  const item = makeItem();
  return {
    DB: {
      prepare: (sql: string) => {
        const stmt = {
          bind: (..._args: unknown[]) => stmt,
          first: async () => {
            if (sql.includes('user_profile')) return { interests: '[]' };
            return itemToRow(item);
          },
          all: async () => ({ results: [itemToRow(item)] }),
          run: async () => ({}),
        };
        return stmt;
      },
    } as unknown as D1Database,
    BUCKET: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      head: vi.fn().mockResolvedValue(null),
    } as unknown as R2Bucket,
    AI: {
      run: vi.fn().mockImplementation(async (model: string) => {
        if (model.includes('llama')) {
          return { response: '{"title":"t","summary_short":"s","summary_long":"l","tags":[],"personal_score":0.5,"org_score":0.5}' };
        }
        return { data: [[0.1, 0.2]] };
      }),
    } as unknown as Ai,
    VECTORIZE: {
      query: vi.fn().mockResolvedValue({ matches: [] }),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as VectorizeIndex,
    API_KEY: TEST_API_KEY,
  } as Env;
}

// ──────────────────────────────────────────────────────────────────────────────
// CORS preflight
// ──────────────────────────────────────────────────────────────────────────────
describe('CORS preflight', () => {
  it('OPTIONS リクエストは 204 を返す', async () => {
    const req = new Request('https://worker.example/api/items', { method: 'OPTIONS' });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(204);
  });

  it('CORS ヘッダーが設定される', async () => {
    const req = new Request('https://worker.example/api/items', { method: 'OPTIONS' });
    const res = await worker.fetch(req, makeEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('通常のレスポンスにも CORS ヘッダーが付与される', async () => {
    const req = new Request('https://worker.example/api/items', { method: 'GET' });
    const res = await worker.fetch(req, makeEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ルーティング
// ──────────────────────────────────────────────────────────────────────────────
describe('ルーティング', () => {
  it('GET /api/items → 200', async () => {
    const req = new Request('https://worker.example/api/items');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it('GET /api/search?q=test → 200', async () => {
    const req = new Request('https://worker.example/api/search?q=test');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it('GET /api/items/:id → 200（item 存在する場合）', async () => {
    const req = new Request('https://worker.example/api/items/item-x');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it('GET /api/items/:id/similar → 200', async () => {
    const req = new Request('https://worker.example/api/items/item-x/similar');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it('PATCH /api/items/:id/status → 200（認証あり）', async () => {
    const req = new Request('https://worker.example/api/items/item-x/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_API_KEY}` },
      body: JSON.stringify({ status: 'muted' }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it('PATCH /api/items/:id/pin → 200（認証あり）', async () => {
    const req = new Request('https://worker.example/api/items/item-x/pin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_API_KEY}` },
      body: JSON.stringify({ pin: 1 }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it('POST /api/ingest → 401（認証なし）', async () => {
    const req = new Request('https://worker.example/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 未知パス
// ──────────────────────────────────────────────────────────────────────────────
describe('未知パス', () => {
  it('GET /unknown → 404', async () => {
    const req = new Request('https://worker.example/unknown');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it('GET /api/unknown → 404', async () => {
    const req = new Request('https://worker.example/api/unknown');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it('GET /api/items/:id/unknown-sub → 404', async () => {
    const req = new Request('https://worker.example/api/items/item-x/unknown-sub');
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// エラーハンドリング
// ──────────────────────────────────────────────────────────────────────────────
describe('エラーハンドリング', () => {
  it('ハンドラが例外をスローしても 500 を返す', async () => {
    const brokenEnv = {
      ...makeEnv(),
      DB: {
        prepare: () => { throw new Error('DB connection failed'); },
      } as unknown as D1Database,
    } as Env;
    const req = new Request('https://worker.example/api/items');
    const res = await worker.fetch(req, brokenEnv);
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
