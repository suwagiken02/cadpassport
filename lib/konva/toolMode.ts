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
  /** 方向入力の対象種別。'roof' は屋根領域、'site' は敷地境界線の描き入力中。 */
  pendingTargetType?: import('@/types').DirectionInputTarget;
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
    // S-1: 敷地境界線も屋根とまったく同じ turtle なので、同じ扱いにする。
    //   どちらも `mode === 'building'` を伴うときだけツール中＝選択モードには漏れない。
    || ((s.pendingTargetType === 'roof' || s.pendingTargetType === 'site') && s.mode === 'building')
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

// ============================================================
// 部材パレットを使えるモードか — 唯一の定義。
//
// ■ なぜ要るか（実機の不具合）
// 部材を選んだ（武装した）まま「消去」を押すと、パレットの見た目は消えるのに
// 武装（planeAddTool）と点灯（showPartSelector）が残り、**キャンバスを 1 回
// タップすると削除と配置の両方が走っていた**。
// 見た目を消していたのは PartSelector の `return null` だけで、状態は残っていた。
//
// ■ 対応表にしてある理由
// 「使えるモードを列挙」でも「使えないモードを列挙」でもなく、**全モードを
// 網羅した Record** にしてある。ModeType にモードを 1 つ足すと、この表に
// キーが足りず**型エラーで気づける**（更新漏れが起きない）。
//
// ■ 値は現状の挙動そのまま
// erase / building だけ false。obstacle でパレットが出るのは意図した併存
// （障害物はパレットからのドラッグでしか置かず、キャンバスのタップでは
// 作図が走らない＝ useCanvasInteraction の起点タップは building 限定）。
// ============================================================

/** モードごとに、部材パレット（と武装）を使ってよいか。 */
const PART_SELECTOR_BY_MODE: Record<ModeType, boolean> = {
  view: true,
  select: true,
  handrail: true,
  post: true,
  anti: true,
  memo: true,
  obstacle: true,
  'move-select': true,
  stair: true,
  pipe: true,
  // ここだけ false。どちらも「タップが別の処理に使われる」モード。
  erase: false,      // タップ＝削除。武装が残ると 1 タップで削除と配置が同時に走る
  building: false,   // タップ＝作図の起点。同上
};

/**
 * そのモードで部材パレットを使えるか。
 * **ストアの setMode・パレットの表示・配置の受け口の 3 か所がこれを見る。**
 * どこか 1 つでも見落とすと、また「見た目は消えたのに動く」状態に戻る。
 */
export const canUsePartSelector = (mode: ModeType): boolean => PART_SELECTOR_BY_MODE[mode];
