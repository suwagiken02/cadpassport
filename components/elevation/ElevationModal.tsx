'use client';

// ============================================================
// 立面図 E-3 / E-3.6: 立面プレビューモーダル
//
// E-1(reconstructFaces) / E-2(buildFaceElevation) の pure 関数を使い、
// 選んだ 1 面の立面（建物輪郭＋足場）をインライン SVG で描く。
// E-3.6: 嵩上げ 4+1 分解の中間段描画・足場なしでも建物のみ表示・棟破線。
//
// 座標: E-2 の出力は 水平=グリッド(1grid=10mm)・高さ=mm(GL基準)。
//   ここで両軸を mm に揃え（水平は ×10）、mm→SVG px にスケールして
//   viewBox にフィットさせる（GL を下端に、y 反転）。
// ============================================================
import React, { useMemo, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { reconstructFaces, type Face } from '@/lib/konva/elevation/faceReconstruction';
import { buildFaceElevation, type FaceElevation } from '@/lib/konva/elevation/elevationEngine';
import ElevationPlaceDialog from './ElevationPlaceDialog';
import { partWidthPx } from '@/lib/konva/elevation/elevationPartStyle';
// E-8-v2l: 部材の絵は「部材ブロック → プリミティブ」= キャンバス配置版と同じ 1 本の経路で描く。
//   ここに独自の SVG 描画（railLine / postLine 等）を置いていたため、部材の見た目が
//   二重実装になり、プレビューと配置後で食い違う余地が残っていた。
import { faceElevationToParts, partsToPrimitives } from '@/lib/konva/elevation/elevationParts';
import { buildingAndRoofPrimitives } from '@/lib/konva/elevation/elevationToObjects';
import type { PillarType } from '@/lib/konva/calculator';
import type { ElevationPrimitive } from '@/types';

const FACES: { id: Face; label: string }[] = [
  { id: 'north', label: '北面' },
  { id: 'south', label: '南面' },
  { id: 'east', label: '東面' },
  { id: 'west', label: '西面' },
];

/** 高さマーカー未設定時に「絵を出す」ための仮の高さ(mm)。※実値は高さマーカーで設定。 */
const FALLBACK_HEIGHT_MM = 5000;

// SVG viewBox（固定）。SVG 自体は width=100% で親にフィット（モバイル対応）。
const VBW = 680;
const VBH = 440;
const PAD = 48;

export default function ElevationModal() {
  const { showElevation, setShowElevation, canvasData } = useCanvasStore();
  const [face, setFace] = useState<Face>('north');
  const [pillarType, setPillarType] = useState<PillarType>('normal');
  const [showPlaceDialog, setShowPlaceDialog] = useState(false);

  const hasMarkers = (canvasData.heightMarkers ?? []).length > 0;

  // 足場が無い面でも建物のみ描けるよう、常に buildFaceElevation を呼ぶ（face を明示）。
  const faceElevation = useMemo<FaceElevation>(() => {
    const cols = reconstructFaces(canvasData.handrails).filter((c) => c.face === face);
    return buildFaceElevation(cols, canvasData.buildings, {
      markers: canvasData.heightMarkers ?? [],
      // マーカーが 1 つも無ければ仮の高さで描く（バナーで案内）。
      defaultHeightMm: hasMarkers ? undefined : FALLBACK_HEIGHT_MM,
      pillarType,
      face,
      roofOverhangs: canvasData.roofOverhangs,
      roofs: canvasData.roofs,
      ridgeLines: canvasData.ridgeLines ?? [],
    });
  }, [face, pillarType, canvasData.handrails, canvasData.buildings, canvasData.heightMarkers, canvasData.roofOverhangs, canvasData.roofs, canvasData.ridgeLines, hasMarkers]);

  const noScaffold = faceElevation.scaffolds.length === 0;
  const hasContent = faceElevation.buildingOutlines.length > 0 || faceElevation.scaffolds.length > 0;

  // この支柱種で全列が 0 段（段が組めない）→ 根がらみへの切替を案内。
  const noStage = faceElevation.scaffolds.length > 0
    && faceElevation.scaffolds.every((s) => s.levels.floors === 0);

  // 直接 state 操作対策: 管理者以外は開かない（ボタン非表示に加えた二重ガード）。
  if (!showElevation) return null;

  const fillOf = (id: string) => canvasData.buildings.find((b) => b.id === id)?.fill ?? '#3d3d3a';

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-3xl mx-4 w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base text-canvas font-bold">立面図（プレビュー）</h2>
          <span className="text-[10px] text-dimension">E-3.6</span>
        </div>

        {/* 面セレクタ */}
        <div className="flex gap-2 mb-3">
          {FACES.map((f) => (
            <button
              key={f.id}
              onClick={() => setFace(f.id)}
              className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${
                face === f.id
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-dark-bg border-dark-border text-dimension hover:text-canvas'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 支柱種トグル（通常⇔根がらみ）＝スタート下限 330/140 の切替 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-dimension">支柱:</span>
          {(([['normal', '通常(330)'], ['negarami', '根がらみ(140)']]) as [PillarType, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPillarType(id)}
              className={`px-3 py-1 rounded-lg text-xs font-bold border-2 transition-colors ${
                pillarType === id
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-dark-bg border-dark-border text-dimension hover:text-canvas'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* この高さでは段が組めない案内 */}
        {noStage && (
          <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
            この高さでは通常支柱で段が組めません。「根がらみ」に切り替えてください。
          </div>
        )}

        {/* 高さマーカー未設定の案内 */}
        {!hasMarkers && hasContent && (
          <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
            高さマーカーが未設定です。仮の高さ {FALLBACK_HEIGHT_MM / 1000}m で表示しています。
            <span className="text-dimension">（躯体メニュー → 高さ で設定できます）</span>
          </div>
        )}

        {/* 描画エリア（モバイルは横スクロール可） */}
        <div className="overflow-x-auto rounded-lg border border-dark-border bg-dark-bg">
          {hasContent ? (
            <ElevationSVG faceElevation={faceElevation} fillOf={fillOf} />
          ) : (
            <div className="p-10 text-center text-sm text-dimension">
              この面には表示できる建物・足場がありません。
            </div>
          )}
        </div>
        {hasContent && noScaffold && (
          <p className="mt-2 text-xs text-dimension text-center">
            この面には足場がありません（建物のみ表示）
          </p>
        )}

        {hasContent && (
          <button
            onClick={() => setShowPlaceDialog(true)}
            className="mt-4 w-full py-2 bg-accent/20 border-2 border-accent text-accent rounded-xl text-sm font-bold hover:bg-accent/30 transition-colors"
          >
            📍 配置…（4面一括／この面のみ）
          </button>
        )}
        {showPlaceDialog && (
          <ElevationPlaceDialog
            face={face}
            pillarType={pillarType}
            onClose={() => { setShowPlaceDialog(false); setShowElevation(false); }}
          />
        )}

        <button
          onClick={() => setShowElevation(false)}
          className="mt-2 w-full py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold hover:text-canvas transition-colors"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

/** FaceElevation を SVG に描く（静的・インタラクションなし）。 */
function ElevationSVG({
  faceElevation,
  fillOf,
}: {
  faceElevation: FaceElevation;
  fillOf: (buildingId: string) => string;
}) {
  const { buildingOutlines, scaffolds, roofBands, ridgeMaxMm } = faceElevation;

  // ---- world 範囲（水平 mm・高さ mm）→ SVG px マッピング ----
  let minGX = Infinity, maxGX = -Infinity, maxH = 0, buildingTopMm = 0;
  const seeX = (gx: number) => { minGX = Math.min(minGX, gx); maxGX = Math.max(maxGX, gx); };
  for (const o of buildingOutlines) {
    for (const s of o.segments) {
      seeX(s.xStart); seeX(s.xEnd);
      maxH = Math.max(maxH, s.heightStartMm, s.heightEndMm);
      buildingTopMm = Math.max(buildingTopMm, s.heightStartMm, s.heightEndMm);
    }
  }
  for (const sc of scaffolds) {
    for (const px of sc.postXs) seeX(px);
    maxH = Math.max(maxH, sc.levels.topRailMm);
  }
  for (const rb of roofBands) { seeX(rb.xStart); seeX(rb.xEnd); } // 軒の出ぶん拡張した屋根バンドも算入
  if (ridgeMaxMm != null) maxH = Math.max(maxH, ridgeMaxMm); // 棟が viewBox 内に収まるように

  const heightAvailable = maxH >= 1 && Number.isFinite(minGX);
  if (!heightAvailable) {
    return (
      <div className="p-10 text-center text-sm text-dimension">
        高さ情報がありません。躯体メニュー → 高さ で高さマーカーを設定してください。
      </div>
    );
  }

  const minX = minGX * 10;
  const maxX = maxGX * 10;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxH);
  const scale = Math.min((VBW - 2 * PAD) / worldW, (VBH - 2 * PAD) / worldH);
  const sx = (mmX: number) => PAD + (mmX - minX) * scale;
  const sxg = (gridX: number) => sx(gridX * 10);
  const sy = (mmH: number) => VBH - PAD - mmH * scale;

  const glY = sy(0);

  // 寸法表示の代表 scaffold（段数最大）
  const repScaffold = scaffolds.reduce<typeof scaffolds[number] | null>(
    (best, s) => (!best || s.levels.floors > best.levels.floors ? s : best),
    null,
  );

  // E-8-v2f/v2h: 部材の見た目（色・寸法）は elevationPartStyle を参照してキャンバス配置版と揃える。
  //   平面と同じ実寸比（○Grid）で太らせ、縮小時は下限 px（○MinPx）で潰さない。
  //   この SVG は 1 グリッド = 10mm × scale px なので pxPerGrid = scale * 10。
  const pxPerGrid = scale * 10;
  const wpx = (minPx: number, grid?: number) => partWidthPx(minPx, grid, pxPerGrid);

  // ---- 部材（踏板・手摺・支柱・ジャッキ・嵩上げ）----
  // E-8-v2l: キャンバス配置版と同一経路。faceElevationToParts → partsToPrimitives が
  //   唯一の部材描画で、ここは座標をこの SVG に写すだけ（見た目の定義は持たない）。
  const partBundle = faceElevationToParts(faceElevation);
  const partPrimitives = partsToPrimitives(partBundle);
  const partMinXg = partBundle.geom.minXg;
  /** 部材プリミティブのローカル座標（横=グリッド−minXg、縦=−mm/10）→ SVG 座標。 */
  const lpx = (lx: number) => sxg(lx + partMinXg);
  const lpy = (ly: number) => sy(-ly * 10);
  const partToSvg = (p: ElevationPrimitive, key: string) => {
    if (p.kind === 'line') {
      return (
        <line
          key={key} x1={lpx(p.x1)} y1={lpy(p.y1)} x2={lpx(p.x2)} y2={lpy(p.y2)}
          stroke={p.stroke} strokeWidth={wpx(p.width ?? 1, p.widthGrid)}
          strokeLinecap="round" opacity={p.opacity ?? 1}
        />
      );
    }
    if (p.kind === 'circle') {
      return (
        <circle
          key={key} cx={lpx(p.x)} cy={lpy(p.y)} r={wpx(p.r, p.rGrid)}
          fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth ?? 0} opacity={p.opacity ?? 1}
        />
      );
    }
    if (p.kind === 'polygon') {
      const pts: string[] = [];
      for (let k = 0; k < p.points.length; k += 2) {
        pts.push(`${lpx(p.points[k]).toFixed(1)},${lpy(p.points[k + 1]).toFixed(1)}`);
      }
      return (
        <polygon
          key={key} points={pts.join(' ')} fill={p.fill} fillOpacity={p.fillOpacity ?? 1}
          stroke={p.stroke} strokeWidth={p.width ?? 0}
        />
      );
    }
    if (p.kind === 'text') {
      // E-9-fix5: 棟ラベル等（建物・屋根の経路を共通化したので text も写す）。
      return (
        <text
          key={key} x={lpx(p.x)} y={lpy(p.y)} fill={p.fill} fontSize={p.size}
          fontFamily="monospace"
          textAnchor={p.anchor === 'start' ? 'start' : p.anchor === 'end' ? 'end' : 'middle'}
        >
          {p.text}
        </text>
      );
    }
    return null;   // rect は出ない
  };

  // 奥→手前で重ね描き（depthCoord 昇順のまま。E-5 で前後判定・切断）。
  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      width="100%"
      style={{ maxWidth: VBW, display: 'block', margin: '0 auto' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* 建物シルエット・屋根投影バンド */}
      {/* E-9-fix5: キャンバス配置版と同一経路。ここに独自の SVG を持つと、遮蔽の下端や
          継ぎ目の印を無視した絵になり「テストは通るのに実機が直らない」が起きる。 */}
      {buildingAndRoofPrimitives(faceElevation, fillOf, partMinXg)
        .map((p, i) => partToSvg(p, `bg-${i}`))}

      {/* GL 線 */}
      <line x1={PAD * 0.5} y1={glY} x2={VBW - PAD * 0.5} y2={glY} stroke="#6b6b67" strokeWidth={1} strokeDasharray="4 3" />
      <text x={PAD * 0.5} y={glY - 4} fill="#8a8a86" fontSize={10} fontFamily="monospace">GL</text>

      {/* 縦寸法（代表 scaffold: 各 level と天端） */}
      {repScaffold && (
        <g>
          <line x1={18} y1={glY} x2={18} y2={sy(repScaffold.levels.topRailMm)} stroke="#8a8a86" strokeWidth={0.8} />
          {repScaffold.levels.levels.map((lv, i) => (
            <g key={`vl-${i}`}>
              <line x1={14} y1={sy(lv)} x2={22} y2={sy(lv)} stroke="#8a8a86" strokeWidth={0.8} />
              <text x={24} y={sy(lv) + 3} fill="#9a9a96" fontSize={9} fontFamily="monospace">
                {i === 0 ? `スタート ${lv}` : `${lv}`}
              </text>
            </g>
          ))}
          <line x1={14} y1={sy(repScaffold.levels.topRailMm)} x2={22} y2={sy(repScaffold.levels.topRailMm)} stroke="#8a8a86" strokeWidth={0.8} />
          <text x={24} y={sy(repScaffold.levels.topRailMm) - 3} fill="#c9c9c6" fontSize={9} fontWeight="bold" fontFamily="monospace">
            天端 {repScaffold.levels.topRailMm}
          </text>
        </g>
      )}

      {/* 縦寸法（足場なし・建物のみ表示時: 建物高さ） */}
      {!repScaffold && buildingTopMm > 0 && (
        <g>
          <line x1={18} y1={glY} x2={18} y2={sy(buildingTopMm)} stroke="#8a8a86" strokeWidth={0.8} />
          <line x1={14} y1={sy(buildingTopMm)} x2={22} y2={sy(buildingTopMm)} stroke="#8a8a86" strokeWidth={0.8} />
          <text x={24} y={sy(buildingTopMm) - 3} fill="#c9c9c6" fontSize={9} fontWeight="bold" fontFamily="monospace">
            建物 {buildingTopMm}
          </text>
        </g>
      )}

      {/* 横寸法（代表 scaffold: 各スパン部材長） */}
      {repScaffold && repScaffold.column.rails.map((lenMm, i) => {
        const x0 = repScaffold.postXs[i];
        const x1 = repScaffold.postXs[i + 1];
        if (x1 == null) return null;
        const mx = (sxg(x0) + sxg(x1)) / 2;
        return (
          <g key={`hl-${i}`}>
            <line x1={sxg(x0)} y1={glY + 8} x2={sxg(x1)} y2={glY + 8} stroke="#8a8a86" strokeWidth={0.8} />
            <text x={mx} y={glY + 20} textAnchor="middle" fill="#9a9a96" fontSize={9} fontFamily="monospace">
              {lenMm}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
