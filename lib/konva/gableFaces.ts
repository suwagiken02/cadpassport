// ============================================================
// 妻面（つまめん）判定 (M-1b・pure・node 安全)
//
// 妻面 = 切妻の「三角の壁が立ち上がる面」。この面だけ妻割（センター割り）を適用する。
//
// 判定の主軸は「壁の形」: その面の壁高さが面内で変化する（への字＝中央が高い）こと。
// コマ嵩上げ(computeSpanRaises)も壁の形から算出される(R-1c-fix2 で確定)ので、
// 「嵩上げが起きる面」と「妻割を当てる面」を同じ基準にすれば定義上ズレない。
//
// 補助軸は「棟の向き」: 切妻(roofShape==='gable')の RidgeLine を面へ射影して点に潰れる面
// (projectRidgeLinesToFace の a===b) はその棟に対する妻側。壁がフラットでも切妻と分かる。
//
// 壁が全周フラットで棟も無い（陸屋根・寄棟で軒高一定）建物は妻面なし＝全面通常割り。
// ============================================================
import type { BuildingShape, HeightMarker, RidgeLine, Roof } from '@/types';
import type { FaceDir } from './autoLayoutUtils';
import { getBuildingEdgesClockwise } from './autoLayoutUtils';
import { getHeightAtPosition } from './heightInterpolation';
import { projectRidgeLinesToFace } from './elevation/ridgeProjection';

/** 高さ差がこの値(mm)を超えたら「壁が立ち上がっている」とみなす。実測の丸め誤差を吸収。 */
const RISE_TOLERANCE_MM = 50;

export type GableDetection = {
  /** 妻割の対象とする面。 */
  faces: Set<FaceDir>;
  /** 判定根拠（UI やデバッグ用）。 */
  reason: 'wall-shape' | 'ridge' | 'both' | 'none';
};

/** その建物が矩形（4辺・軸並行）か。入隅のある形は対称化が崩れるので妻割の対象外にする。 */
export function isRectangularOutline(building: BuildingShape): boolean {
  const pts = building.points;
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    const horizontal = Math.abs(p.y - q.y) < 1e-6;
    const vertical = Math.abs(p.x - q.x) < 1e-6;
    if (!horizontal && !vertical) return false;
  }
  return true;
}

/**
 * 壁の形から妻面を拾う: 面内で壁高さが変化する（への字）辺の面。
 * マーカーが 2 個未満の建物は面内の変化が作れないので空。
 */
export function gableFacesByWallShape(
  building: BuildingShape, markers: HeightMarker[],
): Set<FaceDir> {
  const out = new Set<FaceDir>();
  const mine = markers.filter((m) => m.buildingId === building.id);
  if (mine.length < 2) return out;

  const edges = getBuildingEdgesClockwise(building);
  for (const e of edges) {
    // 辺の内部マーカー（0<t<1）が両端より高ければ「への字」＝妻。
    const inner = mine.filter((m) => m.edgeIndex === e.originalIndex && m.t > 1e-6 && m.t < 1 - 1e-6);
    if (inner.length === 0) continue;
    const h0 = getHeightAtPosition(building, mine, e.originalIndex, 0);
    const h1 = getHeightAtPosition(building, mine, e.originalIndex, 1);
    if (h0 == null || h1 == null) continue;
    const ends = Math.max(h0, h1);
    const peak = Math.max(...inner.map((m) => m.heightMm));
    if (peak > ends + RISE_TOLERANCE_MM) out.add(e.face);
  }
  return out;
}

/**
 * 棟の向きから妻面を拾う: 切妻屋根の RidgeLine を各面へ射影して点に潰れる面（棟と直交する面）。
 * roofShape==='gable' の屋根に紐づく棟のみを見る（寄棟は妻面を持たない）。
 */
export function gableFacesByRidge(
  building: BuildingShape, roofs: Roof[], ridgeLines: RidgeLine[],
): Set<FaceDir> {
  const out = new Set<FaceDir>();
  const gableRoofs = roofs.filter((r) => r.buildingId === building.id && r.roofShape === 'gable');
  if (gableRoofs.length === 0) return out;
  const mine = ridgeLines.filter((r) => r.buildingId === building.id);
  if (mine.length === 0) return out;

  for (const face of ['north', 'south', 'east', 'west'] as FaceDir[]) {
    const projected = projectRidgeLinesToFace(mine, building, face);
    // a===b は棟が面と直交して 1 点に潰れた状態＝その面は妻側。
    if (projected.some((p) => Math.abs(p.a - p.b) < 1e-6)) out.add(face);
  }
  return out;
}

/**
 * この建物で妻割を当てる面を決める（M-1b）。
 * ・矩形外周のみ対象（入隅のある形は面が分割され、中央対称が成立しないため）
 * ・壁の形（への字）と棟の向きの和集合。どちらも無ければ妻面なし＝全面通常割り。
 */
export function detectGableFaces(
  building: BuildingShape,
  markers: HeightMarker[] = [],
  roofs: Roof[] = [],
  ridgeLines: RidgeLine[] = [],
): GableDetection {
  if (!isRectangularOutline(building)) return { faces: new Set(), reason: 'none' };

  const byWall = gableFacesByWallShape(building, markers);
  const byRidge = gableFacesByRidge(building, roofs, ridgeLines);
  const faces = new Set<FaceDir>([...Array.from(byWall), ...Array.from(byRidge)]);
  const reason: GableDetection['reason'] =
    byWall.size > 0 && byRidge.size > 0 ? 'both'
      : byWall.size > 0 ? 'wall-shape'
      : byRidge.size > 0 ? 'ridge'
      : 'none';
  return { faces, reason };
}

/** 複数建物ぶんをまとめて判定（buildingId → 妻面の集合）。 */
export function detectGableFacesByBuilding(
  buildings: BuildingShape[],
  markers: HeightMarker[] = [],
  roofs: Roof[] = [],
  ridgeLines: RidgeLine[] = [],
): Map<string, Set<FaceDir>> {
  const map = new Map<string, Set<FaceDir>>();
  for (const b of buildings) {
    const d = detectGableFaces(b, markers, roofs, ridgeLines);
    if (d.faces.size > 0) map.set(b.id, d.faces);
  }
  return map;
}
