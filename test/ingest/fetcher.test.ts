import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAndExtract } from '../../src/ingest/fetcher.js';

// Helper: fetch をモックしてレスポンスを返す
function mockFetch(body: string, contentType: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { 'content-type': contentType },
      })
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────────────────────────
// text/html
// ──────────────────────────────────────────────────────────────────────────────
describe('text/html', () => {
  it('<title> タグからタイトルを抽出する', async () => {
    mockFetch(
      '<html><head><title>テストページ</title></head><body><article><p>本文</p></article></body></html>',
      'text/html'
    );
    const { title, cleanText } = await fetchAndExtract('https://example.com/');
    expect(title).toBe('テストページ');
    expect(cleanText).toContain('本文');
  });

  it('<title> がない場合は URL をタイトルとして使う', async () => {
    mockFetch('<html><body><article><p>本文</p></article></body></html>', 'text/html');
    const url = 'https://example.com/article';
    const { title } = await fetchAndExtract(url);
    expect(title).toBe(url);
  });

  it('script/nav/header/footer を除去して本文を返す', async () => {
    mockFetch(
      '<html><body>' +
        '<header>ヘッダー</header>' +
        '<nav>ナビ</nav>' +
        '<article><p>記事本文</p></article>' +
        '<script>alert("xss")</script>' +
        '<footer>フッター</footer>' +
        '</body></html>',
      'text/html'
    );
    const { cleanText } = await fetchAndExtract('https://example.com/');
    expect(cleanText).toContain('記事本文');
    expect(cleanText).not.toContain('ヘッダー');
    expect(cleanText).not.toContain('alert');
    expect(cleanText).not.toContain('フッター');
  });

  it('charset 付き content-type でも html として処理する', async () => {
    mockFetch('<html><head><title>Title</title></head><body><p>本文</p></body></html>', 'text/html; charset=utf-8');
    const { title } = await fetchAndExtract('https://example.com/');
    expect(title).toBe('Title');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// text/plain
// ──────────────────────────────────────────────────────────────────────────────
describe('text/plain', () => {
  it('最初の非空行をタイトルとして使う', async () => {
    mockFetch('最初の行\n2行目', 'text/plain');
    const { title } = await fetchAndExtract('https://example.com/doc.txt');
    expect(title).toBe('最初の行');
  });

  it('100 文字超の最初行はタイトルを 100 文字に切り詰める', async () => {
    const longLine = 'a'.repeat(200);
    mockFetch(longLine, 'text/plain');
    const { title } = await fetchAndExtract('https://example.com/doc.txt');
    expect(title.length).toBeLessThanOrEqual(100);
  });

  it('テキストをそのまま cleanText として返す', async () => {
    mockFetch('Hello World', 'text/plain');
    const { cleanText } = await fetchAndExtract('https://example.com/doc.txt');
    expect(cleanText).toBe('Hello World');
  });

  it('空ファイルの場合は URL をタイトルとして使う', async () => {
    mockFetch('', 'text/plain');
    const url = 'https://example.com/empty.txt';
    const { title } = await fetchAndExtract(url);
    expect(title).toBe(url);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// text/markdown
// ──────────────────────────────────────────────────────────────────────────────
describe('text/markdown', () => {
  it('最初の ATX heading をタイトルとして使う', async () => {
    mockFetch('# マークダウン記事\n\n本文テキスト', 'text/markdown');
    const { title } = await fetchAndExtract('https://example.com/post.md');
    expect(title).toBe('マークダウン記事');
  });

  it('heading がない場合は最初の非空行をタイトルとする', async () => {
    mockFetch('本文だけの行\n2行目', 'text/markdown');
    const { title } = await fetchAndExtract('https://example.com/post.md');
    expect(title).toBe('本文だけの行');
  });

  it('マークダウン記法を除去して cleanText を返す', async () => {
    mockFetch('# 見出し\n\n**太字** と [リンク](https://example.com)', 'text/markdown');
    const { cleanText } = await fetchAndExtract('https://example.com/post.md');
    expect(cleanText).toContain('見出し');
    expect(cleanText).toContain('太字');
    expect(cleanText).toContain('リンク');
    expect(cleanText).not.toContain('**');
    expect(cleanText).not.toContain('https://example.com');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// text/x-markdown
// ──────────────────────────────────────────────────────────────────────────────
describe('text/x-markdown', () => {
  it('text/x-markdown も markdown として処理する', async () => {
    mockFetch('## サブ見出し\n\nコンテンツ', 'text/x-markdown');
    const { title, cleanText } = await fetchAndExtract('https://example.com/post.md');
    expect(title).toBe('サブ見出し');
    expect(cleanText).toContain('コンテンツ');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// エラーケース
// ──────────────────────────────────────────────────────────────────────────────
describe('エラーケース', () => {
  it('非対応 content-type はエラーをスローする', async () => {
    mockFetch('<binary>', 'application/octet-stream');
    await expect(fetchAndExtract('https://example.com/file.bin')).rejects.toThrow(
      'Unsupported content type: application/octet-stream'
    );
  });

  it('content-type ヘッダーなし（空文字）はエラーをスローする', async () => {
    mockFetch('data', '');
    await expect(fetchAndExtract('https://example.com/')).rejects.toThrow('Unsupported content type');
  });

  it('application/json はエラーをスローする', async () => {
    mockFetch('{"key":"value"}', 'application/json');
    await expect(fetchAndExtract('https://example.com/api')).rejects.toThrow(
      'Unsupported content type: application/json'
    );
  });

  it('fetch 自体のエラーは伝播する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    await expect(fetchAndExtract('https://example.com/')).rejects.toThrow('network error');
  });
});
