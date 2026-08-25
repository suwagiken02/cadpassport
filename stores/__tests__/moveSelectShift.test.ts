// ============================================================
// まとめ移動が階段・単管・freeParts を動かさなかった件の回帰テスト。
//
// ■ 何が起きていたか
// 範囲選択・カテゴリ判定・パネルの全選択には P-1 / E-8-v5a の時点で登録されており、
// 選択件数にもちゃんと数えられていた。しかし**実際に座標をずらす
// shiftMoveSelected にだけ入っていなかった**ため、移動量を入れても 1mm も動かない。
// 単体移動（moveElement）は 3 種とも正常だったので、欠落はこの 1 箇所だけだった。
//
// ■ 決めたこと（実装前に確認済み）
//   ・移動後に接合スナップの再計算はしない（入れた数値どおりにきっちり動かす）
//   ・接続先が選択外でも、そのまま動かす（既存の手摺・支柱と同じ扱い）
//   ・Undo の粒度は現状のまま（1 回の移動 ＝ 1 回）
//   ・向き・長さ・所属階は触らない
//   ・カテゴリは「足場」のまま
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { newFreePart } from '@/lib/konva/freeParts';
import type { FreePart } from '@/lib/konva/freeParts';
import type { CanvasData } from '@/types';

const st = () => useCanvasStore.getState();
const cv = () => useCanvasStore.getState().canvasData;

const stairs = () => cv().stairs ?? [];
const pipes = () => cv().pipes ?? [];
const freeParts = () => (cv().freeParts ?? []) as FreePart[];

/** 全種をひととおり置いた図面。 */
const fixture = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [{
    id: 'b1', type: 'polygon', fill: '#3d3d3a',
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
  }],
  roofOverhangs: [],
  obstacles: [{ id: 'o1', type: 'aircon', x: 400, y: 400, width: 80, height: 30 }],
  handrails: [{ id: 'h1', x: 10, y: 10, lengthMm: 1800, direction: 'horizontal', color: '#000' }],
  posts: [{ id: 'p1', x: 20, y: 20 }],
  antis: [{ id: 'a1', x: 30, y: 30, width: 400, lengthMm: 1800, direction: 'horizontal' }],
  memos: [{ id: 'm1', x: 500, y: 500, text: 'メモ', style: 'rect' }],
  compass: { angle: 0 },
  stairs: [{ id: 'st1', x: 100, y: 100, angleDeg: 90, flip: true, floor: 2 }],
  pipes: [{ id: 'pp1', x: 200, y: 200, lengthMm: 3000, angleDeg: 45, floor: 2 }],
  freeParts: [
    newFreePart('rail', 'free:rail:1', { x: 300, y: 300 }, { sizeMm: 1800 }),
    newFreePart('post', 'free:post:1', { x: 350, y: 350 }, { komaCount: 4 }),
  ],
  sitePolygons: [{
    id: 'site:1',
    points: [{ x: -50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: 130 }, { x: -50, y: 130 }],
  }],
} as CanvasData);

const ALL_IDS = [
  'b1', 'o1', 'h1', 'p1', 'a1', 'm1', 'st1', 'pp1',
  'free:rail:1', 'free:post:1', 'site:1',
];

type Cats = { scaffold: boolean; building: boolean; obstacle: boolean; memo: boolean };
const ONLY_SCAFFOLD: Cats = { scaffold: true, building: false, obstacle: false, memo: false };

/**
 * まとめ移動を「カテゴリ選択 → 範囲選択 → 移動量入力」まで進める。
 * 実機のフロー（MoveSelectCategoryModal → MoveSelectRangePanel → MoveSelectMovePanel）と同じ順。
 */
const startMove = (ids: string[] = ALL_IDS, cats: Cats = ONLY_SCAFFOLD) => {
  const s = st();
  s.enterMoveSelectMode();
  s.setMoveSelectCategories(cats);
  s.confirmCategorySelection();
  s.setMoveSelectIds(ids);
  s.confirmRangeSelection();
};

beforeEach(() => {
  st().setCanvasData(fixture());
});

