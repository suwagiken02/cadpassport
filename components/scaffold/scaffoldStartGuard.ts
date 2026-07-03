// ⭐(足場開始)起点階の入口ガード（純関数・UIから分離してテスト可能に）。
//
// 1F+2F同時割付(bothmode)では足場は2F起点で割り付けるため、bothmode 経由で
// ScaffoldStartModal を開いた場合は lockFloor=2 として 1F 設置を入口で弾く。
// lockFloor 未指定(通常起動=1Fのみ/2Fのみ)は両階とも許可する。

/** 起点階が固定(lockFloor)されているとき、選択階が不許可かを返す */
export function isScaffoldFloorBlocked(
  lockFloor: number | undefined,
  selectedFloor: number,
): boolean {
  return lockFloor !== undefined && selectedFloor !== lockFloor;
}
