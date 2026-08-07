// ============================================================
// 部材ブロックの再マッチ (E-8-v2e / E-8-v3f・pure・node 安全)
//
// 平面を編集して立面を作り直すと、自動生成部材は総取っ替えになる。
// ユーザーの手当て（追加・移動・削除）は引き継ぐ。引き継げないものは破棄せず
// 「孤立」として持ち回り、UI で一覧提示してユーザーが削除する
// （勝手に消さない・勝手に別の場所へ付けない）。
//
// 引き継ぎの判定は 2 段構え (= E-8-v3f):
//   1. 旧世代（スロット番号を持つ部材）… 番号（spanIndex/postIndex＋levelMm）で照合する。
//      墓標や、動かしていない自動由来の部材はここで拾う。x0/x1 は新しい幾何から引き直す。
//   2. 自由座標（E-8-v3 以降）… 番号を持たない／番号では見つからない部材は、
//      **座標そのもの**が新しい足場の範囲に掛かっているかで判定し、座標はそのまま残す。
//
// なぜ 2 が要るか（実機で「作り直すと手動部材が全部消える」）:
//   E-8-v3a で位置を自由座標(x0Mm/x1Mm/levelMm)一次に変えたとき、パレットで置いた
//   部材は spanIndex/postIndex を持たなくなった。再マッチだけが v2 の番号照合のまま
//   取り残されていたため、パレット由来は 100%、動かした部材も縦にずらした時点で
//   （levelMm がコマ格子から外れて）孤立し、画面から消えていた。
//
// 方針は「残す」(鮎澤氏):
//   建物が大きく変わって置き場所が不自然になっても、新しい足場の範囲に掛かって
//   いるなら残す。見えていれば手で直せる。孤立にするのは
//   「その面の足場ごと消えた」「完全に範囲外へ出た」ときだけ。
//
// 手動の表現は 3 つだけ:
//   ・追加        → origin:'manual' の部材
//   ・移動        → 元の部材を動かしたもの（origin が manual になる。id は保持）
//   ・削除(自動分) → origin:'manual' + removed:true の墓標（同じ場所の自動部材を抑止）
// ============================================================
import {
  GRID_MM, VIRTUAL_SPAN_MM, partPivotMm, partRangeMm, postStackTopMm,
  type ElevationPart, type ElevationPartGeometry, type ElevationPartsBundle,
} from './elevationParts';
import { GRID_EXT_KOMA, GRID_EXT_SPANS, POST_STACK_EXT_KOMA, buildElevationSlots } from './elevationSlots';
import { KOMA_PITCH_MM } from './komaGrid';

export type PartsRematchResult = {
  /** 新しいビューに載せる部材（新しい自動分＋引き継いだ手動分）。 */
  parts: ElevationPart[];
  /** 置き場所が無くなって引き継げなかった手動部材。 */
  orphans: ElevationPart[];
};

/** 部材の「置き場所」を表すキー（同じ場所なら同じ文字列）。旧世代の照合用。 */
export function partSlotKey(p: {
  kind: ElevationPart['kind']; scaffoldIndex: number;
  postIndex?: number; spanIndex?: number; levelMm?: number;
}): string {
  const pos = p.postIndex != null ? `p${p.postIndex}` : `s${p.spanIndex ?? '-'}`;
  return `${p.kind}@${p.scaffoldIndex}:${pos}:${p.levelMm ?? '-'}`;
}

/** スロット番号を持つ部材か（＝旧世代の照合に掛けられるか）。 */
function hasSlotIndex(p: ElevationPart): boolean {
  return p.postIndex != null || p.spanIndex != null;
}

/** その部材の置き場所が新しい幾何にまだ存在するか（旧世代の照合）。 */
function slotExists(p: ElevationPart, geom: ElevationPartGeometry): boolean {
  const key = partSlotKey(p);
  return buildElevationSlots(geom, p.kind).some((s) => partSlotKey({
    kind: s.kind, scaffoldIndex: s.scaffoldIndex,
    postIndex: s.postIndex, spanIndex: s.spanIndex, levelMm: s.levelMm,
  }) === key);
}

/** スロットからレンジ（x0/x1）を引き直す。支柱系はレンジを持たない。 */
function withFreshRange(p: ElevationPart, geom: ElevationPartGeometry): ElevationPart {
  if (p.kind === 'post' || p.kind === 'jack') {
    const { x0: _x0, x1: _x1, ...rest } = p;
    void _x0; void _x1;
    return rest;
  }
  const key = partSlotKey(p);
  const slot = buildElevationSlots(geom, p.kind).find((s) => partSlotKey({
    kind: s.kind, scaffoldIndex: s.scaffoldIndex,
    postIndex: s.postIndex, spanIndex: s.spanIndex, levelMm: s.levelMm,
  }) === key);
  return slot ? { ...p, x0: slot.x0, x1: slot.x1 } : p;
}

/**
 * 足場の「置いてよい範囲」(mm) (= E-8-v3f)。
 * v3 は仮想グリッド（既存足場の外側へスパン 3 つ・コマ 3 つ）まで置けるので、
 * 引き継ぎの判定もそこまでを範囲に含める。ここより狭くすると、
 * 外側に足した部材が作り直しのたびに消える。
 */
