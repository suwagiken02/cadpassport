// ============================================================
// S-7: 赤い距離ガイドを「頂点ドラッグ中」から「手描き敷地の起点選び」へ移す。
//
// S-5 では頂点をドラッグしている間に出していたが、S-6 の常時表示（青）と重なって
// 青が読めなくなった。ドラッグ中は青だけで足りるので赤は外し、
// **起点（最初の 1 点）を打つ前**に出すようにした。ここが決まらないと以降の
// 方向入力がぜんぶずれるので、打つ前に建物からの距離が見える価値が大きい。
//
// 計算（lib/konva/siteVertexGuide.ts）は S-5 から変えていない。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { buildingCornersGrid, nearestBuildingCornerGuide } from '@/lib/konva/siteVertexGuide';
import type { CanvasData, Point } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const startLayer = read('components/canvas/SiteStartGuideLayer.tsx');
const siteLayer = read('components/canvas/SiteLayer.tsx');
const gridCanvas = read('components/canvas/GridCanvas.tsx');
const interaction = read('lib/konva/useCanvasInteraction.ts');

const st = () => useCanvasStore.getState();

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/**
 * SiteStartGuideLayer が出すかどうかの式そのもの。
 *   起点選びの最中（敷地・方向入力・まだ 1 点も打っていない）＋ポインタ位置＋建物。
 */
const shownGuide = () => {
  const s = st();
  const choosing = s.mode === 'building'
    && s.buildingInputMethod === 'direction'
    && s.pendingTargetType === 'site'
    && s.directionPoints.length === 0;
  if (!choosing || !s.siteStartCursor) return null;
  return nearestBuildingCornerGuide(s.siteStartCursor, buildingCornersGrid(s.canvasData.buildings));
};

/** 「敷地を手で描く」を押した直後の状態にする（SiteModal の startDrawing と同じ）。 */
const startDrawingSite = () => {
  const s = st();
  s.setPendingTargetType('site');
  s.setBuildingInputMethod('direction');
  s.setMode('building');
  s.clearDirectionPoints();
};

beforeEach(() => {
  st().setCanvasData({
    ...blank(),
    buildings: [{ id: 'b1', type: 'polygon', points: rect(0, 0, 100, 80), fill: '#3d3d3a' }],
  } as CanvasData);
  st().clearDirectionPoints();
  useCanvasStore.setState({
    mode: 'select', buildingInputMethod: 'template', pendingTargetType: 'building',
    siteStartCursor: null,
  });
});

// ============================================================
describe('敷地の起点を選んでいる間だけ出る', () => {
  it('起点選びに入る前は出ない', () => {
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(shownGuide()).toBeNull();
  });

  it('「手で描く」で起点選びに入り、ポインタが動けば出る', () => {
    startDrawingSite();
    st().setSiteStartCursor({ x: -50, y: -50 });
    const g = shownGuide()!;
    expect(g.corner).toEqual({ x: 0, y: 0 });
    expect(g.dxMm).toBe(500);
    expect(g.dyMm).toBe(500);
  });

  it('ポインタを動かせば追従する', () => {
    startDrawingSite();
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(shownGuide()!.dxMm).toBe(500);
    st().setSiteStartCursor({ x: -120, y: -50 });
    expect(shownGuide()!.dxMm).toBe(1200);
  });

  it('最寄りの角が変われば相手も切り替わる', () => {
    startDrawingSite();
    st().setSiteStartCursor({ x: -20, y: -20 });
    expect(shownGuide()!.corner).toEqual({ x: 0, y: 0 });
    st().setSiteStartCursor({ x: 120, y: -20 });
    expect(shownGuide()!.corner).toEqual({ x: 100, y: 0 });
  });

  it('起点を打ったら消える（方向入力が始まる）', () => {
    startDrawingSite();
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(shownGuide()).not.toBeNull();
    st().addDirectionPoint({ x: -50, y: -50 });
    expect(shownGuide()).toBeNull();
  });

  it('描き終わり・中断でポインタ位置も捨てる', () => {
    startDrawingSite();
    st().setSiteStartCursor({ x: -50, y: -50 });
    st().clearDirectionPoints();
    expect(st().siteStartCursor).toBeNull();
    expect(shownGuide()).toBeNull();
  });
});

// ============================================================
describe('躯体・屋根の起点選びには出さない', () => {
  it('躯体（建物）では出ない', () => {
    st().setPendingTargetType('building');
    st().setBuildingInputMethod('direction');
    st().setMode('building');
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(shownGuide()).toBeNull();
  });

  it('屋根では出ない', () => {
    st().setPendingTargetType('roof');
    st().setBuildingInputMethod('direction');
    st().setMode('building');
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(shownGuide()).toBeNull();
  });

  it('障害物の壁方向入力でも出ない', () => {
    st().setPendingTargetType('obstacle');
    st().setBuildingInputMethod('direction');
    st().setMode('building');
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(shownGuide()).toBeNull();
  });

  it('ポインタ位置を覚えるのも敷地のときだけ（覚える側でも絞っている）', () => {
    expect(interaction).toMatch(
      /s\.mode === 'building' && s\.buildingInputMethod === 'direction'\s*\n\s*&& s\.pendingTargetType === 'site' && s\.directionPoints\.length === 0/,
    );
    expect(interaction).toMatch(/s\.setSiteStartCursor\(toGrid\(stage, clientPos\)\)/);
  });

  it('描く側の条件はレイヤーでも同じ', () => {
    expect(startLayer).toMatch(/pendingTargetType === 'site'/);
    expect(startLayer).toMatch(/directionPoints\.length === 0/);
  });
});

