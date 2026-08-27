// ============================================================
// 立面の位置候補 (E-8-v2c・pure・node 安全)
//
// E-8-v3 で編集は自由座標＋接合点スナップ (= elevationJoints) に変わったため、
// ここは「置ける場所しか置けない」許可制ではなくなった。今の役目は 2 つだけ:
//   ・再生成時の再マッチ (= elevationPartsRematch) が「その位置がまだ有るか」を見る
//   ・パレットの種類一覧 (= PALETTE_KINDS) と手動部材の id 採番 (= nextPartId)
// 吸着・占有判定・隣への移動といった許可制の仕組みは E-8-v3d で撤去した。
//
// 位置の集合:
//   横 = 支柱位置（postXs）と支柱間（スパン）
//   縦 = 作業床の高さ（levelsMm）と 450 刻みのコマ位置（komaGridMm）
// 部材ごとに使うスロットが違う:
//   支柱・ジャッキ → 支柱位置（postIndex）
//   踏板          → スパン × 作業床の高さ
//   手摺          → スパン × コマ位置（450 刻み）
//   筋交          → スパン × 作業床の高さ（その床から下 1 段の対角）
// 幅はスパン幅から自動で決まる（部材側で長さを指定しない）。
// ============================================================
import {
  postMemberTopMm, postStackTopMm, postXAt,
  type ElevationPart, type ElevationPartGeometry, type ElevationPartKind,
} from './elevationParts';
import { KOMA_PITCH_MM } from './komaGrid';

/**
 * 仮想グリッドの広がり (= E-8-v2n)。既存の足場の外側へ、足場の文法（スパンピッチ・
 * コマ 450 刻み）をこのぶんだけ延長して「置ける場所」にする。
 * 無限に出すとゴーストだらけで狙えなくなるので、実用範囲で止める。
 */
export const GRID_EXT_SPANS = 3;
export const GRID_EXT_KOMA = 3;
/**
 * 支柱の継ぎ足し先を、既存支柱の頭から何コマ上まで出すか (= E-8-v2s)。
 * 規格部材の最長（8 コマ＝3600mm）ぶん。継ぎ足した部材の天もこの範囲に入るので、
 * その上へさらに継ぐ（2 段目・3 段目）ことができる。
 */
export const POST_STACK_EXT_KOMA = 8;

/** 部材を置ける 1 箇所。座標はビューローカル（横=グリッド、縦=mm）。 */
export type ElevationSlot = {
  kind: ElevationPartKind;
  scaffoldIndex: number;
  /** 支柱系。既存範囲の外は負値 / 支柱本数以上になる (= E-8-v2n)。 */
  postIndex?: number;
  /** スパン系（左の支柱番号）。同上。 */
  spanIndex?: number;
  /** 縦位置(mm, GL 基準)。支柱・ジャッキは undefined（足元〜天端の全長）。 */
  levelMm?: number;
  /** 面軸のレンジ（グリッド・生座標）。支柱系は x0===x1。 */
  x0: number;
  x1: number;
  /** 既存の足場の外側（仮想の支柱位置・コマ）か (= E-8-v2n)。置けるが、ゴーストは薄く出す。 */
  virtual?: boolean;
};

/** パレットに出す部材（自動生成されない筋交も含む）。 */
export const PALETTE_KINDS: ElevationPartKind[] = ['post', 'rail', 'board', 'jack', 'brace'];

/**
 * 作図の補助 (= E-8-v5c)。部材ではないのでパレットでも列を分ける。
 * 線は 2 クリック（起点→終点）、点は 1 クリックで置く。
 */
export const AID_PALETTE_KINDS: ElevationPartKind[] = ['line'];

/**
 * パレットを開いた時点で選ばれている種類 (= E-8-v5c)。
 * 「何も選ばれていない段階」は要らない（鮎澤氏）。いちばん使うのが手摺。
 */
export const DEFAULT_ELEVATION_PART_KIND: ElevationPartKind = 'rail';

/**
 * 縦位置は「コマ列（ジャッキ上端から 450 刻み）」を基準にする (= E-8-v2g)。
 * 実物の支柱には 450 刻みでコマが付いていて、そこにしか部材は掛からない。
 * 自動生成の作業床は 1800 ピッチ（スタート端数ぶんズレる）でコマ列に乗らないので、
 * 踏板・筋交は「作業床の高さ ∪ コマ列」にする。既存の自動部材の置き場所を保ったまま、
 * 手で置く/動かすときはコマ全段が使える（＝現場の掛け方に合う）。
 */
