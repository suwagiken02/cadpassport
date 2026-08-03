// ============================================================
// 立面の吸着スロット (E-8-v2c・pure・node 安全)
//
// 「はまる場所にしかはまらない」を担保する有効位置の集合。
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
  postStackTopMm, postXAt,
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

/**
 * 縦位置の延長 (= E-8-v2n)。既存のコマ列の上下へ 450 刻みで伸ばす。
 * 下方向は GL より下に行かないところで止める（皿より下は部材が掛からない）。
 */
function extendedLevels(
  kind: ElevationPartKind, sg: ElevationPartGeometry['scaffolds'][number], extKoma: number,
): (number | undefined)[] {
  const base = levelsFor(kind, sg);
  const nums = base.filter((v): v is number => v != null);
  if (nums.length === 0 || extKoma <= 0) return base;  // 支柱・ジャッキ（高さを持たない）/ 延長なし
  const out = new Set(nums);
  const top = Math.max(...nums), bottom = Math.min(...nums);
  for (let i = 1; i <= extKoma; i++) {
    out.add(top + KOMA_PITCH_MM * i);
    const down = bottom - KOMA_PITCH_MM * i;
    if (down > 0) out.add(down);                       // 皿より下・GL 下には出さない
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** スロット列挙のオプション (= E-8-v2n)。 */
export type SlotGridOptions = {
  /**
   * 既存足場の外側（仮想の支柱位置・コマ）も「置ける場所」に含めるか。既定 false。
   * true にするのは編集の吸着・パレット表示だけ。再マッチ（置き場所が残っているかの判定）は
   * 実在のスロットで見る＝足場が縮んだ手動部材は従来どおり孤立として提示する。
   */
  extend?: boolean;
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
    const levels = extendedLevels(kind, sg, extKoma);
    const realLevels = new Set(levelsFor(kind, sg).filter((v): v is number => v != null));
    // 0 - extSpans（-0 を作らない: postIndex/spanIndex は同値比較に使う）
    for (let i = 0 - extSpans; i <= last - 1 + extSpans; i++) {
      const a = postXAt(sg, i), b = postXAt(sg, i + 1);
      if (a == null || b == null || b - a <= 1e-6) continue;
      const virtualSpan = i < 0 || i + 1 > last;
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

/** スロットの同一判定キー (= E-8-v2g、 ドラッグ中の吸着先が変わったかの比較用)。 */
export function slotKey(slot: ElevationSlot): string {
  const pos = slot.postIndex != null ? `p${slot.postIndex}` : `s${slot.spanIndex ?? '-'}`;
  return `${slot.kind}@${slot.scaffoldIndex}:${pos}:${slot.levelMm ?? '-'}`;
}

/** スロットの代表点（吸着距離の基準）。横はスパン中央、縦は高さ。 */
export function slotAnchor(slot: ElevationSlot, geom: ElevationPartGeometry): { x: number; y: number } {
  const sg = geom.scaffolds[slot.scaffoldIndex];
  const midMm = slot.levelMm ?? ((sg?.jackTopMm ?? 0) + (sg?.topRailMm ?? 0)) / 2;
  return { x: (slot.x0 + slot.x1) / 2, y: midMm };
}

/**
 * ローカル座標（横=グリッド・生座標、縦=mm）に最も近い有効スロットを返す。
 * 縦横のスケールが違うので、縦は mm→グリッド（1grid=10mm）に換算して比較する。
 * 候補が無ければ null。
 */
export function snapToSlot(
  point: { x: number; yMm: number }, geom: ElevationPartGeometry, kind: ElevationPartKind,
  opts?: SlotGridOptions,
): ElevationSlot | null {
  const slots = buildElevationSlots(geom, kind, opts);
  let best: { slot: ElevationSlot; d: number } | null = null;
  for (const s of slots) {
    const a = slotAnchor(s, geom);
    const dx = a.x - point.x;
    const dy = (a.y - point.yMm) / 10; // mm → グリッド
    const d = dx * dx + dy * dy;
    if (!best || d < best.d) best = { slot: s, d };
  }
  return best ? best.slot : null;
}

/**
 * 支柱部材のドラッグ移動先 (= E-8-v2s)。
 *
 * 実機症状: 天端の上へ継ぎ足そうとすると、頭に載らず隙間を空けて宙に浮いた。
 * 原因は吸着の基準点で、汎用の snapToSlot は「指の位置」を寄せていた。支柱は 1 本が
 * 長い（1800〜3600mm）ので、部材の真ん中あたりを掴むと指は下端よりずっと上にあり、
 * 450 刻みの継ぎ足し候補のうち「掴んだ位置ぶん上」のものに吸着していた。
 *
 * ここでは掴んだ部材の「下端」を寄せる:
 *   ・横 = 最寄りの支柱位置（実在＋仮想）
 *   ・縦 = 「今の高さのまま」と「継ぎ足し先」のうち、動かした下端が近い方
 *          （横へ動かしただけなら高さは変わらない ＝ v2q の挙動をそのまま保つ）
 */
export function snapPostSlot(
  geom: ElevationPartGeometry,
  part: ElevationPart,
  moved: { x: number; bottomMm: number },
  currentBottomMm: number,
  opts?: SlotGridOptions,
): ElevationSlot | null {
  const slots = buildElevationSlots(geom, part.kind, opts);
  if (slots.length === 0) return null;
  // 横: 最寄りの支柱位置（縦は見ない）
  let nearest: ElevationSlot | null = null;
  let bestDx = Infinity;
  for (const s of slots) {
    const dx = Math.abs(s.x0 - moved.x);
    if (dx < bestDx - 1e-9) { bestDx = dx; nearest = s; }
  }
  if (!nearest) return null;
  const here = slots.filter(
    (s) => s.scaffoldIndex === nearest!.scaffoldIndex && s.postIndex === nearest!.postIndex);
  // 縦: 既定は「今の高さのまま」（levelMm を持たない足元〜天端のスロット）
  let chosen = here.find((s) => s.levelMm == null) ?? nearest;
  let bestDy = Math.abs(moved.bottomMm - currentBottomMm);
  for (const s of here) {
    if (s.levelMm == null) continue;
    const dy = Math.abs(moved.bottomMm - s.levelMm);
    if (dy < bestDy - 1e-9) { bestDy = dy; chosen = s; }
  }
  return chosen;
}

/** スロット → 手動追加の部材。id は呼び出し側が採番する。 */
export function slotToPart(slot: ElevationSlot, id: string): ElevationPart {
  return {
    id,
    kind: slot.kind,
    scaffoldIndex: slot.scaffoldIndex,
    origin: 'manual',
    postIndex: slot.postIndex,
    spanIndex: slot.spanIndex,
    levelMm: slot.levelMm,
    // 支柱系は postXs から座標を引くのでレンジは持たせない。
    ...(slot.kind === 'post' || slot.kind === 'jack' ? {} : { x0: slot.x0, x1: slot.x1 }),
  };
}

/**
 * 同じ位置に同種の部材が既にあるか（二重置きの防止）。
 *
 * E-8-v2q: 支柱は規格部材（8/6/4/2/1 コマ品）の積み重ねで、1 本の支柱位置に
 * segmentIndex 違いの ElevationPart が複数ある。段を 1 つ掴んで隣の支柱位置へ動かすとき、
 * 「その位置に支柱が 1 つでもあれば埋まり」と見ると実在の支柱位置へは絶対に動かせない
 * （実機の「支柱がスナップせず置けない」の正体）。段を指定されたときは同じ段だけを見る。
 * 段を指定しない（パレットから 1 本ぶん置く）ときは従来どおり位置ごとで見る。
 */
export function slotOccupied(
  parts: ElevationPart[], slot: ElevationSlot, forSegmentIndex?: number,
): boolean {
  return parts.some((p) =>
    p.kind === slot.kind
    && p.scaffoldIndex === slot.scaffoldIndex
    && (slot.postIndex == null || p.postIndex === slot.postIndex)
    && (slot.spanIndex == null || p.spanIndex === slot.spanIndex)
    && (slot.levelMm == null || p.levelMm === slot.levelMm)
    && (forSegmentIndex === undefined || p.segmentIndex === forSegmentIndex));
}

/** 手動追加部材の id を採番する（既存と衝突しない連番）。 */
export function nextPartId(parts: ElevationPart[], kind: ElevationPartKind): string {
  const used = new Set(parts.map((p) => p.id));
  let n = 1;
  while (used.has(`manual:${kind}:${n}`)) n++;
  return `manual:${kind}:${n}`;
}

/**
 * 隣の有効位置（v2d の移動用）。
 * dir: 'left'|'right' はスパン/支柱番号を、'up'|'down' は縦位置を 1 つずらす。
 * ずらせない（端）場合は null。
 */
export function neighborSlot(
  part: ElevationPart, geom: ElevationPartGeometry, dir: 'left' | 'right' | 'up' | 'down',
): ElevationSlot | null {
  const sg = geom.scaffolds[part.scaffoldIndex];
  if (!sg) return null;
  const slots = buildElevationSlots(geom, part.kind).filter((s) => s.scaffoldIndex === part.scaffoldIndex);
  if (dir === 'left' || dir === 'right') {
    const step = dir === 'left' ? -1 : 1;
    if (part.kind === 'post' || part.kind === 'jack') {
      const next = (part.postIndex ?? 0) + step;
      return slots.find((s) => s.postIndex === next) ?? null;
    }
    const next = (part.spanIndex ?? 0) + step;
    return slots.find((s) => s.spanIndex === next && s.levelMm === part.levelMm) ?? null;
  }
  // 縦移動（支柱・ジャッキは縦位置を持たないので不可）
  if (part.kind === 'post' || part.kind === 'jack') return null;
  const levels = Array.from(new Set(slots.map((s) => s.levelMm).filter((v): v is number => v != null)))
    .sort((a, b) => a - b);
  const cur = levels.indexOf(part.levelMm ?? -1);
  if (cur < 0) return null;
  const next = levels[cur + (dir === 'up' ? 1 : -1)];
  if (next == null) return null;
  return slots.find((s) => s.spanIndex === part.spanIndex && s.levelMm === next) ?? null;
}
