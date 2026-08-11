// ============================================================
// 平面部材の「何を置くか」 (= P-2)
//
// 置き方は 2 つあるが、運ぶ中身は同じ:
//   ・パレットから掴んで引き出す（ドラッグ&ドロップ）… 位置つき = ToolbarDrag
//   ・パレットで選んでおいてキャンバスをクリック    … 位置なし = PlacePayload
// 片方だけ直し忘れないよう、型も配置処理も 1 本にまとめる。
// ============================================================
import type { AntiWidth, ObstacleType } from '@/types';

/** 置く部材とその寸法・向き。位置は持たない。 */
export type PlacePayload =
  | { type: 'handrail'; lengthMm: number; direction: 'horizontal' | 'vertical' | number }
  | { type: 'anti'; lengthMm: number; direction: 'horizontal' | 'vertical'; antiWidth: AntiWidth }
  | { type: 'post' }
  | { type: 'stair'; angleDeg: number; flip: boolean }
  | { type: 'pipe'; lengthMm: number; angleDeg: number }
  | { type: 'obstacle'; obstacleType: ObstacleType; widthMm: number; heightMm: number; rotation: number };

/** ドラッグ中は、そこにカーソル位置が付く。 */
export type ToolbarDrag = PlacePayload & { currentX: number; currentY: number };

/** ドラッグの中身から位置を落として、武装の中身にする。 */
export function toPlacePayload(drag: ToolbarDrag): PlacePayload {
  const { currentX: _x, currentY: _y, ...rest } = drag;
  return rest as PlacePayload;
}
