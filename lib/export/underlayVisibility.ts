// ============================================================
// 出力のときの下図の出し分け (= U-1 commit 4)。
//
// PNG / PDF はステージを丸ごと画像化する（stage.toDataURL）ので、下図を
// 出す・出さないは**キャプチャの間だけ表示を切り替える**ことで実現する。
// 補助線（aidVisibility）と同じ考え方だが、**既定は「出す」**（補助線と逆）。
// 背景ごと印刷することがこの機能の目的そのものだから。
//
// 画面側の「隠す」（見比べるための一時的な切り替え）とは独立して効く。
// 画面では隠していても、出力に含める指定なら出る（逆も同じ）。
// 例外が出ても必ず元に戻す。
// ============================================================
import Konva from 'konva';
import { UNDERLAY_GROUP_NAME } from '@/components/canvas/UnderlayLayer';

/**
 * 下図の表示を include に合わせた状態で fn を実行し、終わったら必ず元に戻す。
 * include 未指定は「出す」（既定）。
 */
export async function withUnderlayVisibility<T>(
  include: boolean | undefined, fn: () => Promise<T>,
): Promise<T> {
  const want = include !== false;
  const stages = Konva.stages;
  const changed: { node: Konva.Node; was: boolean }[] = [];

  for (const stage of stages) {
    for (const node of stage.find(`.${UNDERLAY_GROUP_NAME}`)) {
      const was = node.visible();
      if (was === want) continue;   // すでにその状態なら触らない（戻しすぎない）
      node.visible(want);
      changed.push({ node, was });
    }
  }
  if (changed.length > 0) for (const stage of stages) stage.batchDraw();

  try {
    return await fn();
  } finally {
    // 出力が失敗しても必ず戻す（画面の見え方が出力の失敗に引きずられない）。
    for (const c of changed) c.node.visible(c.was);
    if (changed.length > 0) for (const stage of stages) stage.batchDraw();
  }
}
