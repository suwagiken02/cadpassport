'use client';

// ============================================================
// 下図の画像を拡大・移動して見るための配線 (= U-1 commit 3-fix / fix2)。
//
// 計算そのものは lib/konva/imageViewport.ts、入力の取り付けは
// lib/underlay/viewportGestures.ts（どちらも pure・テスト可能）。ここは
// 「いまの表示」と「指の本数」を持って両者をつなぐだけ。
//
// ■ 取り付けは callback ref で行う (= fix2)
// 画像のコンテナは「画像を選んだあと」にしか描かれない。ふつうの useRef ＋
// マウント時の useEffect だと、**要素がまだ無い時点で 1 回走って終わり**になり、
// listener が一度も付かない（実際にホイールが効かなかった原因）。
// callback ref で要素を state に持てば、描かれた時点で必ず取り付け直せる。
//
// ・ホイール … カーソルを中心に拡大・縮小
// ・ドラッグ … 移動。**6px 動いたらドラッグ**（S-9 のゴーストと同じ作法）。
//              動かさずに離したら「点を打つ」クリックとして扱う
// ・2 本指 … ピンチで拡大（中点を中心に）。1 本指はドラッグと同じ
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IMAGE_VIEW_BUTTON_STEP, IMAGE_VIEW_DRAG_PX,
  fitView, panView, viewToImagePx, zoomAbout, type ImageView,
} from '@/lib/konva/imageViewport';
import {
  attachViewportGestures, type GestureCallbacks, type PointerLike,
} from '@/lib/underlay/viewportGestures';
import type { Point } from '@/types';

type Args = {
  naturalWidth: number;
  naturalHeight: number;
  /** 動かさずに離したとき（＝点を打つ）。画像の画素で受け取る。 */
  onPick: (imagePoint: Point) => void;
};

export function useImageViewport({ naturalWidth, naturalHeight, onPick }: Args) {
  /** コンテナの実体。**ref ではなく state** に持つ（描かれた時点で effect を回すため）。 */
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => setNode(node), []);

  const [view, setView] = useState<ImageView>({ scale: 1, tx: 0, ty: 0 });

  /** 押している指（ポインタ id → コンテナ座標）。 */
  const pointers = useRef(new Map<number, Point>());
  const pressStart = useRef<Point | null>(null);
  const dragged = useRef(false);
  /** ピンチ開始時の 2 指の距離。 */
  const pinchDist = useRef<number | null>(null);

  /** 画面座標 → コンテナ座標。 */
  const toLocal = useCallback((clientX: number, clientY: number): Point | null => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, [node]);

  /** 画像全体が入るように戻す。 */
  const fit = useCallback(() => {
    if (!node) return;
    setView(fitView(naturalWidth, naturalHeight, node.clientWidth, node.clientHeight));
  }, [node, naturalWidth, naturalHeight]);

  // 画像が変わったとき・コンテナが現れたときに全体表示から始める。
  useEffect(() => { fit(); }, [fit]);

  /** ボタンでの拡大・縮小（コンテナの中心を軸に）。 */
  const zoomByButton = useCallback((inward: boolean) => {
    if (!node) return;
    setView((v) => zoomAbout(
      v, inward ? IMAGE_VIEW_BUTTON_STEP : 1 / IMAGE_VIEW_BUTTON_STEP,
      node.clientWidth / 2, node.clientHeight / 2,
    ));
  }, [node]);

  /**
   * 取り付けるハンドラ。毎レンダー作り直しても取り付けをやり直さないよう、
   * ref に最新版を置いて、取り付けは要素が変わったときだけにする。
   */
  const cbRef = useRef<GestureCallbacks | null>(null);
  cbRef.current = {
    onWheelZoom: (factor, clientX, clientY) => {
      const p = toLocal(clientX, clientY);
      if (p) setView((v) => zoomAbout(v, factor, p.x, p.y));
    },

    onPointerDown: (e: PointerLike) => {
      const p = toLocal(e.clientX, e.clientY);
      if (!p) return;
      pointers.current.set(e.pointerId, p);
      if (pointers.current.size === 1) {
        pressStart.current = p;
        dragged.current = false;
        // 枠の外へ出ても追えるよう捕まえる（指 1 本のときだけ）。
        node?.setPointerCapture?.(e.pointerId);
      } else if (pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values());
        pinchDist.current = Math.hypot(b.x - a.x, b.y - a.y);
        // 2 本目が乗ったら「点を打つ」ではなくなる。
        dragged.current = true;
        // 捕まえたままだと、端末によっては 2 本目の指が届かない。ピンチの間は放す。
        for (const id of Array.from(pointers.current.keys())) {
          try { node?.releasePointerCapture?.(id); } catch { /* 捕まえていなければ何もしない */ }
        }
      }
    },

    onPointerMove: (e: PointerLike) => {
      const p = toLocal(e.clientX, e.clientY);
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
    },

    onPointerEnd: (e: PointerLike) => {
      const p = toLocal(e.clientX, e.clientY);
      const wasSingle = pointers.current.size === 1;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinchDist.current = null;
      try { node?.releasePointerCapture?.(e.pointerId); } catch { /* 捕まえていなければ何もしない */ }

      // 動かさずに離した＝点を打つ。
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
    },
  };

  // 取り付け。**要素そのものに依存する**ので、描かれた時点で必ず付く。
  useEffect(() => attachViewportGestures(node, {
    onWheelZoom: (f, x, y) => cbRef.current?.onWheelZoom(f, x, y),
    onPointerDown: (e) => cbRef.current?.onPointerDown(e),
    onPointerMove: (e) => cbRef.current?.onPointerMove(e),
    onPointerEnd: (e) => cbRef.current?.onPointerEnd(e),
  }), [node]);

  return {
    containerRef, view, displayScale: view.scale, fit, zoomByButton,
    /** 取り付けは native 側で行うので、JSX には何も渡さない（passive を避けるため）。 */
    handlers: {} as Record<string, never>,
  };
}
