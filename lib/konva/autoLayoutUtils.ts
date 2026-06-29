import { Point, BuildingShape, HandrailLengthMm, ScaffoldStartConfig, PriorityConfig, PhaseDCandidate, PhaseDEdgeCandidates } from '@/types';
import { mmToGrid } from './gridUtils';

import { scoreCombination, getScoreOfSize } from './autolayout/scoring';
import { HANDRAIL_SIZES } from './autolayout/combinations';
import { generateSequentialCandidates, type SequentialCandidate } from './autolayout/candidates';

// === 分割した 3 モジュールの再 export（既存 import 元の互換を維持） ===
export { scoreCombination, getScoreOfSize, HANDRAIL_SIZES, generateSequentialCandidates };
export type { SequentialCandidate };
export { INCH_HANDRAIL_SIZES, END_DISTANCE_TOLERANCE_MM, MAX_NON_MAIN_PER_EDGE } from './autolayout/combinations';
export { SCORING_CONFIG, getSectionOfSize } from './autolayout/scoring';
export type { SequentialCandidateSide } from './autolayout/candidates';

// === 方位 ===
export type FaceDir = 'north' | 'south' | 'east' | 'west';

// === 辺情報 ===
export type EdgeInfo = {
  index: number;
  /** 元の building.points 順での物理辺index（時計回り並べ替え前）。
   *  roofUtils の getEdgeOverhangs / computeOffsetPolygon は元順indexで参照するため、
   *  屋根出幅の辺別キーはこちらを使う。 */
  originalIndex: number;
  label: string;
  p1: Point;
  p2: Point;
  lengthMm: number;
  face: FaceDir;
  handrailDir: 'horizontal' | 'vertical';
  nx: number;
  ny: number;
};

// === 割付結果の1パターン ===
export type LayoutCombination = {
  rails: HandrailLengthMm[];
  remainder: number;
  count: number;
};

// === 1辺の割付情報 ===
export type EdgeLayout = {
  edge: EdgeInfo;
  distanceMm: number;
  edgeLengthMm: number;
  effectiveMm: number;
  /** 足場ラインの固定軸座標（グリッド） horizontal→y, vertical→x */
  scaffoldCoord: number;
  /** カーソル開始座標（可変軸、グリッド） */
  cursorStart: number;
  /** カーソル終了座標（可変軸、グリッド） */
  cursorEnd: number;
  candidates: LayoutCombination[];
  selectedIndex: number;
  locked: boolean;
  /** Phase H-3d-2 Stage 5 残対応 Step 1: bothmode 由来 floor (配置時の手摺所属階を決める)
   *  単一階モードでは undefined のまま */
  originFloor?: 1 | 2;
  /** bothmode 用 segmentIndex (1 つの 2F 辺が複数セグメントに分かれた場合の連番) */
  originSegmentIndex?: number;
};

// === 全体結果 ===
export type AutoLayoutResult = {
  edgeLayouts: EdgeLayout[];
};

// ============================================================
function isClockwise(pts: Point[]): boolean {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum > 0;
}

export function isPointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) &&
        px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function isConvexCorner(prevEdge: EdgeInfo, currEdge: EdgeInfo): boolean {
  const ax = prevEdge.p2.x - prevEdge.p1.x;
  const ay = prevEdge.p2.y - prevEdge.p1.y;
  const bx = currEdge.p2.x - currEdge.p1.x;
  const by = currEdge.p2.y - currEdge.p1.y;
  return ax * by - ay * bx > 0;
}

// ============================================================
// 建物ポリゴンの辺を時計回りで取得
// ============================================================
export function getBuildingEdgesClockwise(building: BuildingShape): EdgeInfo[] {
  const pts = building.points;
  const n = pts.length;
  if (n < 3) return [];

  const cw = isClockwise(pts);
  const orderedPts = cw ? [...pts] : [...pts].reverse();

  const edges: EdgeInfo[] = [];
  for (let i = 0; i < orderedPts.length; i++) {
    const p1 = orderedPts[i];
    const p2 = orderedPts[(i + 1) % orderedPts.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenGrid = Math.sqrt(dx * dx + dy * dy);
    const lengthMm = Math.round(lenGrid * 10);
    const len = lenGrid || 1;

    let nx = dy / len;
    let ny = -dx / len;

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    if (isPointInPolygon(midX + nx * 0.5, midY + ny * 0.5, orderedPts)) {
      nx = -nx; ny = -ny;
    }

    let face: FaceDir;
    if (Math.abs(ny) > Math.abs(nx)) {
      face = ny < 0 ? 'north' : 'south';
    } else {
      face = nx > 0 ? 'east' : 'west';
    }

    const handrailDir: 'horizontal' | 'vertical' =
      (face === 'north' || face === 'south') ? 'horizontal' : 'vertical';

    // 元 points 順の物理辺index。CW のときは並べ替えなしで i に一致、
    // CCW で reverse したときは orderedPts[i]→[i+1] が元辺 (n-2-i) に対応する。
    const originalIndex = cw ? i : (((n - 2 - i) % n) + n) % n;
    edges.push({
      index: i,
      originalIndex,
      label: String.fromCharCode(65 + i),
      p1, p2, lengthMm, face, handrailDir, nx, ny,
    });
  }

  return edges;
}

// ============================================================
// 手摺割付: 1800mm優先 → 端数を小部材で充填
//
// 1. 1800mm をできるだけ多く使う
// 2. 残りの端数（< 1800mm）を小部材で埋める複数パターンを生成
// 3. 端数が最小になるパターンを返す
// ============================================================
export function findBestEndCombinations(
  effectiveMm: number,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  // priorityConfig: Phase 5-B 以降、渡されれば優先部材パターンを追加候補として合流する
  // 未指定なら既存の A〜G パターンのみで動作（互換性完全維持）
  priorityConfig?: PriorityConfig,
): LayoutCombination[] {
  if (effectiveMm <= 0) return [{ rails: [], remainder: 0, count: 0 }];
  // サイズが 0 件なら解なし（UI 側でその旨を通知する想定）
  if (enabledSizes.length === 0) return [{ rails: [], remainder: effectiveMm, count: 0 }];

  // 降順ソート + baseSize（最大サイズを基準）と FILLER_SIZES（残り）に分離
  const sizes: HandrailLengthMm[] = [...enabledSizes].sort((a, b) => b - a);
  const baseSize = sizes[0];
  const FILLER_SIZES: HandrailLengthMm[] = sizes.slice(1);

  // baseSize をできるだけ詰める
  const numBase = Math.floor(effectiveMm / baseSize);
  const leftover = effectiveMm - numBase * baseSize;
  const base1800: HandrailLengthMm[] = Array(numBase).fill(baseSize);

  // 端数がゼロなら完璧（priorityConfig あり時は追加パターンを検討するため早期 return しない）
  if (leftover === 0 && !priorityConfig) {
    return [{ rails: base1800, remainder: 0, count: numBase }];
  }

  const results: LayoutCombination[] = [];
  const seen = new Set<string>();

  const addResult = (rails: HandrailLengthMm[], rem: number) => {
    const sorted = [...rails].sort((a, b) => b - a);
    const key = sorted.join(',') + '|' + rem;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ rails, remainder: rem, count: rails.length });
  };

  // ── パターンA: 端数をグリーディに充填 ──
  const fillGreedy = (remaining: number, sizes: HandrailLengthMm[]): HandrailLengthMm[] => {
    const rails: HandrailLengthMm[] = [];
    let left = remaining;
    for (const size of sizes) {
      while (left >= size) { rails.push(size); left -= size; }
    }
    return rails;
  };

  const fillerA = fillGreedy(leftover, FILLER_SIZES);
  const totalA = fillerA.reduce((s, r) => s + r, 0);
  addResult([...base1800, ...fillerA], leftover - totalA);

  // ── パターンB: 端数部の末尾を1サイズ上げる（はみ出し許容） ──
  if (fillerA.length > 0) {
    const lastSize = fillerA[fillerA.length - 1];
    const idx = FILLER_SIZES.indexOf(lastSize);
    if (idx > 0) {
      const altFiller = [...fillerA];
      altFiller[altFiller.length - 1] = FILLER_SIZES[idx - 1];
      const totalB = altFiller.reduce((s, r) => s + r, 0);
      addResult([...base1800, ...altFiller], leftover - totalB);
    }
  }

  // ── パターンC: 端数部の末尾を削除 ──
  if (fillerA.length > 1) {
    const fewer = fillerA.slice(0, -1);
    const totalC = fewer.reduce((s, r) => s + r, 0);
    addResult([...base1800, ...fewer], leftover - totalC);
  }

  // ── パターンD: 端数を1本で賄えるサイズを試す ──
  // 有効サイズ全てを試す（早期 break しない）。長側候補（rem < 0）を 0 に
  // 最も近づけるには最小サイズまで列挙する必要がある。
  for (const size of sizes) {
    const rem = leftover - size;
    addResult([...base1800, size], rem);
  }

  // ── パターンE: 端数を2本で賄う組み合わせ ──
  for (const s1 of FILLER_SIZES) {
    if (s1 > leftover) continue;
    const rest = leftover - s1;
    for (const s2 of FILLER_SIZES) {
      if (s2 > s1) continue;
      const rem = rest - s2;
      addResult([...base1800, s1, s2], rem);
      if (rem === 0) break; // ぴったりならbreak、マイナスでも次を試す
    }
  }

  // ── パターンG: 端数を3本で賄う組み合わせ ──
  for (const s1 of FILLER_SIZES) {
    if (s1 > leftover) continue;
    const rest1 = leftover - s1;
    for (const s2 of FILLER_SIZES) {
      if (s2 > rest1) continue;
      const rest2 = rest1 - s2;
      for (const s3 of FILLER_SIZES) {
        const rem = rest2 - s3;
        addResult([...base1800, s1, s2, s3], rem);
        if (rem <= 0) break;
      }
      if (rest2 <= 0) break;
    }
  }

  // ── パターンF: baseSize を1本減らして端数を広げる ──
  if (numBase > 0) {
    const base1800m1: HandrailLengthMm[] = Array(numBase - 1).fill(baseSize);
    const bigLeftover = leftover + baseSize;
    const fillerF = fillGreedy(bigLeftover, sizes);
    const totalF = fillerF.reduce((s, r) => s + r, 0);
    addResult([...base1800m1, ...fillerF], bigLeftover - totalF);
  }

  // 結果がなければフォールバック
  if (results.length === 0) {
    addResult(base1800, leftover);
  }

  // 【Phase 5-B】priorityConfig が渡されていれば、優先リストに基づく追加パターンを合流
  // addResult 経由で results に追加されるため、seen セットで重複除去、以降の選出ロジックは既存通り
  if (priorityConfig) {
    const extra = generatePriorityPatterns(effectiveMm, enabledSizes, priorityConfig);
    for (const p of extra) {
      addResult(p.rails, p.remainder);
    }
  }

  // 有効長より短い側（+remainder = 不足）/ 長い側（-remainder = 突出）
  // それぞれの最良候補を選び、候補A/Bダイアログで提示する。
  //   Short: remainder >= 0 の中で最小（端数最小）
  //   Long : remainder < 0 の中で最大（突出最小、つまり 0 に近い負）
  let shorts: LayoutCombination[];
  let longs: LayoutCombination[];

  if (!priorityConfig) {
    // 既存動作（変更なし）
    shorts = results
      .filter(r => r.remainder >= 0)
      .sort((a, b) => (a.remainder - b.remainder) || (a.count - b.count));
    longs = results
      .filter(r => r.remainder < 0)
      .sort((a, b) => (b.remainder - a.remainder) || (a.count - b.count));
  } else {
    // 【Phase 5-C】priorityConfig ありの優先度評価ソート
    // 1. |remainder| 最小  2. 平均スコア最大  3. 最低ランク部材を避ける（最小スコア最大）  4. 本数最小
    const pc = priorityConfig;
    const sortByPriority = (a: LayoutCombination, b: LayoutCombination): number => {
      const remDiff = Math.abs(a.remainder) - Math.abs(b.remainder);
      if (remDiff !== 0) return remDiff;
      const scoreA = scoreCombination(a.rails, pc);
      const scoreB = scoreCombination(b.rails, pc);
      const scoreDiff = scoreB - scoreA;
      if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
      // avg タイブレーク: 最低スコアが高い方 (= 優先度の低い部材を使っていない方) を優先
      const minA = Math.min(...a.rails.map(r => getScoreOfSize(r, pc)));
      const minB = Math.min(...b.rails.map(r => getScoreOfSize(r, pc)));
      const minDiff = minB - minA;
      if (Math.abs(minDiff) > 1e-9) return minDiff;
      return a.count - b.count;
    };
    shorts = results.filter(r => r.remainder >= 0).slice().sort(sortByPriority);
    longs = results.filter(r => r.remainder < 0).slice().sort(sortByPriority);
  }

  const out: LayoutCombination[] = [];
  if (shorts[0]) out.push(shorts[0]);
  if (longs[0]) out.push(longs[0]);
  // 端数 abs が小さい側を先頭（プライマリ候補）にする
  out.sort((a, b) => Math.abs(a.remainder) - Math.abs(b.remainder));
  return out.length > 0 ? out : results.slice(0, 1);
}

// ============================================================
// Phase H-2: 順次決定アルゴリズムによる自動割付
// 各辺を時計回りに処理し、前辺の終点離れを次辺の始点離れとして継承する。
// 端数発生時は2択候補を返す（UI で選択させる）。
// ============================================================
export type SequentialEdgeResult = {
  edge: EdgeInfo;
  startDistanceMm: number;
  desiredEndDistanceMm: number;
  candidates: SequentialCandidate[];
  selectedIndex: number;
  isLocked: boolean;
  isAutoProgress: boolean;
  prevCornerIsConvex: boolean;
  nextCornerIsConvex: boolean;
  // Phase H-3a: 配置に必要な座標情報
  scaffoldCoord: number;
  cursorStart: number;
  cursorEnd: number;
  effectiveMm: number;
};

