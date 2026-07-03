import { Point } from '@/types';
import type { BuildingShape, ScaffoldStartConfig } from '@/types';
import { EdgeInfo, getBuildingEdgesClockwise } from './autoLayoutUtils';

// ============================================================
// Phase H-3d-6: ラベル付けロジック
//
// 師匠の現場ルール:
//   ⭐ (足場開始位置) を起点に時計回り (CW) で A, B, C, D, ... と採番。
//   2F は同面分割が起きたら同アルファベット + 数字 suffix (B1, B2, B3)。
//   1F は下屋部分のみ対象、 ⭐ に最も近い辺を 1A、 そこから CW 順に独立採番。
//   Z 超えは Excel 列番号風に AA, AB, ... と 2 文字化。
//
// 仕様詳細: docs/handoff-h-3d-6.md
// ============================================================

/**
 * Excel 列番号風の 0-indexed アルファベット変換。
 *
 *   numberToAlpha(0)   === 'A'
 *   numberToAlpha(25)  === 'Z'
 *   numberToAlpha(26)  === 'AA'
 *   numberToAlpha(27)  === 'AB'
 *   numberToAlpha(701) === 'ZZ'
 *   numberToAlpha(702) === 'AAA'
 */
export function numberToAlpha(n: number): string {
  let result = '';
  let x = n;
  while (true) {
    result = String.fromCharCode(65 + (x % 26)) + result;
    x = Math.floor(x / 26) - 1;
    if (x < 0) break;
  }
  return result;
}

/**
 * 案Y-2: 範囲離れで星(scaffoldStart)未設定でも計算できるよう、内部で使う自動起点(周回起点)を決める。
 * 北向き辺(face==='north')のうち最も北(y最小)→最も西(x最小)の辺 index を返す＝北西角。
 * これを relabelByFace2F / cascade の周回起点にすると「北の面=2A、時計回りに 2B, 2C...」になる。
 * 北向き辺が無い(円形など)場合は 0 にフォールバック。
 * 返り値は getBuildingEdgesClockwise(building) の辺 index 規約（startVertexIndex と同一規約）。
 */
export function autoStartVertexIndex(building: BuildingShape): number {
  const edges = getBuildingEdgesClockwise(building);
  let best = -1, bestY = Infinity, bestX = Infinity;
  for (const e of edges) {
    if (e.face !== 'north') continue;
    const y = e.p1.y;
    const x = Math.min(e.p1.x, e.p2.x);
    if (y < bestY || (y === bestY && x < bestX)) { bestY = y; bestX = x; best = e.index; }
  }
  return best >= 0 ? best : 0;
}

/**
 * 2F edges に label を付与する (⭐ 起点 CW、 同面分割は suffix)。
 *
 * 入力 edges は normalizedBuilding2F の getBuildingEdgesClockwise 出力 (CW、
 * face/handrailDir 設定済) を想定する。 startVertexIndex は normalizedBuilding2F
 * の points 上での ⭐ vertex index。
 *
 * 戻り値は入力と同じ要素数で、 各 EdgeInfo の label のみ書き換えた配列を返す
 * (= index/face/p1/p2/... は不変)。 配列の物理 index 順序も保持。
 */
export function relabelByFace2F(
  edges: EdgeInfo[],
  startVertexIndex: number,
): EdgeInfo[] {
  const n = edges.length;
  if (n === 0) return edges;
  const startIdx = ((startVertexIndex % n) + n) % n;

  // step 1: ⭐ から CW で巡回しつつ、 連続する同 (face, handrailDir) を group 化
  type Group = { startK: number; endK: number; face: string; dir: string };
  const groups: Group[] = [];
  let curGroup: Group | null = null;
  for (let k = 0; k < n; k++) {
    const i = (startIdx + k) % n;
    const e = edges[i];
    if (curGroup && e.face === curGroup.face && e.handrailDir === curGroup.dir) {
      curGroup.endK = k;
    } else {
      if (curGroup) groups.push(curGroup);
      curGroup = { startK: k, endK: k, face: e.face, dir: e.handrailDir };
    }
  }
  if (curGroup) groups.push(curGroup);

  // step 2: 各 group に letter 付与。 group size === 1 → suffix なし、 2+ → 'B1', 'B2', ...
  const labelByOriginalIndex = new Map<number, string>();
  for (let g = 0; g < groups.length; g++) {
    const base = numberToAlpha(g);
    const size = groups[g].endK - groups[g].startK + 1;
    for (let k = groups[g].startK; k <= groups[g].endK; k++) {
      const i = (startIdx + k) % n;
      const subIdx = k - groups[g].startK;
      const label = size > 1 ? `${base}${subIdx + 1}` : base;
      labelByOriginalIndex.set(edges[i].index, label);
    }
  }

  return edges.map(e => ({
    ...e,
    label: labelByOriginalIndex.get(e.index) ?? e.label,
  }));
}

