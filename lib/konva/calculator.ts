// ============================================================
// 電卓の計算ロジック（pure・node 安全・テスト可能）。
//   c-1: 四則演算の評価。c-2: 割付(fillByLargest)・高さ(heightToFloors)。
// ============================================================
import type { HandrailLengthMm, PriorityConfig } from '@/types';
import { getSectionOfSize } from './autolayout/scoring';

/** 足場 1 層の高さ(mm)。高さ計算の 1 段分。 */
export const LAYER_HEIGHT_MM = 1800;

// ---- c-1: 四則演算 ----
type Tok = { t: 'num'; v: number } | { t: 'op'; v: '+' | '-' | '*' | '/' };

/** 電卓の式文字列（例 "12+3*4-5/2"）をトークン化。演算子は ASCII + - * / のみ
 *  （UI 側で ×÷−＋ を ASCII へ写像してから渡す）。先頭/演算子直後の '-' は負号として
 *  数値に取り込む。不正入力は null。 */
function tokenize(expr: string): Tok[] | null {
  const s = expr.replace(/\s+/g, '');
  if (s.length === 0) return [];
  const toks: Tok[] = [];
  let i = 0;
  const expectNum = () => toks.length === 0 || toks[toks.length - 1].t === 'op';
  while (i < s.length) {
    const c = s[i];
    if (c === '+' || c === '*' || c === '/' || (c === '-' && !expectNum())) {
      toks.push({ t: 'op', v: c as '+' | '-' | '*' | '/' });
      i++;
      continue;
    }
    // 数値（負号 '-' を許容・小数点 1 個まで）
    let j = i;
    if (s[j] === '-') j++;
    let seenDot = false;
    while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || (s[j] === '.' && !seenDot))) {
      if (s[j] === '.') seenDot = true;
      j++;
    }
    const numStr = s.slice(i, j);
    if (numStr === '' || numStr === '-' || numStr === '.' || numStr === '-.') return null;
    const v = Number(numStr);
    if (!Number.isFinite(v)) return null;
    toks.push({ t: 'num', v });
    i = j;
  }
  return toks;
}

/** 四則演算を評価（× ÷ を + − より先）。0 除算・不正式は null を返す。 */
export function evalExpr(expr: string): number | null {
  const toks = tokenize(expr);
  if (toks === null || toks.length === 0) return null;
  // num (op num)* の形であること
  if (toks[0].t !== 'num' || toks[toks.length - 1].t !== 'num') return null;

  // pass 1: * /
  const reduced: Tok[] = [];
  for (const tok of toks) {
    if (tok.t === 'op' && (tok.v === '*' || tok.v === '/')) {
      reduced.push(tok);
      continue;
    }
    if (tok.t === 'num' && reduced.length >= 2) {
      const op = reduced[reduced.length - 1];
      const left = reduced[reduced.length - 2];
      if (op.t === 'op' && (op.v === '*' || op.v === '/') && left.t === 'num') {
        if (op.v === '/' && tok.v === 0) return null; // ゼロ除算
        const r = op.v === '*' ? left.v * tok.v : left.v / tok.v;
        reduced.splice(reduced.length - 2, 2, { t: 'num', v: r });
        continue;
      }
    }
    reduced.push(tok);
  }
  // pass 2: + -
  let acc = (reduced[0] as { t: 'num'; v: number }).v;
  for (let k = 1; k < reduced.length; k += 2) {
    const op = reduced[k];
    const num = reduced[k + 1];
    if (op.t !== 'op' || num.t !== 'num') return null;
    if (op.v === '+') acc += num.v;
    else if (op.v === '-') acc -= num.v;
    else return null; // * / は pass1 で消えているはず
  }
  return Number.isFinite(acc) ? acc : null;
}

// ---- c-2: 割付（長さ→部材の大物優先グリーディ＋余り） ----
export type RailCombo = { size: number; count: number };
export type FillResult = { combo: RailCombo[]; usedMm: number; remainderMm: number };

/** 長さ(mm)を enabledSizes の大物優先グリーディで埋め、組み合わせと余りを返す。
 *  priorityConfig 指定時は excluded サイズを除外（本体割付と同じ規則）。
 *  非正/非整数はガード（Math.round・0 以下や部材なしは combo 空・余りは length）。 */
export function fillByLargest(
  lengthMm: number,
  enabledSizes: number[],
  priorityConfig?: PriorityConfig,
): FillResult {
  const L = Math.round(lengthMm);
  if (!Number.isFinite(L) || L <= 0) return { combo: [], usedMm: 0, remainderMm: Math.max(0, L || 0) };
  const usable = priorityConfig
    ? enabledSizes.filter(s => getSectionOfSize(s as HandrailLengthMm, priorityConfig) !== 'excluded')
    : [...enabledSizes];
  const sizes = usable.filter(s => s > 0).sort((a, b) => b - a);
  if (sizes.length === 0) return { combo: [], usedMm: 0, remainderMm: L };

  let remaining = L;
  const combo: RailCombo[] = [];
  for (const s of sizes) {
    const n = Math.floor(remaining / s);
    if (n > 0) { combo.push({ size: s, count: n }); remaining -= n * s; }
  }
  return { combo, usedMm: L - remaining, remainderMm: remaining };
}

// ---- c-2: 高さ（高さ→段数＋スタート端数） ----
export type HeightResult = { startMm: number; floors: number };

/** 高さ(mm)を段数とスタート端数に分解。
 *  floors = 高さから layerMm(=1800) を引いて >0 を保てる回数 = floor((H-1)/layerMm)（H<=0 は 0）。
 *  startMm = H − layerMm×floors（残った端数＝スタート）。例: 5000 → {startMm:1400, floors:2}。 */
export function heightToFloors(heightMm: number, layerMm: number = LAYER_HEIGHT_MM): HeightResult {
  const H = Math.round(heightMm);
  if (!Number.isFinite(H) || H <= 0 || layerMm <= 0) return { startMm: Math.max(0, H || 0), floors: 0 };
  const floors = Math.max(0, Math.floor((H - 1) / layerMm));
  return { startMm: H - layerMm * floors, floors };
}

/** 高さの結果表示文言。floors>=1 は「NスタートのM段でK下がりになります」、
 *  floors=0（1800 未満で段が立たない）は「足場不要の高さです」。
 *  K(下がり) = H − (startMm + 1800×(floors−1))（現行式では常に 1800 だが計算で出す）。 */
export function formatHeightResult(heightMm: number): string {
  const H = Math.round(heightMm);
  const { startMm, floors } = heightToFloors(H);
  if (floors === 0) return '足場不要の高さです';
  const sagari = H - (startMm + LAYER_HEIGHT_MM * (floors - 1));
  return `${startMm}スタートの${floors}段で${sagari}下がりになります`;
}
