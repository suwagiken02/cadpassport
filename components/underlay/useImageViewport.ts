'use client';

// ============================================================
// 下図の画像を拡大・移動して見るための配線 (= U-1 commit 3-fix)。
//
// 計算そのものは lib/konva/imageViewport.ts（pure）。ここは
// ポインタの取り回しだけを持つ。
//
// ・ホイール … カーソルを中心に拡大・縮小
// ・ドラッグ … 移動。**6px 動いたらドラッグ**（S-9 のゴーストと同じ作法）。
//              動かさずに離したら「点を打つ」クリックとして扱う
// ・2 本指 … ピンチで拡大（中点を中心に）。1 本指はドラッグと同じ
// マウスもタッチも pointer イベント 1 本で受けるので、経路が二重にならない。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IMAGE_VIEW_BUTTON_STEP, IMAGE_VIEW_DRAG_PX, IMAGE_VIEW_WHEEL_STEP,
  fitView, panView, viewToImagePx, zoomAbout, type ImageView,
} from '@/lib/konva/imageViewport';
import type { Point } from '@/types';

type Args = {
  naturalWidth: number;
  naturalHeight: number;
  /** 動かさずに離したとき（＝点を打つ）。画像の画素で受け取る。 */
  onPick: (imagePoint: Point) => void;
};

export function useImageViewport({ naturalWidth, naturalHeight, onPick }: Args) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ImageView>({ scale: 1, tx: 0, ty: 0 });

  /** 押している指（ポインタ id → コンテナ座標）。 */
  const pointers = useRef(new Map<number, Point>());
  const pressStart = useRef<Point | null>(null);
  const dragged = useRef(false);
  /** ピンチ開始時の 2 指の距離。 */
  const pinchDist = useRef<number | null>(null);

  const containerPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  /** 画像全体を表示する。 */
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setView(fitView(naturalWidth, naturalHeight, el.clientWidth, el.clientHeight));
  }, [naturalWidth, naturalHeight]);

  // 画像が変わったら全体表示から始める
  useEffect(() => { fit(); }, [fit]);

  /** ボタンでの拡大・縮小（コンテナの中心を軸に）。 */
  const zoomByButton = useCallback((inward: boolean) => {
    const el = containerRef.current;
    if (!el) return;
    setView((v) => zoomAbout(
      v, inward ? IMAGE_VIEW_BUTTON_STEP : 1 / IMAGE_VIEW_BUTTON_STEP,
      el.clientWidth / 2, el.clientHeight / 2,
    ));
  }, []);

  // ホイール。React の onWheel は passive になり preventDefault が効かないので、
  //   ページごとスクロールしないよう非 passive で直接付ける。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = containerPoint(e.clientX, e.clientY);
      if (!p) return;
      setView((v) => zoomAbout(v, e.deltaY < 0 ? IMAGE_VIEW_WHEEL_STEP : 1 / IMAGE_VIEW_WHEEL_STEP, p.x, p.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerPoint]);

  const onPointerDown = (e: React.PointerEvent) => {
    const p = containerPoint(e.clientX, e.clientY);
    if (!p) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      pressStart.current = p;
      dragged.current = false;
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchDist.current = Math.hypot(b.x - a.x, b.y - a.y);
      // 2 本目が乗った時点で「点を打つ」ではなくなる
      dragged.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = containerPoint(e.clientX, e.clientY);
    if (!p || !pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values());
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const base = pinchDist.current;
      if (base && base > 0 && d > 0) {
        setView((v) => zoomAbout(v, d / base, (a.x + b.x) / 2, (a.y + b.y) / 2));
        pinchDist.current = d;
      }
      return;
    }

    if (pressStart.current && !dragged.current) {
      const moved = Math.hypot(p.x - pressStart.current.x, p.y - pressStart.current.y);
      if (moved > IMAGE_VIEW_DRAG_PX) dragged.current = true;
    }
    if (dragged.current) setView((v) => panView(v, p.x - prev.x, p.y - prev.y));
  };

  const endPointer = (e: React.PointerEvent) => {
    const p = containerPoint(e.clientX, e.clientY);
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;

    // 動かさずに離した＝点を打つ
    if (wasSingle && !dragged.current && p) {
      setView((v) => {
        const img = viewToImagePx(v, p.x, p.y);
        if (img && img.x >= 0 && img.y >= 0 && img.x <= naturalWidth && img.y <= naturalHeight) {
          onPick(img);
        }
        return v;   // 表示は変えない
      });
    }
    if (pointers.current.size === 0) { pressStart.current = null; dragged.current = false; }
  };

  /** 表示の倍率（画像 1px が画面何 px か）。誤差の見積もりに使う。 */
  const displayScale = view.scale;

  return {
    containerRef, view, displayScale, fit, zoomByButton,
    handlers: {
      onPointerDown, onPointerMove,
      onPointerUp: endPointer, onPointerCancel: endPointer,
    },
  };
}
