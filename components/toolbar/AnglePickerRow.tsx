'use client';

// ============================================================
// 平面パレットの「角度」行 (= P-1-fix4)
//
// もとは手摺だけが持っていた UI（プリセット / 姿図 / 数値入力 / ±微調整）を、
// そのまま部品として切り出したもの。手摺・単管がこの**同じ部品**を使う。
// 単管用に作り直すのではなく流用する＝操作感が必ず一致し、片方だけ直り忘れることもない。
//
// マークアップは手摺の実装を 1 文字も変えずに移してある（見た目・クラス名は不変）。
// 姿図（preview）は部材ごとに違うので呼び出し側が渡す:
//   手摺 … getAnglePreviewPoints の線分 SVG（従来どおり）
//   単管 … PlanePartPreview（キャンバスと同じ描画関数で描く・P-1-fix の仕組みを維持）
// どちらも枠は PalettePreviewFrame（= P-1-fix5）なので、掴んで引き出す挙動は同じ。
// ============================================================
import React from 'react';
import { ANGLE_STEPS } from '@/lib/konva/placement/anglePresets';
import NumInput from '@/components/ui/NumInput';

type Props<V> = {
  /** 角度プリセット（横 / 縦 / 15°…）。 */
  presets: { label: string; value: V }[];
  /** そのプリセットが選択中か。 */
  isActive: (v: V) => boolean;
  onPreset: (v: V) => void;
  /** 数値入力に出す角度(度)。 */
  numValue: number;
  onNum: (v: number) => void;
  /** ±微調整。delta は ANGLE_STEPS の値。 */
  onStep: (delta: number) => void;
  /** 姿図（掴んでキャンバスへ引き出せる SVG）。 */
  preview: React.ReactNode;
};

export default function AnglePickerRow<V>({
  presets, isActive, onPreset, numValue, onNum, onStep, preview,
}: Props<V>) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1 flex-wrap">
        {presets.map((p) => (
          <button key={String(p.value)} onClick={() => onPreset(p.value)}
            className={`px-2 py-1 rounded text-xs font-bold transition-colors ${
              isActive(p.value) ? 'bg-accent text-white' : 'bg-dark-bg text-dimension border border-dark-border'
            }`}
          >{p.label}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {preview}
        <div className="flex items-center gap-1">
          <NumInput
            value={numValue}
            onChange={onNum}
            min={0}
            className="w-16 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono"
          />
          <span className="text-[10px] text-dimension">°</span>
        </div>
        <div className="flex gap-0.5">
          {ANGLE_STEPS.map((d) => (
            <button key={d} onClick={() => onStep(d)}
              className="px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors"
            >{d > 0 ? `+${d}°` : `${d}°`}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
