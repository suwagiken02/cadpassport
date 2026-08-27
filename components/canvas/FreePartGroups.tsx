'use client';

// ============================================================
// キャンバス直下の手動部材の「描画＋触れる部分」 (= E-8-v5c で切り出し)。
//
// FreePartLayer（部材）と AidLayer（補助線・目印）が同じ絵・同じ触り方を共有する。
// 分けた理由は重ね順で、補助線は図面の主役を隠さないよう**建物より背面**に敷く。
// 描き方と当たり判定を 1 か所にまとめてあるので、片方だけ選べない・片方だけ
// 動かせない、といった食い違いが構造的に起こらない。
// ============================================================
import React, { useMemo } from 'react';
import { Group } from 'react-konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { moveFreePartBy } from '@/lib/konva/placement/freePartPlacement';
import { freePartsToPrimitives, type FreePart } from '@/lib/konva/freeParts';
import { groupByPartId, renderPrimLocal } from './ElevationViewLayer';

/** ドラッグと判定するまでの移動量(px)。指のタップのぶれより大きく。 */
export const EDIT_DRAG_PX = 10;

export default function FreePartGroups({
  parts, gridPx, interactive, mode, selectedIds,
}: {
  parts: FreePart[];
  gridPx: number;
  /** 触れる状態か（選択モードで選択 ON、または消去モード）。 */
  interactive: boolean;
  mode: string;
  selectedIds: string[];
}) {
  const prims = useMemo(() => freePartsToPrimitives(parts), [parts]);
  const groups = useMemo(() => groupByPartId(prims), [prims]);
  const partById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  /** タップ: 消去ツール中は削除、そうでなければ既存の選択経路（selectedIds）へ乗せる。 */
  const onPartTap = (id: string) => {
    const st = useCanvasStore.getState();
    if (mode === 'erase') { st.removeElement(id); return; }
    st.setSelectedIds([id]);
  };

  return (
    <>
      {groups.map(({ id, from, items }) => {
        const part = id ? partById.get(id) : undefined;
        const hittable = interactive && !!part;
        const isSel = !!id && selectedIds.includes(id);
        const nodes = items.map((p, k) => renderPrimLocal(p, `${from}-${k}`, gridPx, {
          selected: isSel, overridden: false, interactive: hittable,
        }));
        if (!hittable || !id) return <React.Fragment key={`g-${from}`}>{nodes}</React.Fragment>;
        return (
          <Group
            key={`g-${from}`}
            draggable={mode === 'select'}
            // 指のタップは必ず数 px ぶれる。小さすぎるとドラッグ扱いになり選べなくなる。
            dragDistance={EDIT_DRAG_PX}
            onDragStart={() => { if (mode === 'select') onPartTap(id); }}
            onDragEnd={(e) => {
              const d = e.target.position();
              e.target.position({ x: 0, y: 0 });
              moveFreePartBy(id, d);
            }}
            onClick={() => onPartTap(id)}
            onTap={() => onPartTap(id)}
          >
            {nodes}
          </Group>
        );
      })}
    </>
  );
}
