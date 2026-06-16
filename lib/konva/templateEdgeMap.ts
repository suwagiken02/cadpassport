import { BuildingTemplateId } from '@/types';

/**
 * テンプレートの各入力 dim を、それが駆動する多角形の辺 index に対応付ける。
 * 不変条件: 割当先 edge の実長 == dims[dimKey]（= 入力欄の表示値）。
 * これが崩れるとラベル↔辺ズレになる（templateEdgeMap.test.ts で検証）。
 *
 * 既知の例外（単一辺の実長と一致し得ない設計上の総寸法）:
 *  - t_cross の hw/vh（全幅・全高。十字には その長さの単一辺が無い）
 *  - l_ne の tw（欠けで上辺が短く full-width 辺に載っていない。要再検討）
 */
export function getKeyEdgeMap(id: BuildingTemplateId): Record<string, number> {
  switch (id) {
    case 'rect': return { top: 0, right: 1, bottom: 2, left: 3 };
    case 'l_ne': return { tw: 0, ch: 1, cw: 2, th: 5 };
    case 'l_nw': return { tw: 2, th: 1, cw: 4, ch: 5 };
    case 'l_se': return { tw: 0, cw: 2, ch: 3, th: 5 };
    case 'l_sw': return { tw: 0, th: 1, cw: 4, ch: 3 };
    case 'convex_s': return { tw: 0, th: 1, pw: 4, ph: 3, px: 6 };
    case 'convex_n': return { pw: 0, ph: 1, tw: 4, th: 3, px: 6 };
    case 'convex_e': return { tw: 0, th: 7, pw: 2, ph: 3, py: 1 };
    case 'convex_w': return { tw: 0, th: 1, pw: 4, ph: 5, py: 7 };
    case 'u_s': return { tw: 0, th: 1, ow: 4, od: 3 };
    case 'u_n': return { tw: 6, th: 5, ow: 2, od: 3 };
    case 't_cross': return { vw: 0, hw: 2, hh: 3, vh: 11 };
    case 'circle': return { diameter: 0 };
    default: return {};
  }
}
