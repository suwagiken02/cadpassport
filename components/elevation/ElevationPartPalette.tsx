'use client';

// ============================================================
// 立面の部材パレット (E-8-v3c-fix)
//
// 入口を 1 つにするため、立面タップで出るバー(ElevationEditBar)と
// 画面下の「部材」メニュー(PartSelector)の**両方がこの同じコンポーネント**を出す。
// 中身も見た目も完全に同一なので、どちらから開いても迷わない。
//
// 操作（平面の部材配置と同じ流儀・placementInput が判定）:
//   ・マウス … 選ぶとシャドーがカーソルに追従し、クリックで置く（連続配置可）
//   ・指     … パレットのボタンを掴んだままキャンバスへ引き出し、離した位置に置く
// 置ける場所の制限（ゴーストの許可位置）は無い。接合が近ければ吸着する。
// ============================================================
import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { PALETTE_KINDS } from '@/lib/konva/elevation/elevationSlots';
import {
  POST_KOMA_CHOICES, SPAN_LENGTH_CHOICES_MM, type ElevationPartKind,
} from '@/lib/konva/elevation/elevationParts';
import {
  defaultPlacementMode, placementModeForPointer, startPaletteDragOut, type PlacementMode,
} from '@/lib/konva/placement/placementInput';

/** パレットの部材名。 */
const PART_LABEL: Record<ElevationPartKind, string> = {
  post: '支柱', postExt: '支柱延長', jack: 'ジャッキ', board: '踏板',
  rail: '手摺', raiseBoard: '嵩上げ床', raiseRail: '嵩上げ手摺', brace: '筋交',
};

export default function ElevationPartPalette({ showText = true }: { showText?: boolean }) {
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const addSize = useCanvasStore((s) => s.elevationAddSize);
  const addFlip = useCanvasStore((s) => s.elevationAddFlip);
  /** 入力方式。マウス=シャドー追従+クリック / 指=パレットから引き出して離す。 */
  const [inputMode, setInputMode] = useState<PlacementMode>('hover-click');
  useEffect(() => { setInputMode(defaultPlacementMode()); }, []);

  /** パレットのボタンを掴んでキャンバスへ引き出す（平面と共通の受け口）。 */
  const startDragOut = (kind: ElevationPartKind, e: React.PointerEvent) => {
    useCanvasStore.getState().setElevationAddTool(kind);
    setInputMode(placementModeForPointer(e.pointerType));
    startPaletteDragOut({
      from: { clientX: e.clientX, clientY: e.clientY },
      onDrop: (p) => useCanvasStore.getState().setElevationDropAt(p),
    });
  };

  const isPost = addTool === 'post' || addTool === 'postExt';
  const sizes = isPost
    ? POST_KOMA_CHOICES.map((k) => ({ value: k as number, label: `${k}` }))
    : SPAN_LENGTH_CHOICES_MM.map((l) => ({ value: l as number, label: `${l}` }));

  return (
    <>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <span className="text-[10px] text-dimension mr-1">部材</span>
        {PALETTE_KINDS.map((k) => (
          <button key={k} type="button"
            onClick={() => useCanvasStore.getState().setElevationAddTool(addTool === k ? null : k)}
            onPointerDown={(e) => startDragOut(k, e)}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
              addTool === k ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
            }`}>
            {PART_LABEL[k]}
          </button>
        ))}
        {showText && (
          <button type="button"
            onClick={() => useCanvasStore.getState().setElevationAddTool(addTool === 'text' ? null : 'text')}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
              addTool === 'text' ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
            }`}>
            文字
          </button>
        )}
        {addTool && addTool !== 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">
            {inputMode === 'drag-drop' ? 'パレットから引き出して離す' : '置きたい位置をクリック'}
          </span>
        )}
        {addTool === 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">位置をタップ</span>
        )}
      </div>

      {/* 長さ（支柱＝コマ数／手摺・踏板・筋交＝標準スパン）と、筋交の向き。 */}
      {addTool && addTool !== 'text' && addTool !== 'jack' && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[10px] text-dimension mr-1">{isPost ? '長さ(コマ)' : '長さ(mm)'}</span>
          {sizes.map(({ value, label }) => (
            <button key={value} type="button"
              onClick={() => useCanvasStore.getState().setElevationAddSize(value)}
              onPointerDown={(e) => {
                useCanvasStore.getState().setElevationAddSize(value);
                startDragOut(addTool, e);
              }}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                addSize === value ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
              }`}>
              {label}
            </button>
          ))}
          {isPost && <span className="text-[10px] text-dimension ml-1">＝{addSize * 450}mm</span>}
          {addTool === 'brace' && (
            <button type="button"
              onClick={() => useCanvasStore.getState().toggleElevationAddFlip()}
              className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-dark-bg border-dark-border text-dimension ml-1">
              向き {addFlip ? '↖' : '↗'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
