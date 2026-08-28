// ============================================================
// U-1 commit 1: 下図の合わせ込みの計算とデータ。
//
// この機能の目的は「背景に絵を敷く」ことではなく、**図面の 1800mm とグリッドの
// 1800mm をぴったり重ねる**こと。合っていないと、グリッド交点に吸着する割付部材が
// 実際の壁の位置に乗らず、背景がきれいでも使い物にならない。
//
// ここでいちばん大事なのは 2 つ:
//   ・値を丸めないこと（グリッドは 10mm 刻み。丸めると最初から最大 5mm の誤差が入り、
//     2 点合わせで出した 7mm 前後の精度が台無しになる）
//   ・既存の図面が 1 ミリも変わらないこと
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  GRID_MAJOR_STEP, UNDERLAY_CLICK_ERROR_PX, UNDERLAY_DEFAULT_OPACITY, UNDERLAY_MAX_BYTES,
  UNDERLAY_MAX_LONG_EDGE_PX, UNDERLAY_MIN_CALIB_PX,
  calibrateFromTwoPoints, calibrationRotationDeg, canCalibrate, clampOpacity,
  estimatedErrorMm, fitToMaxLongEdge, gridToImage, guessOrientation, identityTransform,
  imageDistancePx, imageSpanMm, imageToGrid, misalignmentMm, nearestMajorIntersection,
  originForAnchor, translateTransform, underlayDrawingPrefix, underlayProjectPrefix,
  underlayStoragePath, type UnderlayTransform,
} from '../underlay';
import { GRID_UNIT_MM } from '../gridUtils';
import type { CanvasData, Point, Underlay } from '@/types';

const st = () => useCanvasStore.getState();
const cv = () => useCanvasStore.getState().canvasData;

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

const t = (over: Partial<UnderlayTransform> = {}): UnderlayTransform => ({
  ...identityTransform(), ...over,
} as UnderlayTransform);

const underlay = (over: Partial<Underlay> = {}): Underlay => ({
  id: 'u1',
  storagePath: 'u/p/d/u1.jpg',
  widthPx: 3000, heightPx: 2000,
  transform: t({ scale: 0.5, rotationDeg: 0, originGrid: { x: 0, y: 0 } }),
  opacity: UNDERLAY_DEFAULT_OPACITY,
  ...over,
});

