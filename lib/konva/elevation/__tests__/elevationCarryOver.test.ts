// ============================================================
// E-8-v3f: 立面の配置先がどこでも、手当ての引き継ぎは同じであること。
//
// 実機で塞いだ穴: 「立面図を配置」の配置先は 3 つある。
//   ・今のページ       → canvasStore.addElevationViews → 引き継ぎあり
//   ・既存の別ページ   → canvas_data を直接 update      → **素通りしていた**
//   ・新しいページ     → 新しい canvas_data を insert   → **素通りしていた**
// 後ろ 2 つは store を通らないので、引き継ぎが store の中にある限り効かない。
// ここでは pure 側（mergeElevationViews）で同じ引き継ぎが走ることを固定する。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { ElevationView } from '@/types';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { newElevationPart } from '../elevationParts';
import { carryOverElevationView, mergeElevationViews } from '../elevationCarryOver';

const geom: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360, 540],
    jackTopMm: 150,
    topRailMm: 6500,
    levelsMm: [1100, 2900, 4700],
    komaGridMm: [150, 600, 1050, 1500, 1950, 2400, 2850],
  }],
};

/** 自動生成だけのビュー（＝作り直した直後の姿）。 */
const freshView = (id: string, face = 'south'): ElevationView => ({
  id, face, originGrid: { x: 0, y: 0 }, scale: 1, primitives: [],
  parts: [{
    id: 'rail:0:1500:180', kind: 'rail', scaffoldIndex: 0, origin: 'auto',
    spanIndex: 1, levelMm: 1500, x0: 180, x1: 360,
  }],
  geom,
} as ElevationView);

/** 手動で手摺を 1 本足した状態のビュー。 */
const editedView = (): ElevationView => {
  const v = freshView('old');
  const manual: ElevationPart = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
  return { ...v, parts: [...(v.parts ?? []), manual] };
};

describe('立面ビューの引き継ぎ（配置先に依らない）', () => {
  it('手動部材は新しいビューへ引き継がれる', () => {
    const out = carryOverElevationView(editedView(), freshView('new'));
    expect(out.id).toBe('new');
    expect(out.parts?.map((p) => p.id)).toContain('manual:rail:1');
  });

  it('手当てが無ければ新しいビューをそのまま使う（余計な加工をしない）', () => {
    const next = freshView('new');
    expect(carryOverElevationView(freshView('old'), next)).toBe(next);
    expect(carryOverElevationView(undefined, next)).toBe(next);
  });

  describe('mergeElevationViews（別ページ・新しいページの経路）', () => {
    it('同じ面の旧ビューがあれば手当てを引き継ぐ', () => {
      const merged = mergeElevationViews([editedView()], [freshView('new')]);
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('new');
      expect(merged[0].parts?.map((p) => p.id)).toContain('manual:rail:1');
    });

    it('別の面のビューはそのまま残す（1 面 1 ビュー）', () => {
      const north = freshView('north-view', 'north');
      const merged = mergeElevationViews([editedView(), north], [freshView('new')]);
      expect(merged.map((v) => v.id).sort()).toEqual(['new', 'north-view']);
      expect(merged.find((v) => v.face === 'north')).toBe(north);
    });

    it('置き換え先が無い（新しいページ）なら、そのまま置くだけ', () => {
      const v = freshView('new');
      expect(mergeElevationViews(undefined, [v])).toEqual([v]);
      expect(mergeElevationViews([], [v])).toEqual([v]);
    });

    // 実機の穴はここ。ダイアログが自前の merge を持っていると、
    // pure 側をいくら直しても別ページ経路には届かない（＝ソースで固定する）。
    it('配置ダイアログは自前の merge を持たず、共通の引き継ぎを使う', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../../../components/elevation/ElevationPlaceDialog.tsx'), 'utf8');
      expect(src).toMatch(/import \{[^}]*mergeElevationViews[^}]*\} from '@\/lib\/konva\/elevation\/elevationCarryOver'/);
      expect(src).not.toMatch(/function mergeElevationViews/);
      // 別ページ・新しいページの 2 経路がどちらも引き継ぎ付きの merge を通る
      expect(src).toMatch(/function mergeInto[\s\S]*mergeElevationViews\(/);
      expect((src.match(/= mergeInto\(/g) ?? []).length).toBe(2);
      // 今のページは store 経由（store も同じ pure 関数を使う）
      expect(src).toContain('addElevationViews');
    });

    it('引き継げなかった手当ては孤立として持ち回る（消さない）', () => {
      const far = newElevationPart('rail', 'manual:rail:far', 0, { xMm: 60000, yMm: 1500 });
      const prev = { ...freshView('old'), parts: [far] };
      const merged = mergeElevationViews([prev], [freshView('new')]);
      expect(merged[0].parts?.some((p) => p.id === 'manual:rail:far')).toBe(false);
      expect(merged[0].orphanParts?.map((p) => p.id)).toEqual(['manual:rail:far']);
    });
  });
});
