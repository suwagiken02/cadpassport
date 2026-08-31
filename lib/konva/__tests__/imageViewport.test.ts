// ============================================================
// U-1 commit 3-fix: 下図の画像の拡大・移動と、誤差の基準。
//
// ■ なぜ要るか
// 画面に収まるよう縮小表示しただけでは、寸法線の端を狙ってクリックできない。
// A3 の図面（4000px 幅）を 700px で表示すると、**表示上の 1px が図面の 5.7px**。
// これは見た目の問題ではなく精度の問題で、推定誤差の計算も狂う。
//
// ■ 誤差の基準
// 人が狙うときにずれるのは「画像の画素」ではなく「表示上の px」。
// 表示倍率で画像の画素へ直してから見積もる。拡大すれば誤差は小さくなる。
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  IMAGE_VIEW_BUTTON_STEP, IMAGE_VIEW_DRAG_PX, IMAGE_VIEW_MAX_SCALE, IMAGE_VIEW_MIN_SCALE,
  IMAGE_VIEW_WHEEL_STEP, fitView, imagePxToView, panView, viewToImagePx, zoomAbout,
  type ImageView,
} from '../imageViewport';
import {
  UNDERLAY_CLICK_ERROR_PX, UNDERLAY_MIN_CALIB_PX,
  canCalibrate, clickErrorImagePx, estimatedErrorMm, imageSpanMm,
} from '../underlay';

const v = (scale: number, tx = 0, ty = 0): ImageView => ({ scale, tx, ty });