/**
 * 1F 下屋 edges に label を付与する (⭐ から 1F polygon を CW で巡回、 下屋辺のみ
 * 順次採番)。
 *
 * 旧版は「⭐ に最も近い uncoveredEdge midpoint」 を 1A としていたが、 これは
 * 師匠の現場ルールと不一致 (= L 型で SW ⭐ のとき下屋南端が 1A になってしまう)。
 * 新版は「⭐ → 最近接 1F 頂点 → そこから CW 巡回 → 最初に出会う下屋辺が 1A」。
 *
 * 入力:
 *   building1FEdges: 1F polygon の全辺 (= getBuildingEdgesClockwise(normalizedBuilding1F))
 *   uncoveredEdgeIndices: 下屋辺の edge.index Set
 *   commonStartPoint: ⭐ の絶対座標。 null なら 1F polygon vertex 0 を起点にする。
 *
 * 戻り値: 下屋辺のみ含む配列 (= 入力 building1FEdges のうち uncoveredEdgeIndices
 * に該当するものだけ)、 ⭐ から CW 巡回した順序で label = 'A', 'B', 'C', ... が
 * 付与済み。 配列順序も巡回順 (= 入力 building1FEdges の物理順とは限らない)。
 *
 * 同距離の頂点が複数ある場合は配列の先勝ち。
 */
export function relabelByFace1F(
  building1FEdges: EdgeInfo[],
  uncoveredEdgeIndices: Set<number>,
  commonStartPoint: Point | null,
): EdgeInfo[] {
  const n = building1FEdges.length;
  if (n === 0) return [];

  // step 1: ⭐ に最も近い 1F polygon 頂点 index を探す (= edge.p1 で代表)
  let startVertexIdx = 0;
  if (commonStartPoint) {
    let minDistSq = Infinity;
    for (let i = 0; i < n; i++) {
      const p = building1FEdges[i].p1;
      const dx = p.x - commonStartPoint.x;
      const dy = p.y - commonStartPoint.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < minDistSq) {
        minDistSq = dSq;
        startVertexIdx = i;
      }
    }
  }

  // step 2: 起点から CW (= 配列の wraparound) で全 1F 辺を巡回、
  //          uncoveredEdgeIndices に該当する辺だけ採番
  const result: EdgeInfo[] = [];
  let labelIdx = 0;
  for (let k = 0; k < n; k++) {
    const i = (startVertexIdx + k) % n;
    const edge = building1FEdges[i];
    if (uncoveredEdgeIndices.has(edge.index)) {
      result.push({ ...edge, label: numberToAlpha(labelIdx) });
      labelIdx++;
    }
  }

  return result;
}

/**
 * H-3d-7 修正: bothmode ⭐(足場開始)起点解決の単一規約。
 *
 * scaffoldStart.startVertexIndex は getBuildingEdgesClockwise(building) の辺順
 * (= edge.p1 列上の位置) として保存されている(types/index.ts:298)。normalize
 * (splitBuilding2FAt1FVertices)で頂点が増減・winding が変わっても、⭐ の絶対座標
 * を基準に「正規化後ポリゴンの CW 辺順で p1 が ⭐ に一致する辺の index」を一意に返す。
 *
 * 全消費側(normalizedScaffoldStart / commonStartPoint / edges2FAll /
 * getBothmodeEdgesWithRelativeLabels)がこの index を共有することで、生 points 配列を
 * CW 辺 index で引いていた旧実装の winding 不整合(⭐ が左上にズレる)を解消する。
 *
 * @returns vertexIndex は normalizedBuilding の getBuildingEdgesClockwise 上の index、
 *          point は ⭐ の絶対座標(= その辺の p1)。最近接マッチ(一致頂点があれば距離0)。
 */
