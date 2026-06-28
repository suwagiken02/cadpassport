import { describe, it, expect } from 'vitest';
import {
  generateSequentialCandidates,
  computeAutoLayoutSequential,
  getSectionOfSize,
} from '../autoLayoutUtils';
import {
  INCH_DEFAULT_ENABLED_SIZES,
  INCH_DEFAULT_PRIORITY_CONFIG,
  DEFAULT_ENABLED_SIZES,
  DEFAULT_PRIORITY_CONFIG,
  type BuildingShape,
  type HandrailLengthMm,
} from '@/types';

// ============================================================
// 順次決定モーダルの空候補回帰 修正:
//   - 非デフォルト引数(←/→・割り変更)でも候補を返す(旧: [] 空返却)
//   - 自動進行は「候補1件 かつ 離れ差0 かつ 端数0」のみ
//   - ±50mm内に制約内解なしのとき、外側を自由探索し近い割れ位置(smaller/larger)を動かせる候補で返す
//   - 非メイン≤3・±50mm・大物案デフォルトの先週ルールは維持
// ============================================================

const nonMain = (rails: HandrailLengthMm[]): number =>
  rails.filter(r => getSectionOfSize(r, INCH_DEFAULT_PRIORITY_CONFIG) !== 'main').length;

// 9000mm × 9000mm 正方形(grid=10mm 単位 → points は 900)
const square9000: BuildingShape = {
  id: 'b1', type: 'polygon',
  points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }],
  fill: '#000', floor: 1,
};

describe('constrained 候補生成: 操作対応 (←/→・割り変更)', () => {
  // 引数: edgeLen, startDist, desiredEnd, prevConvex, nextConvex, prevEdgeStart,
  //       enabledSizes, priorityConfig, largerOff, smallerOff, largerVar, smallerVar
  const ARGS = [2000, 900, 900, true, true, 900, INCH_DEFAULT_ENABLED_SIZES, INCH_DEFAULT_PRIORITY_CONFIG] as const;

  it('(a) variation: 非デフォルトでも空にならず、index で別組合せにページングする', () => {
    const v1 = generateSequentialCandidates(...ARGS, 0, 0, 0, 1); // smallerVariationIdx=1
    const v2 = generateSequentialCandidates(...ARGS, 0, 0, 0, 2); // smallerVariationIdx=2

    expect(v1.length).toBeGreaterThan(0); // 旧: 非デフォルトで [] になっていた
    expect(v2.length).toBeGreaterThan(0);

    const s1 = v1.find(c => c.side === 'smaller');
    const s2 = v2.find(c => c.side === 'smaller');
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    // 同一離れ(同 target)で別の組合せにページング
    expect(s1!.actualEndDistanceMm).toBe(s2!.actualEndDistanceMm);
    expect(s1!.rails).not.toEqual(s2!.rails);
    // 先週ルール(非メイン≤3)は維持
    expect(nonMain(s1!.rails)).toBeLessThanOrEqual(3);
    expect(nonMain(s2!.rails)).toBeLessThanOrEqual(3);
  });

  it('(b) offset: 離れ変更後も候補が返る(空にならない)・離れが動く', () => {
    const nearest = generateSequentialCandidates(...ARGS, 0, 0, 0, 1); // smaller@offset0(非デフォルト化のため var=1)
    const offset1 = generateSequentialCandidates(...ARGS, 0, 1, 0, 0); // smallerOffsetIdx=1

    expect(offset1.length).toBeGreaterThan(0); // 旧: [] になっていた

    const sNear = nearest.find(c => c.side === 'smaller');
    const sOff = offset1.find(c => c.side === 'smaller');
    expect(sNear).toBeDefined();
    expect(sOff).toBeDefined();
    // offset を進めると採用する離れ(target)が変わる
    expect(sOff!.actualEndDistanceMm).not.toBe(sNear!.actualEndDistanceMm);
    expect(nonMain(sOff!.rails)).toBeLessThanOrEqual(3);
  });

  it('(e) rule5差し替え: ±50mm 内に解が無いとき、外側の近い割れ位置を動かせる候補(smaller/larger)で返す', () => {
    // pc=false, nc=false, start=600, desired=1300, edge=2000 → 窓[1250,1350]空。
    // 外側自由探索: smaller側 E=1200(required=200=[200])が最初の clean。larger側は required<=0 で解なし。
    const r = generateSequentialCandidates(
      2000, 600, 1300, false, false, 600,
      INCH_DEFAULT_ENABLED_SIZES, INCH_DEFAULT_PRIORITY_CONFIG,
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
    // 旧 rule5 の「希望離れ＋端数の単一候補」ではなく、離れを動かした clean split を提示する。
    r.forEach(c => {
      expect(c.diffFromDesired).not.toBe(0);                 // 離れを動かす
      expect(c.side === 'smaller' || c.side === 'larger').toBe(true);
      expect(c.remainder ?? 0).toBe(0);                      // 端数残りではなく clean
      expect(nonMain(c.rails)).toBeLessThanOrEqual(3);       // 非メイン≤3 維持
    });
    expect(r.some(c => c.side === 'smaller')).toBe(true);    // 近い smaller 側を提示
  });
});

describe('自動進行ポリシー: 候補1件 かつ 離れ差0 かつ 端数0 のみ', () => {
  it('(c) 離れ差≠0 の1件のみ → isAutoProgress=false(モーダルで提案)', () => {
    // インチ正方形(有効10800)は大物案デフォルトが diff≠0 の1件
    const r = computeAutoLayoutSequential(
      square9000, { 0: 900, 1: 900, 2: 900, 3: 900 },
      undefined, INCH_DEFAULT_ENABLED_SIZES, INCH_DEFAULT_PRIORITY_CONFIG,
    );
    const e0 = r.edgeResults[0];
    expect(e0.candidates.length).toBe(1);
    expect(e0.candidates[0].diffFromDesired).not.toBe(0);
    expect(e0.isAutoProgress).toBe(false);
    expect(r.hasUnresolved).toBe(true);
  });

  it('(d) 離れ差0 の1件(メートル clean 1800×6) → isAutoProgress=true で不変', () => {
    const r = computeAutoLayoutSequential(
      square9000, { 0: 900, 1: 900, 2: 900, 3: 900 },
      undefined, DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG,
    );
    expect(r.hasUnresolved).toBe(false);
    r.edgeResults.forEach(er => {
      expect(er.candidates.length).toBe(1);
      expect(er.candidates[0].diffFromDesired).toBe(0);
      expect(er.candidates[0].rails).toEqual([1800, 1800, 1800, 1800, 1800, 1800]);
      expect(er.isAutoProgress).toBe(true);
    });
  });
});
