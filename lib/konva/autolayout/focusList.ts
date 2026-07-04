import type { EdgeInfo } from '@/lib/konva/autoLayoutUtils';
import type { FloorLayoutResult, FloorEdgeSegment } from '@/lib/konva/autolayout/cascade';

// ============================================================
// S-5b: bothmode(将来 'all')の reader/rendering を per-floor 一般化する pure 部分。
//   真実源 layoutByFloor: Record<floor, FloorLayoutResult> を「cascade 降順(上→下)で
//   全 seg を 1 本に flatten」したフォーカスリストと、セグメントのラベル解決を提供する。
//   N=2({1,2}) では従来の「2F 全 seg → 1F 全 seg」順・従来ラベルと完全一致する。
// ============================================================

/** フォーカスリストの 1 エントリ（従来 rendering の allSegments 要素と同形）。 */
export type FocusEntry = { seg: FloorEdgeSegment; floor: number; edgeIndex: number };

/** layoutByFloor を cascade 降順(上→下)で全 edgeSegments を flatten。
 *  N=2 では floors=[2,1] ＝ 従来 allSegments(2F→1F) と同順・deep equal。 */
export function flattenFocusList(
  layoutByFloor: Record<number, FloorLayoutResult> | null | undefined,
): FocusEntry[] {
  if (!layoutByFloor) return [];
  const out: FocusEntry[] = [];
  const floors = Object.keys(layoutByFloor).map(Number).sort((a, b) => b - a);
  for (const f of floors) {
    for (const s of layoutByFloor[f].edgeSegments) {
      out.push({ seg: s, floor: f, edgeIndex: s.edgeIndex });
    }
  }
  return out;
}

/** セグメント自身のラベル用 relabel edge を、その floor の relabel 済リストから引く。
 *  従来: cur.floor===2 → edges2FAll / else → subEdgesRelabeled。 */
export function selfRelabeledEdge(
  floor: number,
  edgeIndex: number,
  relabeledEdgesByFloor: Record<number, EdgeInfo[]>,
): EdgeInfo | undefined {
  return (relabeledEdgesByFloor[floor] ?? []).find(e => e.index === edgeIndex);
}

/** 次面ラベル（prefix = 隣接階の実番号）。
 *  従来の 2 固定(edges2FAll="2"/subEdgesRelabeled="1")を per-floor + `${f±1}` へ一般化。
 *  discriminator は isTop(=cur.floor===topFloor)。N=2 では top=2F 枝=desiredEndSource、
 *  非top=1F 枝=endConstraint で従来と同一分岐・同一 prefix("2"/"1")。 */
export function computeNextFaceLabel(
  seg: FloorEdgeSegment,
  floor: number,
  isTop: boolean,
  relabeledEdgesByFloor: Record<number, EdgeInfo[]>,
  layoutByFloor: Record<number, FloorLayoutResult>,
): string {
  const rel = (f: number) => relabeledEdgesByFloor[f] ?? [];
  if (isTop) {
    // 旧 cur.floor===2 枝: desiredEndSource を見る
    const src = seg.desiredEndSource;
    if (src?.kind === 'next-face') {
      const e = rel(floor).find(x => x.index === src.edgeIndex);
      return `${floor}${e?.label ?? '?'}`;
    } else if (src?.kind === 'lower-face-pillar') {
      const e = rel(floor - 1).find(x => x.index === src.lowerEdgeIndex);
      return `${floor - 1}${e?.label ?? '?'}`;
    }
    return '?';
  }
  // 旧 cur.floor===1 枝: endConstraint を見る
  const ec = seg.endConstraint;
  if (ec?.kind === 'collinear-with-upper') {
    const e = rel(floor + 1).find(x => x.index === ec.upperEdgeIndex);
    return `${floor + 1}${e?.label ?? '?'}`;
  } else if (ec?.kind === 'next-face') {
    const e = rel(floor).find(x => x.index === ec.edgeIndex);
    return `${floor}${e?.label ?? '?'}`;
  } else if (ec?.kind === 'pillar-to-upper') {
    const pp = ec.pillarPoint;
    const segAbove = (layoutByFloor[floor + 1]?.edgeSegments ?? []).find(s2 =>
      Math.abs(s2.startPoint.x - pp.x) < 0.001 && Math.abs(s2.startPoint.y - pp.y) < 0.001,
    );
    if (segAbove) {
      const e = rel(floor + 1).find(x => x.index === segAbove.edgeIndex);
      return `${floor + 1}${e?.label ?? '?'}`;
    }
  }
  return '?';
}
