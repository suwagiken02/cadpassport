// ============================================================
// コマ格子と皿(ジャッキ上端)の関係 (E-8-v2h-fix・pure・node 安全・依存なし)
//
// 現場の組み方（鮎澤氏）:
//   ・支柱の 1 コマ目 = 皿から 250mm、以降 450 刻み
//   ・ジャッキ巻き（皿の高さの可動域）= 40〜490mm
//   → GL からのコマ高さ = 皿高さ + 250 + 450×(n−1)
//   → スタート値からの逆算: 皿 = スタート − 250 − 450×(n−1) が 40〜490 に入る n を選ぶ
//        例) スタート 1400 → 皿 250・3 コマ目（現場の組み方と一致）
//   → 床・手摺・コマ列はすべて「スタート基準の 450 刻み」
//
// つまり皿の高さは固定値ではなく、スタート端数から決まる（職人がジャッキを巻いて合わせる）。
// 従来の「ジャッキ上端 = GL+150 固定・そこから 450 刻み」は誤りだった。
// GL+150 は「皿 150mm」の一例にすぎない。
//
// このモジュールは他を一切 import しない（elevationEngine と elevationPartStyle の
// 双方から使うため。ここに置かないと循環 import になる）。
// ============================================================

/** 支柱コマピッチ(mm)。楔ポケット間隔（足場基礎仕様: 1800 = 4×450）。 */
export const KOMA_PITCH_MM = 450;

/** 皿(ジャッキ上端)から 1 コマ目までの高さ(mm)。 */
export const FIRST_KOMA_OFFSET_MM = 250;

/** ジャッキ巻きの可動域(mm)＝皿の高さが取りうる範囲。 */
export const JACK_WIND_MIN_MM = 40;
export const JACK_WIND_MAX_MM = 490;

/**
 * 高さ列を from から pitch 刻みで to 以下まで。
 * 逆順・ピッチ 0 以下は空（無限ループにしない）。
 */
export function komaLevelsMm(
  fromMm: number, toMm: number, pitchMm: number = KOMA_PITCH_MM,
): number[] {
  const out: number[] = [];
  if (!(pitchMm > 0) || !(toMm >= fromMm)) return out;
  for (let h = fromMm; h <= toMm + 1e-6; h += pitchMm) out.push(Math.round(h));
  return out;
}

/** 皿(ジャッキ上端)から見たコマ列。1 コマ目は皿+250、以降 450 刻みで toMm 以下まで。 */
export function komaLevelsFromJackMm(
  jackTopMm: number, toMm: number, pitchMm: number = KOMA_PITCH_MM,
): number[] {
  return komaLevelsMm(jackTopMm + FIRST_KOMA_OFFSET_MM, toMm, pitchMm);
}

/**
 * スタート（1 段目の作業床高さ, mm）から皿の高さ(mm)を逆算する。
 * 作業床は必ずコマに乗るので、皿 = start − 250 − 450×(n−1) が
 * ジャッキ巻きの可動域 40〜490 に入る n を選ぶ（可動域はピッチと同じ幅なので n は一意）。
 * スタートが規格外に低くて可動域に入らない場合は下限に丸める。
 */
export function jackTopForStartMm(startMm: number, pitchMm: number = KOMA_PITCH_MM): number {
  const raw = startMm - FIRST_KOMA_OFFSET_MM;   // n=1（スタートが 1 コマ目）のときの皿
  if (!(pitchMm > 0)) return Math.min(JACK_WIND_MAX_MM, Math.max(JACK_WIND_MIN_MM, raw));
  if (raw < JACK_WIND_MIN_MM) return JACK_WIND_MIN_MM;
  const r = ((raw - JACK_WIND_MIN_MM) % pitchMm + pitchMm) % pitchMm;
  return Math.round(JACK_WIND_MIN_MM + r);
}

/**
 * 手摺が付くコマの高さ列(mm) (= E-8-v2j)。現場ルール（鮎澤氏）:
 *   ・支柱の一番下のコマ / 一番上のコマ
 *   ・各作業床の +1 コマ(450 = 中さん) と +2 コマ(900 = 上さん)
 * 全コマに手摺を出していた従来は誤り。作業床そのものの高さには手摺は付かない。
 */
export function railKomaLevelsMm(
  komaGridMm: number[], floorLevelsMm: number[], pitchMm: number = KOMA_PITCH_MM,
): number[] {
  if (komaGridMm.length === 0) return [];
  const lo = komaGridMm[0], hi = komaGridMm[komaGridMm.length - 1];
  const out = new Set<number>([lo, hi]);
  for (const f of floorLevelsMm) {
    for (const k of [1, 2]) {
      const h = f + pitchMm * k;   // 作業床はコマに乗るので +450×k もコマ上
      if (h >= lo && h <= hi) out.add(h);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

// ── 支柱の規格部材 (= E-8-v2j) ──
/** 支柱の規格品（コマ数）。大きい順に並べる＝貪欲の探索順。 */
export const POST_KOMA_SIZES = [8, 6, 4, 2, 1];

/**
 * n コマの支柱を規格部材に割る。返り値は「下から上」のコマ数列。
 * 上合わせ＝大きい部材を上に、端数の小部材を下に。大きい物から順に使う（貪欲）。
 *   10 → [2, 8] / 9 → [1, 8] / 7 → [1, 6] / 5 → [1, 4] / 3 → [1, 2] / 14 → [6, 8]
 */
export function splitPostKoma(n: number, sizes: number[] = POST_KOMA_SIZES): number[] {
  const desc = [...sizes].filter((s) => s > 0).sort((a, b) => b - a);
  const topDown: number[] = [];
  let rest = Math.max(0, Math.floor(n));
  while (rest > 0) {
    const pick = desc.find((s) => s <= rest);
    if (pick == null) break;   // 最小規格より小さい端数は落とす（1 コマ品があるので通常起きない）
    topDown.push(pick);
    rest -= pick;
  }
  return topDown.reverse();    // 上から取ったので反転して下→上に
}

/**
 * 支柱を規格部材に割った各段の実座標(mm, GL 基準)。
 * 部材長 = 450 × コマ数、部材の下端から 1 コマ目が 250 なので、継ぎ目をまたいでも
 * コマ格子は連続する（下段の天 = 上段の底、上段の 1 コマ目はそのままコマ列に乗る）。
 * 最上段は topLimitMm（足場天端）でクリップする＝描画範囲を変えない。
 */
export function postSegmentsMm(
  jackTopMm: number, komaCount: number, topLimitMm: number, pitchMm: number = KOMA_PITCH_MM,
): { komaCount: number; bottomMm: number; topMm: number }[] {
  const segs = splitPostKoma(komaCount);
  const out: { komaCount: number; bottomMm: number; topMm: number }[] = [];
  let cum = 0;
  for (const k of segs) {
    const bottomMm = jackTopMm + pitchMm * cum;
    cum += k;
    out.push({ komaCount: k, bottomMm, topMm: Math.min(jackTopMm + pitchMm * cum, topLimitMm) });
  }
  return out;
}

/** そのスタートで作業床が何コマ目に乗るか（1 始まり・現場の数え方）。 */
export function komaIndexOfStart(startMm: number, pitchMm: number = KOMA_PITCH_MM): number {
  const jack = jackTopForStartMm(startMm, pitchMm);
  if (!(pitchMm > 0)) return 1;
  return Math.round((startMm - jack - FIRST_KOMA_OFFSET_MM) / pitchMm) + 1;
}
