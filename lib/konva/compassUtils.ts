/**
 * 方位角を 0-360 度に正規化する。
 * 360 超 / 負数 / undefined / null / NaN を modulo + default 0 で処理。
 *
 * 例:
 *  normalizeCompassAngle(undefined) // 0
 *  normalizeCompassAngle(370)       // 10
 *  normalizeCompassAngle(-10)       // 350
 *  normalizeCompassAngle(720)       // 0
 */
export function normalizeCompassAngle(angle: number | undefined | null): number {
  if (angle == null || !Number.isFinite(angle)) return 0;
  return ((angle % 360) + 360) % 360;
}
