import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // HTMLRewriter / crypto.subtle など Workers ランタイム API を有効にする
        // D1/R2/Vectorize バインディングはユーティリティテストでは不要
        miniflare: {
          compatibilityDate: '2024-09-23',
          compatibilityFlags: ['nodejs_compat'],
          // R2 / D1 バインディング（repository テストで使用）
          r2Buckets: ['BUCKET'],
          d1Databases: ['DB'],
        },
      },
    },
  },
});
