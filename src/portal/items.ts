import { Env, Item, ItemsListResponse } from '../types.js';
import { getItems, getItemById, getItemsByIds, updateItemStatus, updateItemPin } from '../repository/d1.js';
import { getContent } from '../repository/r2.js';
import { querySimilar } from '../repository/vectorize.js';
import { runEmbedding } from '../llm/workers-ai.js';

export async function handleItemsList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const view = (url.searchParams.get('view') || 'browse') as 'browse' | 'recent' | 'org';
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const threshold = url.searchParams.has('threshold')
    ? parseFloat(url.searchParams.get('threshold')!)
    : undefined;

  const result = await getItems(env.DB, { view, cursor, limit, threshold });
  const body: ItemsListResponse = { items: result.items, nextCursor: result.nextCursor };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleItemDetail(request: Request, env: Env, id: string): Promise<Response> {
  const item = await getItemById(env.DB, id);
  if (!item) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify(item), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleItemContent(request: Request, env: Env, id: string): Promise<Response> {
  const item = await getItemById(env.DB, id);
  if (!item) {
    return new Response('Not found', { status: 404 });
  }
  const text = await getContent(env.BUCKET, item.r2_path);
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function handleItemSimilar(request: Request, env: Env, id: string): Promise<Response> {
  const url = new URL(request.url);
  const topK = parseInt(url.searchParams.get('topK') || '20', 10);

  const item = await getItemById(env.DB, id);
  if (!item) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const embedding = await runEmbedding(env.AI, item.summary_long);
  const similarIds = await querySimilar(env.VECTORIZE, embedding, topK + 1);
  const filteredIds = similarIds.filter((sid) => sid !== id);
  const items = await getItemsByIds(env.DB, filteredIds);
  const activeItems = items.filter((i) => i.status === 'active');

  return new Response(JSON.stringify(activeItems), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleItemStatus(request: Request, env: Env, id: string): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await request.json<{ status: string }>();
  if (!['active', 'muted', 'archived'].includes(body.status)) {
    return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  await updateItemStatus(env.DB, id, body.status);
  return new Response(JSON.stringify({ id, status: body.status }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleItemPin(request: Request, env: Env, id: string): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.API_KEY}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await request.json<{ pin: number }>();
  if (body.pin !== 0 && body.pin !== 1) {
    return new Response(JSON.stringify({ error: 'Invalid pin value' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  await updateItemPin(env.DB, id, body.pin as 0 | 1);
  return new Response(JSON.stringify({ id, pin: body.pin }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