// ============================================================
describe('1. 回帰の本体: 階段・単管・freeParts が実際に動く', () => {
  it('階段が動く（動かなかったのが今回の不具合）', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(stairs()[0].x).toBe(200);
  });

  it('単管が動く', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(pipes()[0].x).toBe(300);
  });

  it('freeParts が動く', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(freeParts()[0].x0Mm).toBe(2100 + 1000);
  });

  it('3 種が同時に動く（1 回の操作でまとめて）', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect({
      stair: stairs()[0].x, pipe: pipes()[0].x, free: freeParts()[0].x0Mm,
    }).toEqual({ stair: 200, pipe: 300, free: 3100 });
  });

  it('手摺・支柱・アンチと一緒に動く（同じ足場カテゴリ）', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(cv().handrails[0].x).toBe(110);
    expect(cv().posts[0].x).toBe(120);
    expect(cv().antis[0].x).toBe(130);
    expect(stairs()[0].x).toBe(200);
  });
});

// ============================================================
describe('2. 移動量ぶんきっちり動く', () => {
  it('1000mm = 100 グリッド', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(stairs()[0].x - 100).toBe(100);
    expect(pipes()[0].x - 200).toBe(100);
  });

  it('X と Y の両方', () => {
    startMove();
    st().shiftMoveSelected(1000, 500);
    expect(stairs()[0]).toMatchObject({ x: 200, y: 150 });
    expect(pipes()[0]).toMatchObject({ x: 300, y: 250 });
  });

  it('負の値（左・上へ）', () => {
    startMove();
    st().shiftMoveSelected(-1000, -500);
    expect(stairs()[0]).toMatchObject({ x: 0, y: 50 });
  });

  it('小さい値（1mm = 0.1 グリッド）でも動く', () => {
    startMove();
    st().shiftMoveSelected(1, 0);
    expect(stairs()[0].x).toBeCloseTo(100.1, 6);
  });

  it('0 なら動かない', () => {
    startMove();
    st().shiftMoveSelected(0, 0);
    expect(stairs()[0].x).toBe(100);
    expect(freeParts()[0].x0Mm).toBe(2100);
  });

  it('接合スナップで吸い寄せられない（入れた数値どおり）', () => {
    // freeParts の 2 本は近接しているが、動かした先で吸着して位置が変わったりしない
    startMove();
    st().shiftMoveSelected(1234, 0);
    expect(freeParts()[0].x0Mm).toBe(2100 + 1234);
    expect(freeParts()[1].x0Mm).toBe(3500 + 1234);
  });
});

// ============================================================
describe('3. 選択していないものは動かない', () => {
  it('階段だけ選べば階段だけ動く', () => {
    startMove(['st1']);
    st().shiftMoveSelected(1000, 0);
    expect(stairs()[0].x).toBe(200);
    expect(pipes()[0].x).toBe(200);
    expect(freeParts()[0].x0Mm).toBe(2100);
    expect(cv().handrails[0].x).toBe(10);
  });

  it('単管だけ選べば単管だけ動く', () => {
    startMove(['pp1']);
    st().shiftMoveSelected(1000, 0);
    expect(pipes()[0].x).toBe(300);
    expect(stairs()[0].x).toBe(100);
  });

  it('freeParts は選んだ 1 本だけ動く', () => {
    startMove(['free:rail:1']);
    st().shiftMoveSelected(1000, 0);
    expect(freeParts()[0].x0Mm).toBe(3100);
    expect(freeParts()[1].x0Mm).toBe(3500);   // もう 1 本は据え置き
  });

  it('何も選ばなければ何も動かない', () => {
    // 読み込み時の正規化（版の更新・欠落フィールドの補完）を挟んだあとの状態を基準にする
    const before = JSON.stringify(cv());
    startMove([]);
    st().shiftMoveSelected(1000, 0);
    expect(JSON.stringify(cv())).toBe(before);
  });
});

