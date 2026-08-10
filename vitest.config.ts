import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig の jsx は Next のために 'preserve'。vitest から .tsx を読むときだけ
  // 変換方式を指定する（P-1-fix4: パレット部品の出力をテストで固定するため）。
  // この設定は vitest からしか読まれないので、本体のビルドには影響しない。
  oxc: { jsx: { runtime: 'automatic' } },
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
