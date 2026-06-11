import { describe, it, expect } from 'vitest';
import { generateSequentialCandidates, getSectionOfSize } from '../autoLayoutUtils';
import {
  INCH_DEFAULT_ENABLED_SIZES,
  INCH_DEFAULT_PRIORITY_CONFIG,
  DEFAULT_ENABLED_SIZES,
  DEFAULT_PRIORITY_CONFIG,
  type HandrailLengthMm,
  type PriorityConfig,
} from '@/types';

// CAD パスポート: 「1面の部材数ルール」
//   - メイン部材(priorityConfig メイン帯)は本数無制限
//   - 非メイン(サブ+調整)はサイズ問わず合計 3 本まで
//   - まず離れぴったり、無理なら ±50mm で最良の大物案を優先
//
// 破綻ケース: インチ規格・辺長9000/有効10800。
//   旧挙動(priorityConfig なし経路)では 610×13 + 410×7 の小物だらけになる。
//   新ルール(priorityConfig あり経路)では大物(1829=メイン)中心・非メイン≤3 になる。

const nonMainCountWith = (rails: HandrailLengthMm[], config: PriorityConfig): number =>
  rails.filter(r => getSectionOfSize(r, config) !== 'main').length;
// インチ規格用のショートカット（既存テストの可読性のため）
const nonMainCount = (rails: HandrailLengthMm[]): number =>
  nonMainCountWith(rails, INCH_DEFAULT_PRIORITY_CONFIG);

describe('1面の部材数ルール (CAD パスポート)', () => {
  // 辺9000 / 前辺900 / 始点900 / 希望終点900 / 凸→凸 → 有効長 900+9000+900 = 10800
  const ARGS = [9000, 900, 900, true, true, 900] as const;

  it('インチ有効10800: 非メイン≤3・大物(1829)中心のデフォルト案になる', () => {
    const result = generateSequentialCandidates(
      ...ARGS, INCH_DEFAULT_ENABLED_SIZES, INCH_DEFAULT_PRIORITY_CONFIG,
    );
    expect(result.length).toBeGreaterThanOrEqual(1);

    const def = result[0]; // デフォルト = 大物案
    // メイン(1829)を複数使う大物案であること
    expect(def.rails.filter(r => r === 1829).length).toBeGreaterThanOrEqual(4);
    // 非メインは 3 本以下
    expect(nonMainCount(def.rails)).toBeLessThanOrEqual(3);
    // 小物だらけ(610×13+410×7=20本)では絶対にない
    expect(def.rails.length).toBeLessThanOrEqual(8);
    // 離れは ±50mm 以内
    expect(Math.abs(def.diffFromDesired)).toBeLessThanOrEqual(50);
  });

  it('非メイン3本上限が効く: 全候補が非メイン≤3、旧経路(制約なし)は20本になっていた', () => {
    // 新ルール: 返るすべての候補が非メイン≤3
    const ruled = generateSequentialCandidates(
      ...ARGS, INCH_DEFAULT_ENABLED_SIZES, INCH_DEFAULT_PRIORITY_CONFIG,
    );
    for (const c of ruled) {
      expect(nonMainCount(c.rails)).toBeLessThanOrEqual(3);
    }

    // 旧経路(priorityConfig 省略 = 制約なし)では 610×13+410×7 の20本になっていた
    const legacy = generateSequentialCandidates(...ARGS, INCH_DEFAULT_ENABLED_SIZES);
    expect(legacy.length).toBeGreaterThanOrEqual(1);
    expect(legacy[0].rails.length).toBeGreaterThanOrEqual(10); // 小物だらけ
    // 新ルールは旧経路より明確に本数が少ない(大物化)
    expect(ruled[0].rails.length).toBeLessThan(legacy[0].rails.length);
  });

  it('メートル clean 辺(有効10800=1800×6・非メイン0)はルール適用後も不変', () => {
    const result = generateSequentialCandidates(
      ...ARGS, DEFAULT_ENABLED_SIZES, DEFAULT_PRIORITY_CONFIG,
    );
    // 離れぴったり1択(大物案=離れ厳守案が一致)
    expect(result.length).toBe(1);
    expect(result[0].rails).toEqual([1800, 1800, 1800, 1800, 1800, 1800]);
    expect(result[0].diffFromDesired).toBe(0);
    expect(nonMainCountWith(result[0].rails, DEFAULT_PRIORITY_CONFIG)).toBe(0);
  });
});
