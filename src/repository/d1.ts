import { Item } from '../types.js';

function rowToItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as string,
    source: row.source as string,
    url: row.url as string,
    url_hash: row.url_hash as string,
    title: row.title as string,
    summary_short: row.summary_short as string,
    summary_long: row.summary_long as string,
    tags: JSON.parse(row.tags as string),
    personal_score: row.personal_score as number,
    org_score: row.org_score as number,
    novelty: row.novelty as number,
    base_score: row.base_score as number,
    status: row.status as Item['status'],
    pin: row.pin as 0 | 1,
    r2_path: row.r2_path as string,
    created_at: row.created_at as string,
    processed_at: (row.processed_at as string) ?? null,
  };
}

export async function insertItem(db: D1Database, item: Item): Promise<void> {
  await db
    .prepare(
      `INSERT INTO items (id, source, url, url_hash, title, summary_short, summary_long, tags, personal_score, org_score, novelty, base_score, status, pin, r2_path, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      item.id,
      item.source,
      item.url,
      item.url_hash,
      item.title,
      item.summary_short,
      item.summary_long,
      JSON.stringify(item.tags),
      item.personal_score,
      item.org_score,
      item.novelty,
      item.base_score,
      item.status,
      item.pin,
      item.r2_path,
      item.created_at,
      item.processed_at,
    )
    .run();
}

export async function getItemByUrlHash(db: D1Database, urlHash: string): Promise<Item | null> {
  const row = await db
    .prepare('SELECT * FROM items WHERE url_hash = ?')
    .bind(urlHash)
    .first();
  if (!row) return null;
  return rowToItem(row);
}

export async function getItemById(db: D1Database, id: string): Promise<Item | null> {
  const row = await db
    .prepare('SELECT * FROM items WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return null;
  return rowToItem(row);
}

export async function getItemsByIds(db: D1Database, ids: string[]): Promise<Item[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT * FROM items WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  return results.map((row) => rowToItem(row as Record<string, unknown>));
}

export async function getItems(
  db: D1Database,
  opts: { view: 'browse' | 'recent' | 'org'; cursor?: string; limit: number; threshold?: number },
): Promise<{ items: Item[]; nextCursor: string | null }> {
  const { view, cursor, limit, threshold = 0.6 } = opts;
  const binds: unknown[] = [];
  let sql = 'SELECT * FROM items';
  const wheres: string[] = [];

  if (view === 'browse') {
    wheres.push("status = 'active'");
    if (cursor) {
      const decoded = JSON.parse(atob(cursor)) as { pin: number; base_score: number; created_at: string };
      wheres.push(
        `(pin < ? OR (pin = ? AND base_score < ?) OR (pin = ? AND base_score = ? AND created_at < ?))`,
      );
      binds.push(decoded.pin, decoded.pin, decoded.base_score, decoded.pin, decoded.base_score, decoded.created_at);
    }
    sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY pin DESC, base_score DESC, created_at DESC';
  } else if (view === 'recent') {
    if (cursor) {
      const created_at = atob(cursor);
      wheres.push('created_at < ?');
      binds.push(created_at);
    }
    if (wheres.length > 0) {
      sql += ' WHERE ' + wheres.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
  } else {
    // org
    wheres.push("status = 'active'");
    wheres.push('org_score >= ?');
    binds.push(threshold);
    if (cursor) {
      const decoded = JSON.parse(atob(cursor)) as { org_score: number; created_at: string };
      wheres.push('(org_score < ? OR (org_score = ? AND created_at < ?))');
      binds.push(decoded.org_score, decoded.org_score, decoded.created_at);
    }
    sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY org_score DESC, created_at DESC';
  }

  sql += ' LIMIT ?';
  binds.push(limit + 1);

  const stmt = binds.length > 0 ? db.prepare(sql).bind(...binds) : db.prepare(sql);
  const { results } = await stmt.all();

  let nextCursor: string | null = null;
  const rows = results as Record<string, unknown>[];

  if (rows.length > limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    if (view === 'browse') {
      nextCursor = btoa(JSON.stringify({ pin: last.pin, base_score: last.base_score, created_at: last.created_at }));
    } else if (view === 'recent') {
      nextCursor = btoa(last.created_at as string);
    } else {
      nextCursor = btoa(JSON.stringify({ org_score: last.org_score, created_at: last.created_at }));
    }
  }

  return { items: rows.map(rowToItem), nextCursor };
}

export async function updateItemStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare('UPDATE items SET status = ? WHERE id = ?').bind(status, id).run();
}

export async function updateItemPin(db: D1Database, id: string, pin: 0 | 1): Promise<void> {
  await db.prepare('UPDATE items SET pin = ? WHERE id = ?').bind(pin, id).run();
}
