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
    // 既定は node のまま（2986 本はこれで回る。jsdom にすると遅くなる）。
    environment: 'node',
    // UI を実際に描いて触るテストだけ jsdom にする。指定はファイル先頭の
    //   `@vitest-environment jsdom` で行う（vitest 4 で environmentMatchGlobs は無い）。
    //   既定を jsdom にすると 2900 本が遅くなるので、既定は node のまま。
    //   ※ jsdom はレイアウトを計算しないので、「画面からはみ出す」「他の UI の裏に
    //     潜る」といった寸法・重なりの不具合は**この道具では検出できない**。
    // 大型幾何フィクスチャ（90m 辺の候補生成で 1 ケース約 5〜12s）が負荷時に
    // デフォルト 5s でタイムアウト flake するため 30s に引き上げる（テスト設定のみ・挙動中立）。
    testTimeout: 30000,
  },
});
