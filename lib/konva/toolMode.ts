// ============================================================
// ツールモード判定 (R-1h-fix): 「いまキャンバスのクリックを占有しているツールがあるか」を1箇所で判定する。
//
// 背景（実機症状）: 高さマーカーツールは ModeType とは独立した副次フラグ（isHeightMarkerMode）で動き、
// mode は 'select' のまま変わらない。そのため `listening={mode === 'select'}` のような判定は
// 「高さツール中なのに選択モード扱い」になり、壁に重なった屋根の出幅点線がクリックを先取りして
// 高さ入力の代わりに屋根編集モーダルが開いていた。
// 副次フラグは複数あり各レイヤーで書き下すと漏れるので、判定はこの pure 関数に集約する。
// ============================================================
import type { ModeType } from '@/types';

/** クリック占有の判定に必要な状態だけを受ける（store から呼び出し側で組み立てる）。 */
export type CanvasToolFlags = {
  mode: ModeType;
  /** 高さマーカー配置中（壁タップでマーカーを置く）。 */
  isHeightMarkerMode?: boolean;
  /** 棟ライン配置中（建物内部を2点タップ）。 */
  isRidgeLineMode?: boolean;
  /** 計測中（2点タップ）。 */
  isMeasuring?: boolean;
  /** マグネットピン配置中（基点タップ）。 */
  isMagnetPinMode?: boolean;
  /** 平米計算の1F足場指定中（手摺タップで階を反転）。 */
  isAreaDesignationMode?: boolean;
  /** 部材並べ替え中（部材タップで順序入替）。 */
  isReorderMode?: boolean;
  /** 一括移動モード中。 */
  moveSelectActive?: boolean;
  /** 方向入力の対象種別。'roof' は屋根領域の描き入力中。 */
  pendingTargetType?: 'building' | 'obstacle' | 'roof';
};

/**
 * キャンバスのクリックを占有するツールが動いているか。
 * mode（ModeType）とは別に立つ副次フラグを見る（mode 自体の判定は isPlainSelectMode 側）。
 * ※ isDuplicateMode は「ドラッグの意味を変える修飾」でクリックを奪わないため含めない。
 *
 * R-1k: 屋根描き（pendingTargetType==='roof'）は「方向入力が実際に動いている（mode==='building'）」
 *   ときだけツール中とみなす。pendingTargetType は屋根描きを他ボタンで中断すると 'roof' のまま
 *   残ることがあり、これを無条件にツール中と扱うと通常の選択モードでも屋根点線が触れなくなる
 *   （実機で「select なのに屋根点線タップで編集が開かない」デグレとして出た）。
 */
export function isToolActive(s: CanvasToolFlags): boolean {
  return !!(
    s.isHeightMarkerMode
    || s.isRidgeLineMode
    || s.isMeasuring
    || s.isMagnetPinMode
    || s.isAreaDesignationMode
    || s.isReorderMode
    || s.moveSelectActive
    || (s.pendingTargetType === 'roof' && s.mode === 'building')
  );
}

/**
 * 素の選択モードか＝「mode==='select' かつクリックを占有するツールが1つも動いていない」。
 * 常時リスナー（屋根の出幅点線・建物本体など）の listening 条件はこれを使う。
 * これまでの `mode === 'select'` 単独判定はツール中も true になり、クリックの取り合いが起きていた。
 */
export function isPlainSelectMode(s: CanvasToolFlags): boolean {
  return s.mode === 'select' && !isToolActive(s);
}