function levelsFor(
  kind: ElevationPartKind, sg: ElevationPartGeometry['scaffolds'][number],
): (number | undefined)[] {
  switch (kind) {
    case 'post':
    case 'jack':
      return [undefined];                  // 足元〜天端で 1 本
    case 'rail':
    case 'raiseRail':
      return sg.komaGridMm;                // コマ列そのまま
    case 'board':
    case 'brace':
    case 'raiseBoard':
    default:
      return Array.from(new Set([...sg.levelsMm, ...sg.komaGridMm])).sort((a, b) => a - b);
  }
}

/** コマ列を伸ばす上限の安全弁（暴走防止・450mm × 400 = 180m）。 */
const MAX_KOMA_STEPS = 400;

/**
 * 継ぎ足しの吸着許容（mm）(= E-8-v2u)。候補は 450 刻みなので 1 コマ。
 * 部材の長さに依らない固定値にするのが要点（ドラッグ量や掴んだ位置と比べると、
 * 長い部材ほど挙動が変わってしまう）。
 */
const STACK_SNAP_TOL_MM = KOMA_PITCH_MM;

/**
 * 縦位置の延長 (= E-8-v2n / E-8-v2t)。既存のコマ列の上下へ 450 刻みで伸ばす。
 * 下方向は GL より下に行かないところで止める（皿より下は部材が掛からない）。
 *
 * E-8-v2t: 上方向は「そのスパンの支柱が実際どこまで伸びているか(ceilingMm)」まで
 * コマ列を継ぎ、そこからさらに仮想延長ぶんを足す。支柱を継ぎ足せば手摺の候補も
 * 一緒に上がる（継ぎ足した支柱にもコマがあるのだから掛けられるべき・鮎澤氏）。
 * コマ格子は継ぎ目をまたいでも連続する（部材の下端から 250、以降 450）ので、
 * 既存の列を 450 刻みで伸ばすだけで継ぎ足し部材のコマと一致する。
 */
