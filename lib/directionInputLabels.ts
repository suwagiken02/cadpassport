// ============================================================
// 方向入力（turtle）UI の文言・色を、描く対象で出し分ける（R-1e-fix8・表示のみ）。
// 屋根領域描き（pendingTargetType==='roof'）も敷地境界線（'site'・S-1）も、建物作成と
// まったく同じ turtle を流用するため、「壁」等の建物用語を対象に合わせて着せ替える。
// 機能は不変。
//
// S-1: 引数を boolean（屋根か）から対象そのものへ変えた。3 つ以上を出し分けるため。
//   'building' / 'roof' の戻り値は 1 文字も変えていない（テストで固定）。
// ============================================================
import type { DirectionInputTarget } from '@/types';

export type DirectionInputLabels = {
  addSegment: string;
  confirm: string;
  segmentNoun: string;
  moveOnly: string;
};

/** 描く対象に応じた turtle UI の文言。 */
export function directionInputLabels(target: DirectionInputTarget): DirectionInputLabels {
  if (target === 'roof') {
    return { addSegment: '辺を追加', confirm: '屋根を確定', segmentNoun: '辺', moveOnly: '辺を作らずキャラのみ移動' };
  }
  if (target === 'site') {
    return { addSegment: '境界を追加', confirm: '敷地を確定', segmentNoun: '境界', moveOnly: '境界を作らずキャラのみ移動' };
  }
  // 躯体・障害物は従来どおり「壁」表記。
  return { addSegment: '壁を追加', confirm: '作図確定', segmentNoun: '壁', moveOnly: '壁を作らずキャラのみ移動' };
}

export type DirectionInputColors = { line: string; vertex: string; start: string; count: string };

/**
 * 描く対象に応じた入力中の色（躯体=青／屋根=琥珀／敷地=緑）。
 * これは**描いている最中のプレビュー**の色で、確定後の見た目とは別物。
 * 敷地の確定後は建物と同じ黒（区別は一点鎖線と細さ）だが、描いている最中に
 * 建物と同じ黒だと「いま何を描いているか」が分からないので色を分ける。
 */
export function directionInputColors(target: DirectionInputTarget): DirectionInputColors {
  if (target === 'roof') {
    return { line: '#F59E0B', vertex: '#F59E0B', start: '#B45309', count: '#F59E0B' };
  }
  if (target === 'site') {
    // 起点の赤は躯体と共通（どこから描き始めたかの意味は同じ）。
    return { line: '#059669', vertex: '#059669', start: '#EF4444', count: '#059669' };
  }
  return { line: '#3B82F6', vertex: '#3B82F6', start: '#EF4444', count: '#378ADD' };
}
