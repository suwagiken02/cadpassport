'use client';

// ============================================================
// 平面パレットの姿図の枠 (= P-1-fix5)
//
// もとは手摺の姿図だけが持っていた「枠 ＋ 掴んで引き出す」を部品にしたもの。
// 手摺・階段・単管の姿図はすべてこの**同じ枠**を通る。
//
// なぜ枠ごと共通化するか:
//   ドラッグ開始の配線（onPointerDown / touchAction / 枠のクラス）を部材ごとに
//   書いていると、片方だけ付け忘れる・片方だけ直し忘れるが起きる。
//   枠が 1 つなら「姿図があるのに掴めない」という状態が構造的に作れない。
//
// マークアップは手摺の実装そのまま。viewBox は指定があるときだけ付ける
// （手摺は viewBox を持たないので、属性ごと出さない＝出力が完全に一致する）。
// ============================================================
import React from 'react';

/**
 * 姿図の枠。手摺の実装から取った文字列そのままで、手摺・階段・単管が共有する
 * （枠の大きさ・見た目を部材ごとにバラつかせない）。
 */
export const PREVIEW_FRAME_CLASS =
  'bg-dark-bg rounded-lg border border-dark-border cursor-grab active:cursor-grabbing select-none';
/** 姿図の一辺(px)。手摺の getAnglePreviewPoints の枠と同じ。 */
export const PREVIEW_FRAME_SIZE = 80;

type Props = {
  size?: number;
  /** 描画座標系を使う姿図（階段・単管）だけ指定する。手摺は付けない。 */
  viewBox?: string;
  /** 掴んでキャンバスへ引き出す（＝ドラッグ開始）。 */
  onDragOut?: (e: React.PointerEvent) => void;
  children: React.ReactNode;
};

export default function PalettePreviewFrame({
  size = PREVIEW_FRAME_SIZE, viewBox, onDragOut, children,
}: Props) {
  return (
    <svg
      width={size} height={size}
      {...(viewBox ? { viewBox } : {})}
      className={PREVIEW_FRAME_CLASS}
      style={{ touchAction: 'none' }}
      onPointerDown={onDragOut}
    >
      {children}
    </svg>
  );
}