export type SequentialLayoutResult = {
  edgeResults: SequentialEdgeResult[];
  hasUnresolved: boolean;
};

// Phase I-2: 各辺ごとの「割り変更」「←/→」操作の状態。
// AutoLayoutModal から computeAutoLayoutSequential 経由で
// generateSequentialCandidates の offset/variation 引数に伝搬される。
export type EdgeAdjustment = {
  larger: { offsetIdx: number; variationIdx: number };
  smaller: { offsetIdx: number; variationIdx: number };
};

export const DEFAULT_EDGE_ADJUSTMENT: EdgeAdjustment = {
  larger: { offsetIdx: 0, variationIdx: 0 },
  smaller: { offsetIdx: 0, variationIdx: 0 },
};

export function computeAutoLayoutSequential(
  building: BuildingShape,
  distances: Record<number, number>,
  scaffoldStart?: ScaffoldStartConfig,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  userSelections?: Record<number, number>,
  // Phase I-2: 各辺の「割り変更」「←/→」操作状態。undefined or 該当 edge 無しなら
  // 全 0 (既存挙動と完全互換)。
  userAdjustments?: Record<number, EdgeAdjustment>,
  // 範囲離れ S-3: 帯[lo,hi] 受け口（generateSequentialCandidates へ透過。未指定=現挙動）
  band?: { lo: number; hi: number; mode?: 'center' | 'lower' },
): SequentialLayoutResult {
  const edges = getBuildingEdgesClockwise(building);
  const n = edges.length;

  // Phase H-fix-2b: 順次決定の起点を scaffoldStart にローテート。
  // edges[startIdx]   = out edge (角から出る辺、cascade 起点、face で初期化)
  // edges[startIdx-1] = in edge  (角に入る辺、cascade 終点、face で閉合)
  // scaffoldStart 無し時は startIdx=0 → 旧来 i=0 起点と一致 (後方互換)
  const startIdx = scaffoldStart && n >= 2
    ? (scaffoldStart.startVertexIndex ?? 0) % n
    : 0;

  // lockedIndices: 既存 computeAutoLayout のロジックをそのまま使用
  const lockedIndices = new Set<number>();
  if (scaffoldStart && n >= 2) {
    lockedIndices.add(edges[startIdx].index);
    lockedIndices.add(edges[(startIdx - 1 + n) % n].index);
  }

  // 各コーナーの凸/凹判定: cornerConvexity[i] = 辺i と 辺(i+1) の間のコーナー
  const cornerConvexity: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const next = edges[(i + 1) % n];
    cornerConvexity.push(isConvexCorner(edges[i], next));
  }

  // 順次決定パス: 座標以外の情報を確定。
  // ループ順は scaffoldStart 起点 (k=0 で out edge、k=n-1 で in edge)。
  // intermediate は edges 物理 index 順で格納 → 2 パス目 (cursor 計算) は無変更で動作。
  type Intermediate = Omit<
    SequentialEdgeResult,
    'scaffoldCoord' | 'cursorStart' | 'cursorEnd' | 'effectiveMm'
  >;
  const intermediate: Intermediate[] = new Array(n);
  let prevEndDistanceMm: number | undefined = undefined;
  let hasUnresolved = false;

  for (let k = 0; k < n; k++) {
    const i = (startIdx + k) % n;
    const edge = edges[i];
    const isLocked = lockedIndices.has(edge.index);
    const prevCornerIsConvex = cornerConvexity[(i - 1 + n) % n];
    const nextCornerIsConvex = cornerConvexity[i];

    // 始点離れの決定
    // - k===0: 起点辺。scaffoldStart があれば locked = face1/2、無ければ distances or 900
    // - k===n-1: 閉じ辺。scaffoldStart があれば locked = face1/2 で cascade を上書きして閉合
    // - その他: 前辺 (cascade k-1) の actualEnd を継承
    let startDistanceMm: number;
    if (k === 0) {
      if (scaffoldStart && isLocked) {
        startDistanceMm = edge.handrailDir === 'horizontal'
          ? scaffoldStart.face1DistanceMm
          : scaffoldStart.face2DistanceMm;
      } else {
        startDistanceMm = distances[edge.index] ?? 900;
      }
    } else if (k === n - 1 && scaffoldStart && isLocked) {
      // 閉じ辺: もう一方の locked を face で固定 (cascade 値を捨てる)
      startDistanceMm = edge.handrailDir === 'horizontal'
        ? scaffoldStart.face1DistanceMm
        : scaffoldStart.face2DistanceMm;
    } else {
      startDistanceMm = prevEndDistanceMm ?? distances[edge.index] ?? 900;
    }

    // 終点離れ希望 = 次の辺の希望離れ
    const nextEdge = edges[(i + 1) % n];
    const desiredEndDistanceMm = distances[nextEdge.index] ?? 900;

    // Phase H-fix-2a: 前辺 wall 距離 = 物理 prev edge の startDist
    // 物理 prev = (i-1+n)%n は cascade 順では k-1 (= 前回処理した辺) と一致するため、
    // k>=1 では intermediate[prevIdx] が既に書き込み済み。
    // k===0 のみ物理 prev = 閉じ辺 (cascade 最後で確定) → ユーザー入力 distances から取る。
    // scaffoldStart 有り時は AutoLayoutModal が distances[locked_edge.index] = face で
    // 初期化するため、k=0 起点辺の prevEdgeStart と k=n-1 閉じ辺の上書き値 (face) が
    // 一致 → 閉合誤差ゼロ。scaffoldStart 無し時は edges[n-1]/edges[0] 境界に残存。
    const prevIdx = (i - 1 + n) % n;
    const prevEdgeStartDistanceMm = k === 0
      ? distances[edges[prevIdx].index] ?? 900
      : intermediate[prevIdx].startDistanceMm;

    // Phase I-2: 該当辺の adjustments を generateSequentialCandidates へ伝搬
    const adj = userAdjustments?.[edge.index] ?? DEFAULT_EDGE_ADJUSTMENT;
    const candidates = generateSequentialCandidates(
      edge.lengthMm,
      startDistanceMm,
      desiredEndDistanceMm,
      prevCornerIsConvex,
      nextCornerIsConvex,
      prevEdgeStartDistanceMm,
      enabledSizes,
      priorityConfig,
      adj.larger.offsetIdx,
      adj.smaller.offsetIdx,
      adj.larger.variationIdx,
      adj.smaller.variationIdx,
      band,
    );

    let selectedIndex = userSelections?.[edge.index] ?? 0;
    if (selectedIndex >= candidates.length) selectedIndex = 0;

    // 自動進行は「候補1件 かつ 離れ差0 かつ 端数0」のみ。
    // 離れが動く案(diff≠0)や端数あり(rule5)はモーダルで提案する。
    const isAutoProgress = candidates.length === 1
      && candidates[0].diffFromDesired === 0
      && (candidates[0].remainder ?? 0) === 0;
    if (!isLocked && !isAutoProgress) hasUnresolved = true;

    intermediate[i] = {
      edge,
      startDistanceMm,
      desiredEndDistanceMm,
      candidates,
      selectedIndex,
      isLocked,
      isAutoProgress,
      prevCornerIsConvex,
      nextCornerIsConvex,
    };

    if (candidates.length > 0) {
      prevEndDistanceMm = candidates[selectedIndex].actualEndDistanceMm;
    } else {
      prevEndDistanceMm = desiredEndDistanceMm;
    }
  }

  // Phase H-3a: 1パス目相当 — 確定 startDistanceMm から distGrid と scaffoldCoord を計算
  const distGrids: number[] = [];
  const scaffoldCoords: number[] = [];
  for (let i = 0; i < n; i++) {
    const dg = mmToGrid(intermediate[i].startDistanceMm);
    distGrids.push(dg);
    scaffoldCoords.push(calcScaffoldCoord(edges[i], dg));
  }

  // Phase H-3a: 2パス目相当 — cursorStart/cursorEnd/effectiveMm を計算
  // 既存 computeAutoLayout の 2パス目ロジックを忠実にコピー
  const edgeResults: SequentialEdgeResult[] = [];
  for (let i = 0; i < n; i++) {
    const edge = edges[i];
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const prevEdge = edges[prevIdx];
    const nextEdge = edges[nextIdx];

    const dx = edge.p2.x - edge.p1.x;
    const dy = edge.p2.y - edge.p1.y;

    // --- cursorStart ---
    const prevScaffold = scaffoldCoords[prevIdx];
    let cursorStart: number;
    if (prevEdge.handrailDir !== edge.handrailDir) {
      cursorStart = prevScaffold;
    } else {
      cursorStart = edge.handrailDir === 'horizontal' ? edge.p1.x : edge.p1.y;
    }

    // --- cursorEnd ---
    const endConvex = isConvexCorner(edge, nextEdge);
    const nextScaffold = scaffoldCoords[nextIdx];
    const nextDistGrid = distGrids[nextIdx];
    let cursorEnd: number;
    if (edge.handrailDir === 'horizontal') {
      const sign = dx > 0 ? 1 : -1;
      if (endConvex) {
        cursorEnd = edge.p2.x + sign * nextDistGrid;
      } else if (nextEdge.handrailDir !== edge.handrailDir) {
        cursorEnd = nextScaffold;
      } else {
        cursorEnd = edge.p2.x;
      }
    } else {
      const sign = dy > 0 ? 1 : -1;
      if (endConvex) {
        cursorEnd = edge.p2.y + sign * nextDistGrid;
      } else if (nextEdge.handrailDir !== edge.handrailDir) {
        cursorEnd = nextScaffold;
      } else {
        cursorEnd = edge.p2.y;
      }
    }

    const effectiveMm = Math.max(0, Math.round(Math.abs(cursorEnd - cursorStart) * 10));

    edgeResults.push({
      ...intermediate[i],
      scaffoldCoord: scaffoldCoords[i],
      cursorStart,
      cursorEnd,
      effectiveMm,
    });
  }

  return { edgeResults, hasUnresolved };
}

// ============================================================
// Phase H-3b-1: SequentialLayoutResult → AutoLayoutResult アダプタ
// 既存 placeHandrailsForEdge / handlePlace を変更せずに使うため、
// SequentialLayoutResult を AutoLayoutResult 形式に変換する。
//
// cursorEnd は rails 合計ベースに再計算する（cursor 由来の effectiveMm と
// 順次決定の railsTotal が乖離するケースで配置が崩れるのを防ぐ）。
// 提案モーダルは H-3b-2 で順次決定方式に置き換わるまでの暫定対応として
// remainder=0 で発火を抑止する。
// ============================================================
export function sequentialResultToAutoLayoutResult(
  seqResult: SequentialLayoutResult,
): AutoLayoutResult {
  const edgeLayouts: EdgeLayout[] = seqResult.edgeResults.map(er => {
    const selectedCandidate = er.candidates[er.selectedIndex];
    const railsTotal = selectedCandidate
      ? selectedCandidate.rails.reduce((a, b) => a + b, 0)
      : 0;

    // cursorEnd を rails 合計ベースに再計算
    // cursorStart から辺の進行方向に rails 合計分進んだ位置を cursorEnd とする
    const railsTotalGrid = railsTotal / 10;
    const sign = er.edge.handrailDir === 'horizontal'
      ? (er.edge.p2.x > er.edge.p1.x ? 1 : -1)
      : (er.edge.p2.y > er.edge.p1.y ? 1 : -1);
    const cursorEndAdjusted = er.cursorStart + sign * railsTotalGrid;

    // 端数は候補の remainder を使用（通常0。CAD パスポート rule5 の「離れを動かさず残した端数」のみ非0）
    const candidates: LayoutCombination[] = er.candidates.map(c => ({
      rails: c.rails,
      remainder: c.remainder ?? 0,
      count: c.rails.length,
    }));

    return {
      edge: er.edge,
      distanceMm: er.startDistanceMm,
      edgeLengthMm: er.edge.lengthMm,
      effectiveMm: railsTotal,
      scaffoldCoord: er.scaffoldCoord,
      cursorStart: er.cursorStart,
      cursorEnd: cursorEndAdjusted,
      candidates,
      selectedIndex: er.selectedIndex,
      locked: er.isLocked,
    };
  });

  return { edgeLayouts };
}

// ============================================================
// 辺のscaffoldCoordを計算（固定軸座標）
// ============================================================
function calcScaffoldCoord(edge: EdgeInfo, distGrid: number): number {
  // 1mm精度の離れ（例: 999mm = 99.9 grid）を保持したまま足場ライン座標を計算。
  // 候補A/Bダイアログが 1mm 単位で正しい新離れを提案できるようにする。
  if (edge.handrailDir === 'horizontal') {
    return edge.p1.y + edge.ny * distGrid;
  } else {
    return edge.p1.x + edge.nx * distGrid;
  }
}

