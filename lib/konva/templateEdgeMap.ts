import { BuildingTemplateId } from '@/types';

/**
 * テンプレートの各入力 dim を、それが駆動する多角形の辺 index に対応付ける。
 * 不変条件: 割当先 edge の実長 == dims[dimKey]（= 入力欄の表示値）。
 * これが崩れるとラベル↔辺ズレになる（templateEdgeMap.test.ts で検証）。
 *
 * 既知の例外（単一辺の実長と一致し得ない設計上の総寸法）:
 *  - t_cross の hw/vh（全幅・全高。十字には その長さの単一辺が無い。詳細は t_cross 直前コメント）
 */
export function getKeyEdgeMap(id: BuildingTemplateId): Record<string, number> {
  switch (id) {
    case 'rect': return { top: 0, right: 1, bottom: 2, left: 3 };
    // l_ne(北東欠け): 全幅 tw は full-width の下辺 E4 に割当（上辺 E0 は tw-cw で派生表示）。
    case 'l_ne': return { tw: 4, ch: 1, cw: 2, th: 5 };
    case 'l_nw': return { tw: 2, th: 1, cw: 4, ch: 5 };
    case 'l_se': return { tw: 0, cw: 2, ch: 3, th: 5 };
    case 'l_sw': return { tw: 0, th: 1, cw: 4, ch: 3 };
    case 'convex_s': return { tw: 0, th: 1, pw: 4, ph: 3, px: 6 };
    case 'convex_n': return { pw: 0, ph: 1, tw: 4, th: 3, px: 6 };
    case 'convex_e': return { tw: 0, th: 7, pw: 2, ph: 3, py: 1 };
    case 'convex_w': return { tw: 0, th: 1, pw: 4, ph: 5, py: 7 };
    case 'u_s': return { tw: 0, th: 1, ow: 4, od: 3 };
    case 'u_n': return { tw: 6, th: 5, ow: 2, od: 3 };
    // ⚠ 既知の制限（十字 t_cross の hw / vh は辺の実長と一致しない）:
    //   ・制限: hw(全幅) / vh(全高) は総寸法で、プラス形には実長が一致する単一辺が存在しない
    //     （上下左右の各辺が腕で3分割されるため）。よって現状 hw→C(edge2)・vh→L(edge11) の
    //     段差辺にラベルが乗り、その辺の実長(= 腕の張り出し)とは一致しない。
    //     vw(縦幅)→A・hh(横高さ)→D は先端辺と実長一致で正常。
    //   ・影響: 入力値・生成ポリゴン・足場割付はすべて正しい。辺ラベルの表示だけが紛らわしい
    //     （実害小。十字の使用頻度も低い）。
    //   ・直し方(将来A案): hw / vh を辺ラベル A〜L から外し、「全幅 / 全高」を総寸法の独立入力に
    //     変更＋プレビューでブラケット( |←全幅→| )表示にする。8本の段差辺は派生にして各実長を
    //     表示する。これで全ラベルが「実長 == 表示値」を満たす。
    case 't_cross': return { vw: 0, hw: 2, hh: 3, vh: 11 };
    case 'circle': return { diameter: 0 };
    default: return {};
  }
}
