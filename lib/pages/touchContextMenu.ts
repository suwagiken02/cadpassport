// ============================================================
// タッチ操作でのコンテキストメニュー自動表示条件（E-6d・pure）。
// スマホはブラウザ contextmenu の長押し発火に依存できない環境があるため、
// 選択操作の完了時（範囲選択の指離し / 単体タップ選択）にメニューを自動表示する。
//   ・タッチ操作であること（PC マウスは従来どおり右クリックなので対象外）。
//   ・select モードであること。
//   ・選択が 1 件以上あること。
//   ・範囲選択(rubber band) or 単体タップ選択のいずれかで確定したこと。
// ============================================================
export function shouldAutoOpenTouchMenu(p: {
  isTouch: boolean;
  mode: string;
  selectionCount: number;
  viaRubberBand: boolean;
  viaTapSelect: boolean;
}): boolean {
  return p.isTouch && p.mode === 'select' && p.selectionCount > 0 && (p.viaRubberBand || p.viaTapSelect);
}