// ============================================================
// 全辺の自動割付を計算
//
// 各辺のcursor開始点は「前の辺のscaffoldCoord」で決まる。
// 凸コーナー: 前の辺のscaffoldCoordが次の辺の開始位置になる
// 凹コーナー: 同様に前の辺のscaffoldCoordから開始
//
// 終了点は凸コーナーならendFlyout付き、凹なら辺のp2座標で止まる。
// ============================================================
export function computeAutoLayout(
  building: BuildingShape,
  distances: Record<number, number>,
  scaffoldStart?: ScaffoldStartConfig,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  // priorityConfig: Phase 5 で findBestEndCombinations の評価関数に使用予定
  // Phase 4 時点では受け取って findBestEndCombinations に素通しするだけ
  priorityConfig?: PriorityConfig,
): AutoLayoutResult {
  const edges = getBuildingEdgesClockwise(building);
  const n = edges.length;

  // L字スタート角に隣接する 2 辺を「固定辺」として識別。
  // この 2 辺は ScaffoldStartModal で既に手摺 1 本配置済みなので、
  // 自動割付では追加配置をスキップする（locked=true）。
  const lockedIndices = new Set<number>();
  if (scaffoldStart && n >= 2) {
    const startIdx = scaffoldStart.startVertexIndex ?? 0;
    lockedIndices.add(edges[startIdx % n].index);
    lockedIndices.add(edges[(startIdx - 1 + n) % n].index);
  }

  // 1パス目: 各辺のscaffoldCoordを計算
  // 離れは 1mm 精度のまま保持（候補A/B提案で正しい 10mm 単位の新離れを算出するため）。
  const scaffoldCoords: number[] = [];
  const distGrids: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    const dist = distances[edges[i].index] ?? 900;
    const dg = mmToGrid(dist);
    distGrids.push(dg);
    const sc = calcScaffoldCoord(edges[i], dg);
    scaffoldCoords.push(sc);
  }

  // 2パス目: cursorStart/cursorEnd と effectiveMm を計算
  const edgeLayouts: EdgeLayout[] = [];

  for (let i = 0; i < n; i++) {
    const edge = edges[i];
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const prevEdge = edges[prevIdx];
    const nextEdge = edges[nextIdx];

    const thisDist = distances[edge.index] ?? 900;

    const dx = edge.p2.x - edge.p1.x;
    const dy = edge.p2.y - edge.p1.y;

    // --- cursorStart ---
    // 方向転換するコーナーでは前の面のscaffoldCoordを引き継ぐ
    // （凸・凹問わず、足場ラインの交点から開始）
    // 同方向連続の場合のみ p1 座標
    const prevScaffold = scaffoldCoords[prevIdx];
    const startConvex = isConvexCorner(prevEdge, edge);
    let cursorStart: number;
    if (prevEdge.handrailDir !== edge.handrailDir) {
      // 方向転換（H→V or V→H）→ 前の面のscaffoldCoordが開始位置
      cursorStart = prevScaffold;
    } else {
      // 同方向連続 → p1座標
      cursorStart = edge.handrailDir === 'horizontal' ? edge.p1.x : edge.p1.y;
    }


    // --- cursorEnd ---
    // 凸コーナー: p2 + 次の面の離れ分飛び出し
    // 凹コーナー: 次の面のscaffoldCoord（足場ラインの交点で止まる）
    const endConvex = isConvexCorner(edge, nextEdge);
    const nextScaffold = scaffoldCoords[nextIdx];
    let cursorEnd: number;
    // 1mm精度のまま計算し、effectiveMm で Math.round して整数 mm 化する
    const nextDistGrid = distGrids[nextIdx];
    if (edge.handrailDir === 'horizontal') {
      const sign = dx > 0 ? 1 : -1;
      if (endConvex) {
        cursorEnd = edge.p2.x + sign * nextDistGrid;
      } else if (nextEdge.handrailDir !== edge.handrailDir) {
        cursorEnd = nextScaffold;
      } else {
        cursorEnd = edge.p2.x;
      }
    } else {
      const sign = dy > 0 ? 1 : -1;
      if (endConvex) {
        cursorEnd = edge.p2.y + sign * nextDistGrid;
      } else if (nextEdge.handrailDir !== edge.handrailDir) {
        cursorEnd = nextScaffold;
      } else {
        cursorEnd = edge.p2.y;
      }
    }


    // 1mm精度の建物座標でも float 誤差で `=== 0` 判定が壊れるのを防ぐため整数 mm に正規化
    const effectiveMm = Math.round(Math.abs(cursorEnd - cursorStart) * 10);
    const candidates = findBestEndCombinations(Math.max(0, effectiveMm), enabledSizes, priorityConfig);

    edgeLayouts.push({
      edge,
      distanceMm: thisDist,
      edgeLengthMm: edge.lengthMm,
      effectiveMm: Math.max(0, effectiveMm),
      scaffoldCoord: scaffoldCoords[i],
      cursorStart,
      cursorEnd,
      candidates,
      selectedIndex: 0,
      locked: lockedIndices.has(edge.index),
    });
  }

  return { edgeLayouts };
}

// ============================================================
// 1辺の手摺座標を生成
// ============================================================
export function placeHandrailsForEdge(
  layout: EdgeLayout,
  rails: HandrailLengthMm[],
): { x: number; y: number; lengthMm: HandrailLengthMm; direction: 'horizontal' | 'vertical' }[] {
  const edge = layout.edge;
  const dx = edge.p2.x - edge.p1.x;
  const dy = edge.p2.y - edge.p1.y;

  const results: { x: number; y: number; lengthMm: HandrailLengthMm; direction: 'horizontal' | 'vertical' }[] = [];


  if (edge.handrailDir === 'horizontal') {
    const scaffoldY = layout.scaffoldCoord;
    const sign = dx > 0 ? 1 : -1;
    let cursor = layout.cursorStart;

    for (const railMm of rails) {
      const railGrid = mmToGrid(railMm);
      const x = sign > 0 ? cursor : cursor - railGrid;
      results.push({ x, y: scaffoldY, lengthMm: railMm, direction: 'horizontal' });
      cursor += sign * railGrid;
    }
  } else {
    const scaffoldX = layout.scaffoldCoord;
    const sign = dy > 0 ? 1 : -1;
    let cursor = layout.cursorStart;

    for (const railMm of rails) {
      const railGrid = mmToGrid(railMm);
      const y = sign > 0 ? cursor : cursor - railGrid;
      results.push({ x: scaffoldX, y, lengthMm: railMm, direction: 'vertical' });
      cursor += sign * railGrid;
    }
  }

  return results;
}

// ============================================================
// 内側の辺 inner が外側の辺 outer に「乗っている（包含されている）」かを判定。
// 軸並行（水平/垂直）の辺のみ対応。足場図面は基本これで十分。
// ============================================================
function isEdgeContainedIn(inner: EdgeInfo, outer: EdgeInfo): boolean {
  // 水平線同士: 同じ Y、X 範囲が outer に含まれる
  if (
    inner.p1.y === inner.p2.y &&
    outer.p1.y === outer.p2.y &&
    inner.p1.y === outer.p1.y
  ) {
    const innerXMin = Math.min(inner.p1.x, inner.p2.x);
    const innerXMax = Math.max(inner.p1.x, inner.p2.x);
    const outerXMin = Math.min(outer.p1.x, outer.p2.x);
    const outerXMax = Math.max(outer.p1.x, outer.p2.x);
    return innerXMin >= outerXMin && innerXMax <= outerXMax;
  }
  // 垂直線同士: 同じ X、Y 範囲が outer に含まれる
  if (
    inner.p1.x === inner.p2.x &&
    outer.p1.x === outer.p2.x &&
    inner.p1.x === outer.p1.x
  ) {
    const innerYMin = Math.min(inner.p1.y, inner.p2.y);
    const innerYMax = Math.max(inner.p1.y, inner.p2.y);
    const outerYMin = Math.min(outer.p1.y, outer.p2.y);
    const outerYMax = Math.max(outer.p1.y, outer.p2.y);
    return innerYMin >= outerYMin && innerYMax <= outerYMax;
  }
  // 斜め辺は対象外
  return false;
}

// ============================================================
// target 建物の辺のうち、cover 建物で「覆われていない」辺を返す。
//
// 判定:
//   1. target の辺が cover の辺と完全一致するなら共通辺扱い → 覆われている (false)
//      （1F が 2F と同じ位置の辺を持つケースで誤判定回避）
//   2. target の辺が cover のいずれかの辺の上に完全に乗っている（包含）なら
//      共通部分扱い → 覆われている (false)
//      （1F の C 辺・G 辺などが 2F の長い1辺の一部分と重なるケース）
//   3. それ以外は、辺の中点から外向き法線方向に 1 グリッド (=10mm) ずらした点が
//      cover ポリゴンの「外側」にあれば、その辺は覆われていない (true)
//
// 使用例（1F+2F同時モード）:
//   getEdgesNotCoveredBy(building1F, building2F)
//     → 1F のうち 2F で覆えない辺（＝下屋部分）に 1F 足場必要
//   2F 側は常に全周足場なので、この関数で絞り込む必要なし
// ============================================================
export function getEdgesNotCoveredBy(
  target: BuildingShape,
  cover: BuildingShape,
): EdgeInfo[] {
  const edges = getBuildingEdgesClockwise(target);
  const coverEdges = getBuildingEdgesClockwise(cover);
  const polyCover = cover.points;
  return edges.filter(edge => {
    // 1. cover の辺と完全一致するなら共通辺 → 覆われている扱い
    const isSharedEdge = coverEdges.some(ce =>
      (edge.p1.x === ce.p1.x && edge.p1.y === ce.p1.y && edge.p2.x === ce.p2.x && edge.p2.y === ce.p2.y) ||
      (edge.p1.x === ce.p2.x && edge.p1.y === ce.p2.y && edge.p2.x === ce.p1.x && edge.p2.y === ce.p1.y)
    );
    if (isSharedEdge) return false;

    // 2. target の辺が cover のいずれかの辺に包含されているなら共通部分扱い
    const isContainedInCoverEdge = coverEdges.some(ce => isEdgeContainedIn(edge, ce));
    if (isContainedInCoverEdge) return false;

    // 3. 中点を外向きに 1 グリッドずらした点が cover ポリゴン外なら覆われていない
    const midX = (edge.p1.x + edge.p2.x) / 2;
    const midY = (edge.p1.y + edge.p2.y) / 2;
    const testX = midX + edge.nx * 1;
    const testY = midY + edge.ny * 1;
    return !isPointInPolygon(testX, testY, polyCover);
  });
}

// ============================================================
// Phase H-3d-2 Stage 2: 1F辺と2F辺の「同一直線上で連動」判定
//
// bothmode の自動割付で、1F の壁と 2F の壁が同じ直線上にあるとき、
// それらは「連動」して扱われる必要がある (= 足場ラインも揃える)。
// この判定を機械的に行うための純粋関数を提供する。
//
// 連動条件 (全て満たすとき true):
//   1. 両辺とも軸並行 (水平または垂直、斜めは false)
//   2. 両辺の handrailDir が一致
//   3. 固定軸座標が一致 (horizontal: Y、vertical: X)
//   4. 1F辺の可変軸範囲が 2F辺の可変軸範囲に完全に含まれる
//   5. 法線方向が一致 (外向き法線が同じ向き)
// ============================================================
export function isCollinearWith(edge1F: EdgeInfo, edge2F: EdgeInfo): boolean {
  // 1. 両辺とも軸並行 (handrailDir が定まっていれば軸並行)
  // handrailDir は 'horizontal' | 'vertical' で、getBuildingEdgesClockwise で
  // 既に face/handrailDir が決まっている。axis-aligned 確認のため明示的に座標で判定。
  const e1IsH = edge1F.p1.y === edge1F.p2.y;
  const e1IsV = edge1F.p1.x === edge1F.p2.x;
  const e2IsH = edge2F.p1.y === edge2F.p2.y;
  const e2IsV = edge2F.p1.x === edge2F.p2.x;
  if (!(e1IsH || e1IsV)) return false;
  if (!(e2IsH || e2IsV)) return false;

  // 2. handrailDir 一致
  if (edge1F.handrailDir !== edge2F.handrailDir) return false;

  // 3. 固定軸座標一致
  if (edge1F.handrailDir === 'horizontal') {
    if (edge1F.p1.y !== edge2F.p1.y) return false;
  } else {
    if (edge1F.p1.x !== edge2F.p1.x) return false;
  }

  // 4. 1F の可変軸範囲が 2F の可変軸範囲に完全に含まれる
  if (edge1F.handrailDir === 'horizontal') {
    const min1 = Math.min(edge1F.p1.x, edge1F.p2.x);
    const max1 = Math.max(edge1F.p1.x, edge1F.p2.x);
    const min2 = Math.min(edge2F.p1.x, edge2F.p2.x);
    const max2 = Math.max(edge2F.p1.x, edge2F.p2.x);
    if (min1 < min2 || max1 > max2) return false;
  } else {
    const min1 = Math.min(edge1F.p1.y, edge1F.p2.y);
    const max1 = Math.max(edge1F.p1.y, edge1F.p2.y);
    const min2 = Math.min(edge2F.p1.y, edge2F.p2.y);
    const max2 = Math.max(edge2F.p1.y, edge2F.p2.y);
    if (min1 < min2 || max1 > max2) return false;
  }

  // 5. 法線方向一致 (外向き法線、getBuildingEdgesClockwise で計算済み)
  if (edge1F.nx !== edge2F.nx || edge1F.ny !== edge2F.ny) return false;

  return true;
}

/**
 * edge1F が edge2F と「同一壁の隣接継続」か判定する (面一の含有 collinear とは別の第3区分)。
 * 同じ handrailDir・同じ固定軸座標・同じ外向き法線で、edge1F の始点が edge2F の終点に
 * 一致し同方向に延長する場合 true。例: 2F東(y0-4000) の続きの 1F東(y4000-7000)。
 * 面一(isCollinearWith=含有)でも pillar(下屋への折れ)でもなく、足場は1本の連続ラインになる。
 */
