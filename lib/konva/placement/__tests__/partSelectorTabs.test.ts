// ============================================================
// E-8-v3c-fix3: 部材メニューの [平面部材 / 立面図] タブが必ず出ること。
//
// 経緯: fix2 でタブを足したのに実機で見えなかった。原因はコンポーネントの取り違えではなく
// 「表示条件」で、(a) 立面が 1 つも無いページでは隠れる、(b) PC パネルは折りたたみ中に
// 消える、の 2 つだった。条件付きに戻ると同じ事故になるので、ソースを走査して固定する。
// （DOM が無い環境なので、レンダリング条件を構造として検査する）
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../../components/toolbar/PartSelector.tsx'), 'utf8');

describe('部材メニューのタブ', () => {
  it('タブ本体が定義されている（ラベルは 平面部材 / 立面図）', () => {
    expect(SRC).toContain("'平面部材'");
    expect(SRC).toContain("'立面図'");
    expect(SRC).toContain('setPartPaletteTab');
  });

  it('立面の有無で隠していない（hasElevation で条件分岐していない）', () => {
    // 例: `const paletteTabs = hasElevation ? (` に戻っていないこと
    expect(/paletteTabs\s*=\s*hasElevation/.test(SRC)).toBe(false);
    expect(/\{paletteTabs\s*&&/.test(SRC)).toBe(false);
  });

  it('平面パネル（PC・モバイル）と立面パネルの 3 箇所すべてに置かれている', () => {
    const uses = SRC.split('\n').filter((l) => /\{paletteTabs\}/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  it('PC パネルでは折りたたみ(expanded)の外に置かれている', () => {
    const pcTab = SRC.indexOf('shrink-0">{paletteTabs}</div>');
    const expandedGate = SRC.indexOf('{/* コンテンツ */}\n        {expanded && (');
    expect(pcTab).toBeGreaterThan(0);
    expect(expandedGate).toBeGreaterThan(0);
    expect(pcTab).toBeLessThan(expandedGate);   // タブが先＝expanded に囲まれていない
  });

  it('立面タブは立面が無いページでも開ける（案内を出す）', () => {
    expect(SRC).toContain("if (paletteTab === 'elevation')");
    expect(SRC).toContain('立面図がありません');
  });
});
