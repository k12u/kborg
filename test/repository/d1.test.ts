import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  insertItem,
  getItemByUrlHash,
  getItemById,
  getItemsByIds,
  getItems,
  updateItemStatus,
  updateItemPin,
} from '../../src/repository/d1.js';
import type { Item } from '../../src/types.js';

const db = (env as unknown as { DB: D1Database }).DB;

// テーブルを beforeAll で作成（isolated storage により各テストへ反映される）
// db.exec() は miniflare でマルチライン SQL を扱えないため prepare().run() を使用
beforeAll(async () => {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS items (' +
        'id TEXT PRIMARY KEY,' +
        'source TEXT NOT NULL DEFAULT "manual",' +
        'url TEXT NOT NULL,' +
        'url_hash TEXT NOT NULL UNIQUE,' +
        'title TEXT NOT NULL DEFAULT "",' +
        'summary_short TEXT NOT NULL DEFAULT "",' +
        'summary_long TEXT NOT NULL DEFAULT "",' +
        'tags TEXT NOT NULL DEFAULT "[]",' +
        'personal_score REAL NOT NULL DEFAULT 0.0,' +
        'org_score REAL NOT NULL DEFAULT 0.0,' +
        'novelty REAL NOT NULL DEFAULT 0.0,' +
        'base_score REAL NOT NULL DEFAULT 0.0,' +
        'status TEXT NOT NULL DEFAULT "active",' +
        'pin INTEGER NOT NULL DEFAULT 0,' +
        'r2_path TEXT NOT NULL DEFAULT "",' +
        'created_at TEXT NOT NULL DEFAULT "",' +
        'processed_at TEXT DEFAULT NULL' +
        ')'
    )
    .run();
});

