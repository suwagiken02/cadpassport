// ============================================================
// E-8-v3d-check: 「手動配置 → 建物の高さ変更 → 立面を作り直す」で
// 手動部材が引き継がれるか（実機で「まっさらな自動生成に戻る」症状）。
//
// 経路: ElevationPlaceDialog(今のページ) → canvasStore.addElevationViews
//       → carryOverElevationEdits → rematchElevationParts
//
// 分かっていること（このファイルの active なテストが根拠）:
//   ・E-8-v3a より前は、手動部材は slotToPart で作られ spanIndex/postIndex/levelMm
//     という「置き場所の番号」を必ず持っていた。再マッチはこの番号で照合する。
//   ・E-8-v3a で位置を自由座標(x0Mm/x1Mm/levelMm)一次に変えたとき、
//     newElevationPart は番号を持たせなくなった。
//     → partSlotKey が `rail@0:s-:1500` のような「番号なし」キーになり、
//       どのスロットとも一致しない＝必ず孤立して落ちる。
//   ・自動部材を動かした場合も、縦にずらした時点で levelMm がコマ格子から外れ、
//     同じ理由で落ちる。
//
// つまり再マッチだけが v2 の「番号で場所を表す」世界に取り残されている。
// 直し方（未実装）は報告参照。直ったら下の skip を外すこと。
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ElevationPart, ElevationPartGeometry } from '../elevationParts';
import { newElevationPart, movePart } from '../elevationParts';
import { rematchElevationParts, partSlotKey } from '../elevationPartsRematch';

/** 2F の高さ変更を模す。天端だけが変わり、支柱位置(スパン)は変わらない。 */
const geomAt = (topRailMm: number): ElevationPartGeometry => ({
  minXg: 0,
  scaffolds: [{
    postXs: [0, 180, 360, 540],
    jackTopMm: 150,
    topRailMm,
    levelsMm: [1100, 2900, 4700].filter((v) => v <= topRailMm),
    komaGridMm: Array.from(
      { length: Math.floor((topRailMm - 150) / 450) + 1 }, (_, k) => 150 + 450 * k),
  }],
});

/** 作り直した後の自動部材（中身は本件に関係しないので空でよい）。 */
const nextBundle = (topRailMm: number) => ({ parts: [] as ElevationPart[], geom: geomAt(topRailMm) });

describe('E-8-v3d-check: 再マッチが v3 の自由座標部材を見失う', () => {
  it('パレットで置いた部材は「置き場所の番号」を持たない（v3a の設計）', () => {
    const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
    expect(rail.spanIndex).toBeUndefined();
    expect(rail.postIndex).toBeUndefined();
    expect(rail).toMatchObject({ x0Mm: 0, x1Mm: 1800, levelMm: 1500 });
    // 再マッチのキーは番号を見るので、番号なしは `s-` になる
    expect(partSlotKey(rail)).toBe('rail@0:s-:1500');
  });

  it('自動部材を縦にずらすと levelMm がコマ格子から外れる', () => {
    const auto: ElevationPart = {
      id: 'rail:0:1500:180', kind: 'rail', scaffoldIndex: 0, origin: 'auto',
      spanIndex: 1, levelMm: 1500, x0: 180, x1: 360,
    };
    const moved = movePart(auto, geomAt(6500).scaffolds[0], { dxMm: 900, dyMm: 220 });
    expect(moved.levelMm).toBe(1720);              // 450 刻みのどのコマでもない
    expect(partSlotKey(moved)).toBe('rail@0:s1:1720');
  });

  // ------------------------------------------------------------
  // ここから下が「あるべき姿」。今は落ちるので skip（既存を赤にしない）。
  // 修正したら skip を外す。
  // ------------------------------------------------------------
  describe.skip('あるべき姿: 高さを変えて作り直しても手動部材が残る', () => {
    it('パレットで置いた手摺が引き継がれる', () => {
      const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
      const r = rematchElevationParts([rail], nextBundle(8300));
      expect(r.orphans).toHaveLength(0);
      expect(r.parts.map((p) => p.id)).toContain('manual:rail:1');
    });

    it('引き継いだ後も自由座標がそのまま残る（別の場所へ移らない）', () => {
      const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
      const kept = rematchElevationParts([rail], nextBundle(8300)).parts
        .find((p) => p.id === 'manual:rail:1');
      expect(kept).toMatchObject({ x0Mm: 0, x1Mm: 1800, levelMm: 1500 });
    });

    it('パレットの支柱・ジャッキ・踏板・筋交も同じく引き継がれる', () => {
      for (const kind of ['post', 'jack', 'board', 'brace'] as const) {
        const p = newElevationPart(kind, `manual:${kind}:1`, 0, { xMm: 900, yMm: 1500 });
        const r = rematchElevationParts([p], nextBundle(8300));
        expect(r.orphans, kind).toHaveLength(0);
      }
    });

    it('自動部材を縦にずらしたものも引き継がれる', () => {
      const auto: ElevationPart = {
        id: 'rail:0:1500:180', kind: 'rail', scaffoldIndex: 0, origin: 'auto',
        spanIndex: 1, levelMm: 1500, x0: 180, x1: 360,
      };
      const moved = movePart(auto, geomAt(6500).scaffolds[0], { dxMm: 900, dyMm: 220 });
      const r = rematchElevationParts([moved], nextBundle(8300));
      expect(r.orphans).toHaveLength(0);
      expect(r.parts.map((p) => p.id)).toContain(auto.id);
    });

    it('足場そのものが無くなった場合だけ孤立にする', () => {
      const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
      const gone = { parts: [] as ElevationPart[], geom: { minXg: 0, scaffolds: [] } };
      const r = rematchElevationParts([rail], gone);
      expect(r.orphans).toHaveLength(1);
    });
  });

  // 現状の記録（直したらこの 2 つは削除する）。
  it('現状: パレットで置いた部材は作り直しで孤立して消える（＝実機の症状）', () => {
    const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
    const r = rematchElevationParts([rail], nextBundle(8300));
    expect(r.parts).toHaveLength(0);
    expect(r.orphans.map((p) => p.id)).toEqual(['manual:rail:1']);
  });

  it('現状: 縦にずらした自動部材も孤立して消える', () => {
    const auto: ElevationPart = {
      id: 'rail:0:1500:180', kind: 'rail', scaffoldIndex: 0, origin: 'auto',
      spanIndex: 1, levelMm: 1500, x0: 180, x1: 360,
    };
    const moved = movePart(auto, geomAt(6500).scaffolds[0], { dxMm: 900, dyMm: 220 });
    const r = rematchElevationParts([moved], nextBundle(8300));
    expect(r.orphans).toHaveLength(1);
  });
});
