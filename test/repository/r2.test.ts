import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { saveContent, getContent } from '../../src/repository/r2.js';

// Cloudflare R2 binding (miniflare in-memory)
const bucket = (env as unknown as { BUCKET: R2Bucket }).BUCKET;

// ──────────────────────────────────────────────────────────────────────────────
// saveContent
// ──────────────────────────────────────────────────────────────────────────────
describe('saveContent', () => {
  it('content/{yyyy}/{mm}/{id}.txt.gz 形式のキーを返す', async () => {
    const key = await saveContent(bucket, 'test-id-1', 'Hello', {
      url: 'https://example.com',
      processed_at: new Date().toISOString(),
    });
    expect(key).toMatch(/^content\/\d{4}\/\d{2}\/test-id-1\.txt\.gz$/);
  });

  it('保存したオブジェクトが R2 に存在する', async () => {
    const key = await saveContent(bucket, 'test-id-2', 'Some content', {
      url: 'https://example.com/page',
      processed_at: '2026-02-24T00:00:00Z',
    });
    // head() はボディストリームを返さないため isolated storage クリーンアップが安全
    const obj = await bucket.head(key);
    expect(obj).not.toBeNull();
  });

  it('カスタムメタデータ（url / processed_at）が保存される', async () => {
    const meta = { url: 'https://example.com/meta', processed_at: '2026-02-24T12:00:00Z' };
    const key = await saveContent(bucket, 'test-id-3', 'text', meta);
    const obj = await bucket.head(key);
    expect(obj?.customMetadata?.url).toBe(meta.url);
    expect(obj?.customMetadata?.processed_at).toBe(meta.processed_at);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getContent
// ──────────────────────────────────────────────────────────────────────────────
describe('getContent', () => {
  it('save → get のラウンドトリップでテキストが復元される', async () => {
    const original = '人工知能の活用事例を紹介します。';
    const key = await saveContent(bucket, 'rt-id-1', original, {
      url: 'https://example.com/ja',
      processed_at: new Date().toISOString(),
    });
    const restored = await getContent(bucket, key);
    expect(restored).toBe(original);
  });

  it('ASCII テキストのラウンドトリップ', async () => {
    const original = 'Hello World! This is a test.';
    const key = await saveContent(bucket, 'rt-id-2', original, {
      url: 'https://example.com/en',
      processed_at: new Date().toISOString(),
    });
    const restored = await getContent(bucket, key);
    expect(restored).toBe(original);
  });

  it('空文字列のラウンドトリップ', async () => {
    const key = await saveContent(bucket, 'rt-id-empty', '', {
      url: 'https://example.com/empty',
      processed_at: new Date().toISOString(),
    });
    const restored = await getContent(bucket, key);
    expect(restored).toBe('');
  });

  it('長いテキスト（30KB 相当）のラウンドトリップ', async () => {
    const original = 'テスト文章。'.repeat(5000); // ~30KB
    const key = await saveContent(bucket, 'rt-id-long', original, {
      url: 'https://example.com/long',
      processed_at: new Date().toISOString(),
    });
    const restored = await getContent(bucket, key);
    expect(restored).toBe(original);
  });

  it('存在しないキーは Error をスローする', async () => {
    await expect(getContent(bucket, 'content/2026/02/nonexistent.txt.gz')).rejects.toThrow(
      'R2 object not found'
    );
  });
});
