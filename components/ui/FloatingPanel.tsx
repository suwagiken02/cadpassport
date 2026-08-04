'use client';

// ============================================================
// 掴んで動かせるフローティングパネル (E-8-v3c-fix5)
//
// 立面のパレット／操作バーが画面下で場所を奪い合い、隠れた部分を触れなくなったので、
// 「タイトルバーを掴んでどこへでも逃がせる」形にする。位置の計算は panelPosition(pure)。
//
//   ・pos が null … 従来どおり画面下の中央に固定（初回の見え方は変えない）
//   ・掴んだ瞬間  … 実際の表示位置を測って pos に切り替える（掴んだ所が飛ばない）
//   ・画面外へは出さない。画面リサイズでも収め直す（掴み直せなくなるのを防ぐ）
//
// 平面のパネルにも展開できるよう、立面固有のものは何も持たない（鮎澤氏方針）。
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clampPanelPos, dragPanelPos, type PanelPos } from '@/lib/konva/placement/panelPosition';

type Props = {
  title: string;
  /** 移動後の位置。null＝既定位置（画面下・中央）。 */
  pos: PanelPos | null;
  onMove: (p: PanelPos) => void;
  /** 右上に出す追加要素。 */
  headerRight?: React.ReactNode;
  /** 明示的に閉じる操作 (= E-8-v3c-fix6)。渡すと右上に × を出す。 */
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
};

export default function FloatingPanel({
  title, pos, onMove, headerRight, onClose, className = '', children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ from: PanelPos; origin: PanelPos } | null>(null);
  const [dragging, setDragging] = useState(false);
  // ドラッグ中に listener を貼り直すと pointermove を取りこぼしてカクつくので、
  // 親から来る callback は ref 経由で読む（購読は dragging の切り替わりだけ）。
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  const sizes = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    return {
      panel: { w: r?.width ?? 0, h: r?.height ?? 0 },
      vp: { w: window.innerWidth, h: window.innerHeight },
    };
  }, []);

  // 画面が狭くなったときに画面外へ取り残されないよう収め直す。
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const { panel, vp } = sizes();
      const next = clampPanelPos(pos, panel, vp);
      if (next.x !== pos.x || next.y !== pos.y) moveRef.current(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, sizes]);

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const { panel, vp } = sizes();
      moveRef.current(dragPanelPos(d.origin, d.from, { x: e.clientX, y: e.clientY }, panel, vp));
    };
    const onUp = () => { dragRef.current = null; setDragging(false); };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, sizes]);

  const startDrag = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    // 掴んだ瞬間の実位置を起点にする（固定位置 → 自由位置へ切り替わっても飛ばない）。
    dragRef.current = { from: { x: e.clientX, y: e.clientY }, origin: { x: r.left, y: r.top } };
    setDragging(true);
    onMove({ x: r.left, y: r.top });
  };

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: '50%', bottom: 64, transform: 'translateX(-50%)' };

  return (
    <div
      ref={ref}
      style={style}
      // E-8-v3c-fix6: パネル内の操作を外へ漏らさない。キャンバスや window 側の
      //   「外側を触った」系の処理に拾われて、選択が外れる／パネルが消えるのを防ぐ。
      //   閉じるのは明示操作（× / Esc / パネルの外の実クリック）だけにする。
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`fixed z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl max-w-[94vw] max-h-[80vh] overflow-y-auto ${className}`}
    >
      {/* タイトルバー＝ドラッグハンドル（平面パネルと同じ ⠿）。 */}
      <div
        onPointerDown={startDrag}
        className={`flex items-center justify-between gap-2 px-3 py-1.5 border-b border-dark-border select-none touch-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-dimension text-sm leading-none">⠿</span>
          <span className="text-xs font-bold text-canvas truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {headerRight}
          {onClose && (
            <button type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label="閉じる"
              className="px-2 leading-none text-dimension hover:text-canvas text-sm">
              ×
            </button>
          )}
        </div>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
