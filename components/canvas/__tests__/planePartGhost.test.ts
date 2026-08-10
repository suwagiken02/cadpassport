// ============================================================
// P-1-fix8: 階段・単管の配置プレビュー（ゴースト）。
//
// 実機の指摘:「置きにくい。どこにどう置けるか、置くまで分からない」。
// 手摺は引き出し中にキャンバスへプレビュー線が出るが、階段・単管は
// カーソルの札だけだった。
//
// ここで押さえるのは:
//   ・階段のゴーストは**吸着後**の位置に出る（カーソルの生の位置ではない）
//   ・向き・上り反転がゴーストに出る
//   ・単管のゴーストは長さ・角度を反映し、吸着しない
//   ・ドラッグが終わったらゴーストが消える
//   ・手摺のプレビューは従来どおり
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  pipeEndpointsGrid, snapStairToCellGrid, stairArrowGrid, stairCornersGrid, stairTreadLinesGrid,
} from '@/lib/konva/planeParts';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const partSelector = read('components/toolbar/PartSelector.tsx');
const planeLayer = read('components/canvas/PlanePartLayer.tsx');

/** PartSelector の onMove と同じ組み立て（階段は吸着後の位置に出す）。 */
const stairGhostAt = (cursor: { x: number; y: number }, angleDeg: number, flip = false) => {
  const at = snapStairToCellGrid(cursor, angleDeg);
  return { kind: 'stair' as const, stair: { id: 'preview', x: at.x, y: at.y, angleDeg, flip } };
};
const pipeGhostAt = (cursor: { x: number; y: number }, lengthMm: number, angleDeg: number) => ({
  kind: 'pipe' as const,
  pipe: { id: 'preview', x: cursor.x, y: cursor.y, lengthMm, angleDeg },
});

beforeEach(() => {
  useCanvasStore.getState().setPlanePartPreview(null);
});

