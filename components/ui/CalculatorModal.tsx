'use client';

import { useState, useEffect } from 'react';
import { evalExpr, fillByLargest, formatHeightResult } from '@/lib/konva/calculator';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';

// 足場職人向け電卓（フローティングパネル・部材パレット PartSelector と同方式）。
// オーバーレイなし＝開いたまま図面のズーム/パン/部材選択が可能。ヘッダー=移動・右下角=リサイズ。
// OS キーボードを出さず画面内ボタンで入力。計算ロジックは lib/konva/calculator.ts（無改変）。

type Props = { onClose: () => void };

const DEFAULT_W = 264;
const DEFAULT_H = 460;
const MIN_W = 160; // 大幅縮小可（タッチペン前提・ミニモードなし）
const MIN_H = 200;

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: { corner: Corner; pos: string; cursor: string }[] = [
  { corner: 'nw', pos: 'top-0 left-0', cursor: 'cursor-nw-resize' },
  { corner: 'ne', pos: 'top-0 right-0', cursor: 'cursor-ne-resize' },
  { corner: 'sw', pos: 'bottom-0 left-0', cursor: 'cursor-sw-resize' },
  { corner: 'se', pos: 'bottom-0 right-0', cursor: 'cursor-se-resize' },
];

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
  const [result, setResult] = useState<string | null>(null);
  const enabledSizes = useHandrailSettingsStore((s) => s.enabledSizes);
  const priorityConfig = useHandrailSettingsStore((s) => s.priorityConfig);

  // --- フローティングパネル位置・サイズ（PartSelector と同じドラッグ/リサイズ方式・オーバーレイなし） ---
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 16, y: 72 };
    // 既定は右上寄り（PartSelector 既定=下部中央・ツールバー=下部・FloorSelector=上部中央 と重ならない）
    return { x: Math.max(8, window.innerWidth - DEFAULT_W - 12), y: 72 };
  });
  const [panelSize, setPanelSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [panelDrag, setPanelDrag] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [panelResize, setPanelResize] = useState<{ corner: Corner; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  // パネル移動（ヘッダードラッグ）
  useEffect(() => {
    if (!panelDrag) return;
    const onMove = (e: PointerEvent) => {
      setPanelPos({
        x: Math.max(0, Math.min(window.innerWidth - 60, panelDrag.origX + e.clientX - panelDrag.startX)),
        y: Math.max(0, Math.min(window.innerHeight - 40, panelDrag.origY + e.clientY - panelDrag.startY)),
      });
    };
    const onUp = () => setPanelDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [panelDrag]);

  // パネルリサイズ（四隅ドラッグ）: 掴んだ角を動かし反対側の角は固定（一般的なウィンドウ挙動）。
  //   最小 160×200、最大は viewport 内。左/上の角は panelPos も同時に更新。
  useEffect(() => {
    if (!panelResize) return;
    const { corner, startX, startY, origX, origY, origW, origH } = panelResize;
    const isLeft = corner === 'nw' || corner === 'sw';
    const isTop = corner === 'nw' || corner === 'ne';
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let w: number, h: number, x = origX, y = origY;
      if (isLeft) {
        // 右端(origX+origW)を固定。左へ広げても x>=0（幅上限=origX+origW）
        w = Math.max(MIN_W, Math.min(origX + origW, origW - dx));
        x = origX + origW - w;
      } else {
        w = Math.max(MIN_W, Math.min(window.innerWidth - origX, origW + dx));
      }
      if (isTop) {
        // 下端(origY+origH)を固定。上へ広げても y>=0（高さ上限=origY+origH）
        h = Math.max(MIN_H, Math.min(origY + origH, origH - dy));
        y = origY + origH - h;
      } else {
        h = Math.max(MIN_H, Math.min(window.innerHeight - origY, origH + dy));
      }
      setPanelSize({ w, h });
      setPanelPos({ x, y });
    };
    const onUp = () => setPanelResize(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [panelResize]);

  const append = (ch: string) => { setError(false); setResult(null); setExpr((e) => e + ch); };
  const clearAll = () => { setError(false); setResult(null); setExpr(''); };
  const backspace = () => { setError(false); setResult(null); setExpr((e) => e.slice(0, -1)); };
  const equals = () => {
    const r = evalExpr(expr);
    if (r === null) { setError(true); return; }
    setResult(null);
    // 小数は最大 6 桁で丸めて末尾 0 を除去
    setExpr(String(Math.round(r * 1e6) / 1e6));
  };

  /** 表示中の数値（式なら評価結果）。無効なら null。 */
  const currentValue = (): number | null => {
    if (expr.trim() === '') return null;
    return evalExpr(expr);
  };

  const doAllocate = () => {
    const v = currentValue();
    if (v === null || v <= 0) { setError(true); return; }
    const { combo, usedMm, remainderMm } = fillByLargest(v, enabledSizes, priorityConfig);
    if (combo.length === 0) { setResult('配置できる部材がありません'); return; }
    const parts = combo.map((c) => `${c.size}×${c.count}`).join('＋');
    setResult(`${parts}＝${usedMm}　余り${remainderMm}`);
  };

  const doHeight = () => {
    const v = currentValue();
    if (v === null || v <= 0) { setError(true); return; }
    setResult(formatHeightResult(v));
  };

  const onDigit = (label: string) => {
    if (label === '=') { equals(); return; }
    if (label in OP_MAP) { append(OP_MAP[label]); return; }
    append(label);
  };

  // 表示は演算子を見やすい記号へ戻す
  const shown = (expr || '0').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');

  // 幅に応じた段階的な文字サイズ（小さくすると文字も縮む・はみ出さない範囲）
  const padText = panelSize.w < 200 ? 'text-xs' : panelSize.w < 240 ? 'text-sm' : 'text-lg';
  const dispText = panelSize.w < 200 ? 'text-base' : panelSize.w < 240 ? 'text-xl' : 'text-2xl';
  const resText = panelSize.w < 240 ? 'text-xs' : 'text-sm';
  // 共通ボタン: グリッドセルに追従（高さはセルが伸縮＝パネルサイズに追従）・文字はみ出し防止
  const btn = `rounded-xl ${padText} font-bold flex items-center justify-center overflow-hidden active:opacity-70 transition-opacity`;

  return (
    <div
      data-calc-panel
      style={{ left: panelPos.x, top: panelPos.y, width: panelSize.w, height: panelSize.h }}
      className="fixed z-50 flex flex-col rounded-xl shadow-2xl border bg-dark-surface border-dark-border"
    >
      {/* ヘッダー（ドラッグハンドル） */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0 border-b border-dark-border touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          setPanelDrag({ startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y });
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-dimension text-sm leading-none">⠿</span>
          <span className="text-sm font-bold text-canvas">電卓</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="relative z-20 text-dimension hover:text-canvas text-base px-1 leading-none"
        >
          ✕
        </button>
      </div>

      {/* 本体（flex-1・数字パッドが余白を埋めてサイズ追従） */}
      <div className="flex-1 flex flex-col gap-2 p-3 min-h-0 overflow-y-auto">
        {/* 表示エリア（div = OS キーボード抑止） */}
        <div className="shrink-0 bg-dark-bg border border-dark-border rounded-xl px-3 py-2 min-h-[40px] flex items-center justify-end">
          <span className={`font-mono ${dispText} break-all ${error ? 'text-red-500' : 'text-canvas'}`}>
            {error ? 'エラー' : shown}
          </span>
        </div>

        {/* 操作行: AC / ← */}
        <div className="shrink-0 grid grid-cols-4 gap-1.5 h-10">
          <button type="button" onClick={clearAll} className={`${btn} col-span-2 bg-red-500/15 text-red-400`}>AC</button>
          <button type="button" onClick={backspace} className={`${btn} col-span-2 bg-dark-bg border border-dark-border text-canvas`}>←</button>
        </div>

        {/* 数字パッド（flex-1・grid-rows-4 でセルが伸縮＝パネル高さに追従。min-h-0 で縮小可） */}
        <div className="flex-1 min-h-[96px] grid grid-cols-4 grid-rows-4 gap-1.5">
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

        {/* 足場専用ボタン: 表示中の数値を使う */}
        <div className="shrink-0 grid grid-cols-2 gap-1.5 h-10">
          <button type="button" onClick={doAllocate} className={`${btn} bg-yellow-500/15 text-yellow-400 border border-yellow-500/30`}>
            割付
          </button>
          <button type="button" onClick={doHeight} className={`${btn} bg-teal-500/15 text-teal-300 border border-teal-500/30`}>
            高さ
          </button>
        </div>

        {/* 結果表示 */}
        {result !== null && (
          <div className="shrink-0 bg-dark-bg border border-dark-border rounded-xl px-4 py-3">
            <p className={`${resText} font-mono text-canvas break-all leading-relaxed whitespace-pre-line`}>{result}</p>
          </div>
        )}
      </div>

      {/* リサイズハンドル（四隅）: stopPropagation でヘッダードラッグと干渉しない */}
      {HANDLES.map(({ corner, pos, cursor }) => (
        <div
          key={corner}
          className={`absolute ${pos} w-4 h-4 ${cursor} touch-none z-10`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPanelResize({ corner, startX: e.clientX, startY: e.clientY, origX: panelPos.x, origY: panelPos.y, origW: panelSize.w, origH: panelSize.h });
          }}
        >
          {corner === 'se' && (
            <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-0.5 right-0.5 text-dimension/40">
              <path d="M9 1L1 9M9 4L4 9M9 7L7 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}