// ============================================================
describe('建物が無い図面', () => {
  beforeEach(() => {
    st().setCanvasData(blank());
    startDrawingSite();
  });

  it('何も出ない（落ちない）', () => {
    st().setSiteStartCursor({ x: -50, y: -50 });
    expect(() => shownGuide()).not.toThrow();
    expect(shownGuide()).toBeNull();
  });

  it('起点タップ自体は従来どおりできる', () => {
    st().addDirectionPoint({ x: 10, y: 20 });
    expect(st().directionPoints).toEqual([{ x: 10, y: 20 }]);
  });
});

// ============================================================
describe('頂点ドラッグ中には出さなくなった（S-7 で外した）', () => {
  it('SiteLayer から赤いガイドが消えている', () => {
    expect(siteLayer).not.toMatch(/nearestBuildingCornerGuide/);
    expect(siteLayer).not.toMatch(/GUIDE_COLOR|#EF4444/);
    expect(siteLayer).not.toMatch(/\{drag && guide/);
  });

  it('青い常時表示（S-6）はそのまま残っている', () => {
    expect(siteLayer).toMatch(/const GAP_COLOR = '#2563EB';/);
    expect(siteLayer).toMatch(/\{editable && gaps\.map/);
  });

  it('つまみのドラッグ・確定・吸着・履歴の配線は変わっていない', () => {
    expect(siteLayer).toMatch(/onDragStart=\{\(\) => \{[^]*?pushHistory\(\)/);
    expect(siteLayer).toMatch(/setSitePolygonPoint\(site\.id, index/);
    expect(siteLayer).toMatch(/dragBoundFunc=\{\(pos\) => \{/);
    expect(siteLayer).toMatch(/snapSiteVertex\(/);
    expect(siteLayer).toMatch(/setDrag\(null\)/);
  });

  it('計算部は残してある（起点選びで使うため）', () => {
    expect(() => read('lib/konva/siteVertexGuide.ts')).not.toThrow();
    expect(startLayer).toMatch(/nearestBuildingCornerGuide/);
  });
});

// ============================================================
describe('レイヤーの置き方', () => {
  it('GridCanvas に載っている', () => {
    expect(gridCanvas).toMatch(/<SiteStartGuideLayer \/>/);
    expect(gridCanvas).toMatch(/import SiteStartGuideLayer from '\.\/SiteStartGuideLayer'/);
  });

  it('敷地・建物より上に描く（下敷きにならない）', () => {
    expect(gridCanvas.indexOf('<SiteLayer />'))
      .toBeLessThan(gridCanvas.indexOf('<SiteStartGuideLayer />'));
    expect(gridCanvas.indexOf('<BuildingLayer />'))
      .toBeLessThan(gridCanvas.indexOf('<SiteStartGuideLayer />'));
  });

  it('触れない（操作を邪魔しない）', () => {
    expect(startLayer).toMatch(/<Layer listening=\{false\}>/);
    expect(startLayer).not.toMatch(/draggable|onClick|onTap|onMouseDown/);
  });

  it('条件を満たさなければ何も描かない', () => {
    expect(startLayer).toMatch(/if \(!guide \|\| !cursor\) return null;/);
  });

  it('建物の角は建物が変わったときだけ作り直す', () => {
    expect(startLayer).toMatch(/useMemo\(\(\) => buildingCornersGrid\(buildings\), \[buildings\]\)/);
  });
});

// ============================================================
describe('見た目は S-5 のまま（計測ツールに合わせた赤）', () => {
  it('赤の破線', () => {
    expect(startLayer).toMatch(/const GUIDE_COLOR = '#EF4444';/);
    expect(startLayer).toMatch(/const GUIDE_DASH = \[6, 4\];/);
  });

  it('数値は mm 表記の monospace 太字', () => {
    expect(startLayer).toMatch(/\$\{guide\.dxMm\}mm/);
    expect(startLayer).toMatch(/\$\{guide\.dyMm\}mm/);
    expect(startLayer).toMatch(/fontSize=\{13\} fontFamily="monospace" fontStyle="bold"/);
  });

  it('数値は脚の中点から外へずらす（ポインタに隠れない）', () => {
    expect(startLayer).toMatch(/y=\{cy - 18\}/);
    expect(startLayer).toMatch(/x=\{px \+ ySide \* 14\}/);
  });

  it('水平と垂直の 2 本で L 字に結ぶ', () => {
    expect(startLayer).toMatch(/points=\{\[cx, cy, px, cy\]\}/);
    expect(startLayer).toMatch(/points=\{\[px, cy, px, py\]\}/);
  });
});
