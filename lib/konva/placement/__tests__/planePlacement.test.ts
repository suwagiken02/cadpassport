// ============================================================
// P-2-fix: 平面部材が「シャドーは出るのに置けない」件。
//
// ■ 原因
// P-2 で配置処理を共通化したとき、抽出した placeAt の中に
//   if (canvasRect && toolbarDrag) { ... }
// という**ドラッグ状態への参照が残っていた**。placeAt は useCallback の依存が
// 安定だったため初回レンダーの toolbarDrag(=null) を永久に捕まえ、この条件は
// 常に偽。つまりクリックだけでなく**引き出しでも置けない**状態だった。
//
// ■ 直し方
// 配置とシャドーの処理をコンポーネントの外（このモジュール）へ出した。
// 渡るのは drag(何を置くか)と gridPos(どこへ置くか)だけなので、
// ドラッグ状態を参照しようがない＝同じ事故が構造的に起こらない。
//
// ここでは**実際にデータが増えること**を直接叩いて確かめる。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { clearPlanePreviews, placePlanePart, updatePlanePreview } from '../planePlacement';
import type { PlacePayload } from '@/components/toolbar/placePayload';
import type { CanvasData } from '@/types';

const st = () => useCanvasStore.getState();
const cv = () => useCanvasStore.getState().canvasData;

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** パレットで選べる平面部材ひととおり。 */
const PARTS: [name: string, payload: PlacePayload][] = [
  ['手摺', { type: 'handrail', lengthMm: 1800, direction: 'horizontal' }],
  ['支柱', { type: 'post' }],
  ['アンチ', { type: 'anti', lengthMm: 1800, direction: 'horizontal', antiWidth: 400 }],
  ['階段', { type: 'stair', angleDeg: 0, flip: false }],
  ['単管', { type: 'pipe', lengthMm: 5000, angleDeg: 45 }],
];

/** その部材が入る配列の本数。 */
const countOf = (payload: PlacePayload): number => {
  const d = cv();
  switch (payload.type) {
    case 'handrail': return d.handrails.length;
    case 'post': return d.posts.length;
    case 'anti': return d.antis.length;
    case 'stair': return (d.stairs ?? []).length;
    case 'pipe': return (d.pipes ?? []).length;
    default: return d.obstacles.length;
  }
};

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({ zoom: 1, panX: 0, panY: 0 });
  clearPlanePreviews();
});

describe('置けること（今回の不具合）', () => {
  it.each(PARTS)('%s が置ける（canvasData が増える）', (_name, payload) => {
    expect(countOf(payload)).toBe(0);
    placePlanePart(payload, { x: 100, y: 80 });
    expect(countOf(payload)).toBe(1);
  });

  it('続けて置ける（連続配置）', () => {
    for (let i = 0; i < 3; i++) {
      placePlanePart({ type: 'post' }, { x: i * 50, y: 0 });
    }
    expect(cv().posts).toHaveLength(3);
  });

  it('置いた場所に入る', () => {
    placePlanePart({ type: 'pipe', lengthMm: 5000, angleDeg: 45 }, { x: 37, y: 91 });
    expect(cv().pipes![0]).toMatchObject({ x: 37, y: 91, lengthMm: 5000, angleDeg: 45 });
  });

  it('選んだ寸法・向きがそのまま入る', () => {
    placePlanePart({ type: 'handrail', lengthMm: 900, direction: 'vertical' }, { x: 0, y: 0 });
    expect(cv().handrails[0]).toMatchObject({ lengthMm: 900, direction: 'vertical' });
    placePlanePart({ type: 'stair', angleDeg: 90, flip: true }, { x: 0, y: 0 });
    expect(cv().stairs![0]).toMatchObject({ angleDeg: 90, flip: true });
  });

  it('ドラッグでもクリックでも同じ関数なので、結果は同じ', () => {
    // 呼び出し元が違うだけで、通る処理は 1 本
    placePlanePart({ type: 'post' }, { x: 20, y: 30 });
    const fromDrag = { ...cv().posts[0] };
    st().setCanvasData(blank());
    placePlanePart({ type: 'post' }, { x: 20, y: 30 });
    const fromClick = { ...cv().posts[0] };
    expect({ x: fromClick.x, y: fromClick.y }).toEqual({ x: fromDrag.x, y: fromDrag.y });
  });

  it('ドラッグ状態を参照していない（今回の原因を構造で潰す）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../planePlacement.ts'), 'utf8');
    // コメント（事故の説明）は除いて、コードに残っていないことを見る
    const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/toolbarDrag/);
    expect(code).not.toMatch(/planeAddTool/);
  });
});

