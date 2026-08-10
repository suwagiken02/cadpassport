// ============================================================
// 立面部材をどこへ置くかの判定 (= E-8-v5a-fix・pure)
//
// ■ 事故
// v5a で「まっさらなキャンバスにも部材を置ける（freeParts）」を作ったが、実機で
// 置けなかった。原因は**配置のゲート**。FreePartLayer が ElevationViewLayer の
// 条件（isPlainSelectMode = mode === 'select'）をそのまま流用していたのに対し、
// mode の既定は 'view'（図面を開いた直後の閲覧モード）。つまり開いた直後は
// 置き場所の面がそもそも出ていなかった。
//
// 平面部材は「配置は mode 非依存のドラッグ&ドロップ」で作られている（PartSelector）。
// 立面部材も同じ流儀に揃える＝開いてすぐ置ける。
//
// ■ 置き先の切り分け（v5a の約束は維持）
//   立面ビューを選択中で、そのビューが配置を受け取れる状態 → 従来どおりビューへ
//   それ以外                                                → キャンバス直下(freeParts)へ
// 「そのビューが受け取れる状態」まで見るのは、view モードでは ElevationViewLayer が
// 対話版を出さない＝誰も受け取れず、置いても何も起きなくなるため。
// ============================================================
import { isPlainSelectMode, isToolActive, type CanvasToolFlags } from '../toolMode';
import type { ElevationPartKind } from './elevationParts';

export type PlacementContext = {
  /** パレットで選んでいる部材。null / 'text' は配置ではない。 */
  addTool: ElevationPartKind | 'text' | null;
  flags: CanvasToolFlags;
  /** 選択ツールが有効か（閲覧固定のときは false）。 */
  selectActive: boolean;
  /** 立面ビューを選択中か。 */
  viewSelected: boolean;
};

/** 立面ビューが配置を受け取れる状態か（ElevationViewLayer が対話版を出す条件）。 */
export function viewCanReceivePart(
  flags: CanvasToolFlags, selectActive: boolean,
): boolean {
  return (isPlainSelectMode(flags) && selectActive) || flags.mode === 'erase';
}

/**
 * キャンバス直下（freeParts）へ置いてよいか。
 *
 * ・部材を選んでいないときは置かない
 * ・消しゴム・建物入力中は置かない（別の操作をしている）
 * ・キャンバスのクリックを占有するツール（計測・高さマーカー等）が動いていれば譲る
 * ・立面ビューが受け取れる状態で選択中なら、そちらに任せる（従来の立面編集は不変）
 * それ以外は置ける。**mode は問わない**（閲覧モードで開いた直後でも置ける）。
 */
export function canPlaceFreePart(ctx: PlacementContext): boolean {
  const { addTool, flags, selectActive, viewSelected } = ctx;
  if (!addTool || addTool === 'text') return false;
  if (flags.mode === 'erase' || flags.mode === 'building') return false;
  if (isToolActive(flags)) return false;
  if (viewSelected && viewCanReceivePart(flags, selectActive)) return false;
  return true;
}
