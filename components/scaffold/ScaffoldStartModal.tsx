'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import NumInput from '@/components/ui/NumInput';
import { StartCorner, HandrailLengthMm, Point } from '@/types';
import { mmToGrid } from '@/lib/konva/gridUtils';
import { getHandrailColor } from '@/lib/konva/handrailColors';
import { getBuildingEdgesClockwise, EdgeInfo } from '@/lib/konva/autoLayoutUtils';
import { computeEdgeLabelPosition } from '@/lib/konva/buildingLabelUtils';
import { isScaffoldFloorBlocked } from './scaffoldStartGuard';
import { MAX_SCAFFOLD_FLOOR } from '@/lib/konva/floorLimits';

type Props = { onClose: () => void; lockFloor?: number };

const FACE_LABEL: Record<string, string> = {
  north: '北面', south: '南面', east: '東面', west: '西面',
};

/** 頂点の位置から最も近い StartCorner を推定 */
function vertexToCorner(vtx: Point, center: Point): StartCorner {
  const dx = vtx.x - center.x;
  const dy = vtx.y - center.y;
  if (dx >= 0 && dy <= 0) return 'ne';
  if (dx < 0 && dy <= 0) return 'nw';
  if (dx >= 0 && dy > 0) return 'se';
  return 'sw';
}

