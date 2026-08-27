// ============================================================
// 出力の間だけ補助線を隠す (= E-8-v5c)。
//
// PNG / PDF は Konva のステージを丸ごと画像化する（stage.toDataURL）ので、
// 「補助線を含めない」は**キャプチャの間だけレイヤーを隠す**ことで実現する。
// 純粋関数に値を渡すだけでは効かない（DXF・contentBounds とはそこが違う）。
//
// 印刷枠の赤破線を隠す既存の仕組み（pdfExport）と同じ考え方だが、あちらは
// 「赤い破線の Rect を含むレイヤーを探す」という内容による判定で、補助線には
// 使えない。AidLayer には name を付けてあるので**名指しで**隠す。
//
// 例外が出ても必ず元に戻す。ここで戻し損ねると、以降ずっと補助線が消えたままに
// なる（画面の状態が出力の失敗に引きずられる）ので、finally で確実に戻す。
// ============================================================
import Konva from 'konva';
import { AID_LAYER_NAME } from '@/components/canvas/AidLayer';

/**
 * 補助線を隠した状態で fn を実行し、終わったら必ず元に戻す。
 * includeAids が true のときは何もしない（そのまま実行する）。
 */
export async function withAidsHidden<T>(
  includeAids: boolean | undefined, fn: () => Promise<T>,
): Promise<T> {
  if (includeAids) return fn();

  // ステージが無い（描画前）なら隠すものも無い。
  const stages = Konva.stages;
  const hidden: Konva.Layer[] = [];
  for (const stage of stages) {
    for (const layer of stage.find(`.${AID_LAYER_NAME}`)) {
      const l = layer as Konva.Layer;
      if (!l.visible()) continue;   // もともと非表示なら触らない（戻しすぎない）
      l.visible(false);
      hidden.push(l);
    }
  }
  if (hidden.length > 0) {
    for (const stage of stages) stage.batchDraw();
  }

  try {
    return await fn();
  } finally {
    // 出力が失敗しても必ず戻す（画面から補助線が消えたままにならない）。
    for (const l of hidden) l.visible(true);
    if (hidden.length > 0) {
      for (const stage of stages) stage.batchDraw();
    }
  }
}
