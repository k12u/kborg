import { Env, Item } from '../types.js';
import { getItemsByIds } from '../repository/d1.js';
import { runEmbedding } from '../llm/workers-ai.js';

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) {
    return new Response(JSON.stringify({ error: 'Missing query parameter q' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const limitParam = parseInt(url.searchParams.get('limit') || '10', 10);
  const limit = Math.min(Math.max(limitParam, 1), 50);

  const embedding = await runEmbedding(env.AI, q);
  const result = await env.VECTORIZE.query(embedding, {
    topK: limit,
    returnValues: false,
    returnMetadata: 'none',
  });

  const ids = result.matches.map((m) => m.id);
  const items = await getItemsByIds(env.DB, ids);
  const filtered = items.filter((i) => i.status !== 'muted' && i.status !== 'archived');

  return new Response(JSON.stringify(filtered), {
    headers: { 'Content-Type': 'application/json' },
  });
}