export function isWallContinuation(edge2F: EdgeInfo, edge1F: EdgeInfo): boolean {
  if (edge1F.handrailDir !== edge2F.handrailDir) return false;
  if (edge1F.nx !== edge2F.nx || edge1F.ny !== edge2F.ny) return false;
  // 固定軸座標一致
  if (edge2F.handrailDir === 'horizontal') {
    if (edge1F.p1.y !== edge2F.p1.y) return false;
  } else {
    if (edge1F.p1.x !== edge2F.p1.x) return false;
  }
  // 1F の始点が 2F の終点に一致 (= 2F の続きから始まる)
  const eq = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
  if (!eq(edge1F.p1, edge2F.p2)) return false;
  // 同方向に延長
  const d2 = edge2F.handrailDir === 'horizontal'
    ? Math.sign(edge2F.p2.x - edge2F.p1.x) : Math.sign(edge2F.p2.y - edge2F.p1.y);
  const d1 = edge1F.handrailDir === 'horizontal'
    ? Math.sign(edge1F.p2.x - edge1F.p1.x) : Math.sign(edge1F.p2.y - edge1F.p1.y);
  return d1 === d2 && d1 !== 0;
}

/**
 * 建物全体の連動ペア (1F辺 ↔ 2F辺) を抽出する。
 * 各 1F 辺について、isCollinearWith(edge1F, edge2F) が true になる
 * 最初の 2F 辺をペアとして登録 (1F 辺 1 本に対して 2F 辺は最大 1 本対応する想定)。
 */
export function findCollinearEdgePairs(
  building1F: BuildingShape,
  building2F: BuildingShape,
): Array<{ edge1FIndex: number; edge2FIndex: number }> {
  const edges1F = getBuildingEdgesClockwise(building1F);
  const edges2F = getBuildingEdgesClockwise(building2F);
  const pairs: Array<{ edge1FIndex: number; edge2FIndex: number }> = [];
  for (const e1 of edges1F) {
    const e2 = edges2F.find(e => isCollinearWith(e1, e));
    if (e2) {
      pairs.push({ edge1FIndex: e1.index, edge2FIndex: e2.index });
    }
  }
  return pairs;
}

/**
 * Phase H-3d-2 重大変更: 軸並行辺の上に乗っている (両端を除く) 投影頂点を挿入する汎用関数。
 * splitBuilding1FAtBuilding2FVertices / splitBuilding2FAt1FVertices の共通処理。
 */
function splitBuildingAtVertices(
  target: BuildingShape,
  source: BuildingShape,
): BuildingShape {
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const eqPt = (a: Point, b: Point) => eq(a.x, b.x) && eq(a.y, b.y);

  const ptsTarget = target.points;
  const ptsSource = source.points;
  const n = ptsTarget.length;
  if (n < 3) return target;

  const newPoints: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = ptsTarget[i];
    const p2 = ptsTarget[(i + 1) % n];
    newPoints.push({ x: p1.x, y: p1.y });

    // 軸並行辺のみ対象 (斜め辺は分割しない)
    const isH = eq(p1.y, p2.y);
    const isV = eq(p1.x, p2.x);
    if (!isH && !isV) continue;

    // この辺上に乗っている source 頂点を抽出 (両端は除外)
    const inserts: Point[] = [];
    for (const v of ptsSource) {
      if (eqPt(v, p1) || eqPt(v, p2)) continue;
      if (isH) {
        if (!eq(v.y, p1.y)) continue;
        const min = Math.min(p1.x, p2.x);
        const max = Math.max(p1.x, p2.x);
        if (v.x <= min + 0.001 || v.x >= max - 0.001) continue;
      } else {
        if (!eq(v.x, p1.x)) continue;
        const min = Math.min(p1.y, p2.y);
        const max = Math.max(p1.y, p2.y);
        if (v.y <= min + 0.001 || v.y >= max - 0.001) continue;
      }
      inserts.push({ x: v.x, y: v.y });
    }

    if (inserts.length === 0) continue;

    // 進行方向 (p1 → p2) でソート
    if (isH) {
      const ascending = p2.x > p1.x;
      inserts.sort((a, b) => ascending ? a.x - b.x : b.x - a.x);
    } else {
      const ascending = p2.y > p1.y;
      inserts.sort((a, b) => ascending ? a.y - b.y : b.y - a.y);
    }
    for (const ins of inserts) newPoints.push(ins);
  }

  // Phase H-3d-2 重大変更: 出力を canonical CW + NW 起点に正規化。
  // canvasStore に CCW で保存 OR CW で別頂点起点 (例: SW 起点) で保存されている可能性に対応。
  // getBuildingEdgesClockwise は points[0] から順に edge.label A/B/C/D を振るため、
  // ここで NW 起点に揃えないとラベルが回転して見える。
  //
  // Step 1: shoelace < 0 なら CCW → reverse して CW に
  // Step 2: 最も NW 寄りの頂点 (X 最小、同点なら Y 最小) を points[0] に rotate
  let shoelaceSum = 0;
  for (let i = 0; i < newPoints.length; i++) {
    const p1 = newPoints[i];
    const p2 = newPoints[(i + 1) % newPoints.length];
    shoelaceSum += p1.x * p2.y - p2.x * p1.y;
  }
  let outPoints = shoelaceSum < 0 ? [...newPoints].reverse() : newPoints;

  // Step 2: NW 起点へ rotate
  let nwIdx = 0;
  for (let i = 1; i < outPoints.length; i++) {
    const cur = outPoints[i], best = outPoints[nwIdx];
    if (cur.x < best.x - 0.001) {
      nwIdx = i;
    } else if (Math.abs(cur.x - best.x) < 0.001 && cur.y < best.y - 0.001) {
      nwIdx = i;
    }
  }
  if (nwIdx > 0) {
    outPoints = [...outPoints.slice(nwIdx), ...outPoints.slice(0, nwIdx)];
  }

  return { ...target, points: outPoints };
}

/**
 * Phase H-3d-2 修正A: 1Fポリゴンに2Fの頂点を投影して頂点を追加する。
 *
 * 1Fの各軸並行辺について、その辺上に乗っている (両端を除く) 2F の頂点を見つけて、
 * 1Fの頂点列の該当位置に挿入する。これにより、1F辺が「2Fと連動する部分」と
 * 「下屋として独立する部分」で自動分割され、後続の連動判定 (isCollinearWith) が
 * 部分連動も正しく扱えるようになる。
 *
 * 例: 1F南面が X=-150 から X=750 (Y=550) の 1 辺で、2F南面の右端頂点 (X=450,Y=550)
 *     がこの辺上にある場合、1F南面は X=[-150,450] と X=[450,750] の 2 辺に分割される。
 *
 * 副作用なし、新しい BuildingShape を返す純粋関数。
 */
export function splitBuilding1FAtBuilding2FVertices(
  building1F: BuildingShape,
  building2F: BuildingShape,
): BuildingShape {
  return splitBuildingAtVertices(building1F, building2F);
}

/**
 * Phase H-3d-2 重大変更 (B1/B2 概念導入): 2Fポリゴンに 1F の頂点を投影して頂点を追加する。
 *
 * 2Fの各軸並行辺について、その辺上に乗っている (両端を除く) 1F の頂点を見つけて、
 * 2Fの頂点列の該当位置に挿入する。これにより、2F辺が「下屋の境」で自動分割され、
 * 後続の bothmode 計算で「intra-edge セグメント分割」を行う必要がなくなる
 * (各辺が常に 1 segment になるため)。
 *
 * 例: 2F東面が Y=-150 から Y=550 (X=450) の 1 辺で、1F の段差頂点 (X=450,Y=150)
 *     がこの辺上にある場合、2F東面は Y=[-150,150] (B1) と Y=[150,550] (B2) の 2 辺に分割される。
 *
 * 副作用なし、新しい BuildingShape を返す純粋関数。
 * splitBuilding1FAtBuilding2FVertices と完全対称的。
 */
export function splitBuilding2FAt1FVertices(
  building1F: BuildingShape,
  building2F: BuildingShape,
): BuildingShape {
  return splitBuildingAtVertices(building2F, building1F);
}

// ============================================================
// N階一般化 P3-0: 上下中立エイリアス（中身は既存関数への委譲のみ・挙動不変）
// ------------------------------------------------------------
// カスケード(P3-1以降)では「1F/2F」ではなく「上(upper)/下(lower)」の隣接ペアで
// 幾何ヘルパを呼ぶ。既存の階固定名・実装・挙動・呼び出し箇所は一切変えず、
// 中立な呼び名を足すだけ。下の各関数は元から2引数の純関数で上下中立に呼べる。
// isWallContinuation(a, b) は既に中立名のため別名は設けず、そのまま使う。
// ============================================================

/** 下階ポリゴンを上階の頂点で分割する（= splitBuilding1FAtBuilding2FVertices の中立名）。*/
export const splitLowerAtUpper = (lower: BuildingShape, upper: BuildingShape): BuildingShape =>
  splitBuilding1FAtBuilding2FVertices(lower, upper);

/** 上階ポリゴンを下階の頂点で分割する（= splitBuilding2FAt1FVertices の中立名）。
 *  ※既存 splitBuilding2FAt1FVertices(building1F, building2F) は引数順が (下, 上) のため、
 *    委譲時は (lower, upper) の順で渡す。*/
export const splitUpperAtLower = (upper: BuildingShape, lower: BuildingShape): BuildingShape =>
  splitBuilding2FAt1FVertices(lower, upper);

/** target 辺のうち cover に覆われない辺（= getEdgesNotCoveredBy の中立別名）。
 *  下屋は edgesNotCoveredBy(lower, upper)、せり出しは edgesNotCoveredBy(upper, lower) で対称に呼べる。*/
export const edgesNotCoveredBy = (target: BuildingShape, cover: BuildingShape): EdgeInfo[] =>
  getEdgesNotCoveredBy(target, cover);

/** 2辺が同一直線上で連動するか（= isCollinearWith の中立別名）。引数の上下は不問。*/
export const isCollinear = (a: EdgeInfo, b: EdgeInfo): boolean =>
  isCollinearWith(a, b);

/** 隣接ペアの連動辺ペア（= findCollinearEdgePairs の中立別名）。
 *  戻り値のキーは既存どおり { edge1FIndex(=下階), edge2FIndex(=上階) }。*/
export const collinearPairs = (
  lower: BuildingShape,
  upper: BuildingShape,
): Array<{ edge1FIndex: number; edge2FIndex: number }> =>
  findCollinearEdgePairs(lower, upper);

// ============================================================
// Phase H-3d-2 Stage 3: bothmode 専用の 2F 計算関数
//
// 2F 面が 1F 下屋と交差する場合、その 2F 面を N 個のセグメントに分割。
// 各セグメント間に柱を仕込み、対応する 1F 面の希望離れを参照して位置を決める。
// 同一直線連動する交差点では柱仕込みを省略する (次の 2F 面で処理されるため)。
// ============================================================

/** Bothmode 2F edge の 1 セグメント */
export type Bothmode2FEdgeSegment = {
  edge2FIndex: number;
  segmentIndex: number;          // この 2F 面の中で何番目のセグメントか (0-based)
  segmentCount: number;          // この 2F 面の総セグメント数

  // セグメント自体の物理情報
  startPoint: Point;
  endPoint: Point;
  segmentLengthMm: number;
  face: FaceDir;
  handrailDir: 'horizontal' | 'vertical';
  nx: number;
  ny: number;

  // 離れ情報
  startDistanceMm: number;
  desiredEndDistanceMm: number;
  desiredEndSource:
    | { kind: 'next-2F-face'; edge2FIndex: number }
    | { kind: '1F-face-pillar'; edge1FIndex: number };

  // 候補と選択 (既存 SequentialCandidate を流用)
  candidates: SequentialCandidate[];
  selectedIndex: number;
  isLocked: boolean;
  isAutoProgress: boolean;
  prevCornerIsConvex: boolean;
  nextCornerIsConvex: boolean;

  // 描画用座標 (セグメント単位)
  scaffoldCoord: number;
  cursorStart: number;
  cursorEnd: number;
  effectiveMm: number;
};

export type Bothmode2FResult = {
  edgeSegments: Bothmode2FEdgeSegment[];
  hasUnresolved: boolean;
};

/**
 * 2F 面の足場ライン (壁から離れだけ離れた直線) と交差する 1F 壁を、
 * 進行方向順に並べて返す。
 * 「次の 2F 面と同一直線連動」する 1F 壁は除外される (柱仕込み不要)。
 */
