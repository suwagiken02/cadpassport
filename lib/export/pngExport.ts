import Konva from 'konva';
import { withAidsHidden } from './aidVisibility';

export const exportToPng = async (
  siteName: string, opts?: { includeAids?: boolean },
): Promise<void> => {
  const stages = Konva.stages;
  if (stages.length === 0) return;

  const stage = stages[0];
  // E-8-v5c: 補助線を含めないときは、画像化の間だけ隠す（終わったら必ず戻る）。
  const dataUrl = await withAidsHidden(opts?.includeAids, async () =>
    stage.toDataURL({ pixelRatio: 3 }));

  const link = document.createElement('a');
  link.download = `${siteName || '図面'}_平面図.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