export default function ScaffoldStartModal({ onClose, lockFloor }: Props) {
  const { setScaffoldStartFloor, canvasData, addHandrail } = useCanvasStore();
  const enabledSizes = useHandrailSettingsStore(s => s.enabledSizes);

  // 部材設定で ON のサイズを降順で表示。OFF サイズは選択肢から除外。
  const handrailOptions = useMemo<HandrailLengthMm[]>(
    () => [...enabledSizes].sort((a, b) => b - a),
    [enabledSizes],
  );

  // 対象階の選択（初期は 1F。bothmode 経由(lockFloor)なら固定階で開く）
  const [targetFloor, setTargetFloor] = useState<number>(lockFloor ?? 1);

  // 対象階に合致する最初の建物
  const targetBuilding = useMemo(
    () => canvasData.buildings.find(b => (b.floor ?? 1) === targetFloor) ?? null,
    [canvasData.buildings, targetFloor],
  );

  // S-5e-3: 建物が存在する階の昇順ユニーク（対象階ボタンの母集合）。{1,2} では [1,2]。
  const presentFloors = useMemo<number[]>(() => {
    const s = new Set<number>();
    for (const b of canvasData.buildings) s.add(b.floor ?? 1);
    return Array.from(s).sort((a, b) => a - b);
  }, [canvasData.buildings]);

  // 建物の辺情報を取得（対象階の建物基準）
  const edgeInfo = useMemo(() => {
    if (!targetBuilding) return null;
    const edges = getBuildingEdgesClockwise(targetBuilding);
    if (edges.length < 3) return null;
    const pts = edges.map(e => e.p1);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { edges, pts, center: { x: cx, y: cy } };
  }, [targetBuilding]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [face1Distance, setFace1Distance] = useState(900);
  const [face2Distance, setFace2Distance] = useState(900);
  const [face1Handrail, setFace1Handrail] = useState<HandrailLengthMm>(
    () => handrailOptions[0] ?? 1800,
  );
  const [face2Handrail, setFace2Handrail] = useState<HandrailLengthMm>(
    () => handrailOptions[0] ?? 1800,
  );

  // enabledSizes 変化時に現在選択値が無効になった場合、最大サイズへ自動補正
  useEffect(() => {
    if (handrailOptions.length === 0) return;
    if (!handrailOptions.includes(face1Handrail)) setFace1Handrail(handrailOptions[0]);
    if (!handrailOptions.includes(face2Handrail)) setFace2Handrail(handrailOptions[0]);
  }, [handrailOptions, face1Handrail, face2Handrail]);

  // 選択頂点に隣接する2辺のラベル
  const faceLabels = useMemo(() => {
    if (!edgeInfo) return { label1: '面1', label2: '面2' };
    const { edges } = edgeInfo;
    const n = edges.length;
    const edgeOut = edges[selectedIdx % n];
    const edgeIn = edges[(selectedIdx - 1 + n) % n];
    const outIsH = edgeOut.face === 'north' || edgeOut.face === 'south';
    const face1 = outIsH ? edgeOut : edgeIn;
    const face2 = outIsH ? edgeIn : edgeOut;
    return {
      label1: `${FACE_LABEL[face1.face] || face1.face}(${face1.label})`,
      label2: `${FACE_LABEL[face2.face] || face2.face}(${face2.label})`,
    };
  }, [edgeInfo, selectedIdx]);

  const handleConfirm = () => {
    if (isScaffoldFloorBlocked(lockFloor, targetFloor)) return; // 入口ガード: 固定階以外は確定不可
    if (!edgeInfo || !targetBuilding) { onClose(); return; }
    const { edges, pts, center } = edgeInfo;
    const n = edges.length;
    const vtx = pts[selectedIdx % n];

    // 隣接辺からface1(水平), face2(垂直)を決定
    const edgeOut = edges[selectedIdx % n];
    const edgeIn = edges[(selectedIdx - 1 + n) % n];
    const outIsH = edgeOut.face === 'north' || edgeOut.face === 'south';
    const face1Edge = outIsH ? edgeOut : edgeIn;
    const face2Edge = outIsH ? edgeIn : edgeOut;

    const computedCorner = vertexToCorner(vtx, center);

    // S-5e-3: byFloor へ保存（floor 1/2 は既存2スロットへ両建て・3F+ は byFloor のみ）。合成アクセサ経由で N 階の起点を取得可能に。
    setScaffoldStartFloor(targetFloor, {
      corner: computedCorner,
      startVertexIndex: selectedIdx % n,
      face1DistanceMm: face1Distance,
      face2DistanceMm: face2Distance,
      face1FirstHandrail: face1Handrail,
      face2FirstHandrail: face2Handrail,
      floor: targetFloor,
    });

    const d1 = mmToGrid(face1Distance);
    const d2 = mmToGrid(face2Distance);
    const len1 = mmToGrid(face1Handrail);
    const len2 = mmToGrid(face2Handrail);

    // 足場オフセット方向
    const f1Sign = face1Edge.face === 'north' ? -1 : 1;
    const f2Sign = face2Edge.face === 'west' ? -1 : 1;
    const cx = vtx.x + f2Sign * d2;
    const cy = vtx.y + f1Sign * d1;

    // face1(水平)手摺方向: 辺の進行方向に合わせる
    const f1StartsAtVtx = face1Edge.p1.x === vtx.x && face1Edge.p1.y === vtx.y;
    const f1dx = f1StartsAtVtx
      ? face1Edge.p2.x - face1Edge.p1.x
      : face1Edge.p1.x - face1Edge.p2.x;
    const h1x = f1dx > 0 ? cx : cx - len1;
    const h1y = cy;

    // face2(垂直)手摺方向
    const f2StartsAtVtx = face2Edge.p1.x === vtx.x && face2Edge.p1.y === vtx.y;
    const f2dy = f2StartsAtVtx
      ? face2Edge.p2.y - face2Edge.p1.y
      : face2Edge.p1.y - face2Edge.p2.y;
    const h2x = cx;
    const h2y = f2dy > 0 ? cy : cy - len2;

    addHandrail({
      id: uuidv4(), x: h1x, y: h1y,
      lengthMm: face1Handrail, direction: 'horizontal',
      color: getHandrailColor(face1Handrail),
      floor: targetFloor,
    });
    addHandrail({
      id: uuidv4(), x: h2x, y: h2y,
      lengthMm: face2Handrail, direction: 'vertical',
      color: getHandrailColor(face2Handrail),
      floor: targetFloor,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} />
      <div
        className="relative bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto"
      >
        {/* ヘッダー */}
        <div className="sticky top-0 bg-dark-surface px-4 py-3 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-bold text-lg">足場開始設定</h2>
          <button type="button" onClick={onClose} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        <div className="p-4 space-y-6">
          {/* 対象階 */}
          <div>
            <label className="block text-sm text-dimension mb-2">対象階</label>
            {/* S-5e-3: 建物が存在する階のボタン。lockFloor 固定 or MAX_SCAFFOLD_FLOOR 超は無効化。
                {1,2} では [1F][2F] の 2 ボタンで従来と同等（present=={1,2} 時）。 */}
            <div className="flex gap-2 flex-wrap">
              {presentFloors.map((f) => {
                const blocked = isScaffoldFloorBlocked(lockFloor, f) || f > MAX_SCAFFOLD_FLOOR;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => { if (!blocked) setTargetFloor(f); }}
                    disabled={blocked}
                    title={f > MAX_SCAFFOLD_FLOOR ? `自動割付は${MAX_SCAFFOLD_FLOOR}階までです` : undefined}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
                      targetFloor === f
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-dark-border text-dimension hover:border-accent/50'
                    } ${blocked ? 'opacity-40 cursor-not-allowed hover:border-dark-border' : ''}`}
                  >
                    {f}F
                  </button>
                );
              })}
            </div>
            {lockFloor !== undefined && (
              <p className="text-[11px] text-yellow-500 mt-2">
                全階同時割付では足場開始(⭐)を{lockFloor}Fに設定します。
              </p>
            )}
            {!targetBuilding && (
              <p className="text-[11px] text-yellow-500 mt-2">
                {targetFloor === 2 ? '2F建物が未作成です。' : '建物が未作成です。'}
                躯体メニューから建物を先に作成してください。
              </p>
            )}
          </div>

          {/* スタート頂点の選択 */}
          <div>
            <label className="block text-sm text-dimension mb-2">スタート角を選択</label>
            {edgeInfo && (
              <VertexSelector
                edges={edgeInfo.edges}
                pts={edgeInfo.pts}
                selectedIndex={selectedIdx}
                onChange={setSelectedIdx}
              />
            )}
          </div>

          {/* 各面の離れ */}
          <div>
            <label className="block text-sm text-dimension mb-2">各面の離れ (mm)</label>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-sm w-20 shrink-0">{faceLabels.label1}</span>
                <NumInput value={face1Distance} onChange={setFace1Distance} min={0} step={1}
                  className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm w-20 shrink-0">{faceLabels.label2}</span>
                <NumInput value={face2Distance} onChange={setFace2Distance} min={0} step={1}
                  className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          {/* 各面の最初の手摺の長さ */}
          <div>
            <label className="block text-sm text-dimension mb-2">最初の手摺の長さ</label>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-dimension">{faceLabels.label1}</span>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {handrailOptions.map((len) => (
                    <button key={`f1-${len}`} type="button" onClick={() => setFace1Handrail(len)}
                      className={`flex-1 min-w-[60px] py-2 rounded-lg text-sm font-medium border transition-colors ${
                        face1Handrail === len
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-dark-border text-dimension hover:border-accent/50'
                      }`}>{len}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs text-dimension">{faceLabels.label2}</span>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {handrailOptions.map((len) => (
                    <button key={`f2-${len}`} type="button" onClick={() => setFace2Handrail(len)}
                      className={`flex-1 min-w-[60px] py-2 rounded-lg text-sm font-medium border transition-colors ${
                        face2Handrail === len
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-dark-border text-dimension hover:border-accent/50'
                      }`}>{len}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 確定ボタン */}
          <button
            type="button"
            data-tutorial-id="scaffold-start-confirm"
            onClick={handleConfirm}
            disabled={!targetBuilding}
            className="w-full py-3 bg-accent text-white font-bold rounded-xl text-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            足場開始
          </button>
        </div>
      </div>
    </div>
  );
}

/** 建物ポリゴンの頂点選択UI */
function VertexSelector({
  edges, pts, selectedIndex, onChange,
}: {
  edges: EdgeInfo[];
  pts: Point[];
  selectedIndex: number;
  onChange: (idx: number) => void;
}) {
  // バウンディングボックス
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }

  const W = 240, H = 180, PAD = 28;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((W - PAD * 2) / rangeX, (H - PAD * 2) / rangeY);
  const ox = (W - rangeX * scale) / 2;
  const oy = (H - rangeY * scale) / 2;
  const tx = (x: number) => (x - minX) * scale + ox;
  const ty = (y: number) => (y - minY) * scale + oy;

  const polyStr = pts.map(p => `${tx(p.x)},${ty(p.y)}`).join(' ');

  return (
    <div className="flex justify-center">
      <svg width={W} height={H} className="bg-dark-bg rounded-lg border border-dark-border">
        {/* 方角 */}
        <text x={W / 2} y={12} textAnchor="middle" fontSize={10} fill="#666">北</text>
        <text x={W / 2} y={H - 3} textAnchor="middle" fontSize={10} fill="#666">南</text>
        <text x={8} y={H / 2 + 3} textAnchor="middle" fontSize={10} fill="#666">西</text>
        <text x={W - 8} y={H / 2 + 3} textAnchor="middle" fontSize={10} fill="#666">東</text>

        {/* 建物ポリゴン */}
        <polygon points={polyStr} fill="#3d3d3a" stroke="#666" strokeWidth={1.5} />

        {/* Phase J-1: 辺ラベルを画面座標系に変換し、凹角隣接辺は内側配置 */}
        {(() => {
          // 画面座標系の edge を構築 (法線も画面座標スケール 1 単位で再計算)
          const edgesScreen = edges.map((e) => {
            const sp1 = { x: tx(e.p1.x), y: ty(e.p1.y) };
            const sp2 = { x: tx(e.p2.x), y: ty(e.p2.y) };
            // 法線は元の建物座標 nx, ny の符号を保持 (Y 下向き同士で符号一致)
            return { nx: e.nx, ny: e.ny, p1: sp1, p2: sp2 };
          });
          return edges.map((e, i) => {
            const eScreen = edgesScreen[i];
            const prev = edgesScreen[(i - 1 + edgesScreen.length) % edgesScreen.length];
            const next = edgesScreen[(i + 1) % edgesScreen.length];
            const mx = (eScreen.p1.x + eScreen.p2.x) / 2;
            const my = (eScreen.p1.y + eScreen.p2.y) / 2;
            const labelPos = computeEdgeLabelPosition(eScreen, prev, next, mx, my, 12);
            return (
              <text key={`el-${i}`} x={labelPos.x} y={labelPos.y} textAnchor="middle"
                fontSize={9} fill="#888" dominantBaseline="central"
                paintOrder={labelPos.isInside ? 'stroke' : undefined}
                stroke={labelPos.isInside ? '#3d3d3a' : undefined}
                strokeWidth={labelPos.isInside ? 2.5 : undefined}
              >
                {e.label}
              </text>
            );
          });
        })()}

        {/* 頂点ドット（クリック可能） */}
        {pts.map((p, i) => {
          const isSelected = i === selectedIndex;
          const sx = tx(p.x);
          const sy = ty(p.y);
          return (
            <g key={i} onClick={() => onChange(i)} style={{ cursor: 'pointer' }}>
              {/* タップ領域を広げる透明円 */}
              <circle cx={sx} cy={sy} r={16} fill="transparent" />
              <circle cx={sx} cy={sy} r={isSelected ? 10 : 6}
                fill={isSelected ? '#378ADD' : '#555'}
                stroke={isSelected ? '#fff' : '#999'}
                strokeWidth={isSelected ? 2 : 1} />
              {isSelected && (
                <text x={sx} y={sy - 14} textAnchor="middle"
                  fontSize={10} fontWeight="bold" fill="#378ADD">
                  START
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
