import type {
  Env,
  Item,
  IngestContext,
  IngestResponse,
  DuplicateResponse,
} from '../types.js';
import { normalizeUrl, hashUrl } from '../utils/url.js';
import { fetchAndExtract } from './fetcher.js';
import { saveContent } from '../repository/r2.js';
import { scoreContent } from './scoring.js';
import { generateEmbeddingAndNovelty } from './embedding.js';
import { insertItem, getItemByUrlHash } from '../repository/d1.js';
import { upsertVector } from '../repository/vectorize.js';

export async function handleIngest(
  request: Request,
  env: Env
): Promise<Response> {
  // 1. Auth check
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader !== `Bearer ${env.API_KEY}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: { url?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return Response.json({ error: 'url is required' }, { status: 400 });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const source = body.source || 'manual';

  // 4. Normalize and hash
  const normalizedUrl = normalizeUrl(url);
  const urlHash = await hashUrl(normalizedUrl);

  // 5. Duplicate check
  const existing = await getItemByUrlHash(env.DB, urlHash);
  if (existing) {
    const dupResponse: DuplicateResponse = {
      id: existing.id,
      duplicate: true,
      message: 'Already ingested',
    };
    return Response.json(dupResponse, { status: 200 });
  }

  // 6. Fetch and extract
  let title: string;
  let cleanText: string;
  try {
    const result = await fetchAndExtract(url);
    title = result.title;
    cleanText = result.cleanText;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed';
    return Response.json({ error: message }, { status: 502 });
  }

  // 7. ID = url_hash
  const id = urlHash;

  // 8. Save to R2
  const processedAt = new Date().toISOString();
  const r2Path = await saveContent(env.BUCKET, id, cleanText, {
    url,
    processed_at: processedAt,
  });

  // 9. Build IngestContext
  const ctx: IngestContext = {
    id,
    url,
    title,
    cleanText,
    r2Path,
  };

  // 10. LLM scoring
  const scoringResult = await scoreContent(env, ctx);

  // 11-12. Embedding and novelty
  let embedding: number[] = [];
  let novelty = 0.5;
  try {
    const embResult = await generateEmbeddingAndNovelty(
      env,
      id,
      scoringResult.summary_long
    );
    embedding = embResult.embedding;
    novelty = embResult.novelty;
  } catch (err) {
    console.error('Embedding generation failed, using fallback novelty:', err);
  }

  // 13. Calculate base_score
  const baseScore =
    0.5 * scoringResult.personal_score +
    0.3 * scoringResult.org_score +
    0.2 * novelty;

  // 14. Build Item and save to D1
  const item: Item = {
    id,
    source,
    url,
    url_hash: urlHash,
    title: scoringResult.title,
    summary_short: scoringResult.summary_short,
    summary_long: scoringResult.summary_long,
    tags: scoringResult.tags,
    personal_score: scoringResult.personal_score,
    org_score: scoringResult.org_score,
    novelty,
    base_score: baseScore,
    status: 'active',
    pin: 0,
    r2_path: r2Path,
    created_at: new Date().toISOString(),
    processed_at: processedAt,
  };

  await insertItem(env.DB, item);

  // 15. Save to Vectorize (non-blocking failure)
  if (embedding.length > 0) {
    try {
      await upsertVector(env.VECTORIZE, id, embedding, {
        source,
        created_at: item.created_at,
      });
    } catch (err) {
      console.error('Vectorize upsert failed:', err);
    }
  }

  // 16. Return success
  const response: IngestResponse = {
    id,
    title: item.title,
    summary_short: item.summary_short,
    base_score: item.base_score,
    status: item.status,
  };

  return Response.json(response, { status: 201 });
}
