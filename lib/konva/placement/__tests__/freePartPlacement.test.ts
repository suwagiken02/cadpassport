// ============================================================
// E-8-v5b: キャンバス直下の手動部材（freeParts）の接合スナップ。
//
// ■ 分かったこと（実装前の再現）
// 接合スナップ自体は FreePartLayer から呼ばれており、手摺⇔手摺・手摺⇔支柱のコマ・
// 支柱⇔支柱（ホゾ⇔受け）・踏板・筋交・連鎖、いずれも効いていた。
// **効いていなかったのはジャッキだけ**。partJoints の jack が受け口の高さを
// 足場（sg.jackTopMm）からしか取っておらず、足場を持たない freeParts では
// 接合点が空配列になっていた＝支柱のホゾが乗らない。
//
// ■ なぜ気付かれなかったか
// 吸着の呼び出しが React コンポーネント（FreePartLayer）の中にあり、
// **ストアを叩く振る舞いテストが 1 本も書けなかった**から。
// 配置・移動・吸着を freePartPlacement.ts へ出して、ここから直接叩く。
//
// ここで押さえること:
//   ・接合点の近くに置くと、吸着位置に入る（コマ⇔楔・ホゾ⇔受け）
//   ・十分離れた場所では、置いた座標のまま置かれる（自由配置が生きている）
//   ・シャドーの姿と、確定して置かれる姿が一致する
//   ・距離判定が実寸基準（立面ビューの scale を掛けない）
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  JOINT_SNAP_PX, freePartDraftAt, freePartSnapOptions, gridPxOf,
  moveFreePartBy, placeFreePartAt,
} from '../freePartPlacement';
import { GRID_MM, type ElevationPartKind } from '@/lib/konva/elevation/elevationParts';
import { partJoints } from '@/lib/konva/elevation/elevationJoints';
import { newFreePart, type FreePart } from '@/lib/konva/freeParts';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import type { CanvasData } from '@/types';

const st = () => useCanvasStore.getState();
const free = (): FreePart[] => useCanvasStore.getState().canvasData.freeParts ?? [];

/** mm → キャンバスのグリッド（freeParts の座標の意味: xMm = x*10 / yMm = -y*10）。 */
const g = (xMm: number, yMm: number) => ({ x: xMm / GRID_MM, y: -yMm / GRID_MM });

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** 既存の部材を直接置いた状態にする（パレット操作を挟まない）。 */
const seed = (...parts: FreePart[]) => {
  st().setCanvasData({ ...blank(), freeParts: parts } as CanvasData);
};

/** パレットで部材を選んだ状態にする。 */
const arm = (kind: ElevationPartKind, size: number, opts?: { flip?: boolean; angle?: number }) => {
  useCanvasStore.setState({
    elevationAddTool: kind,
    elevationAddSize: size,
    elevationAddFlip: opts?.flip ?? false,
    elevationAddAngle: opts?.angle ?? 0,
  });
};

const railAt = (id: string, xMm: number, yMm: number, sizeMm = 1800): FreePart =>
  newFreePart('rail', id, g(xMm, yMm), { sizeMm });
const postAt = (id: string, xMm: number, yMm: number, komaCount = 4): FreePart =>
  newFreePart('post', id, g(xMm, yMm), { komaCount });

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({
    zoom: 1, panX: 0, panY: 0,
    elevationAddTool: null, elevationAddSize: 1800,
    elevationAddFlip: false, elevationAddAngle: 0,
  });
});

