// ============================================================
// S-2: 敷地の方向入力に斜め 8 方向と角度指定を足す。
//
// ■ いちばん大事な制約
// 拡張が効くのは**敷地（pendingTargetType === 'site'）のときだけ**。
// 躯体・屋根は 4 方向・傾きなしのまま。平面の絶対原則「建物と足場は必ず平行」を
// 壊さないため、ここが崩れると図面そのものが成立しなくなる。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { PAD_DIRS_4, PAD_DIRS_DIAGONAL, stepEndpoint } from '@/lib/konva/directionStep';
import type { CanvasData, Point } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const modal = read('components/building/DirectionInputModal.tsx');
const pad = read('components/canvas/DirectionPad.tsx');
const gridCanvas = read('components/canvas/GridCanvas.tsx');

const st = () => useCanvasStore.getState();
const sites = () => useCanvasStore.getState().canvasData.sitePolygons ?? [];

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

beforeEach(() => {
  st().setCanvasData(blank());
  st().clearDirectionPoints();
  useCanvasStore.setState({ pendingTargetType: 'building' });
});

// ============================================================
describe('斜めが出るのは敷地のときだけ', () => {
  it('方向パッドは diagonal を渡されたときだけ斜めを出す', () => {
    expect(pad).toMatch(/const dirs = diagonal \? PAD_DIRS_8 : PAD_DIRS_4;/);
  });

  it('diagonal は pendingTargetType === \'site\' のときだけ true', () => {
    expect(gridCanvas).toMatch(/diagonal=\{pendingTargetType === 'site'\}/);
  });

  it('躯体・屋根で斜めが出る書き方になっていない（常時 true や roof も含む条件が無い）', () => {
    expect(gridCanvas).not.toMatch(/diagonal=\{true\}/);
    expect(gridCanvas).not.toMatch(/diagonal=\{pendingTargetType !== /);
    expect(gridCanvas).not.toMatch(/diagonal=\{[^}]*'roof'[^}]*\}/);
  });

  it('diagonal を渡さなければ 4 方向のまま（既定が広がっていない）', () => {
    // 省略時は undefined → falsy → PAD_DIRS_4
    expect(pad).toMatch(/diagonal\?: boolean;/);
    expect(pad).not.toMatch(/diagonal = true/);
  });
});