let _seq = 0;
function makeItem(overrides: Partial<Item> = {}): Item {
  _seq++;
  return {
    id: `id-${_seq}`,
    source: 'test',
    url: `https://example.com/article-${_seq}`,
    url_hash: `hash-${_seq}`,
    title: `Article ${_seq}`,
    summary_short: 'Short summary',
    summary_long: 'Long summary text',
    tags: ['test'],
    personal_score: 0.7,
    org_score: 0.6,
    novelty: 0.8,
    base_score: 0.7,
    status: 'active',
    pin: 0,
    r2_path: `content/2026/02/id-${_seq}.txt.gz`,
    created_at: `2026-02-24T00:00:${String(_seq).padStart(2, '0')}Z`,
    processed_at: '2026-02-24T01:00:00Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// insertItem / getItemByUrlHash
// ──────────────────────────────────────────────────────────────────────────────
describe('insertItem / getItemByUrlHash', () => {
  it('アイテムを挿入して url_hash で取得できる', async () => {
    const item = makeItem();
    await insertItem(db, item);
    const found = await getItemByUrlHash(db, item.url_hash);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(item.id);
    expect(found!.title).toBe(item.title);
  });

  it('tags は配列として復元される', async () => {
    const item = makeItem({ tags: ['ai', 'cloudflare', 'workers'] });
    await insertItem(db, item);
    const found = await getItemByUrlHash(db, item.url_hash);
    expect(found!.tags).toEqual(['ai', 'cloudflare', 'workers']);
  });

  it('存在しない url_hash は null を返す', async () => {
    const result = await getItemByUrlHash(db, 'nonexistent-hash');
    expect(result).toBeNull();
  });

  it('processed_at が null のアイテムも挿入できる', async () => {
    const item = makeItem({ processed_at: null });
    await insertItem(db, item);
    const found = await getItemByUrlHash(db, item.url_hash);
    expect(found!.processed_at).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getItemById
// ──────────────────────────────────────────────────────────────────────────────
describe('getItemById', () => {
  it('id でアイテムを取得できる', async () => {
    const item = makeItem();
    await insertItem(db, item);
    const found = await getItemById(db, item.id);
    expect(found!.url).toBe(item.url);
  });

  it('存在しない id は null を返す', async () => {
    expect(await getItemById(db, 'no-such-id')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getItemsByIds
// ──────────────────────────────────────────────────────────────────────────────
describe('getItemsByIds', () => {
  it('複数の id でアイテムを一括取得できる', async () => {
    const a = makeItem();
    const b = makeItem();
    await insertItem(db, a);
    await insertItem(db, b);
    const results = await getItemsByIds(db, [a.id, b.id]);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('空配列を渡すと空配列を返す', async () => {
    expect(await getItemsByIds(db, [])).toEqual([]);
  });

  it('存在しない id は結果に含まれない', async () => {
    const item = makeItem();
    await insertItem(db, item);
    const results = await getItemsByIds(db, [item.id, 'no-such-id']);
    expect(results).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getItems (browse / recent / org)
// ──────────────────────────────────────────────────────────────────────────────
describe('getItems - browse', () => {
  it('browse: active アイテムのみ返す', async () => {
    const active = makeItem({ status: 'active' });
    const muted = makeItem({ status: 'muted' });
    await insertItem(db, active);
    await insertItem(db, muted);
    const { items } = await getItems(db, { view: 'browse', limit: 10 });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(muted.id);
  });

  it('browse: カーソルなしで limit 件返す', async () => {
    for (let i = 0; i < 5; i++) await insertItem(db, makeItem());
    const { items, nextCursor } = await getItems(db, { view: 'browse', limit: 3 });
    expect(items.length).toBeLessThanOrEqual(3);
    // 5件以上あれば nextCursor が設定される
    if (items.length === 3) {
      expect(nextCursor).not.toBeNull();
    }
  });

  it('browse: pin=1 のアイテムが優先される', async () => {
    const pinned = makeItem({ pin: 1, base_score: 0.5 });
    const unpinned = makeItem({ pin: 0, base_score: 0.9 });
    await insertItem(db, pinned);
    await insertItem(db, unpinned);
    const { items } = await getItems(db, { view: 'browse', limit: 10 });
    const idx_pinned = items.findIndex((i) => i.id === pinned.id);
    const idx_unpinned = items.findIndex((i) => i.id === unpinned.id);
    if (idx_pinned !== -1 && idx_unpinned !== -1) {
      expect(idx_pinned).toBeLessThan(idx_unpinned);
    }
  });
});

describe('getItems - recent', () => {
  it('recent: created_at 降順で返す', async () => {
    const older = makeItem({ created_at: '2026-02-20T00:00:00Z' });
    const newer = makeItem({ created_at: '2026-02-23T00:00:00Z' });
    await insertItem(db, older);
    await insertItem(db, newer);
    const { items } = await getItems(db, { view: 'recent', limit: 10 });
    const idx_newer = items.findIndex((i) => i.id === newer.id);
    const idx_older = items.findIndex((i) => i.id === older.id);
    if (idx_newer !== -1 && idx_older !== -1) {
      expect(idx_newer).toBeLessThan(idx_older);
    }
  });
});

describe('getItems - org', () => {
  it('org: org_score >= threshold のアイテムのみ返す', async () => {
    const high = makeItem({ org_score: 0.9, status: 'active' });
    const low = makeItem({ org_score: 0.3, status: 'active' });
    await insertItem(db, high);
    await insertItem(db, low);
    const { items } = await getItems(db, { view: 'org', limit: 10, threshold: 0.6 });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(high.id);
    expect(ids).not.toContain(low.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updateItemStatus
// ──────────────────────────────────────────────────────────────────────────────
describe('updateItemStatus', () => {
  it('status を更新できる', async () => {
    const item = makeItem({ status: 'active' });
    await insertItem(db, item);
    await updateItemStatus(db, item.id, 'muted');
    const updated = await getItemById(db, item.id);
    expect(updated!.status).toBe('muted');
  });

  it('archived に更新できる', async () => {
    const item = makeItem({ status: 'active' });
    await insertItem(db, item);
    await updateItemStatus(db, item.id, 'archived');
    const updated = await getItemById(db, item.id);
    expect(updated!.status).toBe('archived');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updateItemPin
// ──────────────────────────────────────────────────────────────────────────────
describe('updateItemPin', () => {
  it('pin を 0→1 に更新できる', async () => {
    const item = makeItem({ pin: 0 });
    await insertItem(db, item);
    await updateItemPin(db, item.id, 1);
    const updated = await getItemById(db, item.id);
    expect(updated!.pin).toBe(1);
  });

  it('pin を 1→0 に更新できる', async () => {
    const item = makeItem({ pin: 1 });
    await insertItem(db, item);
    await updateItemPin(db, item.id, 0);
    const updated = await getItemById(db, item.id);
    expect(updated!.pin).toBe(0);
  });
});
