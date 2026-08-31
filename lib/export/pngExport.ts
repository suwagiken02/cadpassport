import Konva from 'konva';
import { withAidsHidden } from './aidVisibility';
import { withUnderlayVisibility } from './underlayVisibility';
import { whenUnderlayReady } from '@/lib/underlay/underlayImage';
import { useCanvasStore } from '@/stores/canvasStore';

export const exportToPng = async (
  siteName: string, opts?: { includeAids?: boolean; includeUnderlay?: boolean },
): Promise<void> => {
  const stages = Konva.stages;
  if (stages.length === 0) return;

  const stage = stages[0];
  // U-1: 下図の画像が読み込み中だと背景の無い絵になる。待ってから撮る。
  await whenUnderlayReady(useCanvasStore.getState().canvasData.underlay?.storagePath);
  // E-8-v5c: 補助線を含めないときは、画像化の間だけ隠す（終わったら必ず戻る）。
  // U-1: 下図も同じくキャプチャの間だけ表示を合わせる（既定は含める）。
  const dataUrl = await withAidsHidden(opts?.includeAids, async () =>
    withUnderlayVisibility(opts?.includeUnderlay, async () =>
      stage.toDataURL({ pixelRatio: 3 })));

  const link = document.createElement('a');
  link.download = `${siteName || '図面'}_平面図.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
