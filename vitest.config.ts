import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    include: ['**/__tests__/**/*.test.ts'],
    environment: 'node',
    // 大型幾何フィクスチャ（90m 辺の候補生成で 1 ケース約 5〜12s）が負荷時に
    // デフォルト 5s でタイムアウト flake するため 30s に引き上げる（テスト設定のみ・挙動中立）。
    testTimeout: 30000,
  },
});