export function resolveScaffoldStartOnNormalized(
  rawBuilding: BuildingShape,
  normalizedBuilding: BuildingShape,
  rawStartVertexIndex: number,
): { vertexIndex: number; point: Point } {
  const normEdges = getBuildingEdgesClockwise(normalizedBuilding);
  if (normEdges.length === 0) {
    const fallback = normalizedBuilding.points[0] ?? rawBuilding.points[0] ?? { x: 0, y: 0 };
    return { vertexIndex: 0, point: fallback };
  }
  const rawEdges = getBuildingEdgesClockwise(rawBuilding);
  // ⭐ 絶対座標: startVertexIndex は CW 辺順(edge.p1 列)の index として保存されている
  const star = rawEdges.length > 0
    ? rawEdges[((rawStartVertexIndex % rawEdges.length) + rawEdges.length) % rawEdges.length].p1
    : normEdges[0].p1;
  // 正規化後 CW 辺順で ⭐ に最も近い p1 の index
  let best = 0;
  let bestDsq = Infinity;
  for (let i = 0; i < normEdges.length; i++) {
    const p = normEdges[i].p1;
    const dx = p.x - star.x;
    const dy = p.y - star.y;
    const dsq = dx * dx + dy * dy;
    if (dsq < bestDsq) {
      bestDsq = dsq;
      best = i;
    }
  }
  return { vertexIndex: best, point: normEdges[best].p1 };
}

/**
 * ⭐(足場開始)マーカーの表示起点座標を求める。
 *
 * scaffoldStart.startVertexIndex は getBuildingEdgesClockwise(building) の辺順
 * (= CW 辺の p1 列)の index 規約(types/index.ts:298)。表示消費側が building.points
 * (生 polygon 順)で読むと CCW 格納の建物で別頂点(SE 等)に⭐を誤描画するため、
 * 計算側(resolveScaffoldStartOnNormalized 等)と同じ CW 辺order の p1 を返す。
 *
 * @returns ⭐ の絶対座標。辺が無い場合は null。
 */
export function getStartVertexPoint(
  building: BuildingShape,
  startVertexIndex: number,
): Point | null {
  const edges = getBuildingEdgesClockwise(building);
  const n = edges.length;
  if (n === 0) return null;
  const idx = ((startVertexIndex % n) + n) % n;
  return edges[idx].p1;
}

/**
 * Phase H-3e (共通根 1、 案 1A'): bothmode で raw building の入力欄に ⭐-relative
 * ラベルを表示するための helper 関数。
 *
 * raw building (= 入力欄数と一致) の各 edge に対し、 normalized building 上で
 * relabelByFace2F を適用した結果の label を coord match で貼り直す。
 *
 * 入力:
 *   rawBuilding: 入力欄が見ている raw building (= 4 vertex 等)
 *   normalizedBuilding2F: split 適用後 (= 6+ vertex の可能性)
 *   normalizedScaffoldStart: ⭐ 位置 (= normalized building 基準の startVertexIndex)
 *
 * 出力: rawBuilding の edges (= 件数不変)、 ただし label は ⭐-relative。
 *
 * 設計判断:
 *   raw 1 edge が normalized で複数 edges に split される場合、 raw edge.p1 と一致する
 *   normalized edge (= split 後の最初の edge) の label を採用する (e.g., 北辺が 3 split
 *   されたら raw 北辺は "B1" を採用、 中央 "B2" / 右 "B3" は raw に対応する入力欄なし)。
 */