describe('ゴーストは手摺と同じ仕組みに乗っている', () => {
  it('store が持つ（handrailPreview と同じ役目）', () => {
    expect(useCanvasStore.getState().planePartPreview).toBeNull();
    expect(typeof useCanvasStore.getState().setPlanePartPreview).toBe('function');
  });

  it('引き出し中に onMove が更新する', () => {
    expect(partSelector).toMatch(/toolbarDrag\.type === 'stair' \|\| toolbarDrag\.type === 'pipe'[^]*?setPlanePartPreview\(\{/);
  });

  it('描くのは PlanePartLayer（実物と同じ描画を通る）', () => {
    expect(planeLayer).toMatch(/planePartPreview/);
    expect(planeLayer).toMatch(/<StairView[^]*?ghost/);
    expect(planeLayer).toMatch(/<PipeView[^]*?ghost/);
    // 実物とゴーストで別の描画を書いていない
    expect((planeLayer.match(/function StairView/g) ?? []).length).toBe(1);
    expect((planeLayer.match(/function PipeView/g) ?? []).length).toBe(1);
  });

  it('半透明・破線で実物と区別できる', () => {
    expect(planeLayer).toMatch(/GHOST_OPACITY = 0\.4/);
    expect(planeLayer).toMatch(/GHOST_DASH = \[8, 4\]/);
    // 手摺のプレビューと同じ表現
    expect(read('components/canvas/GridCanvas.tsx')).toMatch(/opacity=\{0\.4\}[^]*?dash=\{\[8, 4\]\}/);
  });

  it('ゴーストは触れない（実物の操作を邪魔しない）', () => {
    expect(planeLayer).toMatch(/listening=\{!ghost && !!interaction\?\.listening\}/);
    expect(planeLayer).toMatch(/draggable=\{!ghost && !!interaction\?\.draggable\}/);
  });
});

describe('階段のゴーストは吸着後の位置に出る', () => {
  it('カーソルの生の位置ではなく、納まる区画の左上に出る', () => {
    const cursor = { x: 97, y: 263 };
    const g = stairGhostAt(cursor, 0);
    expect(g.stair.x).not.toBe(cursor.x);
    expect(g.stair.y).not.toBe(cursor.y);
    expect(g.stair).toMatchObject(snapStairToCellGrid(cursor, 0));
  });

  it('少しずれても同じ区画に出る（どこに入るかが分かる）', () => {
    const base = stairGhostAt({ x: 90, y: 270 }, 0).stair;
    for (const [dx, dy] of [[-5, -20], [5, 20], [-2, 40]]) {
      const g = stairGhostAt({ x: 90 + dx, y: 270 + dy }, 0).stair;
      expect([g.x, g.y], `${dx},${dy}`).toEqual([base.x, base.y]);
    }
  });

  it('ゴーストの位置は、離したときに実際に置かれる位置と同じ', () => {
    // ドロップ側も snapStairToCellGrid(gridPos, angleDeg) を通す（P-1-fix7 のテストで固定済み）
    const cursor = { x: 123, y: 456 };
    expect(stairGhostAt(cursor, 90).stair).toMatchObject(snapStairToCellGrid(cursor, 90));
  });

  it('向きがゴーストに出る（90°/270° は横長）', () => {
    for (const deg of [90, 270]) {
      const c = stairCornersGrid(stairGhostAt({ x: 0, y: 0 }, deg).stair);
      expect(c[1].x - c[0].x, `${deg}°`).toBeGreaterThan(c[2].y - c[1].y);
    }
    for (const deg of [0, 180]) {
      const c = stairCornersGrid(stairGhostAt({ x: 0, y: 0 }, deg).stair);
      expect(c[2].y - c[1].y, `${deg}°`).toBeGreaterThan(c[1].x - c[0].x);
    }
  });

  it('上り反転がゴーストに出る（矢印が逆を向く）', () => {
    const normal = stairArrowGrid(stairGhostAt({ x: 0, y: 0 }, 0, false).stair);
    const flipped = stairArrowGrid(stairGhostAt({ x: 0, y: 0 }, 0, true).stair);
    expect(flipped.to).toEqual(normal.from);
    expect(flipped.from).toEqual(normal.to);
  });

  it('段板と矢印まで描く（置かれる姿そのまま）', () => {
    const g = stairGhostAt({ x: 0, y: 0 }, 0).stair;
    expect(stairTreadLinesGrid(g).length).toBeGreaterThan(0);
    expect(stairArrowGrid(g)).toBeTruthy();
    expect(planeLayer).toMatch(/stairTreadLinesGrid\(stair\)/);
    expect(planeLayer).toMatch(/stairArrowGrid\(stair\)/);
  });
});

describe('単管のゴースト', () => {
  it('吸着しない（カーソル位置がそのまま始点）', () => {
    const g = pipeGhostAt({ x: 7.3, y: -11.9 }, 2000, 45);
    expect(pipeEndpointsGrid(g.pipe)[0]).toEqual({ x: 7.3, y: -11.9 });
  });

  it('長さがゴーストに出る', () => {
    const len = (mm: number) => {
      const [a, b] = pipeEndpointsGrid(pipeGhostAt({ x: 0, y: 0 }, mm, 0).pipe);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    expect(len(6000)).toBeCloseTo(len(1000) * 6);
    expect(len(1234)).toBeGreaterThan(len(1000));
  });

  it('角度がゴーストに出る', () => {
    const ang = (deg: number) => {
      const [a, b] = pipeEndpointsGrid(pipeGhostAt({ x: 0, y: 0 }, 2000, deg).pipe);
      return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    };
    expect(ang(0)).toBeCloseTo(0);
    expect(ang(45)).toBeCloseTo(45);
    expect(ang(90)).toBeCloseTo(90);
  });

  it('火打ちの四隅がゴーストで区別できる (= P-1-fix9)', () => {
    // 置いた点から伸びるので、45 と 225 は同じ傾きでも伸びる向きが逆
    const dir = (deg: number) => {
      const [a, b] = pipeEndpointsGrid(pipeGhostAt({ x: 0, y: 0 }, 2000, deg).pipe);
      return { x: Math.sign(Math.round(b.x - a.x)), y: Math.sign(Math.round(b.y - a.y)) };
    };
    expect(dir(45)).toEqual({ x: 1, y: 1 });
    expect(dir(135)).toEqual({ x: -1, y: 1 });
    expect(dir(225)).toEqual({ x: -1, y: -1 });
    expect(dir(315)).toEqual({ x: 1, y: -1 });
    // 始点は動かない（どの向きでも置いた点から伸びる）
    for (const deg of [45, 135, 225, 315]) {
      expect(pipeEndpointsGrid(pipeGhostAt({ x: 12, y: 34 }, 2000, deg).pipe)[0])
        .toEqual({ x: 12, y: 34 });
    }
  });

  it('単管パレットは火打ち用のプリセット、手摺は従来のまま', () => {
    expect(partSelector).toMatch(/<PipePreview[^]*?presets=\{PIPE_ANGLE_PRESETS\}|presets=\{PIPE_ANGLE_PRESETS\}/);
    expect(partSelector).toMatch(/presets=\{ANGLE_PRESETS\}/);
  });
});

describe('ゴーストが消える', () => {
  it('store から消せる', () => {
    useCanvasStore.getState().setPlanePartPreview(stairGhostAt({ x: 0, y: 0 }, 0));
    expect(useCanvasStore.getState().planePartPreview).not.toBeNull();
    useCanvasStore.getState().setPlanePartPreview(null);
    expect(useCanvasStore.getState().planePartPreview).toBeNull();
  });

  it('ドラッグ終了・ゴミ箱・キャンバス外の 3 経路すべてで消している', () => {
    expect((partSelector.match(/setPlanePartPreview\(null\)/g) ?? []).length).toBe(3);
  });

  it('キャンバスの外へ出たら消える', () => {
    expect(partSelector).toMatch(/if \(!cr\) \{ useCanvasStore\.getState\(\)\.setPlanePartPreview\(null\); return; \}/);
  });

  it('ゴーストが無ければ何も描かない', () => {
    expect(planeLayer).toMatch(/preview\?\.kind === 'stair' &&/);
    expect(planeLayer).toMatch(/preview\?\.kind === 'pipe' &&/);
  });
});

describe('手摺・支柱・アンチのプレビューは従来どおり', () => {
  it('手摺は handrailPreview のまま（別の仕組みに移していない）', () => {
    expect(partSelector).toMatch(/setHandrailPreview\(\{\s*x: previewPos\.x, y: previewPos\.y,/);
    expect(read('components/canvas/GridCanvas.tsx')).toMatch(/\{handrailPreview && \(\(\) => \{/);
  });

  it('支柱はプレビュー無しのまま', () => {
    expect(partSelector).toMatch(/toolbarDrag\.type === 'post'[^]*?支柱はプレビューなし/);
  });

  it('障害物は obstaclePreview のまま', () => {
    expect(partSelector).toMatch(/setObstaclePreview\(\{/);
  });

  it('階段・単管のゴーストは手摺のプレビューを潰さない（別の入れ物）', () => {
    useCanvasStore.getState().setHandrailPreview({ x: 1, y: 2, lengthMm: 1800, direction: 'horizontal' });
    useCanvasStore.getState().setPlanePartPreview(stairGhostAt({ x: 0, y: 0 }, 0));
    expect(useCanvasStore.getState().handrailPreview).not.toBeNull();
    useCanvasStore.getState().setHandrailPreview(null);
  });
});
