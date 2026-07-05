'use client';

import { useState } from 'react';
import { evalExpr } from '@/lib/konva/calculator';

// 足場職人向け電卓モーダル（c-1: 四則演算）。OS キーボードを出さず、画面内ボタンで入力。

type Props = { onClose: () => void };

const DIGITS: string[][] = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '.', '=', '＋'],
];
const OP_MAP: Record<string, string> = { '÷': '/', '×': '*', '−': '-', '＋': '+' };

export default function CalculatorModal({ onClose }: Props) {
  const [expr, setExpr] = useState('');
  const [error, setError] = useState(false);

  const append = (ch: string) => { setError(false); setExpr((e) => e + ch); };
  const clearAll = () => { setError(false); setExpr(''); };
  const backspace = () => { setError(false); setExpr((e) => e.slice(0, -1)); };
  const equals = () => {
    const r = evalExpr(expr);
    if (r === null) { setError(true); return; }
    // 小数は最大 6 桁で丸めて末尾 0 を除去
    setExpr(String(Math.round(r * 1e6) / 1e6));
  };

  const onDigit = (label: string) => {
    if (label === '=') { equals(); return; }
    if (label in OP_MAP) { append(OP_MAP[label]); return; }
    append(label);
  };

  // 表示は演算子を見やすい記号へ戻す
  const shown = (expr || '0').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');

  const btn = 'min-h-[56px] rounded-xl text-lg font-bold flex items-center justify-center active:opacity-70 transition-opacity';

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-end sm:items-center justify-center">
      <div className="bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xs mx-0 sm:mx-4 max-h-[92vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
          <h2 className="text-base font-bold text-canvas">電卓</h2>
          <button type="button" onClick={onClose} className="text-dimension hover:text-canvas px-2 text-lg">✕</button>
        </div>

        <div className="p-3 space-y-3">
          {/* 表示エリア（div = OS キーボード抑止） */}
          <div className="bg-dark-bg border border-dark-border rounded-xl px-4 py-3 min-h-[52px] text-right">
            <span className={`font-mono text-2xl break-all ${error ? 'text-red-500' : 'text-canvas'}`}>
              {error ? 'エラー' : shown}
            </span>
          </div>

          {/* 操作行: AC / ← */}
          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={clearAll} className={`${btn} col-span-2 bg-red-500/15 text-red-400`}>AC</button>
            <button type="button" onClick={backspace} className={`${btn} col-span-2 bg-dark-bg border border-dark-border text-canvas`}>←</button>
          </div>

          {/* 数字パッド */}
          <div className="grid grid-cols-4 gap-2">
            {DIGITS.flat().map((label) => {
              const isOp = label in OP_MAP;
              const isEq = label === '=';
              const cls = isEq
                ? 'bg-accent text-white'
                : isOp
                ? 'bg-accent/15 text-accent'
                : 'bg-dark-bg border border-dark-border text-canvas';
              return (
                <button key={label} type="button" onClick={() => onDigit(label)} className={`${btn} ${cls}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
