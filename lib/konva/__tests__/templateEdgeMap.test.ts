import { describe, it, expect } from 'vitest';
import { BUILDING_TEMPLATES } from '@/lib/konva/buildingBuilder';
import { getKeyEdgeMap } from '@/lib/konva/templateEdgeMap';
import { mmToGrid } from '@/lib/konva/gridUtils';
import { BuildingTemplateId, Point } from '@/types';

/**
 * テンプレートの「ラベル↔辺」マッピング不変条件。
 *
 * getKeyEdgeMap が各入力 dim に割り当てる辺の実長 (grid) が、その dim 値 (grid) と
 * 一致しなければならない。入力欄の表示値 = dims[dimKey] なので、これが崩れると
 * 「入力した値」と「プレビュー/図面の辺の長さ」がズレる（= ラベル↔辺ズレ）。
 *
 * 寸法は dim ごとに distinct な値を使い、辺の取り違え（swap）を確実に検出する。
 *
 * 除外 = 単一辺の実長と一致し得ない設計上の例外（本不変条件の対象外）:
 *  - t_cross の hw/vh: 全幅・全高。十字は4方対称で「その長さの単一辺」が存在しない（総寸法）
 *  - circle: diameter は辺ではない（36角形の弦）→ ケース自体を対象外
 *  - rect: 台形入力に対応し side が斜辺になり得るため、矩形寸法で検証
 */

const edgeLen = (pts: Point[], i: number): number => {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return Math.hypot(b.x - a.x, b.y - a.y);
};

type Case = { id: BuildingTemplateId; dims: Record<string, number>; skip?: string[] };

const CASES: Case[] = [
  { id: 'rect', dims: { top: 9000, right: 7000, bottom: 9000, left: 7000 } },
  { id: 'l_ne', dims: { tw: 9000, th: 7000, cw: 3000, ch: 2000 } },
  { id: 'l_nw', dims: { tw: 9000, th: 7000, cw: 3000, ch: 2000 } },
  { id: 'l_se', dims: { tw: 9000, th: 7000, cw: 3000, ch: 2000 } },
  { id: 'l_sw', dims: { tw: 9000, th: 7000, cw: 3000, ch: 2000 } },
  { id: 'convex_s', dims: { tw: 9000, th: 7000, pw: 3000, ph: 2000, px: 2500 } },
  { id: 'convex_n', dims: { tw: 9000, th: 7000, pw: 3000, ph: 2000, px: 2500 } },
  { id: 'convex_e', dims: { tw: 7000, th: 9000, pw: 2000, ph: 3000, py: 2500 } },
  { id: 'convex_w', dims: { tw: 7000, th: 9000, pw: 2000, ph: 3000, py: 2500 } },
  { id: 'u_s', dims: { tw: 10000, th: 7000, ow: 3000, od: 2000 } },
  { id: 'u_n', dims: { tw: 10000, th: 7000, ow: 3000, od: 2000 } },
  { id: 't_cross', dims: { hw: 12000, hh: 3000, vw: 4000, vh: 10000 }, skip: ['hw', 'vh'] },
];

describe('building template label↔edge mapping', () => {
  for (const c of CASES) {
    it(`${c.id}: 各入力dimの割当先edge実長 == dim値`, () => {
      const tpl = BUILDING_TEMPLATES.find((t) => t.id === c.id)!;
      const pts = tpl.buildPoints(c.dims);
      const map = getKeyEdgeMap(c.id);
      for (const [dimKey, edgeIdx] of Object.entries(map)) {
        if (c.skip?.includes(dimKey)) continue;
        const expected = mmToGrid(c.dims[dimKey]);
        const actual = edgeLen(pts, edgeIdx);
        expect(
          Math.abs(actual - expected),
          `${c.id}.${dimKey} → edge[${edgeIdx}] 実長 ${actual} ≠ dim ${expected}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
