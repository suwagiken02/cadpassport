'use client';

// ============================================================
// 敷地境界線のレイヤー (= S-1、 頂点編集は S-4)。
//
// 建物より**下**に敷く（敷地は下地で、その上に建物・足場が乗る）。
// 見た目は lib/konva/siteShape.ts が唯一の定義：建物と同じ黒・一点鎖線・建物より細い。
// 塗りは持たないので、当たり判定は線そのもの（内側をタップしても拾わない＝
// 上に乗っている建物のタップを奪わない）。
//
// 触れる条件・当たり判定の作法は BuildingLayer とまったく同じにしてある
// （素の選択モードで選択ONかつロック解除中、または消去／一括移動中）。
//
// S-4: 敷地を選ぶと角につまみが出て、引っ張ると形を直せる。
//   手描き（S-1/S-2）でも自動生成（S-3）でも同じに扱う。動かす向きに制約は
//   かけない（敷地は S-2 で斜め・任意角度を許しているため）。
//   頂点編集は敷地だけ。建物・屋根・障害物には入れない（建物には
//   「建物と足場は必ず平行」の絶対原則があるため）。
// ============================================================
import React, { useState } from 'react';
import { Layer, Circle, Line } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPlainSelectMode } from '@/lib/konva/toolMode';
import {
  SITE_SELECT_COLOR, SITE_VERTEX_FILL, SITE_VERTEX_HIT, SITE_VERTEX_R, SITE_VERTEX_SNAP_PX,
  siteDash, siteStrokeColor, siteStrokeWidth, snapSiteVertex,
} from '@/lib/konva/siteShape';
import type { Point } from '@/types';

/** ドラッグ中の頂点（確定するまではストアへ書かず、ここで見せるだけ）。 */
type VertexDrag = { id: string; index: number; point: Point };

