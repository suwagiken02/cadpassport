// lib/konva/autolayout/candidates.ts
// autoLayoutUtils.ts から分割（候補生成系・挙動変更なし）
import { HandrailLengthMm, PriorityConfig } from '@/types';
import { HANDRAIL_SIZES, END_DISTANCE_TOLERANCE_MM, findAllCombinationsForEnd } from './combinations';
import { scoreCombination, getSectionOfSize } from './scoring';

// ============================================================
// Phase H-1: 順次決定用の候補生成
// 「希望より大きい結果」「希望より小さい結果」を1つずつ、計2つ返す。
// 端数0の候補があれば、それ1つだけを返す（自動進行用）。
// ============================================================
export type SequentialCandidateSide = 'exact' | 'smaller' | 'larger';

export type SequentialCandidate = {
  rails: HandrailLengthMm[];
  totalMm: number;
  actualEndDistanceMm: number;
  diffFromDesired: number;
  // Phase I-1: 「割り変更」「←/→」操作の状態管理
  side: SequentialCandidateSide;
  variationIdx: number;     // この delta 内で何番目の rails パターンか (0-based, score 降順)
  variationCount: number;   // この delta 内の総 rails パターン数 (UI の (m/N) 表示用)
  /** CAD パスポート rule5: ±END_DISTANCE_TOLERANCE_MM 内に制約内解が無いとき、
   *  離れを動かさず残した端数(mm)。通常は 0(rails が離れにぴったり)。 */
  remainder?: number;
};

/**
 * CAD パスポート: priorityConfig あり時の 1辺候補生成（1面の部材数ルール）。
 * - 非メイン(サブ+調整)は MAX_NON_MAIN_PER_EDGE 本まで・メイン無制限（findAllCombinationsForEnd で担保）
 * - rule2/3: 終点離れを ±END_DISTANCE_TOLERANCE_MM 以内で動かし、制約内解のうち
 *            scoreCombination 最大（メイン多・非メイン少）→|離れ差|小 をデフォルト(大物案)に。
 * - rule4: 制約を満たす「離れ厳守(差0)案」がデフォルトと別に存在すれば 2 つ目に並べる(2択)。
 * - rule5: ±許容内に制約内解が無ければ、非メイン≤3 を守ったまま最も近い解を採り、
 *          離れは動かさず差分を端数(remainder)で表示する。
 * 操作系(←/→・部材変更)はこのルールでは無効化（2択固定）するため、
 * 非デフォルト引数(offset/variation)では候補を返さない。
 */
