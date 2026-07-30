// ============================================================
// キャンバスデータ → 面の立面 (E-8-v2b・pure・node 安全)
//
// 立面の計算入力（手摺の面復元・高さマーカー・屋根・棟）を組み立てる 1 箇所。
// 配置ダイアログと、旧ビューの parts 移行（再生成）で同じ結果を使うために切り出した。
// ============================================================
import type { CanvasData } from '@/types';
import type { PillarType } from '../calculator';
import { reconstructFaces, type Face } from './faceReconstruction';
import { buildFaceElevation, type FaceElevation } from './elevationEngine';
import { faceElevationToParts, type ElevationPartsBundle } from './elevationParts';

/** 高さマーカーが 1 つも無いときに「絵を出す」ための仮の高さ(mm)。 */
export const FALLBACK_HEIGHT_MM = 5000;

/** 指定面の立面を、キャンバスデータから計算する。 */
export function faceElevationForCanvas(
  canvasData: CanvasData, face: Face, pillarType: PillarType = 'normal',
): FaceElevation {
  const hasMarkers = (canvasData.heightMarkers ?? []).length > 0;
  const cols = reconstructFaces(canvasData.handrails).filter((c) => c.face === face);
  return buildFaceElevation(cols, canvasData.buildings, {
    markers: canvasData.heightMarkers ?? [],
    defaultHeightMm: hasMarkers ? undefined : FALLBACK_HEIGHT_MM,
    pillarType,
    face,
    roofOverhangs: canvasData.roofOverhangs,
    roofs: canvasData.roofs,
    ridgeLines: canvasData.ridgeLines ?? [],
  });
}

/** 指定面の部材ブロック（parts + geom）を計算する。 */
export function facePartsForCanvas(
  canvasData: CanvasData, face: Face, pillarType: PillarType = 'normal',
): ElevationPartsBundle {
  return faceElevationToParts(faceElevationForCanvas(canvasData, face, pillarType));
}
