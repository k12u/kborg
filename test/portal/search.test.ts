import { describe, it, expect, vi } from 'vitest';
import { handleSearch } from '../../src/portal/search.js';
import type { Env, Item } from '../../src/types.js';

// ── モックファクトリ ──────────────────────────────────────────────────────────

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    source: 'manual',
    url: 'https://example.com/article',
    url_hash: 'hash-1',
    title: 'Test Article',
    summary_short: 'Short',
    summary_long: 'Long summary',
    tags: ['test'],
    personal_score: 0.7,
    org_score: 0.6,
    novelty: 0.8,
    base_score: 0.7,
    status: 'active',
    pin: 0,
    r2_path: '',
    created_at: '2026-02-24T00:00:00Z',
    processed_at: null,
    ...overrides,
  };
}

function itemToRow(item: Item): Record<string, unknown> {
  return { ...item, tags: JSON.stringify(item.tags) };
}

function makeDb(items: Item[] = []): D1Database {
  return {
    prepare: () => ({
      bind: function (..._args: unknown[]) { return this; },
      all: async () => ({ results: items.map(itemToRow) }),
      first: async () => null,
      run: async () => ({}),
    }),
  } as unknown as D1Database;
}

function makeEnv(opts: {
  items?: Item[];
  vectorizeIds?: string[];
} = {}): Env {
  const { items = [], vectorizeIds = [] } = opts;
  return {
    DB: makeDb(items),
    AI: { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }) },
    VECTORIZE: {
      query: vi.fn().mockResolvedValue({
        matches: vectorizeIds.map((id) => ({ id, score: 0.8 })),
      }),
    },
  } as unknown as Env;
}

// ──────────────────────────────────────────────────────────────────────────────
// クエリバリデーション
// ──────────────────────────────────────────────────────────────────────────────
describe('クエリバリデーション', () => {
  it('q パラメータなしは 400', async () => {
    const req = new Request('https://worker.example/api/search');
    const res = await handleSearch(req, makeEnv());
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('q');
  });

  it('q が空文字列は 400', async () => {
    const req = new Request('https://worker.example/api/search?q=');
    const res = await handleSearch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it('q がスペースのみは 400', async () => {
    const req = new Request('https://worker.example/api/search?q=   ');
    const res = await handleSearch(req, makeEnv());
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 検索結果
// ──────────────────────────────────────────────────────────────────────────────
describe('検索結果', () => {
  it('クエリに一致するアイテムを返す', async () => {
    const item = makeItem({ id: 'a', url_hash: 'h-a' });
    const env = makeEnv({ items: [item], vectorizeIds: ['a'] });
    const req = new Request('https://worker.example/api/search?q=ai+technology');
    const res = await handleSearch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as Item[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('a');
  });

  it('マッチなしは空配列を返す', async () => {
    const req = new Request('https://worker.example/api/search?q=obscure+topic');
    const res = await handleSearch(req, makeEnv({ vectorizeIds: [] }));
    expect(res.status).toBe(200);
    const body = await res.json() as Item[];
    expect(body).toEqual([]);
  });

  it('muted アイテムはフィルタされる', async () => {
    const active = makeItem({ id: 'active', url_hash: 'h-act', status: 'active' });
    const muted = makeItem({ id: 'muted', url_hash: 'h-mut', status: 'muted' });
    const env = makeEnv({ items: [active, muted], vectorizeIds: ['active', 'muted'] });
    const req = new Request('https://worker.example/api/search?q=test');
    const res = await handleSearch(req, env);
    const body = await res.json() as Item[];
    expect(body.some((i) => i.id === 'muted')).toBe(false);
    expect(body.some((i) => i.id === 'active')).toBe(true);
  });

  it('archived アイテムはフィルタされる', async () => {
    const archived = makeItem({ id: 'arch', url_hash: 'h-arch', status: 'archived' });
    const env = makeEnv({ items: [archived], vectorizeIds: ['arch'] });
    const req = new Request('https://worker.example/api/search?q=test');
    const res = await handleSearch(req, env);
    const body = await res.json() as Item[];
    expect(body).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// limit パラメータ
// ──────────────────────────────────────────────────────────────────────────────
describe('limit パラメータ', () => {
  it('limit は 1〜50 にクランプされる（0 → 1）', async () => {
    const env = makeEnv();
    const vectorize = env.VECTORIZE as { query: ReturnType<typeof vi.fn> };
    const req = new Request('https://worker.example/api/search?q=test&limit=0');
    await handleSearch(req, env);
    const callArgs = vectorize.query.mock.calls[0][1] as { topK: number };
    expect(callArgs.topK).toBe(1);
  });

  it('limit は 1〜50 にクランプされる（100 → 50）', async () => {
    const env = makeEnv();
    const vectorize = env.VECTORIZE as { query: ReturnType<typeof vi.fn> };
    const req = new Request('https://worker.example/api/search?q=test&limit=100');
    await handleSearch(req, env);
    const callArgs = vectorize.query.mock.calls[0][1] as { topK: number };
    expect(callArgs.topK).toBe(50);
  });

  it('limit=10 がデフォルト', async () => {
    const env = makeEnv();
    const vectorize = env.VECTORIZE as { query: ReturnType<typeof vi.fn> };
    const req = new Request('https://worker.example/api/search?q=test');
    await handleSearch(req, env);
    const callArgs = vectorize.query.mock.calls[0][1] as { topK: number };
    expect(callArgs.topK).toBe(10);
  });
});
