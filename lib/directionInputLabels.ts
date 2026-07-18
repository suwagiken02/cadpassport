// ============================================================
// 方向入力（turtle）UI の文言・色を、対象（建物 or 屋根）で出し分ける（R-1e-fix8・表示のみ）。
// 屋根領域描き（pendingTargetType==='roof'）は建物作成と同じ turtle を流用するため、
// 「壁」等の建物用語を屋根用に着せ替える。機能は不変。
// ============================================================

/** 屋根描画中か（isRoof）に応じた turtle UI の文言。 */
export function directionInputLabels(isRoof: boolean): {
  addSegment: string;
  confirm: string;
  segmentNoun: string;
  moveOnly: string;
} {
  return isRoof
    ? { addSegment: '辺を追加', confirm: '屋根を確定', segmentNoun: '辺', moveOnly: '辺を作らずキャラのみ移動' }
    : { addSegment: '壁を追加', confirm: '作図確定', segmentNoun: '壁', moveOnly: '壁を作らずキャラのみ移動' };
}

/** 屋根描画中か（isRoof）に応じた描画色（躯体=青／屋根=琥珀）。 */
export function directionInputColors(isRoof: boolean): { line: string; vertex: string; start: string; count: string } {
  return isRoof
    ? { line: '#F59E0B', vertex: '#F59E0B', start: '#B45309', count: '#F59E0B' }
    : { line: '#3B82F6', vertex: '#3B82F6', start: '#EF4444', count: '#378ADD' };
}
