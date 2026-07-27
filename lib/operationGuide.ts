// ============================================================
// 操作ガイド (R-2): 現在のツール状態 → 「次にユーザーが何をすべきか」の一文。
//
// JW-CAD 風に、ツール操作中の次アクションを常時1行で案内する。文言の出し分けは
// この pure 関数1箇所に集約（テスト可能・将来の文言修正はここだけ）。
// null = ガイド不要（バー非表示）。うるさくならないよう閲覧中(view)などは null。
//
// 判定順: モードフラグ（isMeasuring 等・mode に上書きして効く）を先に、次に mode。
// ============================================================
import type { ModeType } from '@/types';

/** ガイド判定に必要な状態だけを primitive で受ける（store から component 側で組み立てる）。 */
export type GuideState = {
  mode: ModeType;
  /** 計測モード中か。measurePoint1 の有無で1点目/2点目を出し分ける。 */
  isMeasuring: boolean;
  hasMeasurePoint1: boolean;
  /** 高さマーカー配置モード。 */
  isHeightMarkerMode: boolean;
  /** 棟ライン配置モード。ridgeDraft(1点目)の有無で始点/終点を出し分ける。 */
  isRidgeLineMode: boolean;
  hasRidgeDraft: boolean;
  /** マグネットピン配置モード。pinAnchor の有無で基点/方向入力を出し分ける。 */
  isMagnetPinMode: boolean;
  hasPinAnchor: boolean;
  /** 面積指定モード。 */
  isAreaDesignationMode: boolean;
  /** 部材並べ替えモード。 */
  isReorderMode: boolean;
  /** 一括移動モード（3ステップ）。 */
  moveSelectActive: boolean;
  moveSelectStep: 'category' | 'select' | 'move';
  /** 建物入力方式（mode==='building' のとき有効）。 */
  buildingInputMethod: 'template' | 'direction';
  /** 壁方向入力の確定済み点数（0=始点待ち、≥1=次の壁待ち）。 */
  directionPointCount: number;
  /** 選択モードが有効か（mode==='select' のとき）。 */
  selectActive: boolean;
  /** 屋根領域を描画中か（建物方向入力を pendingTargetType='roof' で流用・R-1e-fix7b）。 */
  isRoofDraw: boolean;
  /**
   * 階スコープが効くツール（高さ・棟・屋根）の対象階（R-1h-4）。
   * 建物が複数階に跨るときだけ数値を渡し、単一階では null/undefined＝階を出さない（従来文言のまま）。
   */
  targetFloor?: number | null;
};

/** 階スコープが効くツールの文言に付ける接頭辞。単一階（null/undefined）では空文字。 */
function floorPrefix(targetFloor?: number | null): string {
  return targetFloor == null ? '' : `(${targetFloor}F) `;
}

/**
 * 現在のツール状態から操作ガイド文（次アクション）を返す。ガイド不要は null。
 * 文言は現場の言葉で簡潔に（鮎澤氏が後で調整する前提で、まず全工程に出ることを優先）。
 */
export function getOperationGuide(s: GuideState): string | null {
  // 高さ・棟・屋根は編集中の階の建物だけが対象（R-1h）。複数階のときはどの階に入力しているかを明示する。
  const fp = floorPrefix(s.targetFloor);

  // ── モードフラグ（mode に上書きして効くので先に判定）──
  if (s.isMeasuring) {
    return s.hasMeasurePoint1 ? '計測の終点をタップしてください' : '計測の始点をタップしてください';
  }
  if (s.isHeightMarkerMode) return `${fp}高さを入力する壁面をタップしてください`;
  if (s.isRidgeLineMode) {
    return s.hasRidgeDraft ? `${fp}棟の終点をタップしてください` : `${fp}棟の始点を建物の中でタップしてください`;
  }
  if (s.isMagnetPinMode) {
    return s.hasPinAnchor ? 'ピンを立てる方向と距離を入力してください' : 'ピンの基点（建物の角など）をタップしてください';
  }
  if (s.isAreaDesignationMode) return '面積を計算する範囲を指定してください';
  if (s.isReorderMode) return '並べ替える部材をタップしてください';
  if (s.moveSelectActive) {
    switch (s.moveSelectStep) {
      case 'category': return '移動する種類を選んでください';
      case 'select': return '移動するオブジェクトをタップで選択してください';
      case 'move': return 'ドラッグして移動し、確定してください';
    }
  }

  // ── mode 系 ──
  switch (s.mode) {
    case 'building':
      if (s.buildingInputMethod === 'direction') {
        if (s.isRoofDraw) {
          return s.directionPointCount === 0
            ? `${fp}屋根の始点をタップしてください`
            : `${fp}方向と距離で屋根の輪郭を描き、始点に戻って閉じてください`;
        }
        return s.directionPointCount === 0
          ? '壁の始点をタップしてください'
          : '次の壁の方向と距離を入力してください（始点の近くをタップで閉じる）';
      }
      return 'テンプレートと寸法を入力してください';
    case 'handrail': return '手摺を配置する位置をタップしてください';
    case 'post': return '支柱を配置する位置をタップしてください';
    case 'anti': return '踏板を配置する位置をタップしてください';
    case 'erase': return '削除するオブジェクトをタップ、またはドラッグで範囲選択してください';
    case 'obstacle': return '障害物を配置する位置をタップしてください';
    case 'memo': return 'メモを配置する位置をタップしてください';
    // R-1g: 'roof' モードは撤去。屋根は mode='building' + pendingTargetType='roof' の領域描き（上の分岐）。
    case 'select': return s.selectActive ? 'オブジェクトをタップ、またはドラッグで範囲選択してください' : null;
    case 'move-select': return null; // moveSelectActive 側で扱う
    case 'view': return null;        // 閲覧中（ツール未選択）はガイド非表示
    default: return null;
  }
}