// ============================================================
describe('2 点と実寸から、拡大率と回転が決まる', () => {
  it('水平な寸法線: 縮尺が出て、回転は 0', () => {
    // 画像 1000px が実寸 4550mm
    const r = calibrateFromTwoPoints({ x: 100, y: 200 }, { x: 1100, y: 200 }, 4550)!;
    expect(r.scale).toBe(4550 / GRID_UNIT_MM / 1000);
    expect(r.rotationDeg).toBe(0);
    expect(r.orientation).toBe('horizontal');
  });

  it('縮尺は「画像 1px が何グリッドか」', () => {
    const r = calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 500, y: 0 }, 5000)!;
    // 5000mm = 500 グリッドを 500px で見ている → 1px = 1 グリッド
    expect(r.scale).toBe(1);
  });

  it('傾いた寸法線は、水平になるぶんだけ回る', () => {
    // 右下がり 30°（画面座標）→ -30° 回せば水平になる
    const p2 = { x: 100 + Math.cos(Math.PI / 6) * 1000, y: 200 + Math.sin(Math.PI / 6) * 1000 };
    const r = calibrateFromTwoPoints({ x: 100, y: 200 }, p2, 4550, 'horizontal')!;
    expect(r.rotationDeg).toBeCloseTo(-30, 9);
  });

  it('縦の寸法線は 90° 側へ寄せる', () => {
    const r = calibrateFromTwoPoints({ x: 100, y: 100 }, { x: 100, y: 1100 }, 4550, 'vertical')!;
    expect(r.rotationDeg).toBe(0);   // すでに真下向き＝垂直
  });

  it('少し傾いた縦の寸法線', () => {
    // 真下(90°)から 5° 右へ倒れている線 → +5° 回すと垂直になる
    const p2 = { x: 100 + Math.sin(Math.PI / 36) * 1000, y: 100 + Math.cos(Math.PI / 36) * 1000 };
    const r = calibrateFromTwoPoints({ x: 100, y: 100 }, p2, 4550, 'vertical')!;
    expect(r.rotationDeg).toBeCloseTo(5, 6);
    // 合わせたあとは真下を向く（x が揃う）
    const tr = { kind: 'similarity' as const, scale: r.scale, rotationDeg: r.rotationDeg,
      originGrid: { x: 0, y: 0 } };
    const a2 = imageToGrid({ x: 100, y: 100 }, tr), b2 = imageToGrid(p2, tr);
    expect(b2.x - a2.x).toBeCloseTo(0, 9);
  });

  it('2 点をどちらの順で押しても同じ結果（180° ひっくり返らない）', () => {
    const a = { x: 100, y: 200 };
    const b = { x: 1100, y: 260 };
    const f = calibrateFromTwoPoints(a, b, 4550, 'horizontal')!;
    const r = calibrateFromTwoPoints(b, a, 4550, 'horizontal')!;
    expect(r.scale).toBe(f.scale);
    expect(r.rotationDeg).toBeCloseTo(f.rotationDeg, 9);
  });

  it('回転量は常に小さい方を選ぶ（±90° を超えない）', () => {
    for (const deg of [0, 30, 80, 100, 170, -30, -100, -170]) {
      const r = (deg * Math.PI) / 180;
      const p2 = { x: Math.cos(r) * 1000, y: Math.sin(r) * 1000 };
      const got = calibrationRotationDeg({ x: 0, y: 0 }, p2, 'horizontal');
      expect(Math.abs(got), `${deg}`).toBeLessThanOrEqual(90.0001);
    }
  });

  it('距離ゼロ・実寸ゼロでは決まらない', () => {
    expect(calibrateFromTwoPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 4550)).toBeNull();
    expect(calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBeNull();
    expect(calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, -1)).toBeNull();
  });

  it('位置は決まらない（2 点は長さと向きしか与えない）', () => {
    const r = calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 1000, y: 0 }, 4550)!;
    expect(Object.keys(r).sort()).toEqual(['orientation', 'rotationDeg', 'scale']);
  });
});