// ============================================================
describe('4. 向き・長さ・所属階は変わらない', () => {
  it('階段の angleDeg / flip / floor', () => {
    startMove();
    st().shiftMoveSelected(1000, 500);
    expect(stairs()[0]).toMatchObject({ angleDeg: 90, flip: true, floor: 2 });
  });

  it('単管の angleDeg / lengthMm / floor', () => {
    startMove();
    st().shiftMoveSelected(1000, 500);
    expect(pipes()[0]).toMatchObject({ angleDeg: 45, lengthMm: 3000, floor: 2 });
  });

  it('id は変わらない（別物にすり替わらない）', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(stairs()[0].id).toBe('st1');
    expect(pipes()[0].id).toBe('pp1');
    expect(freeParts().map((p) => p.id)).toEqual(['free:rail:1', 'free:post:1']);
  });

  it('freeParts の kind・komaCount も変わらない', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(freeParts()[1]).toMatchObject({ kind: 'post', komaCount: 4 });
  });

  it('配列の並び・本数が変わらない', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(stairs()).toHaveLength(1);
    expect(pipes()).toHaveLength(1);
    expect(freeParts()).toHaveLength(2);
  });
});

// ============================================================
describe('5. freeParts の座標系（mm・Y 上向き・X は 2 値）', () => {
  it('x0Mm と x1Mm が同じだけ動く（部材が伸縮しない）', () => {
    startMove();
    const before = freeParts()[0];
    const len = before.x1Mm! - before.x0Mm!;
    st().shiftMoveSelected(1000, 0);
    const after = freeParts()[0];
    expect(after.x0Mm).toBe(before.x0Mm! + 1000);
    expect(after.x1Mm).toBe(before.x1Mm! + 1000);
    expect(after.x1Mm! - after.x0Mm!).toBe(len);
  });

  it('下へ動かすと levelMm は減る（Y が上向きなので符号が反転する）', () => {
    startMove();
    const before = freeParts()[0].levelMm!;
    st().shiftMoveSelected(0, 500);        // 画面の下へ 500mm
    expect(freeParts()[0].levelMm).toBe(before - 500);
  });

  it('上へ動かすと levelMm は増える', () => {
    startMove();
    const before = freeParts()[0].levelMm!;
    st().shiftMoveSelected(0, -500);
    expect(freeParts()[0].levelMm).toBe(before + 500);
  });

  it('X だけ動かせば高さは変わらない', () => {
    startMove();
    const before = freeParts()[0].levelMm;
    st().shiftMoveSelected(1000, 0);
    expect(freeParts()[0].levelMm).toBe(before);
  });

  it('支柱（1 点もの）でも x0Mm と x1Mm が揃って動く', () => {
    startMove();
    const before = freeParts()[1];
    st().shiftMoveSelected(1000, 0);
    const after = freeParts()[1];
    expect(after.x0Mm).toBe(before.x0Mm! + 1000);
    expect(after.x1Mm).toBe(before.x1Mm! + 1000);
    expect(after.x0Mm).toBe(after.x1Mm);
  });
});

// ============================================================
describe('6. カテゴリを外したら動かない', () => {
  it('足場のチェックを外すと 3 種とも動かない', () => {
    startMove(ALL_IDS, { scaffold: false, building: true, obstacle: false, memo: false });
    st().shiftMoveSelected(1000, 0);
    expect(stairs()[0].x).toBe(100);
    expect(pipes()[0].x).toBe(200);
    expect(freeParts()[0].x0Mm).toBe(2100);
  });

  it('そのとき建物・敷地は動く（カテゴリの切り分けが効いている）', () => {
    startMove(ALL_IDS, { scaffold: false, building: true, obstacle: false, memo: false });
    st().shiftMoveSelected(1000, 0);
    expect(cv().buildings[0].points[0].x).toBe(100);
    expect(cv().sitePolygons![0].points[0].x).toBe(50);
  });

  it('足場だけ入れれば建物・障害物・メモは動かない', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(cv().buildings[0].points[0].x).toBe(0);
    expect(cv().obstacles[0].x).toBe(400);
    expect(cv().memos[0].x).toBe(500);
  });
});