describe('吸着が効く', () => {
  it('支柱は手摺の端点へ吸着する', () => {
    st().setCanvasData({
      ...blank(),
      handrails: [{ id: 'h1', x: 100, y: 100, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
    } as CanvasData);
    placePlanePart({ type: 'post' }, { x: 102, y: 101 });
    expect(cv().posts[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('階段は手摺に辺が沿う', () => {
    st().setCanvasData({
      ...blank(),
      handrails: [{ id: 'h1', x: 0, y: 200, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
    } as CanvasData);
    placePlanePart({ type: 'stair', angleDeg: 0, flip: false }, { x: 30, y: 210 });
    expect(cv().stairs![0].y).toBe(200);
  });

  it('単管は吸着しない（置いた場所そのまま）', () => {
    placePlanePart({ type: 'pipe', lengthMm: 1000, angleDeg: 0 }, { x: 7, y: 13 });
    expect(cv().pipes![0]).toMatchObject({ x: 7, y: 13 });
  });
});

describe('シャドーが出る・消える', () => {
  it('部材ごとの入れ物にシャドーが入る', () => {
    updatePlanePreview({ type: 'handrail', lengthMm: 1800, direction: 'horizontal' }, { x: 10, y: 10 });
    expect(st().handrailPreview).not.toBeNull();

    updatePlanePreview({ type: 'post' }, { x: 10, y: 10 });
    expect(st().planePartPreview).toMatchObject({ kind: 'post' });

    updatePlanePreview({ type: 'stair', angleDeg: 0, flip: false }, { x: 10, y: 10 });
    expect(st().planePartPreview).toMatchObject({ kind: 'stair' });

    updatePlanePreview({ type: 'pipe', lengthMm: 5000, angleDeg: 45 }, { x: 10, y: 10 });
    expect(st().planePartPreview).toMatchObject({ kind: 'pipe' });
  });

  it('シャドーの位置と、置かれる位置が一致する（支柱）', () => {
    st().setCanvasData({
      ...blank(),
      handrails: [{ id: 'h1', x: 100, y: 100, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
    } as CanvasData);
    updatePlanePreview({ type: 'post' }, { x: 102, y: 101 });
    const ghost = st().planePartPreview as { kind: 'post'; x: number; y: number };
    placePlanePart({ type: 'post' }, { x: 102, y: 101 });
    expect({ x: cv().posts[0].x, y: cv().posts[0].y }).toEqual({ x: ghost.x, y: ghost.y });
  });

  it('シャドーの位置と、置かれる位置が一致する（階段）', () => {
    st().setCanvasData({
      ...blank(),
      handrails: [{ id: 'h1', x: 0, y: 200, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
    } as CanvasData);
    updatePlanePreview({ type: 'stair', angleDeg: 0, flip: false }, { x: 30, y: 210 });
    const ghost = st().planePartPreview as { kind: 'stair'; stair: { x: number; y: number } };
    placePlanePart({ type: 'stair', angleDeg: 0, flip: false }, { x: 30, y: 210 });
    expect({ x: cv().stairs![0].x, y: cv().stairs![0].y })
      .toEqual({ x: ghost.stair.x, y: ghost.stair.y });
  });

  it('キャンバスの外ではシャドーを出さない', () => {
    updatePlanePreview({ type: 'stair', angleDeg: 0, flip: false }, null);
    expect(st().planePartPreview).toBeNull();
    updatePlanePreview({ type: 'handrail', lengthMm: 1800, direction: 'horizontal' }, null);
    expect(st().handrailPreview).toBeNull();
  });

  it('まとめて消せる', () => {
    updatePlanePreview({ type: 'pipe', lengthMm: 5000, angleDeg: 45 }, { x: 0, y: 0 });
    clearPlanePreviews();
    expect(st().planePartPreview).toBeNull();
    expect(st().handrailPreview).toBeNull();
    expect(st().obstaclePreview).toBeNull();
    expect(st().snapPoint).toBeNull();
  });
});

describe('undo で戻せる', () => {
  it('置いたぶんを取り消せる', () => {
    placePlanePart({ type: 'post' }, { x: 10, y: 10 });
    expect(cv().posts).toHaveLength(1);
    st().undo();
    expect(cv().posts).toHaveLength(0);
  });
});
