// ============================================================
// E-8-v4a(⑥): 手動部材の足場連の帰属を座標で決める。
//
// 部材の scaffoldIndex は「どの連の部材か」で、再マッチが残す/孤立にするの
// 判断に使う。配置は連を見ずに 0 を入れていたので、L 字などの複数連の面では
// 2 連目に置いた部材まで「0 連目の部材」になり、平面を直して 0 連目が
// 消えると、2 連目の上にあるはずの部材まで巻き添えで消えていた。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { newElevationPart, scaffoldIndexAtMm } from '../elevationParts';
import { rematchElevationParts } from '../elevationPartsRematch';

/** L 字の面: 0 連目 = 0〜5400mm、1 連目 = 12000〜19200mm。 */
const two: ElevationPartGeometry = {
  minXg: 0,
  scaffolds: [
    {
      postXs: [0, 180, 360, 540], jackTopMm: 150, topRailMm: 6500,
      levelsMm: [1100, 2900, 4700], komaGridMm: [150, 600, 1050, 1500, 1950, 2400, 2850],
    },
    {
      postXs: [1200, 1380, 1560, 1740, 1920], jackTopMm: 150, topRailMm: 6500,
      levelsMm: [1100, 2900, 4700], komaGridMm: [150, 600, 1050, 1500, 1950, 2400, 2850],
    },
  ],
};

/** 0 連目が無くなった面（平面で 1 連目だけ残した）。番号は詰めずに残す作り。 */
const onlySecond: ElevationPartGeometry = { minXg: 0, scaffolds: [two.scaffolds[1]] };

describe('scaffoldIndexAtMm（置いた場所で連を決める）', () => {
  it('連の x 範囲に収まればその連', () => {
    expect(scaffoldIndexAtMm(two, 0)).toBe(0);
    expect(scaffoldIndexAtMm(two, 2700)).toBe(0);
    expect(scaffoldIndexAtMm(two, 5400)).toBe(0);
    expect(scaffoldIndexAtMm(two, 12000)).toBe(1);
    expect(scaffoldIndexAtMm(two, 15000)).toBe(1);
    expect(scaffoldIndexAtMm(two, 19200)).toBe(1);
  });

  it('どの連にも入らなければ、いちばん近い連', () => {
    expect(scaffoldIndexAtMm(two, -3000)).toBe(0);     // 0 連目の左外
    expect(scaffoldIndexAtMm(two, 7000)).toBe(0);      // 0 連目寄りの隙間
    expect(scaffoldIndexAtMm(two, 11000)).toBe(1);     // 1 連目寄りの隙間
    expect(scaffoldIndexAtMm(two, 30000)).toBe(1);     // 1 連目の右外
  });

  it('足場が 1 連も無い面は 0（連の概念が無い）', () => {
    expect(scaffoldIndexAtMm({ minXg: 0, scaffolds: [] }, 900)).toBe(0);
  });

  it('パレット配置は置いた場所の連に属する', () => {
    const at = 15000;
    const p = newElevationPart('rail', 'manual:rail:1', scaffoldIndexAtMm(two, at), { xMm: at, yMm: 1500 });
    expect(p.scaffoldIndex).toBe(1);
  });
});

describe('0 連目が消えても、2 連目の部材は巻き添えにならない', () => {
  /** 1 連目（x=15000 付近）の上に置いた手摺。 */
  const onSecond = (): ElevationPart =>
    newElevationPart('rail', 'manual:rail:1', scaffoldIndexAtMm(two, 15000), { xMm: 15000, yMm: 1500 });

  it('帰属が 1 連目なら、0 連目が消えても残る', () => {
    const part = onSecond();
    expect(part.scaffoldIndex).toBe(1);
    // 作り直しで 1 連目だけになった面（連番号は 0 に詰まる）
    const r = rematchElevationParts([part], { parts: [], geom: two });
    expect(r.orphans).toEqual([]);
    expect(r.parts.map((p) => p.id)).toContain('manual:rail:1');
  });

  // ここが本命。0 連目を消すと 1 連目が 0 番へ詰まるので、番号だけを頼りにすると
  // 「場所は何も変わっていないのに自分の連が消えた」と誤判定する。
  it('0 連目を消して連番号が詰まっても、2 連目の部材は残る', () => {
    const part = onSecond();
    expect(part.scaffoldIndex).toBe(1);
    const r = rematchElevationParts([part], { parts: [], geom: onlySecond });
    expect(r.orphans).toEqual([]);
    expect(r.parts.map((p) => p.id)).toContain('manual:rail:1');
    // 座標も動かさない
    expect(r.parts[0]).toMatchObject({ x0Mm: 14100, x1Mm: 15900, levelMm: 1500 });
  });

  it('0 連目に置いた部材は、0 連目が消えれば孤立する（場所が無くなったので）', () => {
    const onFirst = newElevationPart('rail', 'manual:rail:2', scaffoldIndexAtMm(two, 2700), { xMm: 2700, yMm: 1500 });
    expect(onFirst.scaffoldIndex).toBe(0);
    const r = rematchElevationParts([onFirst], { parts: [], geom: onlySecond });
    expect(r.orphans.map((p) => p.id)).toEqual(['manual:rail:2']);
  });

  it('両方の連が残っていれば、どちらの部材も残る', () => {
    const a = onSecond();
    const b = newElevationPart('rail', 'manual:rail:2', scaffoldIndexAtMm(two, 2700), { xMm: 2700, yMm: 1500 });
    const r = rematchElevationParts([a, b], { parts: [], geom: two });
    expect(r.orphans).toEqual([]);
    expect(r.parts).toHaveLength(2);
  });
});