// ============================================================
describe('7. 絶対シフト（累積しない）', () => {
  it('1000 → 2000 と入れ直しても、backup から 2000 の位置', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    st().shiftMoveSelected(2000, 0);
    expect(stairs()[0].x).toBe(100 + 200);
    expect(pipes()[0].x).toBe(200 + 200);
    expect(freeParts()[0].x0Mm).toBe(2100 + 2000);
  });

  it('大きくしてから小さくしても正しい位置に戻る', () => {
    startMove();
    st().shiftMoveSelected(5000, 0);
    st().shiftMoveSelected(1000, 0);
    expect(stairs()[0].x).toBe(200);
    expect(freeParts()[0].x0Mm).toBe(3100);
  });

  it('0 に戻せば元の位置', () => {
    startMove();
    st().shiftMoveSelected(3000, 2000);
    st().shiftMoveSelected(0, 0);
    expect(stairs()[0]).toMatchObject({ x: 100, y: 100 });
    expect(freeParts()[0].x0Mm).toBe(2100);
    expect(freeParts()[0].levelMm).toBe(-3000);
  });

  it('何度動かしても部材が伸縮しない（累積の取りこぼしが無い）', () => {
    startMove();
    for (const mm of [1000, 3000, -2000, 500]) st().shiftMoveSelected(mm, 0);
    const p = freeParts()[0];
    expect(p.x1Mm! - p.x0Mm!).toBe(1800);
  });
});

// ============================================================
describe('8. キャンセルで元に戻る', () => {
  it('3 種とも移動前の位置へ戻る', () => {
    startMove();
    st().shiftMoveSelected(3000, 2000);
    st().cancelMoveSelectMode();
    expect(stairs()[0]).toMatchObject({ x: 100, y: 100 });
    expect(pipes()[0]).toMatchObject({ x: 200, y: 200 });
    expect(freeParts()[0]).toMatchObject({ x0Mm: 2100, x1Mm: 3900, levelMm: -3000 });
  });

  it('図面全体が移動前とまったく同じに戻る', () => {
    const before = JSON.stringify(cv());
    startMove();
    st().shiftMoveSelected(3000, 2000);
    st().cancelMoveSelectMode();
    expect(JSON.stringify(cv())).toBe(before);
  });

  it('確定すれば動いたまま残る', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    st().commitMoveSelectMode();
    expect(stairs()[0].x).toBe(200);
    expect(pipes()[0].x).toBe(300);
    expect(freeParts()[0].x0Mm).toBe(3100);
  });
});

// ============================================================
describe('9. 既存の対象の挙動は変わらない（不変の固定）', () => {
  it('手摺・支柱・アンチ', () => {
    startMove();
    st().shiftMoveSelected(1000, 500);
    expect(cv().handrails[0]).toMatchObject({ x: 110, y: 60 });
    expect(cv().posts[0]).toMatchObject({ x: 120, y: 70 });
    expect(cv().antis[0]).toMatchObject({ x: 130, y: 80 });
  });

  it('手摺の長さ・向き・色は変わらない', () => {
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(cv().handrails[0]).toMatchObject({ lengthMm: 1800, direction: 'horizontal', color: '#000' });
  });

  it('建物（全頂点がずれる）', () => {
    startMove(ALL_IDS, { scaffold: false, building: true, obstacle: false, memo: false });
    st().shiftMoveSelected(1000, 500);
    expect(cv().buildings[0].points).toEqual([
      { x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 130 }, { x: 100, y: 130 },
    ]);
  });

  it('敷地（建物カテゴリ・全頂点がずれる）', () => {
    startMove(ALL_IDS, { scaffold: false, building: true, obstacle: false, memo: false });
    st().shiftMoveSelected(1000, 0);
    expect(cv().sitePolygons![0].points[0]).toEqual({ x: 50, y: -50 });
  });

  it('障害物', () => {
    startMove(ALL_IDS, { scaffold: false, building: false, obstacle: true, memo: false });
    st().shiftMoveSelected(1000, 0);
    expect(cv().obstacles[0]).toMatchObject({ x: 500, y: 400 });
  });

  it('メモ', () => {
    startMove(ALL_IDS, { scaffold: false, building: false, obstacle: false, memo: true });
    st().shiftMoveSelected(1000, 0);
    expect(cv().memos[0]).toMatchObject({ x: 600, y: 500 });
  });

  it('全カテゴリを入れれば全部が同じだけ動く', () => {
    startMove(ALL_IDS, { scaffold: true, building: true, obstacle: true, memo: true });
    st().shiftMoveSelected(1000, 0);
    expect(cv().handrails[0].x).toBe(110);
    expect(cv().buildings[0].points[0].x).toBe(100);
    expect(cv().obstacles[0].x).toBe(500);
    expect(cv().memos[0].x).toBe(600);
    expect(stairs()[0].x).toBe(200);
    expect(pipes()[0].x).toBe(300);
    expect(freeParts()[0].x0Mm).toBe(3100);
  });

  it('図面の骨格（版・グリッド・方位）は触らない', () => {
    const version = cv().version;   // 読み込み時の正規化で決まる版
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(cv().version).toBe(version);
    expect(cv().grid).toEqual({ unitMm: 10, cols: 600, rows: 400 });
    expect(cv().compass).toEqual({ angle: 0 });
  });
});

