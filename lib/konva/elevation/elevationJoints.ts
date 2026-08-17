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
  VIRTUAL_SPAN_MM,
  partPivotMm, partRangeMm, postKomaMm, postMemberBottomMm, postMemberTopMm, rotateAboutMm,
  type ElevationPart, type ElevationPartGeometry,
} from './elevationParts';
import { KOMA_PITCH_MM } from './komaGrid';

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
  /**
   * 仮想の接合点か (= E-8-v3e)。「そこに将来入る部材（多くは支柱）」が持つはずの受け口。
   * 実在の接合点と同じように吸着できるが、距離が同等なら実在の方を選ぶ。
   */
  virtual?: boolean;
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
  // E-8-v3c-fix4: 傾けた部材は接合点も一緒に回る（斜めに掛けた手摺の端も吸着する）。
  const pivot = part.angleDeg ? partPivotMm(part, sg) : null;
  const at = (xMm: number, yMm: number, kind: JointKind): JointPoint => {
    const p = pivot ? rotateAboutMm({ xMm, yMm }, pivot, part.angleDeg ?? 0) : { xMm, yMm };
    return { xMm: p.xMm, yMm: p.yMm, kind, partId: part.id };
  };

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
    case 'jack': {
      // ジャッキは足元の部材。上端が支柱を受ける。
      // E-8-v5b: 足場が無くても（freeParts でも）受け口を出す。ジャッキの levelMm は
      //   **上端**（partPivotMm と同じ扱い）。ここが sg 頼みだったため、キャンバス直下の
      //   ジャッキは接合点ゼロ＝支柱のホゾが乗らなかった（ホゾ⇔受けの片方が欠けていた）。
      //   sg があるときは従来どおり足場の皿高さを使う＝立面ビュー内の挙動は変わらない。
      const topMm = sg ? sg.jackTopMm : part.levelMm;
      return topMm == null ? [] : [at(r.x0Mm, topMm, 'cup')];
    }
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

/**
 * 仮想接合点を縦に何段ぶん出すか（上下それぞれ・コマ 450 刻み）(= E-8-v3e)。
 * 吸着距離はたかだか数百 mm なので 4 段（±1800mm）あれば実用上足りる。
 */
const VIRTUAL_KOMA_STEPS = 4;

/**
 * その部材が「将来そこに入る相手」として提供する接合点 (= E-8-v3e)。
 *
 * 現場では手摺→柱→手摺と 1 本ずつ交互には組まない。手摺を先にバーッと並べ、
 * 後から柱を差す（鮎澤氏）。よって既存の手摺・踏板の楔は
 * 「そこに立つはずの支柱のポケット」を仮想の受け口として提供する。
 *   ・同じ高さ(k=0)   … 隣の手摺がぴったり続く（＝同じ支柱の左右のポケットに刺さる間隔）
 *   ・450 刻み(k≠0)   … 同じ位置の上下段が揃う（手摺の上に手摺）
 * 支柱は「隣の支柱の位置（標準スパン 1800）」を仮想の受けとして提供する。
 *
 * 実在の接合点（本物の支柱のコマ）は partJoints 側。こちらは常に virtual: true。
 */
export function partVirtualJoints(part: ElevationPart, sg: Scaffold | undefined): JointPoint[] {
  if (part.removed) return [];
  const real = partJoints(part, sg);
  const out: JointPoint[] = [];

  if (part.kind === 'post' || part.kind === 'postExt') {
    // 支柱の横連鎖: 標準スパンぶん離れた「隣の支柱の足元」を受けとして出す。
    const spigot = real.find((j) => j.kind === 'spigot');
    if (spigot) {
      for (const dir of [-1, 1]) {
        out.push({
          xMm: spigot.xMm + dir * VIRTUAL_SPAN_MM, yMm: spigot.yMm,
          kind: 'cup', partId: part.id, virtual: true,
        });
      }
    }
    return out;
  }
  if (part.kind === 'jack') return out;   // 足元の部材。将来の相手を連れてこない。

  // 手摺・踏板・筋交・嵩上げ: 楔の位置に「将来の支柱のコマ列」を出す。
  for (const w of real) {
    if (w.kind !== 'wedge') continue;
    for (let k = -VIRTUAL_KOMA_STEPS; k <= VIRTUAL_KOMA_STEPS; k++) {
      out.push({
        xMm: w.xMm, yMm: w.yMm + k * KOMA_PITCH_MM,
        kind: 'pocket', partId: part.id, virtual: true,
      });
    }
  }
  return out;
}

/** 吸着の結果。dx/dy は「素直に動かした位置」へ足す補正量(mm)。 */
export type JointSnap = {
  dxMm: number;
  dyMm: number;
  /** 吸着した組（ハイライト用）。圏外なら undefined ＝ そのままの位置に置かれる。 */
  from?: JointPoint;
  to?: JointPoint;
};

/**
 * 実在の接合点を優先する余裕(px) (= E-8-v3e)。
 * 「距離が同等なら実在優先」。本物の支柱のコマと、その支柱に刺さっている手摺が出す
 * 仮想ポケットは同じ座標に重なるので、この余裕が無いと選び方が計算誤差で揺れる。
 */
const REAL_PREFERENCE_PX = 1;

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
    // E-8-v3e: 実在の相手が居なくても、部材が提供する「将来の受け口」へ寄せられる。
    targets.push(...partVirtualJoints(o, sg));
  }
  if (targets.length === 0) return none;

  // 実在と仮想は別々に最寄りを持ち、最後に優先順位で決める（E-8-v3e）。
  let bestReal: JointSnap | null = null, bestRealPx = opts.tolPx;
  let bestVirtual: JointSnap | null = null, bestVirtualPx = opts.tolPx;
  for (const from of moved) {
    for (const to of targets) {
      // オス⇔メスの対応が合う組だけ（オス同士・メス同士は吸わない）
      const ok = isMale(from.kind)
        ? ACCEPTS[from.kind] === to.kind
        : isMale(to.kind) && ACCEPTS[to.kind] === from.kind;
      if (!ok) continue;
      const dx = to.xMm - from.xMm, dy = to.yMm - from.yMm;
      const px = Math.hypot(dx, dy) * opts.pxPerMm;
      if (to.virtual) {
        if (px < bestVirtualPx - 1e-9) {
          bestVirtualPx = px;
          bestVirtual = { dxMm: dx, dyMm: dy, from, to };
        }
      } else if (px < bestRealPx - 1e-9) {
        bestRealPx = px;
        bestReal = { dxMm: dx, dyMm: dy, from, to };
      }
    }
  }
  // 実在の接合点が優先。仮想を採るのは「実在より明らかに近い」ときだけ。
  if (bestReal && (!bestVirtual || bestRealPx <= bestVirtualPx + REAL_PREFERENCE_PX)) return bestReal;
  return bestVirtual ?? bestReal ?? none;
}
