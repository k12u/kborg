import { describe, it, expect } from 'vitest';
import { generateEmbeddingAndNovelty } from '../../src/ingest/embedding.js';
import type { Env } from '../../src/types.js';

// ── モックファクトリ ──────────────────────────────────────────────────────────

const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => i / 768);

function makeEnv(opts: {
  embedding?: number[];
  vectorizeMatches?: Array<{ id: string; score: number }>;
} = {}): Env {
  const { embedding = MOCK_EMBEDDING, vectorizeMatches = [] } = opts;
  return {
    AI: {
      run: async () => ({ data: [embedding] }),
    },
    VECTORIZE: {
      query: async () => ({ matches: vectorizeMatches }),
    },
  } as unknown as Env;
}

// ──────────────────────────────────────────────────────────────────────────────
// embedding 生成
// ──────────────────────────────────────────────────────────────────────────────
describe('embedding 生成', () => {
  it('AI から返された embedding をそのまま返す', async () => {
    const env = makeEnv({ embedding: [0.1, 0.2, 0.3] });
    const { embedding } = await generateEmbeddingAndNovelty(env, 'id-1', 'summary text');
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// novelty 計算
// ──────────────────────────────────────────────────────────────────────────────
describe('novelty 計算', () => {
  it('類似ベクトルが存在しない場合は novelty = 1.0', async () => {
    const env = makeEnv({ vectorizeMatches: [] });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-1', 'text');
    expect(novelty).toBe(1.0);
  });

  it('novelty = 1.0 - max_cosine_similarity', async () => {
    const env = makeEnv({
      vectorizeMatches: [
        { id: 'other-1', score: 0.8 },
        { id: 'other-2', score: 0.6 },
      ],
    });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-new', 'text');
    expect(novelty).toBeCloseTo(1.0 - 0.8);
  });

  it('自分自身（同一 id）はマッチから除外される', async () => {
    // topK=5 の結果に自分自身が含まれる場合は除外して novelty を計算
    const env = makeEnv({
      vectorizeMatches: [
        { id: 'id-self', score: 0.99 }, // 自分自身 → 除外
        { id: 'other-1', score: 0.7 },
      ],
    });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-self', 'text');
    // 自己除外後の最大スコアは 0.7
    expect(novelty).toBeCloseTo(1.0 - 0.7);
  });

  it('自分自身のみが topK に含まれる場合 novelty = 1.0', async () => {
    const env = makeEnv({
      vectorizeMatches: [{ id: 'id-only', score: 0.99 }],
    });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-only', 'text');
    expect(novelty).toBe(1.0);
  });

  it('複数マッチの中の最大スコアを使って novelty を計算する', async () => {
    const env = makeEnv({
      vectorizeMatches: [
        { id: 'a', score: 0.5 },
        { id: 'b', score: 0.9 },
        { id: 'c', score: 0.3 },
        { id: 'd', score: 0.7 },
      ],
    });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-new', 'text');
    expect(novelty).toBeCloseTo(1.0 - 0.9);
  });

  it('similarity = 0 の場合 novelty = 1.0', async () => {
    const env = makeEnv({
      vectorizeMatches: [{ id: 'other', score: 0.0 }],
    });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-new', 'text');
    expect(novelty).toBeCloseTo(1.0);
  });

  it('similarity = 1 の場合 novelty = 0.0（完全に同じコンテンツ）', async () => {
    const env = makeEnv({
      vectorizeMatches: [{ id: 'duplicate', score: 1.0 }],
    });
    const { novelty } = await generateEmbeddingAndNovelty(env, 'id-new', 'text');
    expect(novelty).toBeCloseTo(0.0);
  });
});
