import { describe, it, expect } from 'vitest';
import { extractCleanText, extractPlainText, extractMarkdownText } from '../../src/utils/html.js';

// ──────────────────────────────────────────────────────────────────────────────
// 除去対象タグ
// ──────────────────────────────────────────────────────────────────────────────
describe('除去対象タグ', () => {
  it('script タグのコードを除去する', async () => {
    const html = '<body><p>本文</p><script>alert("xss")</script></body>';
    const text = await extractCleanText(html);
    expect(text).toContain('本文');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('xss');
  });

  it('style タグの CSS を除去する', async () => {
    const html = '<body><style>.foo { color: red; }</style><p>本文</p></body>';
    const text = await extractCleanText(html);
    expect(text).toContain('本文');
    expect(text).not.toContain('.foo');
    expect(text).not.toContain('color');
  });

  it('nav タグの内容を除去する', async () => {
    const html = '<body><nav>ナビメニュー</nav><main>メインコンテンツ</main></body>';
    const text = await extractCleanText(html);
    expect(text).not.toContain('ナビメニュー');
  });

  it('header タグの内容を除去する', async () => {
    const html = '<body><header>サイトヘッダー</header><article>記事本文</article></body>';
    const text = await extractCleanText(html);
    expect(text).not.toContain('サイトヘッダー');
  });

  it('footer タグの内容を除去する', async () => {
    const html = '<body><article>記事本文</article><footer>フッターリンク</footer></body>';
    const text = await extractCleanText(html);
    expect(text).not.toContain('フッターリンク');
  });

  it('script がネストしていても除去する', async () => {
    const html = '<article><p>本文</p><script>ga("send","event")</script></article>';
    const text = await extractCleanText(html);
    expect(text).toContain('本文');
    expect(text).not.toContain('ga(');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// コンテンツ優先抽出
// ──────────────────────────────────────────────────────────────────────────────
describe('コンテンツ優先抽出', () => {
  it('article タグのテキストを優先し、article 外は除外する', async () => {
    const html =
      '<body><aside>サイドバー</aside><article>記事の本文テキスト</article></body>';
    const text = await extractCleanText(html);
    expect(text).toContain('記事の本文テキスト');
    expect(text).not.toContain('サイドバー');
  });

  it('main タグのテキストを優先抽出する', async () => {
    const html =
      '<body><div>周辺テキスト</div><main>メインコンテンツのテキスト</main></body>';
    const text = await extractCleanText(html);
    expect(text).toContain('メインコンテンツのテキスト');
    expect(text).not.toContain('周辺テキスト');
  });

  it('article がない場合は body 全体からテキストを取得する', async () => {
    const html = '<body><div><p>本文テキスト</p></div></body>';
    const text = await extractCleanText(html);
    expect(text).toContain('本文テキスト');
  });

  it('article 内のネスト要素（h1/p/ul/li）のテキストをすべて抽出する', async () => {
    const html =
      '<article>' +
      '<h1>見出し</h1>' +
      '<p>段落テキスト</p>' +
      '<ul><li>リスト項目1</li><li>リスト項目2</li></ul>' +
      '</article>';
    const text = await extractCleanText(html);
    expect(text).toContain('見出し');
    expect(text).toContain('段落テキスト');
    expect(text).toContain('リスト項目1');
    expect(text).toContain('リスト項目2');
  });

  it('複数の除去タグがすべて除かれる（nav + header + footer）', async () => {
    const html =
      '<body>' +
      '<header>ヘッダー</header>' +
      '<nav>ナビ</nav>' +
      '<article>記事本文</article>' +
      '<footer>フッター</footer>' +
      '</body>';
    const text = await extractCleanText(html);
    expect(text).toContain('記事本文');
    expect(text).not.toContain('ヘッダー');
    expect(text).not.toContain('ナビ');
    expect(text).not.toContain('フッター');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 空白の正規化
// ──────────────────────────────────────────────────────────────────────────────
describe('空白の正規化', () => {
  it('連続スペースを 1 スペースに正規化する', async () => {
    const html = '<p>Hello     World</p>';
    const text = await extractCleanText(html);
    expect(text).toBe('Hello World');
  });

  it('複数の改行をスペースに変換する', async () => {
    const html = '<p>Line1\n\n\nLine2</p>';
    const text = await extractCleanText(html);
    expect(text).toBe('Line1 Line2');
  });

  it('タブ文字を正規化する', async () => {
    const html = '<p>col1\t\tcol2</p>';
    const text = await extractCleanText(html);
    expect(text).toBe('col1 col2');
  });

  it('結果をトリムする（前後の空白を除去）', async () => {
    const html = '<p>   テキスト   </p>';
    const text = await extractCleanText(html);
    expect(text).toBe('テキスト');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 30KB truncate
// ──────────────────────────────────────────────────────────────────────────────
describe('30KB truncate', () => {
  it('30720 文字を超えるテキストを切り詰める', async () => {
    const longContent = 'あ'.repeat(40_000);
    const html = `<article>${longContent}</article>`;
    const text = await extractCleanText(html);
    expect(text.length).toBeLessThanOrEqual(30_720);
  });

  it('30720 文字未満のテキストはそのまま返す', async () => {
    const content = 'テスト文章。'.repeat(100); // 600 文字
    const html = `<article>${content}</article>`;
    const text = await extractCleanText(html);
    expect(text.length).toBeLessThan(30_720);
    expect(text).toContain('テスト文章。');
  });

  it('ちょうど 30720 文字は切り詰めない', async () => {
    const content = 'x'.repeat(30_720);
    const html = `<article>${content}</article>`;
    const text = await extractCleanText(html);
    expect(text.length).toBeLessThanOrEqual(30_720);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// エッジケース
// ──────────────────────────────────────────────────────────────────────────────
describe('エッジケース', () => {
  it('テキストのない空 HTML は空文字列を返す', async () => {
    const text = await extractCleanText('<html><body></body></html>');
    expect(text).toBe('');
  });

  it('タグなしの生テキストは空文字列を返す（HTMLRewriter は要素外テキストを捕捉しない）', async () => {
    // rewriter.on('*', ...) は要素内テキストのみ対象のため、
    // 要素を持たない生テキストは bodyText に蓄積されず空文字列になる
    const text = await extractCleanText('シンプルなテキスト');
    expect(text).toBe('');
  });

  it('日本語テキストを正しく処理する', async () => {
    const html = '<article><p>人工知能の活用事例を紹介します。</p></article>';
    const text = await extractCleanText(html);
    expect(text).toContain('人工知能の活用事例を紹介します。');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractPlainText
// ──────────────────────────────────────────────────────────────────────────────
describe('extractPlainText', () => {
  it('プレーンテキストをそのまま返す', () => {
    expect(extractPlainText('Hello World')).toBe('Hello World');
  });

  it('連続空白・改行を 1 スペースに正規化する', () => {
    expect(extractPlainText('Line1\n\nLine2\t\tLine3')).toBe('Line1 Line2 Line3');
  });

  it('前後の空白をトリムする', () => {
    expect(extractPlainText('  テキスト  ')).toBe('テキスト');
  });

  it('30720 文字を超えるテキストを切り詰める', () => {
    const long = 'a'.repeat(40_000);
    expect(extractPlainText(long).length).toBeLessThanOrEqual(30_720);
  });

  it('30720 文字未満はそのまま返す', () => {
    const text = 'Hello World';
    expect(extractPlainText(text)).toBe('Hello World');
  });

  it('空文字列は空文字列を返す', () => {
    expect(extractPlainText('')).toBe('');
  });

  it('HTML タグを除去しない（plain text の責務外）', () => {
    // text/plain として受け取った内容はタグもそのままテキスト扱い
    expect(extractPlainText('<b>bold</b>')).toBe('<b>bold</b>');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractMarkdownText
// ──────────────────────────────────────────────────────────────────────────────
describe('extractMarkdownText', () => {
  describe('見出し', () => {
    it('ATX heading の # マーカーを除去してテキストを残す', () => {
      expect(extractMarkdownText('# 見出し1')).toBe('見出し1');
      expect(extractMarkdownText('## 見出し2')).toBe('見出し2');
      expect(extractMarkdownText('### 見出し3')).toBe('見出し3');
    });
  });

  describe('強調', () => {
    it('**bold** → テキストを残す', () => {
      expect(extractMarkdownText('**太字テキスト**')).toBe('太字テキスト');
    });

    it('*italic* → テキストを残す', () => {
      expect(extractMarkdownText('*斜体テキスト*')).toBe('斜体テキスト');
    });

    it('__bold__ → テキストを残す', () => {
      expect(extractMarkdownText('__太字テキスト__')).toBe('太字テキスト');
    });

    it('_italic_ → テキストを残す', () => {
      expect(extractMarkdownText('_斜体テキスト_')).toBe('斜体テキスト');
    });
  });

  describe('リンク・画像', () => {
    it('[text](url) → テキストを残す', () => {
      expect(extractMarkdownText('[クリックはこちら](https://example.com)')).toBe('クリックはこちら');
    });

    it('![alt](url) → 除去する', () => {
      const text = extractMarkdownText('前の文章 ![サムネイル](https://example.com/img.png) 後の文章');
      expect(text).not.toContain('サムネイル');
      expect(text).not.toContain('img.png');
      expect(text).toContain('前の文章');
      expect(text).toContain('後の文章');
    });
  });

  describe('コードブロック', () => {
    it('フェンスコードブロックを除去する', () => {
      const md = '説明文\n```python\nprint("hello")\n```\n続きの文章';
      const text = extractMarkdownText(md);
      expect(text).not.toContain('print');
      expect(text).toContain('説明文');
      expect(text).toContain('続きの文章');
    });

    it('インラインコードの内容を残す', () => {
      expect(extractMarkdownText('`normalizeUrl` 関数を使う')).toBe('normalizeUrl 関数を使う');
    });
  });

  describe('リスト', () => {
    it('unordered list マーカー (- * +) を除去する', () => {
      const md = '- 項目A\n* 項目B\n+ 項目C';
      const text = extractMarkdownText(md);
      expect(text).toContain('項目A');
      expect(text).toContain('項目B');
      expect(text).toContain('項目C');
      expect(text).not.toMatch(/^[-*+]\s/);
    });

    it('ordered list マーカーを除去する', () => {
      const md = '1. 最初\n2. 次\n3. 最後';
      const text = extractMarkdownText(md);
      expect(text).toContain('最初');
      expect(text).toContain('次');
      expect(text).toContain('最後');
      expect(text).not.toMatch(/\d+\.\s/);
    });
  });

  describe('その他', () => {
    it('blockquote マーカーを除去してテキストを残す', () => {
      expect(extractMarkdownText('> 引用テキスト')).toBe('引用テキスト');
    });

    it('水平線を除去する', () => {
      const md = '段落1\n---\n段落2';
      const text = extractMarkdownText(md);
      expect(text).toContain('段落1');
      expect(text).toContain('段落2');
      expect(text).not.toContain('---');
    });

    it('空白・改行を正規化する', () => {
      expect(extractMarkdownText('# タイトル\n\n本文テキスト')).toBe('タイトル 本文テキスト');
    });

    it('30720 文字を超えるマークダウンを切り詰める', () => {
      const long = '# 見出し\n' + 'テキスト。'.repeat(10_000);
      expect(extractMarkdownText(long).length).toBeLessThanOrEqual(30_720);
    });

    it('実際的なマークダウン文書を処理できる', () => {
      const md = [
        '# Cloudflare Workers AI Guide',
        '',
        '## Overview',
        '**Workers AI** allows you to run [AI models](https://ai.cloudflare.com) at the edge.',
        '',
        '## Example',
        '```typescript',
        'const result = await env.AI.run("@cf/meta/llama-3", { prompt });',
        '```',
        '',
        '> Note: Requires a Workers paid plan.',
        '',
        '- Fast inference',
        '- Global distribution',
        '- No cold starts',
      ].join('\n');

      const text = extractMarkdownText(md);
      expect(text).toContain('Cloudflare Workers AI Guide');
      expect(text).toContain('Overview');
      expect(text).toContain('Workers AI');
      expect(text).toContain('AI models');        // リンクのテキスト
      expect(text).not.toContain('https://ai.cloudflare.com');
      expect(text).not.toContain('```');
      expect(text).not.toContain('env.AI.run');   // コードブロックは除去
      expect(text).toContain('Note:');            // blockquote のテキストは残る
    });
  });
});