// ============================================================
describe('接合点の近くに置くと吸着する', () => {
  it('手摺の右端の続きに手摺（20mm ずれ）→ ぴったり続く', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    // a の右端の楔は (900, 0)。b の左端がその 20mm 右・10mm 下に来る位置を指す。
    expect(placeFreePartAt(g(1820, -10))).toBe(true);
    const b = free()[1];
    expect({ x0Mm: b.x0Mm, levelMm: b.levelMm }).toEqual({ x0Mm: 900, levelMm: 0 });
  });

  it('手摺の真上 450mm（コマ 1 つぶん）にも吸着する', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    placeFreePartAt(g(10, 460));
    const b = free()[1];
    expect({ x0Mm: b.x0Mm, levelMm: b.levelMm }).toEqual({ x0Mm: -900, levelMm: 450 });
  });

  it('支柱のコマ(下端+250)へ手摺の楔が吸着する', () => {
    seed(postAt('p', 0, 0));
    arm('rail', 1800);
    // 手摺の左端が支柱の x、高さがコマの 10mm 上に来る位置
    placeFreePartAt(g(900, 260));
    const r = free()[1];
    expect({ x0Mm: r.x0Mm, levelMm: r.levelMm }).toEqual({ x0Mm: 0, levelMm: 250 });
  });

  it('支柱のコマへ踏板も吸着する', () => {
    seed(postAt('p', 0, 0));
    arm('board', 1800);
    placeFreePartAt(g(900, 710));
    expect(free()[1].levelMm).toBe(700);
  });

  it('支柱を手摺の楔の位置へ（逆向きでも吸う）', () => {
    seed(railAt('a', 0, 0));
    arm('post', 4);
    // 手摺の左端の楔 (-900, 0) の近くへ支柱の下端を置く
    placeFreePartAt(g(-890, -240));
    const p = free()[1];
    // 支柱の 1 コマ目は下端+250。楔に合うのは下端が -250 の位置。
    expect({ x0Mm: p.x0Mm, levelMm: p.levelMm }).toEqual({ x0Mm: -900, levelMm: -250 });
  });

  it('支柱の上に支柱（ホゾ⇔受け）で縦に継げる', () => {
    seed(postAt('p', 0, 0, 4));           // 下端 0 / 上端 1800
    arm('post', 4);
    placeFreePartAt(g(10, 1810));
    const q = free()[1];
    expect({ x0Mm: q.x0Mm, levelMm: q.levelMm }).toEqual({ x0Mm: 0, levelMm: 1800 });
  });

  it('★ ジャッキの上端に支柱が乗る（今回直した穴）', () => {
    const jack = newFreePart('jack', 'j', g(0, 500));
    seed(jack);
    // 足場が無くてもジャッキが受け口を持っていること
    expect(partJoints(jack, undefined)).toEqual([
      { xMm: 0, yMm: 500, kind: 'cup', partId: 'j' },
    ]);
    arm('post', 4);
    placeFreePartAt(g(10, 510));
    const p = free()[1];
    expect({ x0Mm: p.x0Mm, levelMm: p.levelMm }).toEqual({ x0Mm: 0, levelMm: 500 });
  });

  it('連鎖する（吸着した部材の先へさらに繋げる）', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    placeFreePartAt(g(1820, -10));       // 2 本目
    placeFreePartAt(g(3620, 10));        // 3 本目（2 本目の右端の続き）
    expect(free().map((p) => p.x0Mm)).toEqual([-900, 900, 2700]);
    expect(free().every((p) => p.levelMm === 0)).toBe(true);
  });

  it('置くたびに id が増える（上書きにならない）', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    placeFreePartAt(g(1820, -10));
    placeFreePartAt(g(3620, 10));
    expect(new Set(free().map((p) => p.id)).size).toBe(3);
  });
});

// ============================================================
describe('接合点から離れていれば、置いた場所そのまま（自由配置）', () => {
  it('手摺から遠い場所は 1 ミリも動かない', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    placeFreePartAt(g(50000, -30000));
    const b = free()[1];
    expect({ x0Mm: b.x0Mm, x1Mm: b.x1Mm, levelMm: b.levelMm })
      .toEqual({ x0Mm: 50000 - 900, x1Mm: 50000 + 900, levelMm: -30000 });
  });

  it('何も無いキャンバスでも、指した位置に素直に置ける', () => {
    arm('rail', 1800);
    expect(placeFreePartAt(g(1234, -5678))).toBe(true);
    expect(free()[0]).toMatchObject({ x0Mm: 334, x1Mm: 2134, levelMm: -5678 });
  });

  it('吸着圏のすぐ外は吸わない（境界の外側）', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    // 吸着距離(mm) = tolPx / pxPerMm。その少し外へ置く。
    const tolMm = JOINT_SNAP_PX / freePartSnapOptions(1).pxPerMm;
    placeFreePartAt(g(1800 + tolMm + 5, 0));
    // 吸着していない＝指した位置そのまま（グリッド往復のぶん誤差が出るので近似で見る）
    expect(free()[1].x0Mm).toBeCloseTo(900 + tolMm + 5, 6);
  });

  it('吸着圏のすぐ内側は吸う（境界の内側）', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    const tolMm = JOINT_SNAP_PX / freePartSnapOptions(1).pxPerMm;
    placeFreePartAt(g(1800 + tolMm - 5, 0));
    expect(free()[1].x0Mm).toBe(900);
  });

  it('部材を選んでいなければ何も置かない', () => {
    expect(placeFreePartAt(g(0, 0))).toBe(false);
    expect(free()).toHaveLength(0);
  });

  it('文字ツールでは置かない（ここは部材だけ）', () => {
    useCanvasStore.setState({ elevationAddTool: 'text' });
    expect(placeFreePartAt(g(0, 0))).toBe(false);
    expect(free()).toHaveLength(0);
  });
});

