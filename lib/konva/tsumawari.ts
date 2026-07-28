// ============================================================
// 妻割（センター割り）エンジン (M-1a・pure・node 安全)
//
// 切妻の妻面（三角の壁が立ち上がる面）は、端から詰める通常割りではなく「センター割り」が
// 現場の理想（鮎澤氏・足場電卓で確定済みのルール）。理由はコマ嵩上げで、左右対称の階段
// (+1+2+3+2+1) になるにはスパン割自体が中央に対して対称である必要があるため。
//
// 重要な性質: 面内の並べ替えは rails の合計を変えないので、両端の離れ・隣接面との端点接続
// といった絶対制約に一切影響しない（配置は placeHandrailsForEdge が配列順に積むだけ）。
// よって妻割は「多重集合の選択」ではなく「面内の並べ替え」として実装できる。
//
// 端数（最大サイズ以外の部材）は種類で置き場所が決まる:
//   1. 番外（小さい端数・メートル系 ≤300）: 両端専用
//   2. ニコイチ（異なる2枚の組）      : 中央に隣接させてまとめ、左右に対称な連続ブロックを残す
//   3. 同数ペア（同じサイズ2枚）      : 両端に1枚ずつ振り分けて対称
//   4. 単独端数1枚                    : 中央（メインが偶数本＝対称にできるとき）／端（奇数本）
//   端数をバラバラに中間へ散らす配置は下位。
// ============================================================

/** 番外（両端専用の小端数）の上限(mm)。メートル系 300 以下。インチ系は 305/200 が該当。 */
export const BANGAI_MAX_MM = 305;

/** 端数の置き方の種類。 */
export type TsumawariKind =
  | 'none'      // 端数なし（メインのみ）
  | 'bangai'    // 番外のみ
  | 'nikoichi'  // 異なる2枚を中央へ
  | 'pair'      // 同数ペアを両端へ
  | 'single'    // 単独1枚
  | 'mixed';    // 上記に収まらない組み合わせ（下位）

export type TsumawariArrangement = {
  /** 左→右の並び（センター割り適用済み）。 */
  rails: number[];
  kind: TsumawariKind;
  /** メイン部材（この面で使う最大サイズ）。 */
  mainMm: number;
  mainCount: number;
  /** 端数（メイン以外）の本数。 */
  fractionCount: number;
  /** 左右完全対称か（並びが反転と一致）。嵩上げ階段が対称になる条件。 */
  symmetric: boolean;
  totalMm: number;
};

export type TsumawariOptions = {
  /** 番外とみなす上限(mm)。既定 BANGAI_MAX_MM。 */
  bangaiMaxMm?: number;
  /** メイン部材(mm)。既定は rails の最大サイズ。 */
  mainMm?: number;
};

const asc = (a: number, b: number) => a - b;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const isMirror = (xs: number[]) => xs.every((v, i) => v === xs[xs.length - 1 - i]);

/** 端数を「番外」と「それ以外」に分け、置き方の種類を決める。 */
export function classifyFractions(
  fractions: number[], bangaiMaxMm: number = BANGAI_MAX_MM,
): { bangai: number[]; rest: number[]; kind: TsumawariKind } {
  const sorted = [...fractions].sort(asc);
  const bangai = sorted.filter((v) => v <= bangaiMaxMm);
  const rest = sorted.filter((v) => v > bangaiMaxMm);

  let kind: TsumawariKind;
  if (rest.length === 0) kind = bangai.length === 0 ? 'none' : 'bangai';
  else if (rest.length === 1) kind = 'single';
  else if (rest.length === 2) kind = rest[0] === rest[1] ? 'pair' : 'nikoichi';
  else kind = 'mixed';
  return { bangai, rest, kind };
}

/**
 * 多重集合をセンター割りで並べる（配置ルール適用・pure）。
 * 入力の順序は問わない（多重集合として扱う）。合計は変えないので離れ・接続に影響しない。
 */