function findPillarPointsAlong2FEdge(
  edge2F: EdgeInfo,
  distance2FMm: number,
  edges1F: EdgeInfo[],
  collinearPairs: Array<{ edge1FIndex: number; edge2FIndex: number }>,
  nextEdge2FIndex: number,
): Array<{ edge1FIndex: number; intersectPoint: Point }> {
  const distGrid = mmToGrid(distance2FMm);
  // 2F 足場ラインの軸座標 (edge2F の壁から法線方向に distGrid 離れる)
  const e2IsH = edge2F.handrailDir === 'horizontal';
  const scaffoldAxisCoord = e2IsH
    ? (edge2F.p1.y + edge2F.p2.y) / 2 + edge2F.ny * distGrid
    : (edge2F.p1.x + edge2F.p2.x) / 2 + edge2F.nx * distGrid;

  // edge2F の進行方向沿いの範囲 (可変軸)
  const edgeMinAlong = e2IsH
    ? Math.min(edge2F.p1.x, edge2F.p2.x)
    : Math.min(edge2F.p1.y, edge2F.p2.y);
  const edgeMaxAlong = e2IsH
    ? Math.max(edge2F.p1.x, edge2F.p2.x)
    : Math.max(edge2F.p1.y, edge2F.p2.y);

  // 進行方向 (edge2F.p1 → edge2F.p2 で増えるか減るか)
  const progressDelta = e2IsH
    ? edge2F.p2.x - edge2F.p1.x
    : edge2F.p2.y - edge2F.p1.y;
  const progressSign = progressDelta >= 0 ? 1 : -1;

  type Pillar = { edge1FIndex: number; intersectPoint: Point; alongCoord: number };
  const result: Pillar[] = [];

  for (const e1 of edges1F) {
    const e1IsH = e1.handrailDir === 'horizontal';
    const e1IsAxisAligned = (e1.p1.x === e1.p2.x) || (e1.p1.y === e1.p2.y);
    if (!e1IsAxisAligned) continue;

    // edge2F と平行 (両方 H or 両方 V) なら交差せず
    if (e1IsH === e2IsH) continue;

    // セグメント分割点 = edge2F 壁上の交差投影点 (進行軸は 1F 壁の位置、固定軸は edge2F の壁座標)
    // ※ 足場ライン上の座標ではなく edge2F 壁上に取ることで、セグメントの startPoint/endPoint が
    //    edge2F の物理上を順次区切る形になる。
    let intersectPoint: Point;
    if (e2IsH) {
      intersectPoint = { x: e1.p1.x, y: edge2F.p1.y };
    } else {
      intersectPoint = { x: edge2F.p1.x, y: e1.p1.y };
    }

    // 交差点が edge2F の進行方向範囲内か (内部、端点除外)
    const alongCoord = e2IsH ? intersectPoint.x : intersectPoint.y;
    if (alongCoord <= edgeMinAlong || alongCoord >= edgeMaxAlong) continue;

    // 交差点が 1F 壁のセグメント範囲内か (1F 壁の固定軸方向で確認)
    const e1AlongCoord = e1IsH ? intersectPoint.x : intersectPoint.y;
    const e1Min = e1IsH
      ? Math.min(e1.p1.x, e1.p2.x)
      : Math.min(e1.p1.y, e1.p2.y);
    const e1Max = e1IsH
      ? Math.max(e1.p1.x, e1.p2.x)
      : Math.max(e1.p1.y, e1.p2.y);
    // ただし 1F 壁延長線の場合、交差点が 1F 壁の固定軸 (e1IsH なら Y) と一致する必要あり
    const e1FixedCoord = e1IsH ? e1.p1.y : e1.p1.x;
    const intersectFixed = e1IsH ? intersectPoint.y : intersectPoint.x;
    // 注: 上の構築で intersectFixed は scaffoldAxisCoord (2F 足場の固定軸)
    // 1F 壁の延長線は無限長と考えるので、固定軸の一致確認は不要
    void e1FixedCoord;
    void intersectFixed;
    // 1F 壁が「延長線上の交差点を含む」= 2F 足場ライン側に伸びている必要がある
    // 1F 壁の進行方向範囲 (e1IsH なら X 範囲) と交差点の対応軸が一致
    void e1AlongCoord; // ここは実は 1F 壁の固定軸座標と異なる
    // 1F 壁が交差点まで届くかは、1F 壁の固定軸 (e1IsH なら Y) と交差点の Y を比較
    // ただし 1F 壁の Y は 1 点 (固定軸)、交差点の Y は scaffoldAxisCoord
    // → 1F 壁の延長線が 2F 足場ラインに到達するなら、固定軸的な距離は問題ない
    // → 必要なのは「1F 壁の進行方向範囲が交差点の対応軸座標を含むか」
    //   1F が水平 (Y=固定): 進行方向 X、交差点 X = e1.p1.x → 必ず e1 の端点 (= 含まない、等しい)
    //   1F が垂直 (X=固定): 進行方向 Y、交差点 Y = e1.p1.y → 必ず e1 の端点
    // → 上の構築は「1F 壁の延長点として、2F 足場ラインと交わる点」なので
    //   常に 1F 壁の端点のうち固定軸が一致するもの (その方向の延長線)
    // → 1F 壁の延長線が 2F 足場ラインに「到達するか」のチェックは:
    //   1F 壁の固定軸 (e1IsH なら e1.p1.y) と 2F 足場ラインの軸 (scaffoldAxisCoord) を比較し、
    //   1F 壁が 2F 足場ライン側に伸びる方向にあるかを確認
    // 簡略化: 1F 壁の壁長が (1F 壁の固定軸 - 2F 足場ラインの固定軸) の絶対値以上か。
    // ここでは 1F 壁が「2F 足場ライン側に伸びている」(= 範囲に交差点を含む) ものに限定:
    if (e1IsH) {
      // 1F 水平: 固定軸 Y = e1.p1.y、進行軸 X = [e1Min, e1Max]
      // 2F 垂直: 足場ライン X = scaffoldAxisCoord
      // 交差点: (scaffoldAxisCoord, e1.p1.y)
      // 1F 壁が 2F 足場ライン側に伸びるか: scaffoldAxisCoord が e1 の X 範囲内か
      if (scaffoldAxisCoord < e1Min || scaffoldAxisCoord > e1Max) continue;
    } else {
      // 1F 垂直: 固定軸 X = e1.p1.x、進行軸 Y = [e1Min, e1Max]
      // 2F 水平: 足場ライン Y = scaffoldAxisCoord
      // 交差点: (e1.p1.x, scaffoldAxisCoord)
      if (scaffoldAxisCoord < e1Min || scaffoldAxisCoord > e1Max) continue;
    }

    // collinearPairs フィルタ: この 1F edge が「次の 2F edge」と連動なら除外
    const isCollinearWithNext = collinearPairs.some(
      p => p.edge1FIndex === e1.index && p.edge2FIndex === nextEdge2FIndex,
    );
    if (isCollinearWithNext) continue;

    result.push({ edge1FIndex: e1.index, intersectPoint, alongCoord });
  }

  // edge2F の進行方向順にソート
  result.sort((a, b) => progressSign * (a.alongCoord - b.alongCoord));

  return result.map(r => ({
    edge1FIndex: r.edge1FIndex,
    intersectPoint: r.intersectPoint,
  }));
}

/**
 * bothmode 専用: 2F 全周を順次決定で割付。
 *
 * Phase H-3d-2 重大変更 (B1/B2 概念導入): building2F は呼び出し側で
 * splitBuilding2FAt1FVertices 適用済みの想定。各 2F 辺は常に 1 segment として処理する
 * (segmentIndex=0, segmentCount=1)。1F 段差頂点による「intra-edge セグメント分割」は不要。
 *
 * 直線継続 (B1→B2 のような cross product=0 の境界) では rails contribution = 0、
 * 90° コーナーでは凸/凹に応じた contribution。1F 段差ピラー (= 2F 辺の終点が 1F の独立辺
 * の起点と一致) は desiredEndSource = '1F-face-pillar' でマーク。
 */
export function computeBothmode2FLayout(
  building2F: BuildingShape,
  building1F: BuildingShape,
  distances2F: Record<number, number>,
  distances1F: Record<number, number>,
  scaffoldStart: ScaffoldStartConfig,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  userSelections?: Record<string, number>,        // key: `${edge2FIndex}-0`
  userAdjustments?: Record<string, EdgeAdjustment>,
): Bothmode2FResult {
  const edges2F = getBuildingEdgesClockwise(building2F);
  const edges1F = getBuildingEdgesClockwise(building1F);
  const collinearPairs = findCollinearEdgePairs(building1F, building2F);

  const n2F = edges2F.length;
  if (n2F < 3) return { edgeSegments: [], hasUnresolved: false };

  const startIdx = (scaffoldStart.startVertexIndex ?? 0) % n2F;

  // 各 2F edge ごとのコーナー凸/凹判定
  const cornerConvexity2F: boolean[] = [];
  for (let i = 0; i < n2F; i++) {
    const e1 = edges2F[i];
    const e2 = edges2F[(i + 1) % n2F];
    cornerConvexity2F.push(isConvexCorner(e1, e2));
  }

  // 各 2F edge の終点が 1F 段差ピラー (= 1F 独立辺の端点と一致 + 連動でない) か検出
  // pillar = 1F 下屋方向に分岐するセグメント境界 → desiredEndSource = '1F-face-pillar'
  // 1F polygon の頂点には 2 本の 1F 辺が接続するため、p1/p2 両方をチェック。
  // 連動辺 (this 2F or next 2F と collinear) は壁の続きなのでピラーではない。
  const eqPt = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
  const findPillarEdge1FAtEndpoint = (
    endPoint: Point,
    thisEdge2FIndex: number,
    nextEdge2FIndex: number,
  ): number | null => {
    for (const e1 of edges1F) {
      if (!eqPt(e1.p1, endPoint) && !eqPt(e1.p2, endPoint)) continue;
      const isCollinearWithThis = collinearPairs.some(
        p => p.edge1FIndex === e1.index && p.edge2FIndex === thisEdge2FIndex,
      );
      if (isCollinearWithThis) continue;
      const isCollinearWithNext = collinearPairs.some(
        p => p.edge1FIndex === e1.index && p.edge2FIndex === nextEdge2FIndex,
      );
      if (isCollinearWithNext) continue;
      return e1.index;
    }
    return null;
  };

  const intermediate: Bothmode2FEdgeSegment[] = [];
  let prevEndDistanceMm: number | undefined = undefined;
  let prevSegmentStartDist: number | undefined = undefined;
  let hasUnresolved = false;

  for (let k = 0; k < n2F; k++) {
    const i = (startIdx + k) % n2F;
    const edge2F = edges2F[i];
    const nextEdge2F = edges2F[(i + 1) % n2F];
    const isFirstInLoop = k === 0;

    // Phase H-3d-2 直線継続対応 (師匠の現場ロジック): 前/次辺と同じ face かつ同じ handrailDir なら「同じ壁の続き」。
    // 例: B1 → B2 (どちらも東面 vertical)。
    // cross product = 0 で isConvexCorner=false だが、現場では「凸コーナーと同じ式」で扱う:
    //   - rails contribution: +distance (= 凸と同じ +contribution)
    //   - startDistanceMm: prev seg startDist を継承 (B 面の続きなので同じ離れ)
    const prevEdge2F = edges2F[(i - 1 + n2F) % n2F];
    const nextEdge2FCheck = edges2F[(i + 1) % n2F];
    const isPrevStraight =
      prevEdge2F.face === edge2F.face && prevEdge2F.handrailDir === edge2F.handrailDir;
    const isNextStraight =
      nextEdge2FCheck.face === edge2F.face && nextEdge2FCheck.handrailDir === edge2F.handrailDir;
    const isStraightContinuation = isPrevStraight;

    // 終点希望離れの参照先 (1F 段差ピラー or 次 2F 面)
    // 凸/凹判定の前に決定する必要あり (desiredEndSource で convex 判定が変わるため)
    const pillarEdge1FIdx = findPillarEdge1FAtEndpoint(
      edge2F.p2, edge2F.index, nextEdge2F.index,
    );
    const desiredEndSource: Bothmode2FEdgeSegment['desiredEndSource'] = pillarEdge1FIdx !== null
      ? { kind: '1F-face-pillar', edge1FIndex: pillarEdge1FIdx }
      : { kind: 'next-2F-face', edge2FIndex: nextEdge2F.index };
    const desiredEndDistanceMm = pillarEdge1FIdx !== null
      ? (distances1F[pillarEdge1FIdx] ?? 900)
      : (distances2F[nextEdge2F.index] ?? 900);

    // cornerConvex 判定 (師匠の現場ロジック、外積ベース):
    //   - 通常の cross-edge (next = 次の 2F 面): cornerConvexity2F[i] (物理凸/凹)
    //   - 直線継続 (cross=0、同 face): convex (B 面足場ライン一直線扱い)
    //   - 1F-face-pillar (下屋への折れ): 2F edge と 1F pillar edge の外積で判定
    //       1F edge の natural direction (p1→p2) をそのまま使う
    //       例: B1(0,+300) × 1C(+300,0) = -90000 < 0 → 凹 (下屋に凹む)
    //       例: B2(0,+400) × 1E(-300,0) = +120000 > 0 → 凸
    // 直線継続(壁が同一面で続く)では、前セグメントが下屋接続点で +離れ 張り出した分だけ
    // 当該セグメントの始点を逆向き(凹)に揃えて連続させる(二重張り出し=重複/T字を防ぐ)。
    // prevConvex = !前セグメントの nextConvex。先頭(前なし)は従来どおり凸(直線扱い)。
    const prevCornerIsConvex = (isPrevStraight && intermediate.length > 0)
      ? !intermediate[intermediate.length - 1].nextCornerIsConvex
      : (cornerConvexity2F[(i - 1 + n2F) % n2F] || isPrevStraight);
    let nextCornerIsConvex: boolean;
    if (desiredEndSource.kind === '1F-face-pillar') {
      const pillarEdge1F = edges1F.find(e => e.index === desiredEndSource.edge1FIndex);
      if (pillarEdge1F && isWallContinuation(edge2F, pillarEdge1F)) {
        // 同一壁の隣接継続(面一の続き): 直線継続として角を越えて cursor を延長し、
        // 1F 側の続きと足場ラインを連続させる(端で内引きして隙間を作らない)。
        nextCornerIsConvex = true;
      } else if (pillarEdge1F) {
        const ax = edge2F.p2.x - edge2F.p1.x;
        const ay = edge2F.p2.y - edge2F.p1.y;
        const bx = pillarEdge1F.p2.x - pillarEdge1F.p1.x;
        const by = pillarEdge1F.p2.y - pillarEdge1F.p1.y;
        nextCornerIsConvex = (ax * by - ay * bx) > 0;
      } else {
        nextCornerIsConvex = cornerConvexity2F[i] || isNextStraight;
      }
    } else {
      nextCornerIsConvex = cornerConvexity2F[i] || isNextStraight;
    }

    // 始点離れの決定:
    //   - 最初の辺 (起点辺): scaffoldStart.face*DistanceMm
    //   - 直線継続 (B1→B2 等): prev seg の startDistanceMm を継承
    //   - それ以外 (cross-edge): prevEndDistanceMm (前辺 actualEnd を継承)
    let startDistanceMm: number;
    if (isFirstInLoop) {
      startDistanceMm = edge2F.handrailDir === 'horizontal'
        ? scaffoldStart.face1DistanceMm
        : scaffoldStart.face2DistanceMm;
    } else if (isStraightContinuation) {
      startDistanceMm = prevSegmentStartDist ?? distances2F[edge2F.index] ?? 900;
    } else {
      startDistanceMm = prevEndDistanceMm ?? distances2F[edge2F.index] ?? 900;
    }

    // 直前辺の startDist
    const prevEdgeStartDistanceMm = prevSegmentStartDist
      ?? (distances2F[edges2F[(i - 1 + n2F) % n2F].index] ?? 900);

    // userAdjustments
    const segKey = `${edge2F.index}-0`;
    const adj = userAdjustments?.[segKey] ?? DEFAULT_EDGE_ADJUSTMENT;

    const candidates = generateSequentialCandidates(
      edge2F.lengthMm,
      startDistanceMm,
      desiredEndDistanceMm,
      prevCornerIsConvex,
      nextCornerIsConvex,
      prevEdgeStartDistanceMm,
      enabledSizes,
      priorityConfig,
      adj.larger.offsetIdx,
      adj.smaller.offsetIdx,
      adj.larger.variationIdx,
      adj.smaller.variationIdx,
    );

    let selectedIndex = userSelections?.[segKey] ?? 0;
    if (selectedIndex >= candidates.length) selectedIndex = 0;

    // 自動進行は「候補1件 かつ 離れ差0 かつ 端数0」のみ。
    // 離れが動く案(diff≠0)や端数あり(rule5)はモーダルで提案する。
    const isAutoProgress = candidates.length === 1
      && candidates[0].diffFromDesired === 0
      && (candidates[0].remainder ?? 0) === 0;
    // Phase H-3d-2 仕様簡素化: locked 概念廃止。常に false (互換性のためフィールド維持)。
    const isLocked = false;

    if (!isAutoProgress) hasUnresolved = true;

    // 描画用座標 (1st pass)
    const distGrid = mmToGrid(startDistanceMm);
    const scaffoldCoord = edge2F.handrailDir === 'horizontal'
      ? edge2F.p1.y + edge2F.ny * distGrid
      : edge2F.p1.x + edge2F.nx * distGrid;
    const dx = edge2F.p2.x - edge2F.p1.x;
    const dy = edge2F.p2.y - edge2F.p1.y;
    const sign = edge2F.handrailDir === 'horizontal'
      ? (dx >= 0 ? 1 : -1)
      : (dy >= 0 ? 1 : -1);
    const cursorStart = edge2F.handrailDir === 'horizontal'
      ? edge2F.p1.x
      : edge2F.p1.y;
    const railsTotal = candidates[selectedIndex]?.totalMm ?? edge2F.lengthMm;
    const cursorEnd = cursorStart + sign * (railsTotal / 10);
    const effectiveMm = railsTotal;

    intermediate.push({
      edge2FIndex: edge2F.index,
      segmentIndex: 0,
      segmentCount: 1,
      startPoint: edge2F.p1,
      endPoint: edge2F.p2,
      segmentLengthMm: edge2F.lengthMm,
      face: edge2F.face,
      handrailDir: edge2F.handrailDir,
      nx: edge2F.nx,
      ny: edge2F.ny,
      startDistanceMm,
      desiredEndDistanceMm,
      desiredEndSource,
      candidates,
      selectedIndex,
      isLocked,
      isAutoProgress,
      prevCornerIsConvex,
      nextCornerIsConvex,
      scaffoldCoord,
      cursorStart,
      cursorEnd,
      effectiveMm,
    });

    // Phase H-3d-2 仕様簡素化: 単純な cascade。actualEndDistanceMm を次辺に継承。
    if (candidates.length > 0) {
      prevEndDistanceMm = candidates[selectedIndex].actualEndDistanceMm;
    } else {
      prevEndDistanceMm = desiredEndDistanceMm;
    }
    prevSegmentStartDist = startDistanceMm;
  }

  // 2nd pass: cursor 再計算 (corner-aware、 rails 合計と一致する形)。
  // - 凸/直線継続 (prevCornerIsConvex): 前面の足場ラインに揃える → 前の seg の startDist で extension
  // - 凹 (prevCornerIsConvex=false): 自分の離れで内引き
  // - 凸 next: 次面方向に extension (actualEnd で前進)
  // - 凹 next: 内引き (actualEnd で後退)
  // → cursor span = railsTotal
  const nIntm = intermediate.length;
  for (let k = 0; k < nIntm; k++) {
    const s = intermediate[k];

    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    const sign = s.handrailDir === 'horizontal' ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);

    const wallStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    const wallEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;

    // prev seg (CW closed loop) → 凸 extension で「前面の startDist」を使う
    const prevSeg = intermediate[(k - 1 + nIntm) % nIntm];
    const prevDistGrid = mmToGrid(prevSeg.startDistanceMm);
    const startDistGrid = mmToGrid(s.startDistanceMm);
    const actualEndMm =
      s.candidates[s.selectedIndex]?.actualEndDistanceMm ?? s.desiredEndDistanceMm;
    const endDistGrid = mmToGrid(actualEndMm);

    // 凸/直線継続: prev face の足場ラインに揃える (= 前の seg の startDist 分 extension)
    // 凹: 自分の離れで内引き
    const cursorStart = s.prevCornerIsConvex
      ? wallStart - sign * prevDistGrid
      : wallStart + sign * startDistGrid;
    const cursorEnd = s.nextCornerIsConvex
      ? wallEnd + sign * endDistGrid
      : wallEnd - sign * endDistGrid;

    intermediate[k] = {
      ...s,
      cursorStart,
      cursorEnd,
      effectiveMm: Math.max(0, Math.round(Math.abs(cursorEnd - cursorStart) * 10)),
    };
  }

  return { edgeSegments: intermediate, hasUnresolved };
}

