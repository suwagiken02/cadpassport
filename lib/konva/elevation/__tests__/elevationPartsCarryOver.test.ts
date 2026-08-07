// ============================================================
// E-8-v3d-check: 「手動配置 → 建物の高さ変更 → 立面を作り直す」で
// 手動部材が引き継がれるか（実機で「まっさらな自動生成に戻る」症状）。
//
// 経路: ElevationPlaceDialog(今のページ) → canvasStore.addElevationViews
//       → carryOverElevationEdits → rematchElevationParts
//
// 原因（E-8-v3d-check の切り分け）:
//   ・E-8-v3a より前は、手動部材は slotToPart で作られ spanIndex/postIndex/levelMm
//     という「置き場所の番号」を必ず持っていた。再マッチはこの番号で照合していた。
//   ・E-8-v3a で位置を自由座標(x0Mm/x1Mm/levelMm)一次に変えたとき、
//     newElevationPart は番号を持たせなくなった。再マッチだけが v2 の
//     「番号で場所を表す」世界に取り残され、パレット由来は 100%、動かした部材も
//     縦にずらした時点で（levelMm がコマ格子から外れて）孤立していた。
//
// E-8-v3f の修正: 番号で見つからなければ座標そのもので判定し、座標を保ったまま残す。
// 孤立にするのは「足場ごと消えた」「完全に範囲外」のときだけ（＝「勝手に消さない」）。
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

describe('E-8-v3f: 作り直しでも手動部材を引き継ぐ', () => {
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

  describe('高さを変えて作り直しても手動部材が残る (= E-8-v3f で修正)', () => {
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

    // E-8-v4a: 足場ゼロの面でも部材を置けるようにしたので、
    // 足場が無いこと自体は孤立の理由にならなくなった（座標があれば残す）。
    it('足場そのものが無くなっても、座標を持つ部材は残る', () => {
      const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 1500 });
      const gone = { parts: [] as ElevationPart[], geom: { minXg: 0, scaffolds: [] } };
      const r = rematchElevationParts([rail], gone);
      expect(r.orphans).toHaveLength(0);
      expect(r.parts.map((p) => p.id)).toEqual(['manual:rail:1']);
    });
  });

  // ------------------------------------------------------------
  // 孤立にするのは「置き場所そのものが無くなった」ときだけ (= 鮎澤氏「残す」方針)。
  // ------------------------------------------------------------
  describe('孤立にするのは範囲外だけ', () => {
    it('足場の外側（仮想グリッドの範囲内）に足した部材は残る', () => {
      // 右端の支柱(x=540grid=5400mm)より外。v3 はここへ置ける
      const rail = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 7200, yMm: 1500 });
      const r = rematchElevationParts([rail], nextBundle(8300));
      expect(r.orphans).toHaveLength(0);
      expect(r.parts.map((p) => p.id)).toContain('manual:rail:1');
    });

    it('横に完全に外れた部材は孤立する', () => {
      const far = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 60000, yMm: 1500 });
      const r = rematchElevationParts([far], nextBundle(8300));
      expect(r.orphans.map((p) => p.id)).toEqual(['manual:rail:1']);
      expect(r.parts).toHaveLength(0);
    });

    it('足場より遥かに高い位置の部材は孤立する', () => {
      const high = newElevationPart('rail', 'manual:rail:1', 0, { xMm: 900, yMm: 60000 });
      const r = rematchElevationParts([high], nextBundle(8300)).orphans;
      expect(high.levelMm).toBe(60000);
      expect(r.map((p) => p.id)).toEqual(['manual:rail:1']);
    });
  });

  // ------------------------------------------------------------
  // 移動・削除の意味が作り直しでぶり返さないこと（E-8-v2e からの担保）。
  // ------------------------------------------------------------
  describe('移動・削除がぶり返さない', () => {
    /** 作り直しで生えてくる自動の手摺（元の場所）。 */
    const autoRail: ElevationPart = {
      id: 'rail:0:1500:180', kind: 'rail', scaffoldIndex: 0, origin: 'auto',
      spanIndex: 1, levelMm: 1500, x0: 180, x1: 360, x0Mm: 1800, x1Mm: 3600,
    };

    it('動かした部材は 1 本のまま（元の場所に自動が生え直さない）', () => {
      const moved = movePart(autoRail, geomAt(6500).scaffolds[0], { dxMm: 900, dyMm: 220 });
      const r = rematchElevationParts([moved], { parts: [autoRail], geom: geomAt(8300) });
      expect(r.parts).toHaveLength(1);
      expect(r.parts[0]).toMatchObject({ id: autoRail.id, levelMm: 1720, x0Mm: 2700 });
    });

    it('消した自動部材は墓標が効いて生え直さない', () => {
      const tomb: ElevationPart = { ...autoRail, origin: 'manual', removed: true };
      const r = rematchElevationParts([tomb], { parts: [autoRail], geom: geomAt(8300) });
      expect(r.parts.filter((p) => !p.removed)).toHaveLength(0);
    });
  });
});