export function arrangeTsumawari(rails: number[], opts?: TsumawariOptions): TsumawariArrangement {
  const bangaiMaxMm = opts?.bangaiMaxMm ?? BANGAI_MAX_MM;
  const totalMm = sum(rails);
  if (rails.length === 0) {
    return { rails: [], kind: 'none', mainMm: 0, mainCount: 0, fractionCount: 0, symmetric: true, totalMm: 0 };
  }
  const mainMm = opts?.mainMm ?? Math.max(...rails);
  const mains = rails.filter((r) => r === mainMm);
  const fractions = rails.filter((r) => r !== mainMm);
  const { bangai, rest, kind } = classifyFractions(fractions, bangaiMaxMm);

  // 両端（番外）→ その内側（同数ペア）→ メイン連続ブロック → 中央（ニコイチ/単独）の順に組む。
  const endsL: number[] = [];
  const endsR: number[] = [];
  const center: number[] = [];

  // 1. 番外は最外周。2枚あれば両端へ1枚ずつ、1枚なら左端へ。
  const bangaiSorted = [...bangai].sort(asc);
  if (bangaiSorted.length >= 2) {
    endsL.push(bangaiSorted[0]);
    endsR.unshift(bangaiSorted[bangaiSorted.length - 1]);
    // 3枚以上の番外は残りを左右へ交互に寄せる（実務ではまず出ない保険）。
    for (let i = 1; i < bangaiSorted.length - 1; i++) {
      (i % 2 === 1 ? endsL : endsR)[i % 2 === 1 ? 'push' : 'unshift'](bangaiSorted[i]);
    }
  } else if (bangaiSorted.length === 1) {
    endsL.push(bangaiSorted[0]);
  }

  // 2. 番外以外の端数
  if (kind === 'pair') {
    // 同数ペアは両端に1枚ずつ（番外の内側）。
    endsL.push(rest[0]);
    endsR.unshift(rest[1]);
  } else if (kind === 'nikoichi') {
    // 異なる2枚は中央に隣接させる（小さい方を左）。
    center.push(rest[0], rest[1]);
  } else if (kind === 'single') {
    // メインが偶数本なら中央に置いて左右対称にできる。奇数本ならどう置いても割れるので端へ寄せ、
    // メインの連続ブロックを崩さない（嵩上げの段が乱れないようにする）。
    if (mains.length % 2 === 0) center.push(rest[0]);
    else endsL.push(rest[0]);
  } else if (kind === 'mixed') {
    // 同値ペアから順に両端へ、残りは中央へまとめる（バラ撒きは避ける）。
    const pool = [...rest].sort(asc);
    while (pool.length >= 2 && pool[0] === pool[1]) {
      endsL.push(pool.shift()!);
      endsR.unshift(pool.pop()!);
    }
    while (pool.length >= 2 && pool[pool.length - 1] === pool[pool.length - 2]) {
      endsL.push(pool.pop()!);
      endsR.unshift(pool.pop()!);
    }
    center.push(...pool);
  }

  // 3. メインを中央ブロックの左右へ均等配分（余りは左）。
  const half = Math.ceil(mains.length / 2);
  const mainsL = mains.slice(0, half);
  const mainsR = mains.slice(half);

  const out = [...endsL, ...mainsL, ...center, ...mainsR, ...endsR];
  return {
    rails: out,
    kind,
    mainMm,
    mainCount: mains.length,
    fractionCount: fractions.length,
    symmetric: isMirror(out),
    totalMm,
  };
}

/** 探索の上限（組み合わせ爆発の保険）。 */
const MAX_PIECES = 24;
const MAX_COMBOS = 400;

/** 合計 totalMm ちょうどになる多重集合を列挙（降順 DFS・重複なし）。 */
function enumerateCombos(totalMm: number, sizes: number[]): number[][] {
  const uniq = Array.from(new Set(sizes)).sort((a, b) => b - a);
  const out: number[][] = [];
  const cur: number[] = [];
  const dfs = (rest: number, startIdx: number) => {
    if (out.length >= MAX_COMBOS) return;
    if (rest === 0) { out.push([...cur]); return; }
    if (cur.length >= MAX_PIECES) return;
    for (let i = startIdx; i < uniq.length; i++) {
      const s = uniq[i];
      if (s > rest) continue;
      cur.push(s);
      dfs(rest - s, i);
      cur.pop();
      if (out.length >= MAX_COMBOS) return;
    }
  };
  if (totalMm > 0) dfs(totalMm, 0);
  return out;
}

/** 妻割候補の順位付け（小さいほど上位）。 */
function rankKey(a: TsumawariArrangement): number[] {
  const kindRank: Record<TsumawariKind, number> = {
    none: 0, pair: 1, nikoichi: 2, single: 3, bangai: 4, mixed: 5,
  };
  return [
    a.fractionCount,        // 端数は少ないほど良い（メイン主体）
    a.rails.length,         // 本数は少ないほど良い
    a.symmetric ? 0 : 1,    // 左右対称を優先（嵩上げ階段が対称になる）
    kindRank[a.kind],       // 置き方の種類（ペア/ニコイチが上位、バラ撒きは下位）
    -a.mainMm,              // 同条件ならメインが大きい方
  ];
}

const cmpKey = (x: number[], y: number[]): number => {
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * 指定長さ（この面で手摺が占める長さ mm）に対するセンター割り候補を、順位付けして返す。
 * sizes は利用可能な手摺長さ（store の enabledSizes）。解なしは空配列。
 */
export function generateTsumawariCandidates(
  totalMm: number, sizes: number[], opts?: TsumawariOptions,
): TsumawariArrangement[] {
  const combos = enumerateCombos(Math.round(totalMm), sizes);
  const arranged = combos.map((c) => arrangeTsumawari(c, opts));
  return arranged.sort((a, b) => {
    const d = cmpKey(rankKey(a), rankKey(b));
    if (d !== 0) return d;
    // 完全な同順位は並びの辞書順で安定化（テストの再現性のため）。
    return a.rails.join(',').localeCompare(b.rails.join(','));
  });
}
