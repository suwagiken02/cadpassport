// ============================================================
// 立面の接合吸着 (E-8-v3b・pure・node 安全)
//
// v2 の「はまる場所にしかはまらない（スロット＝許可制）」を捨て、実物と同じ
// 「接合するところだけ吸い付く」に変えるためのエンジン。原則は 4 つだけ:
//   1. コマ（楔ポケット）と手摺の楔が吸着する
//   2. 支柱ジョイントのオス（下端ホゾ）とメス（上端受け）が吸着する
//   3. それ以外はどこにでも置ける（吸着圏外ならそのままの位置に置かれる。禁止しない）
//   4. パレット由来でも自動生成でも、部材の扱いは完全に同一
//
// ここは「部材が持つ接合点」と「最寄りの相手へ吸せるための補正量」だけを計算する。
// 置けるかどうかの判定（占有・許可）は持たない ＝ 重複配置も自由。
//
// 座標系: 面軸 x は mm（v3a の自由座標）、高さ y は mm（GL 基準・上が正）。
//   画面 px への換算は縦横とも同じ（1 グリッド = 10mm・縦も -mm/10）なので、
//   吸着距離は mm 距離 × pxPerMm の等方比較でよい。
// ============================================================
import {
  partRangeMm, postKomaMm, postMemberBottomMm, postMemberTopMm,
  type ElevationPart, type ElevationPartGeometry,
} from './elevationParts';

type Scaffold = ElevationPartGeometry['scaffolds'][number];

/** 接合点の種類。オス（差す側）とメス（受ける側）が対になる。 */
export type JointKind =
  | 'wedge'    // オス: 手摺・踏板・筋交の端（楔・爪）
  | 'pocket'   // メス: 支柱のコマ（楔ポケット）
  | 'spigot'   // オス: 支柱の下端ホゾ
  | 'cup';     // メス: 支柱の上端受け／ジャッキの上端

export type JointPoint = {
  /** 面軸(mm)。 */
  xMm: number;
  /** 高さ(mm, GL 基準)。 */
  yMm: number;
  kind: JointKind;
  /** どの部材の接合点か（ハイライト用）。 */
  partId: string;
};

/** オス → 吸着できるメス。この 2 行が「接合の全ルール」。 */
const ACCEPTS: Record<'wedge' | 'spigot', JointKind> = {
  wedge: 'pocket',   // 楔・爪 → コマ
  spigot: 'cup',     // ホゾ  → 支柱の受け／ジャッキの上端
};

const isMale = (k: JointKind): k is 'wedge' | 'spigot' => k === 'wedge' || k === 'spigot';

/**
 * その部材が持つ接合点。相手の「実体」から計算するので、継ぎ足して伸ばした支柱の
 * コマにも自動で吸着する（スロット表を別に持たない）。
 */
export function partJoints(part: ElevationPart, sg: Scaffold | undefined): JointPoint[] {
  if (part.removed) return [];
  const r = partRangeMm(part, sg);
  if (!r) return [];
  const at = (xMm: number, yMm: number, kind: JointKind): JointPoint =>
    ({ xMm, yMm, kind, partId: part.id });

  switch (part.kind) {
    case 'post':
    case 'postExt': {
      const bottomMm = postMemberBottomMm(part, sg);
      const topMm = postMemberTopMm(part, sg);
      return [
        at(r.x0Mm, bottomMm, 'spigot'),                       // 下端ホゾ（オス）
        at(r.x0Mm, topMm, 'cup'),                             // 上端受け（メス）
        ...postKomaMm(part, sg).map((h) => at(r.x0Mm, h, 'pocket')),  // コマ（メス）
      ];
    }
    case 'jack':
      // ジャッキは足元の部材。上端が支柱を受ける。
      return sg ? [at(r.x0Mm, sg.jackTopMm, 'cup')] : [];
    case 'brace': {
      // 筋交はスパンの対角。上端と下端で高さが違う。
      const topMm = part.levelMm ?? sg?.topRailMm ?? 0;
      return [at(r.x0Mm, topMm - 1800, 'wedge'), at(r.x1Mm, topMm, 'wedge')];
    }
    default: {
      // 手摺・踏板・嵩上げ: 両端の楔／爪
      const yMm = (part.levelMm ?? 0) + (part.kind === 'raiseRail' ? (part.railOffsetMm ?? 0) : 0);
      return [at(r.x0Mm, yMm, 'wedge'), at(r.x1Mm, yMm, 'wedge')];
    }
  }
}

/** 吸着の結果。dx/dy は「素直に動かした位置」へ足す補正量(mm)。 */
export type JointSnap = {
  dxMm: number;
  dyMm: number;
  /** 吸着した組（ハイライト用）。圏外なら undefined ＝ そのままの位置に置かれる。 */
  from?: JointPoint;
  to?: JointPoint;
};

export type JointSnapOptions = {
  /** 1mm が画面何 px か（＝ pxPerGrid / 10）。 */
  pxPerMm: number;
  /** 吸着する画面距離(px)。指の基準。 */
  tolPx: number;
};

/**
 * ドラッグ中の部材を、最寄りの接合点へ吸わせるための補正量を返す (= E-8-v3b)。
 *
 *  ・動かした部材のオス点 × 相手のメス点、および 動かした部材のメス点 × 相手のオス点
 *    の全組を見て、画面距離が最も近い組を選ぶ（部材をどちらから寄せても同じ挙動）
 *  ・しきい値(px)を超えていれば補正 0 ＝ 置いた場所にそのまま置かれる（禁止しない）
 *  ・置けるかどうかの判定はしない。同じコマに 2 本置くのも自由
 */
export function snapJoint(
  dragged: ElevationPart,
  others: ElevationPart[],
  sg: Scaffold | undefined,
  move: { dxMm: number; dyMm: number },
  opts: JointSnapOptions,
): JointSnap {
  const none: JointSnap = { dxMm: 0, dyMm: 0 };
  if (!(opts.pxPerMm > 0) || !(opts.tolPx > 0)) return none;

  const moved = partJoints(dragged, sg).map((j) => ({
    ...j, xMm: j.xMm + move.dxMm, yMm: j.yMm + move.dyMm,
  }));
  if (moved.length === 0) return none;

  const targets: JointPoint[] = [];
  for (const o of others) {
    if (o.id === dragged.id || o.removed) continue;
    targets.push(...partJoints(o, sg));
  }
  if (targets.length === 0) return none;

  let best: JointSnap | null = null;
  let bestPx = opts.tolPx;
  for (const from of moved) {
    for (const to of targets) {
      // オス⇔メスの対応が合う組だけ（オス同士・メス同士は吸わない）
      const ok = isMale(from.kind)
        ? ACCEPTS[from.kind] === to.kind
        : isMale(to.kind) && ACCEPTS[to.kind] === from.kind;
      if (!ok) continue;
      const dx = to.xMm - from.xMm, dy = to.yMm - from.yMm;
      const px = Math.hypot(dx, dy) * opts.pxPerMm;
      if (px < bestPx - 1e-9) {
        bestPx = px;
        best = { dxMm: dx, dyMm: dy, from, to };
      }
    }
  }
  return best ?? none;
}