// ============================================================
describe('向きの自動推定（修正3）', () => {
  it('横に長ければ横', () => {
    expect(guessOrientation({ x: 0, y: 0 }, { x: 1000, y: 100 })).toBe('horizontal');
  });

  it('縦に長ければ縦', () => {
    expect(guessOrientation({ x: 0, y: 0 }, { x: 100, y: 1000 })).toBe('vertical');
  });

  it('ちょうど 45° は縦（|dx| > |dy| ではないため）', () => {
    expect(guessOrientation({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe('vertical');
  });

  it('押した順に依らない', () => {
    const a = { x: 0, y: 0 }, b = { x: 1000, y: 100 };
    expect(guessOrientation(b, a)).toBe(guessOrientation(a, b));
  });

  it('指定があればそちらが優先される（推定が違ったら切り替えられる）', () => {
    const p1 = { x: 0, y: 0 }, p2 = { x: 1000, y: 100 };
    expect(calibrateFromTwoPoints(p1, p2, 4550)!.orientation).toBe('horizontal');
    expect(calibrateFromTwoPoints(p1, p2, 4550, 'vertical')!.orientation).toBe('vertical');
  });

  it('向きを変えると回転も変わる', () => {
    const p1 = { x: 0, y: 0 }, p2 = { x: 1000, y: 100 };
    const h = calibrateFromTwoPoints(p1, p2, 4550, 'horizontal')!.rotationDeg;
    const v = calibrateFromTwoPoints(p1, p2, 4550, 'vertical')!.rotationDeg;
    expect(Math.abs(h - v)).toBeCloseTo(90, 6);
  });
});

// ============================================================
describe('値を丸めない（修正2・いちばん大事）', () => {
  it('縮尺を丸めない', () => {
    // 割り切れない値。丸めていれば必ず落ちる
    const r = calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 777, y: 0 }, 4550)!;
    expect(r.scale).toBe(4550 / 10 / 777);
    expect(Number.isInteger(r.scale)).toBe(false);
    expect(r.scale.toString()).toContain('.');
  });

  it('回転を丸めない', () => {
    const p2 = { x: 1000, y: 37 };
    const deg = calibrationRotationDeg({ x: 0, y: 0 }, p2, 'horizontal');
    expect(deg).toBe(-(Math.atan2(37, 1000) * 180) / Math.PI);
    expect(Number.isInteger(deg)).toBe(false);
  });

  it('原点をグリッド単位にも整数にも丸めない', () => {
    // 丸めると最大 5mm（0.5 グリッド）の誤差が最初から入る
    const o = originForAnchor({ x: 333, y: 777 }, { x: 12.34, y: -56.78 }, 0.1234, 7.89);
    expect(Number.isInteger(o.x)).toBe(false);
    expect(Number.isInteger(o.y)).toBe(false);
    // 端数がグリッドの刻みに乗っていない＝丸めていない証拠
    expect(o.x % 1).not.toBe(0);
  });

  it('原点は狙った点にぴったり乗る（誤差 0.001 グリッド＝0.01mm 未満）', () => {
    const img = { x: 1234, y: 567 };
    const target = { x: 98.765, y: -43.21 };
    const scale = 0.0731, rot = 12.3456;
    const o = originForAnchor(img, target, scale, rot);
    const back = imageToGrid(img, t({ scale, rotationDeg: rot, originGrid: o }));
    expect(back.x).toBeCloseTo(target.x, 9);
    expect(back.y).toBeCloseTo(target.y, 9);
  });

  it('平行移動でも丸めない', () => {
    const moved = translateTransform(t({ originGrid: { x: 1.5, y: 2.25 } }), { x: 0.125, y: -0.0625 });
    expect(moved.originGrid).toEqual({ x: 1.625, y: 2.1875 });
  });

  it('保存する値も丸めない（ストアを通しても端数が残る）', () => {
    st().setCanvasData(blank());
    const tr = t({ scale: 0.0731, rotationDeg: 12.3456, originGrid: { x: 1.111, y: -2.222 } });
    st().setUnderlay(underlay({ transform: tr }));
    expect(cv().underlay!.transform).toEqual(tr);
  });
});

// ============================================================
describe('画像座標 ⇔ グリッド座標', () => {
  it('原点は原点へ', () => {
    expect(imageToGrid({ x: 0, y: 0 }, t({ originGrid: { x: 10, y: 20 } })))
      .toEqual({ x: 10, y: 20 });
  });

  it('拡大率が効く', () => {
    expect(imageToGrid({ x: 100, y: 200 }, t({ scale: 0.5 }))).toEqual({ x: 50, y: 100 });
  });

  it('90° 回すと軸が入れ替わる', () => {
    const p = imageToGrid({ x: 100, y: 0 }, t({ rotationDeg: 90 }));
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(100, 9);
  });

  it('往復して元に戻る（どの変換でも）', () => {
    for (const tr of [
      t(), t({ scale: 0.0731 }), t({ rotationDeg: 12.3456 }),
      t({ scale: 0.0731, rotationDeg: -37.5, originGrid: { x: -12.5, y: 88.25 } }),
    ]) {
      for (const p of [{ x: 0, y: 0 }, { x: 1234, y: 567 }, { x: -50, y: 900 }]) {
        const back = gridToImage(imageToGrid(p, tr), tr);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('距離の比が拡大率どおり（形が歪まない）', () => {
    const tr = t({ scale: 0.25, rotationDeg: 33 });
    const a = imageToGrid({ x: 0, y: 0 }, tr);
    const b = imageToGrid({ x: 300, y: 400 }, tr);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(500 * 0.25, 9);
  });
});

// ============================================================
describe('合わせたあとのずれの確認（3 点目）', () => {
  it('ぴったり合っていれば 0mm', () => {
    // 画像 (1000,1000) を主線の交点 (100,100) に載せる
    const o = originForAnchor({ x: 1000, y: 1000 }, { x: 100, y: 100 }, 0.1, 0);
    const m = misalignmentMm({ x: 1000, y: 1000 }, t({ scale: 0.1, originGrid: o }));
    expect(m.distanceMm).toBeCloseTo(0, 6);
  });

  it('ずれていれば mm で出る', () => {
    // 主線の交点から 0.5 グリッド＝5mm ずらす
    const tr = t({ scale: 0.1, originGrid: { x: 0.5, y: 0 } });
    const m = misalignmentMm({ x: 1000, y: 1000 }, tr);
    expect(m.dxMm).toBeCloseTo(5, 6);
    expect(m.distanceMm).toBeCloseTo(5, 6);
  });

  it('いちばん近い主線の交点を相手にする（1000mm ごと）', () => {
    expect(GRID_MAJOR_STEP).toBe(100);      // 100 グリッド = 1000mm
    expect(nearestMajorIntersection({ x: 149, y: 151 })).toEqual({ x: 100, y: 200 });
    expect(nearestMajorIntersection({ x: -149, y: -151 })).toEqual({ x: -100, y: -200 });
  });

  it('X と Y のずれを別々に返す（どちら向きにずれているか分かる）', () => {
    const m = misalignmentMm({ x: 0, y: 0 }, t({ originGrid: { x: 0.3, y: -0.4 } }));
    expect(m.dxMm).toBeCloseTo(3, 6);
    expect(m.dyMm).toBeCloseTo(-4, 6);
    expect(m.distanceMm).toBeCloseTo(5, 6);
  });
});

// ============================================================
describe('2 点が近すぎるときの判定と、推定誤差', () => {
  it('500px 未満は確定させない', () => {
    expect(UNDERLAY_MIN_CALIB_PX).toBe(500);
    expect(canCalibrate({ x: 0, y: 0 }, { x: 499, y: 0 })).toBe(false);
    expect(canCalibrate({ x: 0, y: 0 }, { x: 500, y: 0 })).toBe(true);
  });

  it('距離を返す（1 点目の後に見せる）', () => {
    expect(imageDistancePx({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe(500);
  });

  it('推定誤差が「離すほど小さくなる」', () => {
    const a = estimatedErrorMm(500, 20000);
    const b = estimatedErrorMm(1500, 20000);
    const c = estimatedErrorMm(2800, 20000);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('先に出した見積もりと一致する（2800px で 20m 先が約 11mm）', () => {
    expect(estimatedErrorMm(2800, 20000)).toBeCloseTo(10.7, 1);
    expect(estimatedErrorMm(1500, 20000)).toBeCloseTo(20, 0);
    expect(estimatedErrorMm(500, 20000)).toBeCloseTo(60, 0);
    expect(estimatedErrorMm(100, 20000)).toBeCloseTo(300, 0);
  });

  it('クリック誤差の既定は 1.5px', () => {
    expect(UNDERLAY_CLICK_ERROR_PX).toBe(1.5);
  });

  it('距離ゼロでは無限大（＝確定させない）', () => {
    expect(estimatedErrorMm(0, 20000)).toBe(Infinity);
  });

  it('図面の対角の実寸が出る（「反対側」の目安）', () => {
    // 3000x4000px を 1px=1グリッド で見ると対角 5000 グリッド = 50000mm
    expect(imageSpanMm(3000, 4000, 1)).toBeCloseTo(50000, 6);
  });
});

// ============================================================
describe('画像の縮小（アップロードの前に行う）', () => {
  it('上限以下ならそのまま', () => {
    expect(fitToMaxLongEdge(3000, 2000)).toEqual({ width: 3000, height: 2000, scaled: false });
  });

  it('長辺が上限を超えたら比を保って縮める', () => {
    const r = fitToMaxLongEdge(6000, 3000);
    expect(r.scaled).toBe(true);
    expect(r.width).toBe(UNDERLAY_MAX_LONG_EDGE_PX);
    expect(r.height).toBe(2000);
  });

  it('縦長でも長辺で判定する', () => {
    const r = fitToMaxLongEdge(3000, 6000);
    expect(r.height).toBe(UNDERLAY_MAX_LONG_EDGE_PX);
    expect(r.width).toBe(2000);
  });

  it('スマホ写真（4000x3000）はそのまま通る', () => {
    expect(fitToMaxLongEdge(4000, 3000).scaled).toBe(false);
  });

  it('A3/300dpi のスキャン（4960x3508）は縮む', () => {
    const r = fitToMaxLongEdge(4960, 3508);
    expect(r.scaled).toBe(true);
    expect(r.width).toBe(4000);
  });

  it('1px 未満にならない', () => {
    expect(fitToMaxLongEdge(10000, 1).height).toBeGreaterThanOrEqual(1);
  });

  it('上限の値', () => {
    expect(UNDERLAY_MAX_LONG_EDGE_PX).toBe(4000);
    expect(UNDERLAY_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

// ============================================================
describe('濃さ', () => {
  it('既定は 50%（足場が見やすいよう薄め）', () => {
    expect(UNDERLAY_DEFAULT_OPACITY).toBe(0.5);
  });

  it('範囲に収める（10〜100%）', () => {
    expect(clampOpacity(0)).toBe(0.1);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(0.75)).toBe(0.75);
  });

  it('おかしな値は既定へ', () => {
    expect(clampOpacity(NaN)).toBe(UNDERLAY_DEFAULT_OPACITY);
  });
});

// ============================================================
describe('保存する場所（公開 URL を持たない）', () => {
  it('1 段目がユーザー（RLS の判定に使う）', () => {
    expect(underlayStoragePath('u1', 'p1', 'd1', 'x1', 'jpg')).toBe('u1/p1/d1/x1.jpg');
  });

  it('物件・ページごとに一括で消せるプレフィックス', () => {
    expect(underlayProjectPrefix('u1', 'p1')).toBe('u1/p1');
    expect(underlayDrawingPrefix('u1', 'p1', 'd1')).toBe('u1/p1/d1');
  });

  it('保存するのはパスだけ（公開 URL を持たない）', () => {
    expect(Object.keys(underlay()).sort())
      .toEqual(['heightPx', 'id', 'opacity', 'storagePath', 'transform', 'widthPx']);
  });

  it('画像そのものは canvasData に入らない（軽い）', () => {
    st().setCanvasData(blank());
    st().setUnderlay(underlay());
    // 数百バイト。数 MB になっていたら pushHistory が重くなる
    expect(JSON.stringify(cv().underlay!).length).toBeLessThan(500);
  });
});

// ============================================================
describe('変換の入れ物（第二弾で差し替えられる）', () => {
  it('kind を持つ', () => {
    expect(identityTransform().kind).toBe('similarity');
  });

  it('保存しても kind が残る（後から射影変換を足せる）', () => {
    st().setCanvasData(blank());
    st().setUnderlay(underlay());
    expect(cv().underlay!.transform.kind).toBe('similarity');
  });
});

// ============================================================
describe('ストア', () => {
  beforeEach(() => { st().setCanvasData(blank()); });

  it('入れられる', () => {
    st().setUnderlay(underlay());
    expect(cv().underlay!.id).toBe('u1');
  });

  it('外すと参照が消える', () => {
    st().setUnderlay(underlay());
    st().setUnderlay(null);
    expect(cv().underlay).toBeUndefined();
    expect('underlay' in cv()).toBe(false);
  });

  it('合わせ込みだけ更新できる（画像はそのまま）', () => {
    st().setUnderlay(underlay());
    const tr = t({ scale: 0.25, rotationDeg: 3.5, originGrid: { x: 1.5, y: -2.5 } });
    st().setUnderlayTransform(tr);
    expect(cv().underlay!.transform).toEqual(tr);
    expect(cv().underlay!.storagePath).toBe('u/p/d/u1.jpg');   // 画像は据え置き
  });

  it('濃さを変えられる', () => {
    st().setUnderlay(underlay());
    st().setUnderlayOpacity(0.8);
    expect(cv().underlay!.opacity).toBe(0.8);
  });

  it('濃さは範囲に収まる', () => {
    st().setUnderlay(underlay());
    st().setUnderlayOpacity(5);
    expect(cv().underlay!.opacity).toBe(1);
  });

  it('下図が無ければ何もしない', () => {
    st().setUnderlayTransform(t({ scale: 9 }));
    st().setUnderlayOpacity(0.9);
    expect(cv().underlay).toBeUndefined();
  });

  it('undo で戻る（入れる・外す・合わせ直す）', () => {
    st().setUnderlay(underlay());
    st().setUnderlayTransform(t({ scale: 0.25 }));
    st().undo();
    expect(cv().underlay!.transform.scale).toBe(0.5);
    st().undo();
    expect(cv().underlay).toBeUndefined();
  });

  it('濃さの変更は履歴を積まない（スライダーで連続的に呼ばれるため）', () => {
    st().setUnderlay(underlay());
    const n = st().history.past.length;
    st().setUnderlayOpacity(0.6);
    st().setUnderlayOpacity(0.7);
    expect(st().history.past.length).toBe(n);
  });

  it('保存が必要な状態になる', () => {
    st().setUnderlay(underlay());
    useCanvasStore.setState({ isDirty: false });
    st().setUnderlayOpacity(0.6);
    expect(st().isDirty).toBe(true);
  });
});

// ============================================================
describe('既存の図面が 1 ミリも変わらない', () => {
  it('下図を持たない図面をそのまま読める', () => {
    const legacy = blank();
    expect('underlay' in legacy).toBe(false);
    st().setCanvasData(legacy);
    expect(cv().underlay).toBeUndefined();
  });

  it('保存済みの下図は読み込みで消えない', () => {
    st().setCanvasData({ ...blank(), underlay: underlay() } as CanvasData);
    expect(cv().underlay!.id).toBe('u1');
  });

  it('他のフィールドは 1 つも変わらない', () => {
    const legacy = {
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon' as const, points: [{ x: 0, y: 0 }], fill: '#3d3d3a' }],
      handrails: [{ id: 'h1', x: 1, y: 2, lengthMm: 1800, direction: 'horizontal' as const, color: '#000' }],
    } as CanvasData;
    st().setCanvasData(legacy);
    expect(cv().buildings).toEqual(legacy.buildings);
    expect(cv().handrails).toEqual(legacy.handrails);
  });

  it('下図を入れても他の配列は変わらない', () => {
    st().setCanvasData({
      ...blank(),
      buildings: [{ id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#3d3d3a' }],
    } as CanvasData);
    const before = JSON.stringify(cv().buildings);
    st().setUnderlay(underlay());
    expect(JSON.stringify(cv().buildings)).toBe(before);
  });
});

// ============================================================
describe('実際の図面での通し（合わせ込みが成立する）', () => {
  it('4550mm の寸法線で合わせ、建物の角をグリッド交点へ置く', () => {
    // A3 相当・長辺 4000px の図面。寸法線 4550mm が 1000px で写っている
    const p1: Point = { x: 500, y: 300 };
    const p2: Point = { x: 1500, y: 300 };
    const c = calibrateFromTwoPoints(p1, p2, 4550)!;

    // 図面上の建物の角 (800, 1200) を、グリッドの主線の交点 (100,100) に置く
    const origin = originForAnchor({ x: 800, y: 1200 }, { x: 100, y: 100 }, c.scale, c.rotationDeg);
    const tr = t({ scale: c.scale, rotationDeg: c.rotationDeg, originGrid: origin });

    // その角はぴったり交点に乗る
    expect(misalignmentMm({ x: 800, y: 1200 }, tr).distanceMm).toBeCloseTo(0, 6);

    // 寸法線の実寸が図面どおりに再現される
    const a = imageToGrid(p1, tr), b = imageToGrid(p2, tr);
    expect(Math.hypot(b.x - a.x, b.y - a.y) * GRID_UNIT_MM).toBeCloseTo(4550, 6);
  });

  it('傾いて写った図面でも、合わせれば壁がグリッドと平行になる', () => {
    // 2° 傾いて写っている水平の寸法線
    const r = (2 * Math.PI) / 180;
    const p1 = { x: 0, y: 0 };
    const p2 = { x: Math.cos(r) * 2000, y: Math.sin(r) * 2000 };
    const c = calibrateFromTwoPoints(p1, p2, 9100)!;
    const tr = t({ scale: c.scale, rotationDeg: c.rotationDeg, originGrid: { x: 0, y: 0 } });
    const a = imageToGrid(p1, tr), b = imageToGrid(p2, tr);
    // 合わせたあとは水平（y が揃う）
    expect(b.y - a.y).toBeCloseTo(0, 9);
  });
});