function generateConstrainedCandidates(
  edgeLengthMm: number,
  startContribution: number,
  desiredEndDistanceMm: number,
  isNextConvex: boolean,
  enabledSizes: HandrailLengthMm[],
  priorityConfig: PriorityConfig,
  largerOffsetIdx: number,
  smallerOffsetIdx: number,
  largerVariationIdx: number,
  smallerVariationIdx: number,
): SequentialCandidate[] {
  const isDefaultArgs =
    largerOffsetIdx === 0 && smallerOffsetIdx === 0 &&
    largerVariationIdx === 0 && smallerVariationIdx === 0;

  type C = { rails: HandrailLengthMm[]; targetEnd: number; diff: number };

  const nonMainCount = (rails: HandrailLengthMm[]): number =>
    rails.filter(r => getSectionOfSize(r, priorityConfig) !== 'main').length;
  const score = (rails: HandrailLengthMm[]): number => scoreCombination(rails, priorityConfig);

  // 候補比較: スコア降順 → |離れ差|昇順 → 非メイン本数昇順 → 総本数昇順
  const cmp = (a: C, b: C): number => {
    const sa = score(a.rails), sb = score(b.rails);
    if (Math.abs(sa - sb) > 1e-9) return sb - sa;
    const da = Math.abs(a.diff), db = Math.abs(b.diff);
    if (da !== db) return da - db;
    const na = nonMainCount(a.rails), nb = nonMainCount(b.rails);
    if (na !== nb) return na - nb;
    return a.rails.length - b.rails.length;
  };

  // 制約内(非メイン≤3)の組合せを targetEnd 離れで列挙
  const rawAt = (targetEnd: number): HandrailLengthMm[][] =>
    targetEnd < 0 ? [] : findAllCombinationsForEnd(
      edgeLengthMm, startContribution, targetEnd, isNextConvex, enabledSizes, priorityConfig,
    );
  const combosAt = (targetEnd: number): C[] =>
    rawAt(targetEnd).map(rails => ({ rails, targetEnd, diff: targetEnd - desiredEndDistanceMm }));

  const sideOf = (diff: number): SequentialCandidateSide =>
    diff === 0 ? 'exact' : (diff < 0 ? 'smaller' : 'larger');
  const railsKey = (rails: HandrailLengthMm[]): string =>
    [...rails].sort((a, b) => b - a).join(',');
  const build = (
    c: C, side: SequentialCandidateSide, remainder = 0,
    variationIdx = 0, variationCount = 1,
  ): SequentialCandidate => ({
    rails: c.rails,
    totalMm: c.rails.reduce((a, b) => a + b, 0),
    actualEndDistanceMm: c.targetEnd,
    diffFromDesired: c.diff,
    side,
    variationIdx,
    variationCount,
    remainder,
  });

  const TOL = END_DISTANCE_TOLERANCE_MM;
  const MAX_DELTA = 1000;

  // === デフォルト引数: 大物案デフォルト + 離れ厳守の2択 (rule2/3/4/5) ===
  if (isDefaultArgs) {
    // rule2/3: ±許容内の制約内解を全収集 → 大物案デフォルト
    const windowCands: C[] = [];
    for (let d = -TOL; d <= TOL; d++) {
      windowCands.push(...combosAt(desiredEndDistanceMm + d));
    }

    if (windowCands.length > 0) {
      windowCands.sort(cmp);
      const best = windowCands[0];
      // 同一離れでの代替組合せ数 = 部材変更(割り変更)のページ数
      const bestVarCount = windowCands.filter(c => c.targetEnd === best.targetEnd).length;
      const result: SequentialCandidate[] = [build(best, sideOf(best.diff), 0, 0, bestVarCount)];

      // rule4: 離れ厳守(差0)の制約内解(最良)がデフォルトと別なら2つ目
      const exactCands = windowCands.filter(c => c.diff === 0);
      if (exactCands.length > 0) {
        exactCands.sort(cmp);
        const bestExact = exactCands[0];
        if (railsKey(bestExact.rails) !== railsKey(best.rails)) {
          result.push(build(bestExact, 'exact', 0, 0, exactCands.length));
        }
      }
      return result;
    }

    // rule5: ±許容内に制約内解なし → 非メイン≤3 のまま最も近い解。離れは動かさず端数表示。
    const T0 = startContribution + edgeLengthMm + (isNextConvex ? desiredEndDistanceMm : -desiredEndDistanceMm);
    let nearest: C | null = null;
    for (let d = TOL + 1; d <= MAX_DELTA && !nearest; d++) {
      const here = [...combosAt(desiredEndDistanceMm - d), ...combosAt(desiredEndDistanceMm + d)];
      if (here.length > 0) {
        here.sort(cmp);
        nearest = here[0];
      }
    }
    if (!nearest) return []; // 幾何的に配置不能(最小部材未満)のみ空を許容
    const comboTotal = nearest.rails.reduce((a, b) => a + b, 0);
    return [{
      rails: nearest.rails,
      totalMm: comboTotal,
      actualEndDistanceMm: desiredEndDistanceMm, // 離れは動かさない
      diffFromDesired: 0,
      side: 'exact',
      variationIdx: 0,
      variationCount: 1,
      remainder: T0 - comboTotal, // +: 不足, -: 突出
    }];
  }

  // === 非デフォルト引数: ←/→(離れ変更)・割り変更(部材変更)に応える ===
  // 制約内(非メイン≤3)の枠内で exact/smaller/larger を offset/variation ページング。
  // variation = 同一離れの制約内組合せをスコア降順で列挙し index 番目。
  // offset    = その side 方向で offsetIdx 番目に解ける離れを採用(旧経路と同義)。
  const pickVar = (rawCombos: HandrailLengthMm[][], vIdx: number): HandrailLengthMm[] | null => {
    if (rawCombos.length === 0) return null;
    const sorted = [...rawCombos].sort((a, b) => score(b) - score(a));
    return (vIdx >= 0 && vIdx < sorted.length) ? sorted[vIdx] : null;
  };
  const mkCand = (
    rails: HandrailLengthMm[], targetEnd: number, side: SequentialCandidateSide,
    vIdx: number, vCount: number,
  ): SequentialCandidate => ({
    rails,
    totalMm: rails.reduce((a, b) => a + b, 0),
    actualEndDistanceMm: targetEnd,
    diffFromDesired: targetEnd - desiredEndDistanceMm,
    side,
    variationIdx: vIdx,
    variationCount: vCount,
  });

  const out: SequentialCandidate[] = [];

  // exact (diff=0): 部材変更は smallerVariationIdx を流用(旧経路と同じ)
  const exCombos = rawAt(desiredEndDistanceMm);
  if (exCombos.length > 0) {
    const r = pickVar(exCombos, smallerVariationIdx);
    if (r) out.push(mkCand(r, desiredEndDistanceMm, 'exact', smallerVariationIdx, exCombos.length));
  }

  // smaller (delta<0): smallerOffsetIdx 番目に解ける離れ、部材は smallerVariationIdx
  let smallerFound = 0;
  for (let delta = 1; delta <= MAX_DELTA; delta++) {
    const targetEnd = desiredEndDistanceMm - delta;
    if (targetEnd < 0) break;
    const combos = rawAt(targetEnd);
    if (combos.length === 0) continue;
    if (smallerFound === smallerOffsetIdx) {
      const r = pickVar(combos, smallerVariationIdx);
      if (r) out.push(mkCand(r, targetEnd, 'smaller', smallerVariationIdx, combos.length));
      break;
    }
    smallerFound++;
  }

  // larger (delta>0): largerOffsetIdx 番目に解ける離れ、部材は largerVariationIdx
  let largerFound = 0;
  for (let delta = 1; delta <= MAX_DELTA; delta++) {
    const targetEnd = desiredEndDistanceMm + delta;
    const combos = rawAt(targetEnd);
    if (combos.length === 0) continue;
    if (largerFound === largerOffsetIdx) {
      const r = pickVar(combos, largerVariationIdx);
      if (r) out.push(mkCand(r, targetEnd, 'larger', largerVariationIdx, combos.length));
      break;
    }
    largerFound++;
  }

  return out;
}