// ============================================================
describe('角度 UI が出るのは敷地のときだけ', () => {
  it('傾きの出し分けは pendingTargetType === \'site\' で決まる', () => {
    expect(modal).toMatch(/const canTilt = pendingTargetType === 'site' && !pendingDirectionTarget;/);
  });

  it('傾き UI は canTilt のときだけ描く', () => {
    expect(modal).toMatch(/\{canTilt && \([^]*?data-testid="tilt-controls"/);
  });

  it('躯体・屋根では傾きが必ず 0 になる（計算に渡らない）', () => {
    expect(modal).toMatch(/const effectiveTiltDeg = canTilt \? clampTiltDeg\(tiltDeg\) : 0;/);
    expect(modal).toMatch(/stepEndpoint\(currentLast, pendingDirection, distanceMm, effectiveTiltDeg, tiltSide\)/);
  });

  it('交点タップのときは傾きを出さない（座標が決まっているので意味がない）', () => {
    expect(modal).toContain('!pendingDirectionTarget');
  });

  it('傾きは 1 区間ごとに 0 に戻る（モーダルの中に持つ）', () => {
    expect(modal).toMatch(/const \[tiltDeg, setTiltDeg\] = useState\(0\);/);
    // ストアに持たせていない＝前の区間の傾きが next に持ち越されない
    expect(modal).not.toMatch(/setTiltDegStore|store.*tiltDeg/);
  });

  it('現在の方向表示に傾きも出る', () => {
    expect(modal).toMatch(/tiltSide === 'left' \? '左' : '右'/);
    expect(modal).toMatch(/effectiveTiltDeg > 0 &&/);
  });

  it('角度プリセットが距離プリセットと同じ作法で並ぶ', () => {
    expect(modal).toMatch(/TILT_PRESET_DEG\.map/);
    // 距離プリセットと同じクラス構成（見た目をそろえる）
    expect(modal).toMatch(/TILT_PRESET_DEG\.map[^]*?rounded text-xs font-mono border/);
  });

  it('小数が入る入力欄を使っている', () => {
    expect(modal).toMatch(/<NumInput value=\{tiltDeg\}/);
  });
});

// ============================================================
describe('躯体・屋根の出力は従来と変わらない', () => {
  /** 変更前の 4 方向の計算そのもの。 */
  const legacy = (from: Point, dir: string, mm: number): Point => {
    const d = mm / 10;
    const p = { ...from };
    if (dir === 'up') p.y -= d;
    if (dir === 'down') p.y += d;
    if (dir === 'left') p.x -= d;
    if (dir === 'right') p.x += d;
    return p;
  };

  it('躯体の四角形（↑→↓←）が 1 ミリも変わらない', () => {
    const seq = [['up', 3000], ['right', 4000], ['down', 3000], ['left', 4000]] as const;
    let cur: Point = { x: 10, y: 20 };
    let legacyCur: Point = { x: 10, y: 20 };
    for (const [dir, mm] of seq) {
      // 躯体は傾きが必ず 0 で渡る
      cur = stepEndpoint(cur, dir, mm, 0, 'left');
      legacyCur = legacy(legacyCur, dir, mm);
      expect(cur).toEqual(legacyCur);
    }
    expect(cur).toEqual({ x: 10, y: 20 });   // 元の位置に戻る
  });

  it('屋根の領域も同じ（対象が違うだけで計算は同じ 1 本）', () => {
    for (const dir of PAD_DIRS_4) {
      expect(stepEndpoint({ x: 0, y: 0 }, dir, 1800, 0, 'right'))
        .toEqual(legacy({ x: 0, y: 0 }, dir, 1800));
    }
  });
});

// ============================================================
describe('敷地で斜め・傾きの境界を描くと、その座標が入る', () => {
  /** モーダルと同じ手順で 1 区間ぶん進める。 */
  const step = (dir: Parameters<typeof stepEndpoint>[1], mm: number, tilt = 0, side: 'left' | 'right' = 'left') => {
    const s = useCanvasStore.getState();
    const pts = s.directionPoints;
    const last = s.directionCursor ?? pts[pts.length - 1];
    s.addDirectionPoint(stepEndpoint(last, dir, mm, tilt, side));
  };

  /** 描き終わり（S-1 の確定と同じ）。 */
  const finish = () => {
    const s = useCanvasStore.getState();
    s.addSitePolygon({ id: 'site:1', points: [...s.directionPoints] });
    s.clearDirectionPoints();
  };

  beforeEach(() => {
    useCanvasStore.setState({ pendingTargetType: 'site' });
    st().addDirectionPoint({ x: 0, y: 0 });
  });

  it('斜め 45° の菱形が入り、始点へ戻ってくる', () => {
    step('upRight', 1000);
    step('downRight', 1000);
    step('downLeft', 1000);
    finish();

    const pts = sites()[0].points;
    expect(pts).toHaveLength(4);
    const r = 100 / Math.SQRT2;
    expect(pts[1].x).toBeCloseTo(r, 3);
    expect(pts[1].y).toBeCloseTo(-r, 3);
    expect(pts[2].x).toBeCloseTo(2 * r, 3);
    expect(pts[2].y).toBeCloseTo(0, 3);
    expect(pts[3].x).toBeCloseTo(r, 3);
    expect(pts[3].y).toBeCloseTo(r, 3);
  });

  it('斜めでも「始点の近くに戻ったら自動確定」の判定が効く距離まで戻る', () => {
    step('upRight', 1000);
    step('downRight', 1000);
    step('downLeft', 1000);
    const s = useCanvasStore.getState();
    const pts = s.directionPoints;
    const back = stepEndpoint(pts[pts.length - 1], 'upLeft', 1000);
    // S-1 の自動確定条件（3 点以上 かつ 始点まで 2 グリッド未満）
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(Math.hypot(back.x - pts[0].x, back.y - pts[0].y)).toBeLessThan(2);
  });

  it('↑ を左に 5° 傾けた境界の座標が入る', () => {
    step('up', 3000, 5, 'left');
    step('right', 2000);
    finish();

    const pts = sites()[0].points;
    expect(pts[1].x).toBeCloseTo(-300 * Math.sin((5 * Math.PI) / 180), 3);
    expect(pts[1].y).toBeCloseTo(-300 * Math.cos((5 * Math.PI) / 180), 3);
    // 傾きは 1 区間ごとに 0 へ戻るので、2 本目は真横のまま
    expect(pts[2].y).toBe(pts[1].y);
    expect(pts[2].x).toBeCloseTo(pts[1].x + 200, 6);
  });

  it('↑ を右に 10° 傾けると逆側へ寄る', () => {
    step('up', 3000, 10, 'right');
    finish();
    expect(sites()[0].points[1].x).toBeGreaterThan(0);
  });

  it('傾き 0 の敷地は従来どおり直角に描ける', () => {
    step('up', 3000);
    step('right', 4000);
    step('down', 3000);
    finish();
    expect(sites()[0].points).toEqual([
      { x: 0, y: 0 }, { x: 0, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 0 },
    ]);
  });

  it('描いた敷地はデータ構造を変えずに入る（S-1 の自由座標のまま）', () => {
    step('upRight', 1500, 12.5, 'left');
    finish();
    const site = sites()[0];
    expect(Object.keys(site).sort()).toEqual(['id', 'points']);
    expect(site.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('斜め 4 方向すべてで境界が引ける', () => {
    for (const dir of PAD_DIRS_DIAGONAL) {
      st().clearDirectionPoints();
      st().addDirectionPoint({ x: 0, y: 0 });
      step(dir, 2000);
      const p = useCanvasStore.getState().directionPoints[1];
      expect(Math.hypot(p.x, p.y), dir).toBeCloseTo(200, 3);
    }
  });
});