function extendedLevels(
  kind: ElevationPartKind, sg: ElevationPartGeometry['scaffolds'][number], extKoma: number,
  ceilingMm?: number,
): (number | undefined)[] {
  const base = levelsFor(kind, sg);
  const nums = base.filter((v): v is number => v != null);
  if (nums.length === 0 || extKoma <= 0) return base;  // 支柱・ジャッキ（高さを持たない）/ 延長なし
  const out = new Set(nums);
  const bottom = Math.min(...nums);
  // 継ぎ足しぶんは「コマ格子の続き」として伸ばす（作業床の高さは 1800 ピッチで
  // 格子の途中に来ないので、そこからではなくコマ列から刻む）。
  const komaTop = sg.komaGridMm.length > 0 ? Math.max(...sg.komaGridMm) : Math.max(...nums);
  if (ceilingMm != null) {
    for (let n = 1; n <= MAX_KOMA_STEPS; n++) {
      const h = komaTop + KOMA_PITCH_MM * n;
      if (h > ceilingMm + 1e-6) break;
      out.add(h);
    }
  }
  const top = Math.max(...Array.from(out));
  for (let i = 1; i <= extKoma; i++) {
    out.add(top + KOMA_PITCH_MM * i);
    const down = bottom - KOMA_PITCH_MM * i;
    if (down > 0) out.add(down);                       // 皿より下・GL 下には出さない
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * その支柱位置に実際に立っている支柱の最上端(mm) (= E-8-v2t)。
 * parts を渡さない／その位置に支柱が 1 本も無い場合は、自動生成の頭を既定にする
 * （仮想の支柱位置でも従来どおりのコマ候補が出るように。v2n を壊さない）。
 */
function postTopAt(
  sg: ElevationPartGeometry['scaffolds'][number], scaffoldIndex: number, postIndex: number,
  parts?: ElevationPart[],
): number {
  const base = postStackTopMm(sg);
  if (!parts || parts.length === 0) return base;
  let top = -Infinity;
  for (const p of parts) {
    if (p.kind !== 'post' || p.removed) continue;
    if (p.scaffoldIndex !== scaffoldIndex || p.postIndex !== postIndex) continue;
    top = Math.max(top, postMemberTopMm(p, sg));
  }
  return Number.isFinite(top) ? top : base;
}

/** スロット列挙のオプション (= E-8-v2n)。 */
export type SlotGridOptions = {
  /**
   * 既存足場の外側（仮想の支柱位置・コマ）も「置ける場所」に含めるか。既定 false。
   * true にするのは編集の吸着・パレット表示だけ。再マッチ（置き場所が残っているかの判定）は
   * 実在のスロットで見る＝足場が縮んだ手動部材は従来どおり孤立として提示する。
   */
  extend?: boolean;
  /**
   * いま置かれている部材 (= E-8-v2t)。手摺・踏板のコマ候補を「そのスパンの支柱が
   * 実際どこまで伸びているか」に追従させるために使う（継ぎ足した支柱の高さを反映）。
   * 渡さなければ自動生成の頭を基準にした従来どおりの候補になる。
   */
  parts?: ElevationPart[];
};

/**
 * 指定部材の有効スロットを列挙する。
 * E-8-v2n: extend=true では、既存の支柱列・コマ列の「外側」も足場の文法どおりに延長する
 *   （既存足場の右外のスパンへ手摺を持って行っても吸着せず置けなかった＝平面のような
 *   自由さが無い、という実機指摘）。仮想位置は virtual:true が付く。
 */
export function buildElevationSlots(
  geom: ElevationPartGeometry, kind: ElevationPartKind, opts?: SlotGridOptions,
): ElevationSlot[] {
  const extSpans = opts?.extend ? GRID_EXT_SPANS : 0;
  const extKoma = opts?.extend ? GRID_EXT_KOMA : 0;
  const out: ElevationSlot[] = [];
  geom.scaffolds.forEach((sg, si) => {
    if (sg.postXs.length === 0) return;
    const last = sg.postXs.length - 1;
    const isPostKind = kind === 'post' || kind === 'jack';
    if (isPostKind) {
      for (let i = 0 - extSpans; i <= last + extSpans; i++) {
        const px = postXAt(sg, i);
        if (px == null) continue;
        const virtual = i < 0 || i > last;
        // 足元〜天端の 1 本ぶん（levelMm なし＝既存の支柱そのもの）
        out.push({ kind, scaffoldIndex: si, postIndex: i, x0: px, x1: px, virtual });
        // E-8-v2r: 既存支柱の天端に継ぎ足す位置（ジョイント継ぎ）。levelMm は部材の下端。
        //   支柱は縦位置を持たない設計だったため、上へ積む先が候補に入っていなかった
        //   （手摺は v2n でコマ列が上へ延びたのに、支柱だけ延びなかった差分）。
        //   ジャッキは足元の部材なので継ぎ足さない。
        if (kind === 'post' && extKoma > 0) {
          // 基準は「規格部材を積み上げた実際の頭」。天端(topRailMm)ではない (= E-8-v2s)。
          const head = postStackTopMm(sg);
          // 規格部材 1 本ぶん（最大 8 コマ）まで上へ。継ぎ足した部材の天も候補になるので、
          // その上へさらに継げる（2 段目・3 段目）。
          for (let k = 0; k <= POST_STACK_EXT_KOMA; k++) {
            out.push({
              kind, scaffoldIndex: si, postIndex: i, levelMm: head + KOMA_PITCH_MM * k,
              x0: px, x1: px, virtual: true,
            });
          }
        }
      }
      return;
    }
    const realLevels = new Set(levelsFor(kind, sg).filter((v): v is number => v != null));
    // 0 - extSpans（-0 を作らない: postIndex/spanIndex は同値比較に使う）
    for (let i = 0 - extSpans; i <= last - 1 + extSpans; i++) {
      const a = postXAt(sg, i), b = postXAt(sg, i + 1);
      if (a == null || b == null || b - a <= 1e-6) continue;
      const virtualSpan = i < 0 || i + 1 > last;
      // E-8-v2t: そのスパンの支柱の実高さまでコマ候補を伸ばす。
      //   両側で高さが違うときは「高い方」を採る（片側だけ継ぎ足した直後でも掛けられる。
      //   現物どおりの「両側にコマがある高さだけ」にするならここを Math.min にする）。
      const ceiling = extKoma > 0
        ? Math.max(postTopAt(sg, si, i, opts?.parts), postTopAt(sg, si, i + 1, opts?.parts))
        : undefined;
      const levels = extendedLevels(kind, sg, extKoma, ceiling);
      for (const lv of levels) {
        out.push({
          kind, scaffoldIndex: si, spanIndex: i, levelMm: lv, x0: a, x1: b,
          virtual: virtualSpan || (lv != null && !realLevels.has(lv)),
        });
      }
    }
  });
  return out;
}







/** 手動追加部材の id を採番する（既存と衝突しない連番）。 */
export function nextPartId(parts: ElevationPart[], kind: ElevationPartKind): string {
  const used = new Set(parts.map((p) => p.id));
  let n = 1;
  while (used.has(`manual:${kind}:${n}`)) n++;
  return `manual:${kind}:${n}`;
}