// ============================================================
describe('freeParts は自動生成→手動へ変わる（単体ドラッグと同じ扱い）', () => {
  // moveFreePart（＝ movePart）は origin を 'manual' にし、支柱では
  // segmentIndex を落として komaCount を確定させる。動かした時点で
  // 「足場の再生成に追従しない自由な 1 本」になるという元々の設計で、
  // まとめ移動でも同じ扱いにすると決めた。後から分かるようここで固定する。

  /** 自動生成された立面部材（origin='auto'・段の番号つき）を 1 本混ぜた図面。 */
  const withAutoPart = (): CanvasData => ({
    ...fixture(),
    freeParts: [
      { ...newFreePart('rail', 'free:auto:1', { x: 300, y: 300 }, { sizeMm: 1800 }), origin: 'auto' },
      { ...newFreePart('post', 'free:auto:2', { x: 350, y: 350 }, { komaCount: 4 }),
        origin: 'auto', segmentIndex: 1 },
    ] as FreePart[],
  } as CanvasData);

  beforeEach(() => {
    st().setCanvasData(withAutoPart());
  });

  it('動かすと origin が manual になる', () => {
    expect(freeParts()[0].origin).toBe('auto');
    startMove(['free:auto:1']);
    st().shiftMoveSelected(1000, 0);
    expect(freeParts()[0].origin).toBe('manual');
  });

  it('支柱は segmentIndex が外れ、komaCount が確定する', () => {
    startMove(['free:auto:2']);
    st().shiftMoveSelected(1000, 0);
    const post = freeParts()[1];
    expect(post.segmentIndex).toBeUndefined();
    expect(post.komaCount).toBe(4);
  });

  it('動かしていない部材の origin は変わらない', () => {
    startMove(['free:auto:1']);
    st().shiftMoveSelected(1000, 0);
    expect(freeParts()[1].origin).toBe('auto');
    expect(freeParts()[1].segmentIndex).toBe(1);
  });

  it('キャンセルすれば origin も元に戻る', () => {
    startMove(['free:auto:1']);
    st().shiftMoveSelected(1000, 0);
    st().cancelMoveSelectMode();
    expect(freeParts()[0].origin).toBe('auto');
  });

  it('階段・単管には origin の概念が無い（余計な項目が増えない）', () => {
    st().setCanvasData(fixture());
    startMove();
    st().shiftMoveSelected(1000, 0);
    expect(Object.keys(stairs()[0]).sort())
      .toEqual(['angleDeg', 'flip', 'floor', 'id', 'x', 'y']);
    expect(Object.keys(pipes()[0]).sort())
      .toEqual(['angleDeg', 'floor', 'id', 'lengthMm', 'x', 'y']);
  });
});