// ============================================================
// Phase H-3d-2 Stage 4: bothmode 専用の 1F 計算関数
//
// Stage 3 の Bothmode2FResult を入力として受け取り、1F 全周を時計回りに
// 割付する。1F 開始点は 2F で仕込んだ柱、各 1F 辺は次の 3 パターンに分類:
//   - covered: 2F に覆われる辺 → スキップ (1F 足場不要)
//   - collinear: 2F と同一直線連動する辺 → 1 セグメント、両端固定
//   - independent: 下屋部分の独立辺 → 通常処理、始点/終点制約で動作変化
// ============================================================

/** 1F セグメントの始点制約 */
export type Bothmode1FSegmentStartConstraint =
  | { kind: 'pillar-from-2F'; pillarPoint: Point }
  | { kind: 'cascade-from-prev-1F-segment' }
  | { kind: 'collinear-with-2F'; edge2FIndex: number };

/** 1F セグメントの終点制約 */
export type Bothmode1FSegmentEndConstraint =
  | { kind: 'pillar-to-2F'; pillarPoint: Point }
  | { kind: 'collinear-with-2F'; edge2FIndex: number }
  | { kind: 'next-1F-face'; edge1FIndex: number };

/** 1F セグメント */
export type Bothmode1FEdgeSegment = {
  edge1FIndex: number;
  segmentIndex: number;
  segmentCount: number;

  startPoint: Point;
  endPoint: Point;
  segmentLengthMm: number;
  face: FaceDir;
  handrailDir: 'horizontal' | 'vertical';
  nx: number;
  ny: number;

  startDistanceMm: number;
  desiredEndDistanceMm: number;
  startConstraint: Bothmode1FSegmentStartConstraint;
  endConstraint: Bothmode1FSegmentEndConstraint;

  candidates: SequentialCandidate[];
  selectedIndex: number;
  isLocked: boolean;
  isAutoProgress: boolean;
  prevCornerIsConvex: boolean;
  nextCornerIsConvex: boolean;

  scaffoldCoord: number;
  cursorStart: number;
  cursorEnd: number;
  effectiveMm: number;
};

export type Bothmode1FResult = {
  edgeSegments: Bothmode1FEdgeSegment[];
  hasUnresolved: boolean;
};

/** 1F 辺分類の結果 */
export type Edge1FClassification =
  | { kind: 'covered' }
  | { kind: 'collinear'; edge2FIndex: number; fixedDistanceMm: number }
  | { kind: 'independent' };

/** 抽出した柱仕込み点情報 */
export type PillarPointInfo = {
  point: Point;
  edge1FIndex: number;
  edge2FIndex: number;
  segment2FIndex: number;
};

/** result2F から 1F 向け柱仕込み点を進行順に抽出 */
function extractPillarPointsFromResult2F(
  result2F: Bothmode2FResult,
): PillarPointInfo[] {
  const result: PillarPointInfo[] = [];
  for (const seg of result2F.edgeSegments) {
    if (seg.desiredEndSource.kind === '1F-face-pillar') {
      result.push({
        point: seg.endPoint,
        edge1FIndex: seg.desiredEndSource.edge1FIndex,
        edge2FIndex: seg.edge2FIndex,
        segment2FIndex: seg.segmentIndex,
      });
    }
  }
  return result;
}

/** 1F 辺を 'covered' / 'collinear' / 'independent' に分類 */
function classify1FEdge(
  edge1F: EdgeInfo,
  building2F: BuildingShape,
  collinearPairs: Array<{ edge1FIndex: number; edge2FIndex: number }>,
  result2F: Bothmode2FResult,
): Edge1FClassification {
  // 1. collinear 判定 (連動ペア優先、独立判定より優先)
  const collinearPair = collinearPairs.find(p => p.edge1FIndex === edge1F.index);
  if (collinearPair) {
    // 連動辺は同一直線 = 同じ離れ。result2F の該当 2F 辺の任意セグメントの startDist を採用
    const matchSeg = result2F.edgeSegments.find(s => s.edge2FIndex === collinearPair.edge2FIndex);
    const fixedDistanceMm = matchSeg?.startDistanceMm ?? 900;
    return { kind: 'collinear', edge2FIndex: collinearPair.edge2FIndex, fixedDistanceMm };
  }
  // 2. covered 判定: 中点を法線方向 (外向き) に少しずらした点が 2F polygon 内なら覆われる隣接
  const midX = (edge1F.p1.x + edge1F.p2.x) / 2;
  const midY = (edge1F.p1.y + edge1F.p2.y) / 2;
  const testX = midX + edge1F.nx * 1;
  const testY = midY + edge1F.ny * 1;
  if (isPointInPolygon(testX, testY, building2F.points)) {
    return { kind: 'covered' };
  }
  return { kind: 'independent' };
}

/**
 * bothmode 専用: 1F 全周を順次決定で割付。
 * Stage 3 の computeBothmode2FLayout の結果を受け取り、
 * 2F で仕込んだ柱位置を 1F 足場の起点として、1F 全周を時計回りに割付する。
 */