export default function SiteLayer() {
  const sitePolygons = useCanvasStore((s) => s.canvasData.sitePolygons);
  const buildings = useCanvasStore((s) => s.canvasData.buildings);
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const mode = useCanvasStore((s) => s.mode);
  const isDarkMode = useCanvasStore((s) => s.isDarkMode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  const moveSelectIds = useCanvasStore((s) => s.moveSelectMode.selectedIds);
  const moveSelectActive = useCanvasStore((s) => s.moveSelectMode.active);
  const selectActive = useCanvasStore((s) => s.selectActive);
  const selectLockBuilding = useCanvasStore((s) => s.selectLock.building);
  const isReorderMode = useCanvasStore((s) => s.isReorderMode);
  const isHeightMarkerMode = useCanvasStore((s) => s.isHeightMarkerMode);
  const isRidgeLineMode = useCanvasStore((s) => s.isRidgeLineMode);
  const isMeasuring = useCanvasStore((s) => s.isMeasuring);
  const isMagnetPinMode = useCanvasStore((s) => s.isMagnetPinMode);
  const isAreaDesignationMode = useCanvasStore((s) => s.isAreaDesignationMode);
  const pendingTargetType = useCanvasStore((s) => s.pendingTargetType);
  const [drag, setDrag] = useState<VertexDrag | null>(null);

  const sites = sitePolygons ?? [];
  // 敷地が 1 枚も無ければ何も出さない（既存の図面はノードが 1 つも増えない）。
  if (sites.length === 0) return null;

  const gridPx = INITIAL_GRID_PX * zoom;
  const plainSelect = isPlainSelectMode({
    mode, isHeightMarkerMode, isRidgeLineMode, isMeasuring, isMagnetPinMode,
    isAreaDesignationMode, isReorderMode, moveSelectActive, pendingTargetType,
  });
  // BuildingLayer と同じ条件（敷地は建物と同じ「躯体まわり」なのでロックも建物側に従う）
  const listenSite =
    (plainSelect && selectActive && !selectLockBuilding)
    || (mode === 'select' && isReorderMode);
  const listening = listenSite || mode === 'erase' || mode === 'move-select';
  const effectiveSelectedIds = mode === 'move-select' ? moveSelectIds : selectedIds;
  /** つまみを出すのは、素の選択モードで触れる状態のときだけ（消去・一括移動では出さない）。 */
  const editable = plainSelect && selectActive && !selectLockBuilding;

  const sx = (gx: number) => gx * gridPx + panX;
  const sy = (gy: number) => gy * gridPx + panY;
  /** 画面 px → グリッド（つまみの位置を戻すときに使う）。 */
  const toGrid = (px: number, py: number): Point => ({ x: (px - panX) / gridPx, y: (py - panY) / gridPx });

  /** ドラッグ中の頂点だけ差し替えた外形（線が指に追従する）。 */
  const pointsOf = (id: string, pts: Point[]): Point[] => (
    drag && drag.id === id ? pts.map((p, i) => (i === drag.index ? drag.point : p)) : pts
  );

  /**
   * 寄せ先の角。建物の角と、**他の**敷地の角だけ。
   * 自分自身の角は入れない（辺が潰れてしまうため）。
   */
  const snapTargets = (id: string): Point[] => [
    ...buildings.flatMap((b) => b.points),
    ...sites.filter((s) => s.id !== id).flatMap((s) => s.points),
  ];

  return (
    <Layer>
      {sites.map((site) => {
        const isSelected = effectiveSelectedIds.includes(site.id);
        const pts = pointsOf(site.id, site.points);
        return (
          <Line
            key={site.id}
            id={site.id}
            points={pts.flatMap((p) => [sx(p.x), sy(p.y)])}
            closed
            stroke={siteStrokeColor(isDarkMode, isSelected)}
            strokeWidth={siteStrokeWidth(zoom, isSelected)}
            dash={siteDash(zoom)}
            // 塗らない＝内側は当たらない。線そのものを掴めるよう当たり幅だけ広げる。
            hitStrokeWidth={listening ? 14 : 0}
            listening={listening}
          />
        );
      })}

      {/* S-4: 選んでいる敷地の角につまみを出す。引っ張るとその頂点だけが動く。 */}
      {editable && sites.filter((s) => selectedIds.includes(s.id)).map((site) => (
        pointsOf(site.id, site.points).map((p, index) => (
          <Circle
            key={`${site.id}-v${index}`}
            x={sx(p.x)} y={sy(p.y)}
            radius={SITE_VERTEX_R}
            fill={SITE_VERTEX_FILL}
            stroke={SITE_SELECT_COLOR}
            strokeWidth={2}
            hitStrokeWidth={SITE_VERTEX_HIT}
            draggable
            // つまみの上で始まった操作はステージへ渡さない。渡すと同時に
            //   範囲選択のラバーバンドが走り、離した瞬間に選択がすり替わる。
            //   （新しく足したつまみの上だけの話なので、既存要素の選択挙動は変わらない）
            onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => { e.cancelBubble = true; }}
            onTouchStart={(e: Konva.KonvaEventObject<TouchEvent>) => { e.cancelBubble = true; }}
            // 近くの角へ軽く寄せる。無ければ指の位置そのまま（自由が原則）。
            dragBoundFunc={(pos) => {
              const g = snapSiteVertex(
                toGrid(pos.x, pos.y), snapTargets(site.id), SITE_VERTEX_SNAP_PX / gridPx,
              );
              return { x: sx(g.x), y: sy(g.y) };
            }}
            onDragStart={() => {
              // 1 ドラッグ 1 undo（動かしている間は履歴を積まない）
              useCanvasStore.getState().pushHistory();
              setDrag({ id: site.id, index, point: p });
            }}
            onDragMove={(e) => {
              setDrag({ id: site.id, index, point: toGrid(e.target.x(), e.target.y()) });
            }}
            onDragEnd={(e) => {
              useCanvasStore.getState()
                .setSitePolygonPoint(site.id, index, toGrid(e.target.x(), e.target.y()));
              setDrag(null);
            }}
          />
        ))
      ))}
    </Layer>
  );
}
