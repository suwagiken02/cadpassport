'use client';

// ============================================================
// 階選択モーダル (R-1k): 高さ/棟/屋根ツールの起動直後に「どの階を編集しますか」を訊く。
//
// 背景（実機課題・鮎澤氏）: 階セレクタが画面上端の隅にあり気づきにくい。1F の外形は 2F を
// 内包していることが多く、「1F のまま 2F の屋根や高さを作ってしまう」誤爆が起きていた。
// 複数階の物件でだけ出す（単一階では従来どおり何も訊かない＝操作感を変えない）。
// 既定ハイライトは前回選択（activeFloor）。
// ============================================================
import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { floorChoices } from '@/lib/konva/floorScope';

const TOOL_LABEL: Record<'height' | 'ridge' | 'roof', string> = {
  height: '高さ',
  ridge: '棟ライン',
  roof: '屋根',
};

export default function FloorPickerModal() {
  const tool = useCanvasStore((s) => s.floorPromptTool);
  const activeFloor = useCanvasStore((s) => s.activeFloor);
  const buildings = useCanvasStore((s) => s.canvasData.buildings);

  if (!tool) return null;
  const choices = floorChoices(buildings);
  if (choices.length === 0) return null; // 単一階（起動後に建物が消えた等の保険）

  const pick = (f: number) => {
    useCanvasStore.getState().setActiveFloor(f);
    useCanvasStore.getState().setFloorPromptTool(null);
  };

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-xs mx-4 w-full">
        <h2 className="text-base text-canvas font-bold mb-1">どの階を編集しますか</h2>
        <p className="text-[11px] text-dimension mb-4">
          {TOOL_LABEL[tool]}ツール：選んだ階の外壁だけが対象になります
        </p>

        <div className="flex flex-col gap-2 mb-4">
          {choices.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => pick(f)}
              aria-pressed={activeFloor === f}
              className={`w-full py-4 rounded-xl text-lg font-bold border-2 transition-colors ${
                activeFloor === f
                  ? 'bg-accent text-white border-accent'
                  : 'bg-dark-bg text-canvas border-dark-border hover:border-accent'
              }`}
            >
              {f}F{activeFloor === f && <span className="ml-2 text-xs font-normal">前回</span>}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => useCanvasStore.getState().setFloorPromptTool(null)}
          className="w-full py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold"
        >
          このまま（{activeFloor}F）
        </button>
      </div>
    </div>
  );
}