// ============================================================
describe('動かすときも吸着する', () => {
  it('接合点の近くへ動かすと、吸着位置に収まる', () => {
    seed(railAt('a', 0, 0), railAt('b', 5000, 0));
    // b を a の右端の続き付近へ（20mm 手前）
    expect(moveFreePartBy('b', g(-3180, 0))).toBe(true);
    expect(free()[1].x0Mm).toBe(900);
  });

  it('遠くへ動かしたぶんはそのまま（吸着しない）', () => {
    seed(railAt('a', 0, 0), railAt('b', 5000, 0));
    moveFreePartBy('b', { x: 1000, y: 200 });
    const b = free()[1];
    expect({ x0Mm: b.x0Mm, levelMm: b.levelMm })
      .toEqual({ x0Mm: 5000 - 900 + 10000, levelMm: -2000 });
  });

  it('自分自身の接合点には吸わない', () => {
    seed(railAt('a', 0, 0));
    moveFreePartBy('a', { x: 1, y: 0 });
    expect(free()[0].x0Mm).toBe(-900 + 10);
  });

  it('動かない量なら何もしない（履歴を汚さない）', () => {
    seed(railAt('a', 0, 0));
    expect(moveFreePartBy('a', { x: 0, y: 0 })).toBe(false);
  });

  it('居ない id は何もしない', () => {
    seed(railAt('a', 0, 0));
    expect(moveFreePartBy('nope', { x: 5, y: 5 })).toBe(false);
  });

  it('動かしたぶんは undo で戻せる', () => {
    seed(railAt('a', 0, 0), railAt('b', 5000, 0));
    moveFreePartBy('b', g(-3180, 0));
    expect(free()[1].x0Mm).toBe(900);
    st().undo();
    expect(free()[1].x0Mm).toBe(5000 - 900);
  });
});

// ============================================================
describe('シャドーと、置かれる姿が一致する', () => {
  it('吸着したときも、しないときも同じ', () => {
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    for (const at of [g(1820, -10), g(50000, -30000)]) {
      st().setCanvasData({ ...blank(), freeParts: [railAt('a', 0, 0)] } as CanvasData);
      const ghost = freePartDraftAt(at)!;
      placeFreePartAt(at);
      const placed = free()[1];
      expect({ x0Mm: placed.x0Mm, x1Mm: placed.x1Mm, levelMm: placed.levelMm })
        .toEqual({ x0Mm: ghost.x0Mm, x1Mm: ghost.x1Mm, levelMm: ghost.levelMm });
    }
  });

  it('シャドーはキャンバスに何も足さない', () => {
    arm('rail', 1800);
    freePartDraftAt(g(0, 0));
    expect(free()).toHaveLength(0);
  });

  it('パレットで選んだ寸法・角度がそのまま姿になる', () => {
    arm('rail', 900, { angle: 30 });
    const ghost = freePartDraftAt(g(0, 0))!;
    expect(ghost.x1Mm! - ghost.x0Mm!).toBe(900);
    expect(ghost.angleDeg).toBe(30);
  });
});

// ============================================================
describe('距離判定は実寸基準（立面ビューの縮尺を掛けない）', () => {
  it('1mm あたりの画面 px は gridPx / 10', () => {
    for (const zoom of [0.25, 1, 2.5]) {
      expect(freePartSnapOptions(zoom).pxPerMm).toBe(gridPxOf(zoom) / GRID_MM);
      expect(gridPxOf(zoom)).toBe(INITIAL_GRID_PX * zoom);
    }
  });

  it('吸着距離(px)は立面ビュー内と同じ 22px（同じ操作感）', () => {
    expect(JOINT_SNAP_PX).toBe(22);
    expect(freePartSnapOptions(1).tolPx).toBe(JOINT_SNAP_PX);
  });

  it('ズームを変えても、画面上の吸着距離は変わらない', () => {
    // 画面 22px ぶんの mm はズームで変わるが、px 換算では常に 22px
    for (const zoom of [0.5, 1, 3]) {
      const o = freePartSnapOptions(zoom);
      const tolMm = o.tolPx / o.pxPerMm;
      expect(tolMm * o.pxPerMm).toBeCloseTo(JOINT_SNAP_PX, 9);
    }
  });

  it('ズームアウトしていても、実寸の接合点へ吸着できる', () => {
    useCanvasStore.setState({ zoom: 0.25 });
    seed(railAt('a', 0, 0));
    arm('rail', 1800);
    placeFreePartAt(g(1820, -10));
    expect(free()[1].x0Mm).toBe(900);
  });
});