export function computeBothmode1FLayout(
  building1F: BuildingShape,
  building2F: BuildingShape,
  result2F: Bothmode2FResult,
  distances1F: Record<number, number>,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  userSelections?: Record<string, number>,
  userAdjustments?: Record<string, EdgeAdjustment>,
): Bothmode1FResult {
  const edges1F = getBuildingEdgesClockwise(building1F);
  const edges2F = getBuildingEdgesClockwise(building2F);
  const n1F = edges1F.length;
  if (n1F < 3) return { edgeSegments: [], hasUnresolved: false };

  const collinearPairs = findCollinearEdgePairs(building1F, building2F);
  const pillarPoints = extractPillarPointsFromResult2F(result2F);

  // 1F 開始辺: 進行順最初の柱仕込み点が指す 1F 辺、なければ 0
  const startEdge1FIndex = pillarPoints.length > 0
    ? pillarPoints[0].edge1FIndex % n1F
    : 0;

  // 各 1F 辺を分類
  const classifications: Edge1FClassification[] = edges1F.map(e =>
    classify1FEdge(e, building2F, collinearPairs, result2F)
  );

  // チェイン look-ahead (1 段限定):
  // - startIdx の辺が連動辺 → その fixedDistanceMm
  // - startIdx の辺が独立辺、かつ「次」が連動辺 → その fixedDistanceMm
  // - それ以外 (2 段以上先に連動辺) → undefined (= 希望離れにフォールバック)
  // 「直接 next が連動辺」または「next の次が連動辺」のときだけ
  // 連動辺の確定離れ (= 2F 連動辺の startDist) を desiredEnd に伝搬する。
  const chainedFixedEnd = (startIdx: number): number | undefined => {
    const c0 = classifications[startIdx];
    if (c0.kind === 'collinear') return c0.fixedDistanceMm;
    if (c0.kind === 'independent') {
      const c1 = classifications[(startIdx + 1) % n1F];
      if (c1.kind === 'collinear') return c1.fixedDistanceMm;
    }
    return undefined;
  };

  // 1F の cornerConvexity
  const cornerConvexity1F: boolean[] = [];
  for (let i = 0; i < n1F; i++) {
    cornerConvexity1F.push(isConvexCorner(edges1F[i], edges1F[(i + 1) % n1F]));
  }


  // 座標一致判定
  const pointsMatch = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;

  const intermediate: Bothmode1FEdgeSegment[] = [];
  let prevEndDistanceMm: number | undefined = undefined;
  let prevSegmentStartDist: number | undefined = undefined;

  // 共通の描画用座標計算
  const computeDrawCoords = (
    edge: EdgeInfo,
    startPoint: Point,
    endPoint: Point,
    startDist: number,
    railsTotal: number,
  ) => {
    const distGrid = mmToGrid(startDist);
    const scaffoldCoord = edge.handrailDir === 'horizontal'
      ? startPoint.y + edge.ny * distGrid
      : startPoint.x + edge.nx * distGrid;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const sign = edge.handrailDir === 'horizontal'
      ? (dx >= 0 ? 1 : -1)
      : (dy >= 0 ? 1 : -1);
    const cursorStart = edge.handrailDir === 'horizontal' ? startPoint.x : startPoint.y;
    const cursorEnd = cursorStart + sign * (railsTotal / 10);
    return { scaffoldCoord, cursorStart, cursorEnd };
  };

  for (let k = 0; k < n1F; k++) {
    const i = (startEdge1FIndex + k) % n1F;
    const edge = edges1F[i];
    const cls = classifications[i];

    if (cls.kind === 'covered') continue;

    // 直線継続検出 (= 同 face/handrailDir 隣接) — 師匠の現場ロジックで凸扱い
    const prevEdge1F = edges1F[(i - 1 + n1F) % n1F];
    const nextEdge1F = edges1F[(i + 1) % n1F];
    const isPrevStraight1F =
      prevEdge1F.face === edge.face && prevEdge1F.handrailDir === edge.handrailDir;
    const isNextStraight1F =
      nextEdge1F.face === edge.face && nextEdge1F.handrailDir === edge.handrailDir;
    const isStraightContinuation1F = isPrevStraight1F;

    // cornerConvex: 物理凸 (cross>0) or 直線継続 (cross=0) のどちらでも convex 扱い
    // （2F 面一境界の継続始点のみ下で凹ラップに上書きする）
    let prevCornerIsConvex = cornerConvexity1F[(i - 1 + n1F) % n1F] || isPrevStraight1F;
    // 終端が平行面一(collinear-with-2F)のときは下で凹ラップに上書きする
    let nextCornerIsConvex = cornerConvexity1F[i] || isNextStraight1F;
    const segKey = `${i}-0`;
    const adj = userAdjustments?.[segKey] ?? DEFAULT_EDGE_ADJUSTMENT;
    // 1F の最初のセグメントが pillar-from-2F の場合、prev は 2F edge (= B1 等)。
    // そのため prevEdgeStartDist は 2F seg の startDistanceMm (= B 面の離れ) を使う。
    // (cascade prev: 1F polygon 上の物理 prev edge の distances1F は的外れ)
    const prevPillarMatchForDist = pillarPoints.find(p =>
      pointsMatch(p.point, edge.p1) && p.edge1FIndex === i,
    );
    // 同一壁の隣接継続(2F東→1F東 等): 面一でも特別な始点細工をせず通常の始点終点ルールで割付する。
    // 2F 境界を「離れラップ(凹)コーナー」として扱い、始点側張り出しは 2F 境界セグメントの
    // 張り出し量(desiredEnd)を凹寄与(−)で計上する。底側の凸(+)と相殺して effective を壁長に
    // 一致させ、独立辺(ノッチ壁)と同値割付になる。接続は cursor 側で「2F境界の終端に端点一致」。
    const contEdge2FForDist = prevPillarMatchForDist
      ? edges2F.find(e => e.index === prevPillarMatchForDist.edge2FIndex)
      : undefined;
    const isContinuationStart = !!(contEdge2FForDist && isWallContinuation(contEdge2FForDist, edge));
    const contSeg2F = isContinuationStart && prevPillarMatchForDist
      ? result2F.edgeSegments.find(s => s.edge2FIndex === prevPillarMatchForDist.edge2FIndex)
      : undefined;
    if (isContinuationStart) prevCornerIsConvex = false; // 2F 境界 = 凹ラップ
    const prevEdgeStartDist: number = isContinuationStart
      ? (contSeg2F?.desiredEndDistanceMm ?? distances1F[edge.index] ?? 900)
      : prevPillarMatchForDist
      ? (result2F.edgeSegments.find(s => s.edge2FIndex === prevPillarMatchForDist.edge2FIndex)
          ?.startDistanceMm ?? distances1F[edge.index] ?? 900)
      : (prevSegmentStartDist ?? distances1F[edges1F[(i - 1 + n1F) % n1F].index] ?? 900);

    if (cls.kind === 'collinear') {
      // Phase H-3d-2 修正B: 連動辺は 2F 足場と物理共有するため、edgeSegments には含めない
      // (描画も計算も 2F 側で完結する)。cascade のための変数だけ更新する。
      prevEndDistanceMm = cls.fixedDistanceMm;
      prevSegmentStartDist = cls.fixedDistanceMm;
      continue;
    }

    // cls.kind === 'independent'
    let startConstraint: Bothmode1FSegmentStartConstraint;
    let startDist: number;
    const prevPillarMatch = pillarPoints.find(p =>
      pointsMatch(p.point, edge.p1) && p.edge1FIndex === i,
    );
    if (prevPillarMatch) {
      startConstraint = { kind: 'pillar-from-2F', pillarPoint: prevPillarMatch.point };
      const seg2F = result2F.edgeSegments.find(s => s.edge2FIndex === prevPillarMatch.edge2FIndex);
      startDist = seg2F?.startDistanceMm ?? distances1F[edge.index] ?? 900;
    } else if (isStraightContinuation1F) {
      // 直線継続: prev 1F seg の startDistanceMm を継承 (= 同じ face)
      startConstraint = { kind: 'cascade-from-prev-1F-segment' };
      startDist = prevSegmentStartDist ?? distances1F[edge.index] ?? 900;
    } else {
      startConstraint = { kind: 'cascade-from-prev-1F-segment' };
      startDist = prevEndDistanceMm ?? distances1F[edge.index] ?? 900;
    }

    // 終点制約判定 (次の 1F 辺の状態で分岐)
    // Phase H-3d-2 仕様簡素化: locked 概念廃止、isLockedEnd 削除。
    const nextEdgeIdx = (i + 1) % n1F;
    const nextCls = classifications[nextEdgeIdx];
    let endConstraint: Bothmode1FSegmentEndConstraint;
    let desiredEndDist: number;

    if (nextCls.kind === 'collinear') {
      endConstraint = { kind: 'collinear-with-2F', edge2FIndex: nextCls.edge2FIndex };
      desiredEndDist = nextCls.fixedDistanceMm;
    } else if (nextCls.kind === 'covered') {
      const endPillarMatch = pillarPoints.find(p =>
        pointsMatch(p.point, edge.p2) && p.edge1FIndex === nextEdgeIdx,
      );
      if (endPillarMatch) {
        endConstraint = { kind: 'pillar-to-2F', pillarPoint: endPillarMatch.point };
        const seg2F = result2F.edgeSegments.find(s => s.edge2FIndex === endPillarMatch.edge2FIndex);
        desiredEndDist = seg2F?.startDistanceMm ?? distances1F[nextEdgeIdx] ?? 900;
      } else {
        endConstraint = { kind: 'next-1F-face', edge1FIndex: nextEdgeIdx };
        desiredEndDist = distances1F[nextEdgeIdx] ?? 900;
      }
    } else {
      // 次も independent: 1 段先 chain look-ahead で「next の next」が連動辺なら
      // その確定値を使う (= 1B のように連動辺の手前 1 つの独立辺ケース)。
      // 2 段以上先に連動辺がある場合は希望離れを使う (= 1A のように途中ケース)。
      endConstraint = { kind: 'next-1F-face', edge1FIndex: nextEdgeIdx };
      const chained = chainedFixedEnd(nextEdgeIdx);
      desiredEndDist = chained ?? distances1F[nextEdgeIdx] ?? 900;
    }

    // 平行面一(collinear-with-2F)の終端: 2F 境界へ端点一致させるため凹ラップ扱いにし、
    // candidate 末端の凸+900 突出をやめる(effective を cursor span=壁長に一致)。
    // 接続点は cursor 2nd pass で連動先2Fセグメントの近い端に揃える(支柱共有)。
    if (endConstraint.kind === 'collinear-with-2F') nextCornerIsConvex = false;

    const candidates = generateSequentialCandidates(
      edge.lengthMm, startDist, desiredEndDist,
      prevCornerIsConvex, nextCornerIsConvex,
      prevEdgeStartDist,
      enabledSizes, priorityConfig,
      adj.larger.offsetIdx, adj.smaller.offsetIdx,
      adj.larger.variationIdx, adj.smaller.variationIdx,
    );

    let selectedIndex = userSelections?.[segKey] ?? 0;
    if (selectedIndex >= candidates.length) selectedIndex = 0;
    // 自動進行は「候補1件 かつ 離れ差0 かつ 端数0」のみ。
    // 離れが動く案(diff≠0)や端数あり(rule5)はモーダルで提案する。
    const isAutoProgress = candidates.length === 1
      && candidates[0].diffFromDesired === 0
      && (candidates[0].remainder ?? 0) === 0;
    // Phase H-3d-2 仕様簡素化: locked 概念廃止。常に false (互換性のためフィールド維持)。
    const isLocked = false;

    const railsTotal = candidates[selectedIndex]?.totalMm ?? edge.lengthMm;
    const { scaffoldCoord, cursorStart, cursorEnd } = computeDrawCoords(
      edge, edge.p1, edge.p2, startDist, railsTotal,
    );

    intermediate.push({
      edge1FIndex: i, segmentIndex: 0, segmentCount: 1,
      startPoint: edge.p1, endPoint: edge.p2, segmentLengthMm: edge.lengthMm,
      face: edge.face, handrailDir: edge.handrailDir, nx: edge.nx, ny: edge.ny,
      startDistanceMm: startDist, desiredEndDistanceMm: desiredEndDist,
      startConstraint, endConstraint,
      candidates, selectedIndex,
      isLocked, isAutoProgress,
      prevCornerIsConvex, nextCornerIsConvex,
      scaffoldCoord, cursorStart, cursorEnd, effectiveMm: railsTotal,
    });

    // Phase H-3d-2 仕様簡素化: 単純な cascade。actualEndDistanceMm を次辺に継承。
    if (candidates.length > 0) {
      prevEndDistanceMm = candidates[selectedIndex].actualEndDistanceMm;
    } else {
      prevEndDistanceMm = desiredEndDist;
    }
    prevSegmentStartDist = startDist;
  }

  // Phase H-3d-2 cursor 修正: 1F segment も startConstraint / endConstraint に応じて
  // cursorStart/cursorEnd を 2F 足場の scaffoldCoord (= 柱位置の進行軸座標) に合わせる。
  // pillar-from-2F: 2F 側の pillar 位置で 90° 接続 → 2F 該当 segment の scaffoldCoord
  // pillar-to-2F  : 同上 (終端側)
  // collinear-with-2F: 連動先の 2F 辺の scaffoldCoord
  // cascade-from-prev-1F-segment: 前の 1F segment との接続 (90° なら prev scaffoldCoord)
  for (let k = 0; k < intermediate.length; k++) {
    const s = intermediate[k];
    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    const sign = s.handrailDir === 'horizontal' ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);

    // --- cursorStart ---
    let cursorStart: number;
    if (s.startConstraint.kind === 'pillar-from-2F') {
      const pp = s.startConstraint.pillarPoint;
      const seg2F = result2F.edgeSegments.find(seg2 =>
        Math.abs(seg2.endPoint.x - pp.x) < 0.001
        && Math.abs(seg2.endPoint.y - pp.y) < 0.001,
      );
      if (seg2F && seg2F.handrailDir !== s.handrailDir) {
        cursorStart = seg2F.scaffoldCoord;
      } else if (seg2F) {
        // 同一壁の隣接継続: 2F 境界セグメントの終端に接続 (端点一致・始点細工しない)
        cursorStart = seg2F.cursorEnd;
      } else {
        cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
      }
    } else if (s.startConstraint.kind === 'cascade-from-prev-1F-segment') {
      const prev1F = k > 0 ? intermediate[k - 1] : undefined;
      if (prev1F && prev1F.handrailDir !== s.handrailDir) {
        cursorStart = prev1F.scaffoldCoord;
      } else {
        cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
      }
    } else if (s.startConstraint.kind === 'collinear-with-2F') {
      // 連動先 2F の scaffoldCoord に揃える
      const linked = s.startConstraint.edge2FIndex;
      const seg2F = result2F.edgeSegments.find(seg2 => seg2.edge2FIndex === linked);
      if (seg2F && seg2F.handrailDir !== s.handrailDir) {
        cursorStart = seg2F.scaffoldCoord;
      } else {
        cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
      }
    } else {
      cursorStart = s.handrailDir === 'horizontal' ? s.startPoint.x : s.startPoint.y;
    }

    // --- cursorEnd ---
    let cursorEnd: number;
    if (s.endConstraint.kind === 'pillar-to-2F') {
      const pp = s.endConstraint.pillarPoint;
      const seg2F = result2F.edgeSegments.find(seg2 =>
        Math.abs(seg2.startPoint.x - pp.x) < 0.001
        && Math.abs(seg2.startPoint.y - pp.y) < 0.001,
      );
      if (seg2F && seg2F.handrailDir !== s.handrailDir) {
        cursorEnd = seg2F.scaffoldCoord;
      } else {
        cursorEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
      }
    } else if (s.endConstraint.kind === 'collinear-with-2F') {
      const linked = s.endConstraint.edge2FIndex;
      const seg2F = result2F.edgeSegments.find(seg2 => seg2.edge2FIndex === linked);
      if (seg2F && seg2F.handrailDir !== s.handrailDir) {
        cursorEnd = seg2F.scaffoldCoord;
      } else if (seg2F) {
        // 平行面一: 連動先2Fセグメントの近い方の端(cursor)に端点一致させる(角の支柱を共有)
        const endVar = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
        cursorEnd = Math.abs(seg2F.cursorStart - endVar) <= Math.abs(seg2F.cursorEnd - endVar)
          ? seg2F.cursorStart : seg2F.cursorEnd;
      } else {
        cursorEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
      }
    } else {
      // next-1F-face: 次の 1F intermediate segment との接続
      const next1F = k < intermediate.length - 1 ? intermediate[k + 1] : undefined;
      if (next1F && next1F.handrailDir !== s.handrailDir) {
        // 凸 corner なら次 distGrid 分突き出る、凹なら next scaffoldCoord
        // 1F segment 同士で凸/凹判定するため prevCornerIsConvex/nextCornerIsConvex を流用
        if (s.nextCornerIsConvex) {
          const nextDistGrid = mmToGrid(next1F.startDistanceMm);
          const endVar = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
          cursorEnd = endVar + sign * nextDistGrid;
        } else {
          cursorEnd = next1F.scaffoldCoord;
        }
      } else {
        cursorEnd = s.handrailDir === 'horizontal' ? s.endPoint.x : s.endPoint.y;
      }
    }

    intermediate[k] = {
      ...s,
      cursorStart,
      cursorEnd,
      effectiveMm: Math.max(0, Math.round(Math.abs(cursorEnd - cursorStart) * 10)),
    };
  }

  const hasUnresolved = intermediate.some(s => !s.isLocked && !s.isAutoProgress);
  return { edgeSegments: intermediate, hasUnresolved };
}

