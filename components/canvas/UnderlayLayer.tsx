'use client';

// ============================================================
// 下図の表示 (= U-1)。
//
// ■ 置き場所
// キャンバス背景 Rect の**すぐ上・グリッド線の下**。背景色は不透明なので、
// これより後ろに置くと隠れてしまう。グリッド線より下にしないと、
// 「グリッドが図面の通り芯に重なるか」を目で確かめられない。
// レイヤーは増やさない（E-6a-perf で静的な 2 層を 1 canvas に統合してある）。
// 出力で隠せるよう Group に名前を付けてある。
//
// ■ 読めなかったとき (= (c))
// 背景を描かないだけ。合わせ込みの情報は canvasData に残っているので、
// グリッドと足場は正常に見え、画像を入れ直せば同じ位置に戻る。
// 共有リンクで見ている人は物件の持ち主ではないため、RLS により画像を
// 取得できない。**そのときもここを通って「背景だけ出ない」になる**。
// ============================================================
import React, { useEffect, useState } from 'react';
import { Group, Image as KonvaImage } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import {
  getCachedUnderlayImage, loadUnderlayImage, type UnderlayLoadStatus,
} from '@/lib/underlay/underlayImage';

/** 出力時にここだけ隠せるようにするための名前。 */
export const UNDERLAY_GROUP_NAME = 'underlay-group';

export default function UnderlayLayer() {
  const underlay = useCanvasStore((s) => s.canvasData.underlay);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const setUnderlayStatus = useCanvasStore((s) => s.setUnderlayStatus);

  const path = underlay?.storagePath;
  // 既に取ってあれば最初の描画から出す（ページを戻ったときにちらつかない）。
  const [image, setImage] = useState<HTMLImageElement | null>(
    () => (path ? getCachedUnderlayImage(path) : null),
  );

  useEffect(() => {
    if (!path) { setImage(null); setUnderlayStatus('idle'); return; }
    const cached = getCachedUnderlayImage(path);
    if (cached) { setImage(cached); setUnderlayStatus('ready'); return; }

    let alive = true;
    setImage(null);
    setUnderlayStatus('loading');
    loadUnderlayImage(path)
      .then((img) => { if (alive) { setImage(img); setUnderlayStatus('ready'); } })
      .catch(() => {
        // 通信断・実体が消えている・共有で見ていて権限が無い、のいずれか。
        // 背景を出さないだけで、画面は壊さない。
        if (alive) { setImage(null); setUnderlayStatus('error'); }
      });
    return () => { alive = false; };
  }, [path, setUnderlayStatus]);

  if (!underlay || !image) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const t = underlay.transform;
  // 画像 1px → グリッド → 画面 px。原点は丸めずにそのまま画面へ乗せる。
  const scalePx = t.scale * gridPx;

  return (
    <Group
      name={UNDERLAY_GROUP_NAME}
      x={t.originGrid.x * gridPx + panX}
      y={t.originGrid.y * gridPx + panY}
      rotation={t.rotationDeg}
      scaleX={scalePx}
      scaleY={scalePx}
      opacity={underlay.opacity}
      listening={false}
    >
      <KonvaImage image={image} x={0} y={0} width={underlay.widthPx} height={underlay.heightPx} />
    </Group>
  );
}

export type { UnderlayLoadStatus };
