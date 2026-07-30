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
import type { ElevationPart, ElevationPartGeometry, ElevationPartKind } from './elevationParts';

/** 部材を置ける 1 箇所。座標はビューローカル（横=グリッド、縦=mm）。 */
export type ElevationSlot = {
  kind: ElevationPartKind;
  scaffoldIndex: number;
  /** 支柱系。 */
  postIndex?: number;
  /** スパン系（左の支柱番号）。 */
  spanIndex?: number;
  /** 縦位置(mm, GL 基準)。支柱・ジャッキは undefined（足元〜天端の全長）。 */
  levelMm?: number;
  /** 面軸のレンジ（グリッド・生座標）。支柱系は x0===x1。 */
  x0: number;
  x1: number;
};

/** パレットに出す部材（自動生成されない筋交も含む）。 */
export const PALETTE_KINDS: ElevationPartKind[] = ['post', 'rail', 'board', 'jack', 'brace'];

/** その部材が使う縦位置の一覧。 */
function levelsFor(
  kind: ElevationPartKind, sg: ElevationPartGeometry['scaffolds'][number],
): (number | undefined)[] {
  switch (kind) {
    case 'post':
    case 'jack':
      return [undefined];                  // 足元〜天端で 1 本
    case 'board':
    case 'brace':
    case 'raiseBoard':
      return sg.levelsMm;                  // 作業床の高さ
    case 'rail':
    case 'raiseRail':
      return sg.komaGridMm;                // 450 刻み
    default:
      return sg.levelsMm;
  }
}

/** 指定部材の有効スロットを列挙する。 */
export function buildElevationSlots(
  geom: ElevationPartGeometry, kind: ElevationPartKind,
): ElevationSlot[] {
  const out: ElevationSlot[] = [];
  geom.scaffolds.forEach((sg, si) => {
    const isPostKind = kind === 'post' || kind === 'jack';
    if (isPostKind) {
      sg.postXs.forEach((px, pi) => {
        out.push({ kind, scaffoldIndex: si, postIndex: pi, x0: px, x1: px });
      });
      return;
    }
    for (let i = 0; i < sg.postXs.length - 1; i++) {
      const a = sg.postXs[i], b = sg.postXs[i + 1];
      if (b - a <= 1e-6) continue;
      for (const lv of levelsFor(kind, sg)) {
        out.push({ kind, scaffoldIndex: si, spanIndex: i, levelMm: lv, x0: a, x1: b });
      }
    }
  });
  return out;
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
): ElevationSlot | null {
  const slots = buildElevationSlots(geom, kind);
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

/** 同じ位置に同種の部材が既にあるか（二重置きの防止）。 */
export function slotOccupied(parts: ElevationPart[], slot: ElevationSlot): boolean {
  return parts.some((p) =>
    p.kind === slot.kind
    && p.scaffoldIndex === slot.scaffoldIndex
    && (slot.postIndex == null || p.postIndex === slot.postIndex)
    && (slot.spanIndex == null || p.spanIndex === slot.spanIndex)
    && (slot.levelMm == null || p.levelMm === slot.levelMm));
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
