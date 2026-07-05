// ============================================================
// 電卓の計算ロジック（pure・node 安全・テスト可能）。
//   c-1: 四則演算の評価。c-2: 割付(fillByLargest)・高さ(heightToFloors)。
// ============================================================

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