// ============================================================
// Phase H-3d-2 Stage 5 Part D-1: bothmode 結果を AutoLayoutResult に変換
// ------------------------------------------------------------
// 既存の描画コード (Konva Canvas 等) は AutoLayoutResult.edgeLayouts を消費する。
// bothmode の Bothmode2FResult / Bothmode1FResult を、各セグメント単位で
// EdgeLayout に展開して全部 edgeLayouts に格納する。
// 同じ edge2FIndex / edge1FIndex を持つセグメントが複数 edgeLayouts に並ぶ点に注意。
// ============================================================

function bothmodeSegmentToEdgeLayout(seg: {
  startPoint: Point;
  endPoint: Point;
  segmentLengthMm: number;
  segmentIndex: number;
  face: FaceDir;
  handrailDir: 'horizontal' | 'vertical';
  nx: number;
  ny: number;
  startDistanceMm: number;
  candidates: SequentialCandidate[];
  selectedIndex: number;
  isLocked: boolean;
  scaffoldCoord: number;
  cursorStart: number;
}, edgeIndex: number, originFloor: 1 | 2): EdgeLayout {
  const selectedCandidate = seg.candidates[seg.selectedIndex];
  const railsTotal = selectedCandidate
    ? selectedCandidate.rails.reduce((a, b) => a + b, 0)
    : 0;

  // cursorEnd を rails 合計ベースに再計算 (sequentialResultToAutoLayoutResult と同方式)
  const railsTotalGrid = railsTotal / 10;
  const sign = seg.handrailDir === 'horizontal'
    ? (seg.endPoint.x > seg.startPoint.x ? 1 : -1)
    : (seg.endPoint.y > seg.startPoint.y ? 1 : -1);
  const cursorEndAdjusted = seg.cursorStart + sign * railsTotalGrid;

  const edge: EdgeInfo = {
    index: edgeIndex,
    originalIndex: edgeIndex,
    // Phase H-3d-4: 中間層では label を生成しない (= 表示時に edges2FAll/subEdgesRelabeled から
    // edge.index 経由で lookup する H-3d-3 方針)。 EdgeInfo.label は必須型のため空文字で型を満たす。
    // 1F-origin entry を 2F セクションに混在させて誤 collision していた問題も修正 #1 で解消済み。
    label: '',
    p1: seg.startPoint,
    p2: seg.endPoint,
    lengthMm: seg.segmentLengthMm,
    face: seg.face,
    handrailDir: seg.handrailDir,
    nx: seg.nx,
    ny: seg.ny,
  };

  // 提案モーダル抑止のため remainder=0 (sequentialResultToAutoLayoutResult と同方式)
  const candidates: LayoutCombination[] = seg.candidates.map(c => ({
    rails: c.rails,
    remainder: 0,
    count: c.rails.length,
  }));

  return {
    edge,
    distanceMm: seg.startDistanceMm,
    edgeLengthMm: seg.segmentLengthMm,
    effectiveMm: railsTotal,
    scaffoldCoord: seg.scaffoldCoord,
    cursorStart: seg.cursorStart,
    cursorEnd: cursorEndAdjusted,
    candidates,
    selectedIndex: seg.selectedIndex,
    locked: seg.isLocked,
    originFloor,
    originSegmentIndex: seg.segmentIndex,
  };
}

export function bothmodeResultsToAutoLayoutResult(
  result2F: Bothmode2FResult,
  result1F: Bothmode1FResult,
): AutoLayoutResult {
  const edgeLayouts: EdgeLayout[] = [];
  for (const seg of result2F.edgeSegments) {
    edgeLayouts.push(bothmodeSegmentToEdgeLayout(seg, seg.edge2FIndex, 2));
  }
  for (const seg of result1F.edgeSegments) {
    edgeLayouts.push(bothmodeSegmentToEdgeLayout(seg, seg.edge1FIndex, 1));
  }
  return { edgeLayouts };
}

/**
 * 優先リストの各部材を baseSize としたパターンを生成する。
 * 除外セクションの部材は使わない。
 * Phase 5-B 時点では候補に追加するのみ、ソート基準は既存のまま。
 */
function generatePriorityPatterns(
  effectiveMm: number,
  enabledSizes: HandrailLengthMm[],
  priorityConfig: PriorityConfig,
): LayoutCombination[] {
  // 除外セクションを除いた使用可能部材を優先順 (main→sub→adjust) で取得
  const usableSizes: HandrailLengthMm[] = [];
  const totalInSections =
    priorityConfig.mainCount + priorityConfig.subCount + priorityConfig.adjustCount;
  for (let i = 0; i < totalInSections && i < priorityConfig.order.length; i++) {
    const size = priorityConfig.order[i];
    if (enabledSizes.includes(size)) {
      usableSizes.push(size);
    }
  }

  if (usableSizes.length === 0) return [];

  const patterns: LayoutCombination[] = [];

  // 各 usableSize を baseSize として試す
  for (const baseSize of usableSizes) {
    const baseCount = Math.floor(effectiveMm / baseSize);
    if (baseCount === 0) continue; // baseSize が長すぎる場合はスキップ

    const leftover = effectiveMm - baseSize * baseCount;

    // パターン 1: baseSize のみで埋める（端数は残す）
    patterns.push({
      rails: Array(baseCount).fill(baseSize),
      remainder: leftover,
      count: baseCount,
    });

    // パターン 2: baseSize を1本減らして、端数を他の部材で埋める
    if (baseCount >= 1) {
      const targetLeftover = leftover + baseSize;
      const fillers = usableSizes.filter((s) => s !== baseSize);

      // 単一部材で埋める
      for (const s of fillers) {
        const n = Math.floor(targetLeftover / s);
        if (n > 0) {
          const rem = targetLeftover - s * n;
          patterns.push({
            rails: [...Array(baseCount - 1).fill(baseSize), ...Array(n).fill(s)],
            remainder: rem,
            count: baseCount - 1 + n,
          });
        }
      }

      // 2部材の組み合わせで埋める（s1 + s2）
      for (let i = 0; i < fillers.length; i++) {
        for (let j = i; j < fillers.length; j++) {
          const s1 = fillers[i];
          const s2 = fillers[j];
          if (s1 + s2 <= targetLeftover + 50) { // 50mm の許容
            const rem = targetLeftover - s1 - s2;
            const rails = [...Array(baseCount - 1).fill(baseSize), s1, s2].sort(
              (a, b) => b - a,
            ) as HandrailLengthMm[];
            patterns.push({
              rails,
              remainder: rem,
              count: baseCount - 1 + 2,
            });
          }
        }
      }
    }
  }

  // 優先部材のみで小部材 2 本の組み合わせパターン（baseSize 不使用、短辺向け）
  for (let i = 0; i < usableSizes.length; i++) {
    for (let j = i; j < usableSizes.length; j++) {
      const s1 = usableSizes[i];
      const s2 = usableSizes[j];
      if (s1 + s2 <= effectiveMm + 50) {
        const rem = effectiveMm - s1 - s2;
        patterns.push({
          rails: [s1, s2].sort((a, b) => b - a) as HandrailLengthMm[],
          remainder: rem,
          count: 2,
        });
      }
    }
  }

  return patterns;
}

// ============================================================
// Phase D: 1辺の候補を「exact / larger / smaller」の3枠で返す純粋関数
// ============================================================
/**
 * Phase D: 1辺の候補を生成する。
 *
 * 仕様:
 * - 終点離れ = 割付合計 - 辺長 - 始点離れ
 * - 希望離れにぴったりな候補（exact）が存在すれば exact のみ返す
 * - 無ければ larger/smaller それぞれで「希望との距離 <= 100mm ならスコア優先、超えるなら距離優先」で選定
 */
export function generateEdgeCandidatesForPhaseD(
  edgeLengthMm: number,
  startDistanceMm: number,
  desiredEndDistanceMm: number,
  enabledSizes: HandrailLengthMm[] = HANDRAIL_SIZES,
  priorityConfig?: PriorityConfig,
  options?: {
    /** 大小判定の同スコア許容範囲 (デフォルト 100mm) */
    exactToleranceMm?: number;
    /** 候補生成時の effectiveMm 探索範囲（希望±何mm、デフォルト 500）*/
    searchRangeMm?: number;
  },
): PhaseDEdgeCandidates {
  const tolerance = options?.exactToleranceMm ?? 100;
  const range = options?.searchRangeMm ?? 500;

  // 1. 希望終点離れから逆算した割付合計を中心に、±rangeMm で探索
  const centerTotal = edgeLengthMm + startDistanceMm + desiredEndDistanceMm;

  // 2. findBestEndCombinations を複数回呼んで候補を集める
  const collectedRails: { rails: HandrailLengthMm[]; total: number }[] = [];

  for (let delta = -range; delta <= range; delta += 50) {
    const targetTotal = centerTotal + delta;
    if (targetTotal <= 0) continue;

    const results = findBestEndCombinations(targetTotal, enabledSizes, priorityConfig);
    for (const r of results) {
      const total = r.rails.reduce((a, b) => a + b, 0);
      // 重複除去（同じ total かつ 同じ rails 構成）
      const keySorted = JSON.stringify(r.rails.slice().sort((a, b) => a - b));
      const dup = collectedRails.some(
        (c) =>
          c.total === total &&
          JSON.stringify(c.rails.slice().sort((a, b) => a - b)) === keySorted,
      );
      if (!dup) {
        collectedRails.push({ rails: r.rails, total });
      }
    }
  }

  // 3. 各候補の終点離れを計算
  const phaseDCandidates: PhaseDCandidate[] = collectedRails
    .map((c) => {
      const endDist = c.total - edgeLengthMm - startDistanceMm;
      const diff = endDist - desiredEndDistanceMm;
      const score = priorityConfig ? scoreCombination(c.rails, priorityConfig) : 0;
      return {
        railsTotalMm: c.total,
        endDistanceMm: endDist,
        diffFromDesired: diff,
        score,
        rails: c.rails,
      };
    })
    .filter((c) => c.endDistanceMm > 0); // 終点離れ 0 以下は除外

  // 4. 3グループに分類
  const exactGroup = phaseDCandidates.filter((c) => c.diffFromDesired === 0);
  const largerGroup = phaseDCandidates.filter((c) => c.diffFromDesired > 0);
  const smallerGroup = phaseDCandidates.filter((c) => c.diffFromDesired < 0);

  // 5. exact は1つあれば終了（スコア最大）
  if (exactGroup.length > 0) {
    const exact = exactGroup.reduce((best, cur) =>
      cur.score > best.score ? cur : best,
    );
    return { exact, larger: null, smaller: null };
  }

  // 6. larger/smaller からそれぞれ選定
  const pickByRule = (group: PhaseDCandidate[]): PhaseDCandidate | null => {
    if (group.length === 0) return null;
    // 許容範囲内の候補
    const inTolerance = group.filter((c) => Math.abs(c.diffFromDesired) <= tolerance);
    if (inTolerance.length > 0) {
      // スコア最大、同着なら距離最小、同着なら本数最小
      return inTolerance.reduce((best, cur) => {
        if (cur.score > best.score + 1e-9) return cur;
        if (Math.abs(cur.score - best.score) < 1e-9) {
          if (Math.abs(cur.diffFromDesired) < Math.abs(best.diffFromDesired)) return cur;
          if (
            Math.abs(cur.diffFromDesired) === Math.abs(best.diffFromDesired) &&
            cur.rails.length < best.rails.length
          )
            return cur;
        }
        return best;
      });
    }
    // 許容範囲外なら距離最小（同着はスコア最大）
    return group.reduce((best, cur) => {
      if (Math.abs(cur.diffFromDesired) < Math.abs(best.diffFromDesired)) return cur;
      if (
        Math.abs(cur.diffFromDesired) === Math.abs(best.diffFromDesired) &&
        cur.score > best.score
      )
        return cur;
      return best;
    });
  };

  return {
    exact: null,
    larger: pickByRule(largerGroup),
    smaller: pickByRule(smallerGroup),
  };
}