export function getBothmodeEdgesWithRelativeLabels(
  rawBuilding: BuildingShape,
  normalizedBuilding2F: BuildingShape,
  normalizedScaffoldStart: ScaffoldStartConfig,
): EdgeInfo[] {
  const rawEdges = getBuildingEdgesClockwise(rawBuilding);
  const normalizedEdges = getBuildingEdgesClockwise(normalizedBuilding2F);
  const startIdx = (normalizedScaffoldStart.startVertexIndex ?? 0)
    % (normalizedEdges.length || 1);
  const labeled = relabelByFace2F(normalizedEdges, startIdx);
  return rawEdges.map(re => {
    const match = labeled.find(le =>
      Math.abs(le.p1.x - re.p1.x) < 0.001 && Math.abs(le.p1.y - re.p1.y) < 0.001,
    );
    return match ? { ...re, label: match.label } : re;
  });
}

/**
 * Phase H-3e (共通根 2、 案 2C'): bothmode で raw building の入力欄に保存された
 * distances state を、 cascade が読み出す normalized building の edge.index に
 * re-keying するための helper 関数。
 *
 * 設計の歴史的経緯 (= handoff-h-3e-fix-spec.md 4-X 章):
 *   1F 側 (distances1F) は既に normalized 経由に統一済 (= Phase H-3d-3 / H-3d-6 の経緯)。
 *   2F 側 (distances) のみ raw 経由のまま取り残されていた (= 観測点 C の真因)。
 *   本関数は 1F 側と対称な構造を 2F 側にも適用するもの (= 既存パターンへの追従)。
 *
 * Phase H-3d-5 の `normalizedScaffoldStart` 再マッピング (`AutoLayoutModal.tsx:294-306`)
 * とも対称的なパターン (= raw 値を normalized index に対応付け)。
 *
 * 入力:
 *   rawBuilding: 入力欄が見ている raw building (= distances state の key 元)
 *   normalizedBuilding: split 適用後 (= cascade が edges の index で読む)
 *   rawDistances: state にある raw key 基準の distances
 *
 * 出力: normalized edge.index でキー化された distances。
 *
 * 設計判断:
 *   仕様書 v2 第 4 章の example (= raw edge.p1 と normalized edge.p1 の coord match) は
 *   split された middle/last edges (= p1 が split insert vertex) に値が継承されない
 *   問題があるため、 「同じ wall (face + handrailDir + 固定軸座標一致 + sub-segment
 *   範囲内) 上にあるかで判定」 に修正。 これにより split された全 normalized edges に
 *   同じ raw 値が継承される (= 仕様書 v2 第 4 章の意図 「同じ wall の離れは同値で自然」
 *   を実現)。
 */
export function getNormalizedDistances(
  rawBuilding: BuildingShape,
  normalizedBuilding: BuildingShape,
  rawDistances: Record<number, number>,
): Record<number, number> {
  const rawEdges = getBuildingEdgesClockwise(rawBuilding);
  const normalizedEdges = getBuildingEdgesClockwise(normalizedBuilding);
  const result: Record<number, number> = {};
  for (const ne of normalizedEdges) {
    for (const re of rawEdges) {
      if (ne.face !== re.face) continue;
      if (ne.handrailDir !== re.handrailDir) continue;
      if (ne.handrailDir === 'horizontal') {
        if (Math.abs(ne.p1.y - re.p1.y) > 0.001) continue;
      } else {
        if (Math.abs(ne.p1.x - re.p1.x) > 0.001) continue;
      }
      const neMid = ne.handrailDir === 'horizontal'
        ? (ne.p1.x + ne.p2.x) / 2
        : (ne.p1.y + ne.p2.y) / 2;
      const reMin = ne.handrailDir === 'horizontal'
        ? Math.min(re.p1.x, re.p2.x)
        : Math.min(re.p1.y, re.p2.y);
      const reMax = ne.handrailDir === 'horizontal'
        ? Math.max(re.p1.x, re.p2.x)
        : Math.max(re.p1.y, re.p2.y);
      if (neMid >= reMin - 0.001 && neMid <= reMax + 0.001) {
        if (rawDistances[re.index] !== undefined) {
          result[ne.index] = rawDistances[re.index];
        }
        break;
      }
    }
  }
  return result;
}
