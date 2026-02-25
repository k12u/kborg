import { describe, it, expect } from 'vitest';
import { scoreContent } from '../../src/ingest/scoring.js';
import type { Env, IngestContext } from '../../src/types.js';

// ── モックファクトリ ──────────────────────────────────────────────────────────

function makeDb(opts: { interests?: string[]; themes?: string[]; tags?: string[] } = {}) {
  const { interests = [], themes = [], tags = [] } = opts;
  return {
    prepare: (sql: string) => ({
      first: async () => {
        if (sql.includes('user_profile')) return { interests: JSON.stringify(interests) };
        return null;
      },
      all: async () => {
        if (sql.includes('org_themes')) return { results: themes.map((t) => ({ theme: t })) };
        if (sql.includes('tag_vocabulary')) return { results: tags.map((t) => ({ tag: t })) };
        return { results: [] };
      },
    }),
  } as unknown as D1Database;
}

function makeAi(response: string) {
  return { run: async () => ({ response }) } as unknown as Ai;
}

function makeEnv(opts: {
  interests?: string[];
  themes?: string[];
  tags?: string[];
  aiResponse?: string;
} = {}): Env {
  const defaultJson = JSON.stringify({
    title: 'AI Title',
    summary_short: 'Short',
    summary_long: 'Long summary here',
    tags: ['ai', 'test'],
    personal_score: 0.7,
    org_score: 0.6,
  });
  return {
    DB: makeDb(opts),
    AI: makeAi(opts.aiResponse ?? defaultJson),
  } as unknown as Env;
}

const ctx: IngestContext = {
  id: 'test-id',
  url: 'https://example.com/article',
  title: 'Original Title',
  cleanText: 'Article content here.',
  r2Path: 'content/2026/02/test-id.txt.gz',
};

// ──────────────────────────────────────────────────────────────────────────────
// 正常系
// ──────────────────────────────────────────────────────────────────────────────
describe('正常系', () => {
  it('AI の JSON レスポンスを正しくパースして返す', async () => {
    const env = makeEnv();
    const result = await scoreContent(env, ctx);
    expect(result.title).toBe('AI Title');
    expect(result.summary_short).toBe('Short');
    expect(result.summary_long).toBe('Long summary here');
    expect(result.tags).toEqual(['ai', 'test']);
    expect(result.personal_score).toBe(0.7);
    expect(result.org_score).toBe(0.6);
  });

  it('JSON がテキストに埋め込まれていても抽出できる', async () => {
    const json = JSON.stringify({
      title: 'Embedded',
      summary_short: 's',
      summary_long: 'l',
      tags: [],
      personal_score: 0.8,
      org_score: 0.5,
    });
    const env = makeEnv({ aiResponse: `Here is the analysis:\n${json}\nEnd.` });
    const result = await scoreContent(env, ctx);
    expect(result.title).toBe('Embedded');
    expect(result.personal_score).toBe(0.8);
  });

  it('tags は最大 5 件に切り詰める', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 't',
        summary_short: 's',
        summary_long: 'l',
        tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        personal_score: 0.5,
        org_score: 0.5,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.tags.length).toBeLessThanOrEqual(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// スコアのクランプ
// ──────────────────────────────────────────────────────────────────────────────
describe('スコアのクランプ', () => {
  it('personal_score > 1.0 は 1.0 にクランプされる', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 't', summary_short: 's', summary_long: 'l', tags: [],
        personal_score: 2.5, org_score: 0.5,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.personal_score).toBe(1.0);
  });

  it('personal_score < 0 は 0 にクランプされる', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 't', summary_short: 's', summary_long: 'l', tags: [],
        personal_score: -0.5, org_score: 0.5,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.personal_score).toBe(0);
  });

  it('org_score > 1.0 は 1.0 にクランプされる', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 't', summary_short: 's', summary_long: 'l', tags: [],
        personal_score: 0.5, org_score: 99,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.org_score).toBe(1.0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// フォールバック（JSON 抽出失敗）
// ──────────────────────────────────────────────────────────────────────────────
describe('フォールバック', () => {
  it('AI が JSON を返さない場合はフォールバック値を返す', async () => {
    const env = makeEnv({ aiResponse: 'Sorry, I cannot process this.' });
    const result = await scoreContent(env, ctx);
    expect(result.title).toBe(ctx.title);
    expect(result.personal_score).toBe(0.5);
    expect(result.org_score).toBe(0.5);
    expect(result.tags).toEqual([]);
  });

  it('AI が不正な JSON を返す場合もフォールバックする', async () => {
    const env = makeEnv({ aiResponse: '{ invalid json }' });
    const result = await scoreContent(env, ctx);
    expect(result.title).toBe(ctx.title);
    expect(result.personal_score).toBe(0.5);
  });

  it('AI が例外をスローする場合もフォールバックする', async () => {
    const env = {
      DB: makeDb(),
      AI: { run: async () => { throw new Error('AI unavailable'); } },
    } as unknown as Env;
    const result = await scoreContent(env, ctx);
    expect(result.title).toBe(ctx.title);
    expect(result.personal_score).toBe(0.5);
  });

  it('フォールバックの summary_short は cleanText 先頭 80 文字', async () => {
    const longCtx: IngestContext = { ...ctx, cleanText: 'a'.repeat(200) };
    const env = makeEnv({ aiResponse: 'no json' });
    const result = await scoreContent(env, longCtx);
    expect(result.summary_short.length).toBeLessThanOrEqual(80);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 型ガード（非文字列・非数値フィールド）
// ──────────────────────────────────────────────────────────────────────────────
describe('型ガード', () => {
  it('personal_score が数値でない場合は 0.5 にフォールバック', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 't', summary_short: 's', summary_long: 'l',
        tags: [], personal_score: 'high', org_score: 0.5,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.personal_score).toBe(0.5);
  });

  it('title が文字列でない場合は元のタイトルを使う', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 123, summary_short: 's', summary_long: 'l',
        tags: [], personal_score: 0.5, org_score: 0.5,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.title).toBe(ctx.title);
  });

  it('tags が配列でない場合は空配列を使う', async () => {
    const env = makeEnv({
      aiResponse: JSON.stringify({
        title: 't', summary_short: 's', summary_long: 'l',
        tags: 'ai,test', personal_score: 0.5, org_score: 0.5,
      }),
    });
    const result = await scoreContent(env, ctx);
    expect(result.tags).toEqual([]);
  });
});