function scaffoldBoxMm(sg: ElevationPartGeometry['scaffolds'][number]): {
  x0Mm: number; x1Mm: number; yMinMm: number; yMaxMm: number;
} | null {
  if (sg.postXs.length === 0) return null;
  const marginX = GRID_EXT_SPANS * VIRTUAL_SPAN_MM;
  // 支柱の頭から、継ぎ足せる高さ（規格部材の最長）＋仮想コマぶん上まで。
  const marginY = (POST_STACK_EXT_KOMA + GRID_EXT_KOMA) * KOMA_PITCH_MM;
  return {
    x0Mm: Math.min(...sg.postXs) * GRID_MM - marginX,
    x1Mm: Math.max(...sg.postXs) * GRID_MM + marginX,
    yMinMm: -KOMA_PITCH_MM,                       // GL の少し下まで（ジャッキの遊び）
    yMaxMm: postStackTopMm(sg) + marginY,
  };
}

/**
 * 自由座標のまま引き継げるか (= E-8-v3f)。
 * 横は「重なっていれば可」（長い部材が端から少しはみ出すのは許す）、
 * 縦は基準点（手摺・踏板は高さ、支柱は下端、ジャッキは上端）が範囲内であること。
 */
function withinScaffold(p: ElevationPart, geom: ElevationPartGeometry): boolean {
  // E-8-v4a: 足場が 1 連も無い面（建物だけ描いて足場を置いていない面）では、
  //   比べる相手そのものが存在しない。ここで落とすと「置けるが作り直すと消える」に
  //   なるので、座標を持っている部材はそのまま引き継ぐ。
  if (geom.scaffolds.length === 0) return partRangeMm(p, undefined) != null;
  const sg = geom.scaffolds[p.scaffoldIndex];
  if (!sg) return false;                          // その面の足場ごと消えた
  const box = scaffoldBoxMm(sg);
  if (!box) return false;
  const r = partRangeMm(p, sg);
  const pv = partPivotMm(p, sg);
  if (!r || !pv) return false;
  const overlapsX = Math.max(r.x0Mm, r.x1Mm) >= box.x0Mm && Math.min(r.x0Mm, r.x1Mm) <= box.x1Mm;
  const withinY = pv.yMm >= box.yMinMm && pv.yMm <= box.yMaxMm;
  return overlapsX && withinY;
}

/**
 * 旧ビューの部材を、作り直した自動部材へ引き継ぐ。
 *  ・自動分は next のものを採用（平面の変更が素直に反映される）
 *  ・手動分（追加・移動・削除の墓標）は、番号で見つかればその場所へ、
 *    見つからなくても新しい足場の範囲に掛かっていれば**座標そのままで**引き継ぐ
 *  ・墓標・引き継いだ部材と重なる自動部材は取り除く（削除や移動がぶり返さない）
 *  ・足場ごと消えた／完全に範囲外の手動分だけ orphans へ
 */
export function rematchElevationParts(
  prevParts: ElevationPart[] | undefined,
  next: ElevationPartsBundle,
): PartsRematchResult {
  const manual = (prevParts ?? []).filter((p) => p.origin === 'manual');
  if (manual.length === 0) return { parts: next.parts, orphans: [] };

  const kept: ElevationPart[] = [];
  const orphans: ElevationPart[] = [];
  for (const p of manual) {
    if (hasSlotIndex(p) && slotExists(p, next.geom)) {
      kept.push(withFreshRange(p, next.geom));    // 旧世代: 番号で同じ場所へ
    } else if (withinScaffold(p, next.geom)) {
      kept.push(p);                               // 自由座標: 座標をそのまま保つ
    } else {
      orphans.push(p);
    }
  }

  // 引き継いだ部材とぶつかる自動部材を取り除く。
  //   ・id …「元は自動だった部材」（墓標・動かした部材）は id を保つので、
  //          作り直しで同じ id が生えてきたら重複。これが移動・削除の維持そのもの。
  //   ・置き場所キー … 旧世代の照合で拾ったぶん（id が変わっていても場所で潰す）。
  const takenIds = new Set(kept.map((p) => p.id));
  const takenKeys = new Set(kept.filter(hasSlotIndex).map(partSlotKey));

  const autos = next.parts.filter((p) => !takenIds.has(p.id) && !takenKeys.has(partSlotKey(p)));

  // 墓標は「消したという印」なので、引き継ぎはするが絵には出さない（描画側で除外）。
  return { parts: [...autos, ...kept], orphans };
}

/** 孤立部材を人が読める1行に（一覧表示用）。 */
export function describePart(p: ElevationPart): string {
  const where = p.postIndex != null ? `支柱${p.postIndex + 1}` : `スパン${(p.spanIndex ?? 0) + 1}`;
  const h = p.levelMm != null ? ` ${p.levelMm}mm` : '';
  return `${p.removed ? '削除' : '追加/移動'}: ${p.kind} ${where}${h}`;
}
