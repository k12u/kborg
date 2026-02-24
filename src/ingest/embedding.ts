import type { Env } from '../types.js';
import { runEmbedding } from '../llm/workers-ai.js';

export async function generateEmbeddingAndNovelty(
  env: Env,
  id: string,
  summaryLong: string,
): Promise<{ embedding: number[]; novelty: number }> {
  const embedding = await runEmbedding(env.AI, summaryLong);

  const queryResult = await env.VECTORIZE.query(embedding, {
    topK: 5,
    returnValues: false,
    returnMetadata: 'none',
  });

  const matches = queryResult.matches.filter((m) => m.id !== id);

  if (matches.length === 0) {
    return { embedding, novelty: 1.0 };
  }

  const maxSimilarity = Math.max(...matches.map((m) => m.score));
  const novelty = 1.0 - maxSimilarity;

  return { embedding, novelty };
}