export function generateSequentialCandidates(
  edgeLengthMm: number,
  startDistanceMm: number,
  desiredEndDistanceMm: number,
  isPrevConvex: boolean,
  isNextConvex: boolean,
  // Phase H-fix-2a: 前辺の wall 距離 (= 物理 prev edge の startDist)。
  // cursor 計算 (effectiveMm = edgeLen + s_{i-1} + s_{i+1}) と整合させるため、
  // startContribution は「前辺の startDist」を使う（自身の startDist ではない）。
  prevEdgeStartDistanceMm: number,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  // Phase I-1: 「←/→」「割り変更」UI 操作のための offset / variation 引数。
  // - offsetIdx: 希望から何個目の delta を採用するか (0=最も近い)
  // - variationIdx: その delta 内で何番目の rails パターンを使うか (0=最高 score)
  // 全デフォルト 0 で既存挙動と完全互換。
  largerOffsetIdx: number = 0,
  smallerOffsetIdx: number = 0,
  largerVariationIdx: number = 0,
  smallerVariationIdx: number = 0,
): SequentialCandidate[] {
  if (enabledSizes.length === 0) return [];

  // startDistanceMm はインターフェース互換のため受け取るが、
  // requiredRailsTotal の計算には prevEdgeStartDistanceMm を使う。
  void startDistanceMm;
  const startContribution = isPrevConvex ? prevEdgeStartDistanceMm : -prevEdgeStartDistanceMm;

  // === CAD パスポート: priorityConfig あり経路（1面の部材数ルール）===
  // 非メイン≤3・メイン無制限の制約下で「大物案デフォルト＋離れ厳守の2択」を返す。
  // priorityConfig なし(既存テスト/旧呼出)は従来の exact/smaller/larger ロジックを完全維持。
  if (priorityConfig) {
    return generateConstrainedCandidates(
      edgeLengthMm,
      startContribution,
      desiredEndDistanceMm,
      isNextConvex,
      enabledSizes,
      priorityConfig,
      largerOffsetIdx,
      smallerOffsetIdx,
      largerVariationIdx,
      smallerVariationIdx,
    );
  }

  const MAX_DELTA = 1000;

  // priorityConfig なしは本数少ない順
  const scoreFn = (rails: HandrailLengthMm[]): number =>
    priorityConfig ? scoreCombination(rails, priorityConfig) : -rails.length;

  // combos を score 降順で安定ソートして variationIdx 番目を取り出す
  const pickVariation = (
    combos: HandrailLengthMm[][],
    variationIdx: number,
  ): HandrailLengthMm[] | null => {
    if (combos.length === 0) return null;
    const sorted = [...combos].sort((a, b) => scoreFn(b) - scoreFn(a));
    if (variationIdx < 0 || variationIdx >= sorted.length) return null;
    return sorted[variationIdx];
  };

  const buildCandidate = (
    rails: HandrailLengthMm[],
    targetEnd: number,
    side: SequentialCandidateSide,
    delta: number,
    variationIdx: number,
    variationCount: number,
  ): SequentialCandidate => ({
    rails,
    totalMm: rails.reduce((a, b) => a + b, 0),
    actualEndDistanceMm: targetEnd,
    diffFromDesired: delta,
    side,
    variationIdx,
    variationCount,
  });

  const isDefaultArgs =
    largerOffsetIdx === 0 &&
    smallerOffsetIdx === 0 &&
    largerVariationIdx === 0 &&
    smallerVariationIdx === 0;

  // === exact (delta=0) 探索 ===
  // exact 候補の variation 切替は smallerVariationIdx を流用（指示書に exact 専用引数なし）。
  let exactCand: SequentialCandidate | undefined;
  if (desiredEndDistanceMm >= 0) {
    const exactCombos = findAllCombinationsForEnd(
      edgeLengthMm, startContribution, desiredEndDistanceMm, isNextConvex, enabledSizes,
    );
    if (exactCombos.length > 0) {
      const rails = pickVariation(exactCombos, smallerVariationIdx);
      if (rails) {
        exactCand = buildCandidate(
          rails, desiredEndDistanceMm, 'exact', 0,
          smallerVariationIdx, exactCombos.length,
        );
      }
    }
  }

  // 既存互換: exact ありかつデフォルト引数 → exact 1 候補のみ返す（自動進行）
  if (exactCand && isDefaultArgs) {
    return [exactCand];
  }

  // === smaller 側 (delta = -1, -2, ...) を smallerOffsetIdx 番目まで探索 ===
  let smallerCand: SequentialCandidate | undefined;
  let smallerFoundCount = 0;
  for (let delta = 1; delta <= MAX_DELTA; delta++) {
    const targetEnd = desiredEndDistanceMm - delta;
    if (targetEnd < 0) break;
    const combos = findAllCombinationsForEnd(
      edgeLengthMm, startContribution, targetEnd, isNextConvex, enabledSizes,
    );
    if (combos.length === 0) continue;
    if (smallerFoundCount === smallerOffsetIdx) {
      const rails = pickVariation(combos, smallerVariationIdx);
      if (rails) {
        smallerCand = buildCandidate(
          rails, targetEnd, 'smaller', -delta,
          smallerVariationIdx, combos.length,
        );
      }
      // variationIdx で枯れた場合も配列に含めない
      break;
    }
    smallerFoundCount++;
  }

  // === larger 側 (delta = +1, +2, ...) を largerOffsetIdx 番目まで探索 ===
  let largerCand: SequentialCandidate | undefined;
  let largerFoundCount = 0;
  for (let delta = 1; delta <= MAX_DELTA; delta++) {
    const targetEnd = desiredEndDistanceMm + delta;
    const combos = findAllCombinationsForEnd(
      edgeLengthMm, startContribution, targetEnd, isNextConvex, enabledSizes,
    );
    if (combos.length === 0) continue;
    if (largerFoundCount === largerOffsetIdx) {
      const rails = pickVariation(combos, largerVariationIdx);
      if (rails) {
        largerCand = buildCandidate(
          rails, targetEnd, 'larger', delta,
          largerVariationIdx, combos.length,
        );
      }
      break;
    }
    largerFoundCount++;
  }

  const result: SequentialCandidate[] = [];
  if (exactCand) result.push(exactCand);
  if (smallerCand) result.push(smallerCand);
  if (largerCand) result.push(largerCand);
  return result;
}

