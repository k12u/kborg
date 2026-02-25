import { describe, it, expect } from 'vitest';
import { normalizeUrl, hashUrl } from '../../src/utils/url.js';

// ──────────────────────────────────────────────────────────────────────────────
// normalizeUrl
// ──────────────────────────────────────────────────────────────────────────────
describe('normalizeUrl', () => {
  // ── UTM パラメータの除去 ────────────────────────────────────────────────────
  describe('UTM パラメータの除去', () => {
    it.each([
      ['utm_source',   'https://example.com/a?utm_source=twitter'],
      ['utm_medium',   'https://example.com/a?utm_medium=social'],
      ['utm_campaign', 'https://example.com/a?utm_campaign=launch'],
      ['utm_term',     'https://example.com/a?utm_term=keyword'],
      ['utm_content',  'https://example.com/a?utm_content=banner'],
    ])('%s を除去する', (_param, url) => {
      expect(normalizeUrl(url)).toBe('https://example.com/a');
    });

    it('全 UTM パラメータを一括除去する', () => {
      const url =
        'https://example.com/a' +
        '?utm_source=tw&utm_medium=social&utm_campaign=launch' +
        '&utm_term=kw&utm_content=img&id=1';
      expect(normalizeUrl(url)).toBe('https://example.com/a?id=1');
    });

    it('UTM のみの場合クエリ文字列ごと消える', () => {
      expect(normalizeUrl('https://example.com/a?utm_source=tw&utm_medium=social'))
        .toBe('https://example.com/a');
    });

    it('UTM 以外のパラメータは保持する', () => {
      expect(normalizeUrl('https://example.com/a?id=42&utm_source=tw'))
        .toBe('https://example.com/a?id=42');
    });
  });

  // ── 末尾スラッシュの除去 ────────────────────────────────────────────────────
  describe('末尾スラッシュの除去', () => {
    it('パス末尾の / を除去する', () => {
      expect(normalizeUrl('https://example.com/article/'))
        .toBe('https://example.com/article');
    });

    it('ルートパス "/" はそのまま保持する', () => {
      // URL API は https://example.com を https://example.com/ に正規化するため保持
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('スラッシュなしの URL はそのまま', () => {
      expect(normalizeUrl('https://example.com/article'))
        .toBe('https://example.com/article');
    });

    it('クエリパラメータがある場合は末尾がパラメータ値になるため / は除去されない', () => {
      // result = 'https://example.com/article/?id=1' → endsWith('/') = false
      expect(normalizeUrl('https://example.com/article/?id=1'))
        .toBe('https://example.com/article/?id=1');
    });
  });

  // ── fragment の除去 ─────────────────────────────────────────────────────────
  describe('fragment の除去', () => {
    it('# 以降を除去する', () => {
      expect(normalizeUrl('https://example.com/article#section-1'))
        .toBe('https://example.com/article');
    });

    it('クエリパラメータを保持しつつ fragment のみ除去する', () => {
      expect(normalizeUrl('https://example.com/article?id=1#section-1'))
        .toBe('https://example.com/article?id=1');
    });

    it('fragment のみの URL は fragment だけ除去する', () => {
      expect(normalizeUrl('https://example.com/article#'))
        .toBe('https://example.com/article');
    });
  });

  // ── クエリパラメータのソート ─────────────────────────────────────────────────
  describe('クエリパラメータのアルファベットソート', () => {
    it('逆順のパラメータをソートする', () => {
      expect(normalizeUrl('https://example.com/?z=3&a=1&m=2'))
        .toBe('https://example.com/?a=1&m=2&z=3');
    });

    it('UTM 除去後の残パラメータをソートする', () => {
      expect(normalizeUrl('https://example.com/?utm_source=tw&z=3&a=1'))
        .toBe('https://example.com/?a=1&z=3');
    });

    it('パラメータが 1 つの場合はそのまま', () => {
      expect(normalizeUrl('https://example.com/?id=123'))
        .toBe('https://example.com/?id=123');
    });
  });

  // ── 複合ケース ──────────────────────────────────────────────────────────────
  describe('複合ケース', () => {
    it('UTM 除去 + fragment 除去 + ソートを組み合わせる', () => {
      // クエリパラメータが残るため末尾 / は除去されない
      expect(
        normalizeUrl('https://example.com/post/?z=3&utm_source=tw&a=1#top')
      ).toBe('https://example.com/post/?a=1&z=3');
    });

    it('クエリも fragment もない通常 URL はそのまま', () => {
      expect(normalizeUrl('https://example.com/article'))
        .toBe('https://example.com/article');
    });

    it('末尾スラッシュ + fragment を同時に除去する', () => {
      expect(normalizeUrl('https://example.com/article/#top'))
        .toBe('https://example.com/article');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// hashUrl
// ──────────────────────────────────────────────────────────────────────────────
describe('hashUrl', () => {
  it('64 文字の小文字 16 進数を返す', async () => {
    const hash = await hashUrl('https://example.com/article');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同じ URL は常に同じハッシュを返す（冪等性）', async () => {
    const url = 'https://example.com/article';
    expect(await hashUrl(url)).toBe(await hashUrl(url));
  });

  it('異なる URL は異なるハッシュを返す', async () => {
    const h1 = await hashUrl('https://example.com/article-a');
    const h2 = await hashUrl('https://example.com/article-b');
    expect(h1).not.toBe(h2);
  });

  it('正規化してからハッシュ化する（UTM 付きとなしが同じハッシュ）', async () => {
    const h1 = await hashUrl('https://example.com/a?utm_source=twitter');
    const h2 = await hashUrl('https://example.com/a');
    expect(h1).toBe(h2);
  });

  it('クエリパラメータ順が違っても同じハッシュ（ソート正規化）', async () => {
    const h1 = await hashUrl('https://example.com/?a=1&b=2');
    const h2 = await hashUrl('https://example.com/?b=2&a=1');
    expect(h1).toBe(h2);
  });

  it('fragment が違っても同じハッシュ（fragment 除去）', async () => {
    const h1 = await hashUrl('https://example.com/article#section-1');
    const h2 = await hashUrl('https://example.com/article#section-2');
    expect(h1).toBe(h2);
  });
});