// ============================================================
describe('全体を表示する', () => {
  it('はみ出す側で決まる（狭い方に合わせる）', () => {
    // 4000x2827（縦横比 1.41）を 700x400（1.75）の枠へ → 枠の方が横に広いので高さで決まる
    const f = fitView(4000, 2827, 700, 400);
    expect(f.scale).toBeCloseTo(400 / 2827, 9);
    // 枠を縦長にすれば幅で決まる
    expect(fitView(4000, 2827, 700, 900).scale).toBeCloseTo(700 / 4000, 9);
  });

  it('縦長の画像は高さで決まる', () => {
    const f = fitView(2000, 4000, 700, 400);
    expect(f.scale).toBeCloseTo(400 / 4000, 9);
  });

  it('中央に寄る', () => {
    const f = fitView(4000, 2827, 700, 400);
    expect(f.ty).toBeCloseTo(0, 6);                       // 高さぴったり
    expect(f.tx).toBeCloseTo((700 - 4000 * f.scale) / 2, 6);
    expect(f.tx).toBeGreaterThan(0);                      // 左右に余白ができる
  });

  it('大きさが取れないときは等倍', () => {
    expect(fitView(0, 0, 700, 400)).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(fitView(4000, 3000, 0, 0)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });
});

// ============================================================
describe('カーソルを中心に拡大する', () => {
  it('カーソルの下にある点は動かない', () => {
    const before = v(0.175, 10, 20);
    const cx = 300, cy = 150;
    const imgBefore = viewToImagePx(before, cx, cy)!;
    const after = zoomAbout(before, 2, cx, cy);
    const imgAfter = viewToImagePx(after, cx, cy)!;
    expect(imgAfter.x).toBeCloseTo(imgBefore.x, 6);
    expect(imgAfter.y).toBeCloseTo(imgBefore.y, 6);
  });

  it('倍率が掛かる', () => {
    expect(zoomAbout(v(0.5), 2, 0, 0).scale).toBeCloseTo(1, 9);
    expect(zoomAbout(v(1), 0.5, 0, 0).scale).toBeCloseTo(0.5, 9);
  });

  it('上限・下限で止まる', () => {
    expect(zoomAbout(v(IMAGE_VIEW_MAX_SCALE), 10, 0, 0).scale).toBe(IMAGE_VIEW_MAX_SCALE);
    expect(zoomAbout(v(IMAGE_VIEW_MIN_SCALE), 0.01, 0, 0).scale).toBe(IMAGE_VIEW_MIN_SCALE);
  });

  it('止まったら位置も動かさない（端でじりじりずれない）', () => {
    const at = v(IMAGE_VIEW_MAX_SCALE, 33, 44);
    expect(zoomAbout(at, 10, 100, 100)).toBe(at);
  });

  it('ホイールとボタンの刻み', () => {
    expect(IMAGE_VIEW_WHEEL_STEP).toBeGreaterThan(1);
    expect(IMAGE_VIEW_BUTTON_STEP).toBeGreaterThan(IMAGE_VIEW_WHEEL_STEP);
  });
});

// ============================================================
describe('移動と座標の往復', () => {
  it('平行移動する', () => {
    expect(panView(v(2, 10, 20), 5, -7)).toEqual({ scale: 2, tx: 15, ty: 13 });
  });

  it('コンテナ座標 ⇔ 画像の画素が往復する', () => {
    for (const view of [v(1), v(0.175, 10, 20), v(4.7, -300, -900)]) {
      for (const p of [{ x: 0, y: 0 }, { x: 1234, y: 567 }]) {
        const c = imagePxToView(view, p.x, p.y);
        const back = viewToImagePx(view, c.x, c.y)!;
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('打った点は拡大・移動しても図面上の同じ位置を指す', () => {
    // 画像の画素で保持しているので、ビューが変わっても値は変わらない
    const p = { x: 2500, y: 1800 };
    const a = imagePxToView(v(0.175, 0, 0), p.x, p.y);
    const b = imagePxToView(v(2, -400, -900), p.x, p.y);
    expect(a).not.toEqual(b);                       // 画面上の位置は変わるが
    expect(viewToImagePx(v(0.175, 0, 0), a.x, a.y)!.x).toBeCloseTo(p.x, 6);
    expect(viewToImagePx(v(2, -400, -900), b.x, b.y)!.x).toBeCloseTo(p.x, 6);
  });

  it('倍率ゼロでは変換しない', () => {
    expect(viewToImagePx(v(0), 10, 10)).toBeNull();
  });

  it('ドラッグ判定はゴーストと同じ 6px', () => {
    expect(IMAGE_VIEW_DRAG_PX).toBe(6);
  });
});

// ============================================================
describe('クリック誤差の基準は「表示上の px」', () => {
  it('既定は表示上の 1.5px', () => {
    expect(UNDERLAY_CLICK_ERROR_PX).toBe(1.5);
  });

  it('縮小表示では、画像の画素で見た誤差が大きくなる', () => {
    // 4000px を 700px で表示 → 倍率 0.175
    expect(clickErrorImagePx(700 / 4000)).toBeCloseTo(1.5 / 0.175, 6);
    expect(clickErrorImagePx(700 / 4000)).toBeCloseTo(8.571, 3);
  });

  it('原寸表示ならそのまま', () => {
    expect(clickErrorImagePx(1)).toBe(1.5);
  });

  it('拡大すれば小さくなる', () => {
    expect(clickErrorImagePx(4)).toBeCloseTo(0.375, 9);
  });

  it('倍率が取れないときは無限大（＝確定させない）', () => {
    expect(clickErrorImagePx(0)).toBe(Infinity);
  });
});

// ============================================================
describe('同じ 2 点でも、表示倍率が変われば推定誤差が変わる', () => {
  // A3 の図面（4000x2827px）で 4550mm の寸法線を 1000px ぶん取った場合
  const natW = 4000, natH = 2827;
  const distPx = 1000;
  const scale = 4550 / 10 / distPx;                 // グリッド/px
  const spanMm = imageSpanMm(natW, natH, scale);

  const errAt = (displayScale: number) =>
    estimatedErrorMm(distPx, spanMm, clickErrorImagePx(displayScale));

  it('縮小表示のままだと大きく出る', () => {
    const shrunk = errAt(700 / 4000);
    expect(shrunk).toBeGreaterThan(100);
  });

  it('原寸まで拡大すると小さくなる', () => {
    expect(errAt(1)).toBeLessThan(errAt(700 / 4000));
  });

  it('さらに拡大するともっと小さくなる（単調に減る）', () => {
    const seq = [0.175, 0.5, 1, 2, 4].map(errAt);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThan(seq[i - 1]);
  });

  it('倍率に反比例する', () => {
    expect(errAt(0.175) / errAt(1)).toBeCloseTo(1 / 0.175, 6);
    expect(errAt(1) / errAt(4)).toBeCloseTo(4, 6);
  });

  it('直したことで、縮小表示の見積もりが約 5.7 倍きびしくなった', () => {
    // 直す前は表示倍率を無視して 1.5px 固定で計算していた
    const oldWay = estimatedErrorMm(distPx, spanMm, UNDERLAY_CLICK_ERROR_PX);
    expect(errAt(700 / 4000) / oldWay).toBeCloseTo(4000 / 700, 6);
  });

  it('原寸表示なら、直す前と同じ値になる（等倍では違いが出ない）', () => {
    expect(errAt(1)).toBeCloseTo(estimatedErrorMm(distPx, spanMm, UNDERLAY_CLICK_ERROR_PX), 9);
  });
});

// ============================================================
describe('500px のしきい値は「画像の画素」', () => {
  it('画像の画素で測る（表示倍率に依らない）', () => {
    expect(UNDERLAY_MIN_CALIB_PX).toBe(500);
    // canCalibrate に渡すのは画像の画素の座標
    expect(canCalibrate({ x: 0, y: 0 }, { x: 499, y: 0 })).toBe(false);
    expect(canCalibrate({ x: 0, y: 0 }, { x: 501, y: 0 })).toBe(true);
  });

  it('拡大しても縮小しても判定は変わらない（点は画像の画素で持つため）', () => {
    // 同じ 2 点を、どの倍率で打っても値は同じ
    const p1 = { x: 100, y: 100 }, p2 = { x: 900, y: 100 };
    for (const s of [0.1, 1, 8]) {
      const a = viewToImagePx(v(s), imagePxToView(v(s), p1.x, p1.y).x, imagePxToView(v(s), p1.x, p1.y).y)!;
      const b = viewToImagePx(v(s), imagePxToView(v(s), p2.x, p2.y).x, imagePxToView(v(s), p2.x, p2.y).y)!;
      expect(canCalibrate(a, b), `scale ${s}`).toBe(true);
    }
  });
});
