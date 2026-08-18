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
import React, { useMemo, useState } from 'react';
import { Layer, Circle, Line, Text } from 'react-konva';
import Konva from 'konva';
import { useCanvasStore } from '@/stores/canvasStore';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';
import { isPlainSelectMode } from '@/lib/konva/toolMode';
import {
  SITE_SELECT_COLOR, SITE_VERTEX_FILL, SITE_VERTEX_HIT, SITE_VERTEX_R, SITE_VERTEX_SNAP_PX,
  siteDash, siteStrokeColor, siteStrokeWidth, snapSiteVertex,
} from '@/lib/konva/siteShape';
import { buildingCornersGrid, nearestBuildingCornerGuide } from '@/lib/konva/siteVertexGuide';
import { gapGuides } from '@/lib/konva/siteGapGuides';
import type { Point } from '@/types';

/** ドラッグ中の頂点（確定するまではストアへ書かず、ここで見せるだけ）。 */
type VertexDrag = { id: string; index: number; point: Point };

/** 距離ガイドの色。計測ツールと同じ赤にそろえる (= S-5)。 */
const GUIDE_COLOR = '#EF4444';
const GUIDE_DASH = [6, 4];

/**
 * すき間の常時表示 (= S-6)。S-5 の赤いガイドが主役なので、こちらは控えめにする
 * （細い線・小さい数字・青）。作法（破線＋mm）は S-5 と同じ。
 */
const GAP_COLOR = '#2563EB';
const GAP_DASH = [4, 4];
const GAP_FONT = 11;

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
  /**
   * 建物の角の一覧 (= S-5)。吸着先にも距離ガイドにも使う。
   * 建物が変わったときだけ作り直す（ドラッグ中は毎フレーム作らない）。
   */
  const buildingCorners = useMemo(() => buildingCornersGrid(buildings), [buildings]);
  /**
   * 建物と敷地のすき間 (= S-6)。選んでいる敷地についてだけ出す。
   * **形が変わったときだけ**計算する（選択中に止まっていれば計算しない。
   * 画面を動かしただけでも計算しない＝画面座標への変換は描くときに行う）。
   * ドラッグ中は drag が変わるので、そのぶんだけ計算し直して数値が追従する。
   */
  const gaps = useMemo(() => {
    const chosen = (sitePolygons ?? []).filter((s) => selectedIds.includes(s.id));
    if (chosen.length === 0 || buildings.length === 0) return [];
    const shapes = chosen.map((s) => ({
      points: drag && drag.id === s.id
        ? s.points.map((p, i) => (i === drag.index ? drag.point : p))
        : s.points,
    }));
    return gapGuides(buildings, shapes).filter((g) => g.mm > 0);
  }, [sitePolygons, buildings, selectedIds, drag]);

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
    ...buildingCorners,
    ...sites.filter((s) => s.id !== id).flatMap((s) => s.points),
  ];

  /**
   * ドラッグ中だけ出す距離ガイド (= S-5)。
   * いちばん近い建物の角までの X / Y 距離。建物が無ければ null（何も出さない）。
   */
  const guide = drag ? nearestBuildingCornerGuide(drag.point, buildingCorners) : null;

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

      {/* S-6: 建物と敷地のすき間。選んでいる間ずっと出る（形を変えれば追従する）。
          S-5 の赤いガイドが主役なので、こちらは細い青の破線＋小さめの数字で控えめに。 */}
      {editable && gaps.map((g, i) => {
        const ax = sx(g.from.x);
        const ay = sy(g.from.y);
        const bx = sx(g.to.x);
        const by = sy(g.to.y);
        const label = `${g.mm}`;
        const horizontal = g.axis === 'x';
        return (
          <React.Fragment key={`gap-${i}`}>
            <Line points={[ax, ay, bx, by]} stroke={GAP_COLOR} strokeWidth={1}
              dash={GAP_DASH} opacity={0.75} listening={false} />
            <Text
              x={horizontal ? (ax + bx) / 2 : (ax + bx) / 2 + 6}
              y={horizontal ? ay - GAP_FONT - 3 : (ay + by) / 2 - GAP_FONT / 2}
              text={label}
              fontSize={GAP_FONT} fontFamily="monospace" fill={GAP_COLOR} opacity={0.9}
              offsetX={horizontal ? (label.length * 6.4) / 2 : 0}
              listening={false}
            />
          </React.Fragment>
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

      {/* S-5: ドラッグ中だけ、いちばん近い建物の角までの X / Y 距離を出す。
          離せば消える（drag が null になる）。見た目は計測ツールに合わせた赤の破線。 */}
      {drag && guide && (() => {
        const p = drag.point;
        const cx = sx(guide.corner.x);
        const cy = sy(guide.corner.y);
        const px = sx(p.x);
        const py = sy(p.y);
        const xLabel = `${guide.dxMm}mm`;
        const yLabel = `${guide.dyMm}mm`;
        // 数値は指に隠れないよう、脚の中点から外へずらす。
        //   X は上へ 18px、Y は L の外側（頂点から見て角と反対側）へ 14px。
        const ySide = p.x >= guide.corner.x ? 1 : -1;
        return (
          <React.Fragment key="site-vertex-guide">
            {/* 水平の補助線（角 → 頂点の真上/真下） */}
            <Line points={[cx, cy, px, cy]} stroke={GUIDE_COLOR} strokeWidth={1.5}
              dash={GUIDE_DASH} opacity={0.9} listening={false} />
            {/* 垂直の補助線（そこから頂点まで） */}
            <Line points={[px, cy, px, py]} stroke={GUIDE_COLOR} strokeWidth={1.5}
              dash={GUIDE_DASH} opacity={0.9} listening={false} />
            {/* 相手の建物角 */}
            <Circle x={cx} y={cy} radius={5} fill={GUIDE_COLOR} listening={false} />
            <Circle x={cx} y={cy} radius={2} fill="#FFFFFF" listening={false} />
            {/* X 距離 */}
            <Text x={(cx + px) / 2} y={cy - 18} text={xLabel}
              fontSize={13} fontFamily="monospace" fontStyle="bold" fill={GUIDE_COLOR}
              offsetX={(xLabel.length * 7.5) / 2} listening={false} />
            {/* Y 距離 */}
            <Text x={px + ySide * 14} y={(cy + py) / 2 - 7} text={yLabel}
              fontSize={13} fontFamily="monospace" fontStyle="bold" fill={GUIDE_COLOR}
              offsetX={ySide > 0 ? 0 : yLabel.length * 7.5} listening={false} />
          </React.Fragment>
        );
      })()}
    </Layer>
  );
}
