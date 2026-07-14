// 屋根形状確定時の棟線処理（E-3.14 共通化）。RoofSettingsModal / BuildingTemplateModal / 2F配置 で共用。
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { generateCenterRidgeLine } from '@/lib/konva/elevation/ridgeProjection';
import type { Point } from '@/types';
import type { RoofShape } from './RoofShapeSelector';

/**
 * 屋根形状に応じて棟線を用意/削除する（全て pushHistory 経由・undo 可）。
 *  ・寄棟(自動): 既存棟線を置換して中央棟線を生成 → 直後に高さ入力モーダル。
 *  ・寄棟(手動): 既存棟線は維持し、棟ツールを起動。
 *  ・切妻/水平/片流れ: 棟線を削除。
 */
export function applyRoofShapeRidge(
  buildingId: string,
  points: Point[],
  roofShape: RoofShape,
  hipMode: 'auto' | 'manual',
): void {
  const s = useCanvasStore.getState();
  if (roofShape === 'hip') {
    if (hipMode === 'auto') {
      s.removeRidgeLinesForBuilding(buildingId);
      const { p1, p2 } = generateCenterRidgeLine(points);
      const id = uuidv4();
      s.addRidgeLine({ id, buildingId, p1, p2, heightMm: s.lastRidgeInputMm });
      s.setRidgeInputLineId(id);
    } else {
      s.setRidgeLineMode(true);
    }
  } else {
    s.removeRidgeLinesForBuilding(buildingId);
  }
}
