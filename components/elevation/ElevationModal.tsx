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
import type { PillarType } from '@/lib/konva/calculator';

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
    });
  }, [face, pillarType, canvasData.handrails, canvasData.buildings, canvasData.heightMarkers, canvasData.roofOverhangs, hasMarkers]);

  const noScaffold = faceElevation.scaffolds.length === 0;
  const hasContent = faceElevation.buildingOutlines.length > 0 || faceElevation.scaffolds.length > 0;

  // この支柱種で全列が 0 段（段が組めない）→ 根がらみへの切替を案内。
  const noStage = faceElevation.scaffolds.length > 0
    && faceElevation.scaffolds.every((s) => s.levels.floors === 0);

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

        <button
          onClick={() => setShowElevation(false)}
          className="mt-4 w-full py-2 bg-dark-bg border border-dark-border text-dimension rounded-xl text-sm font-bold hover:text-canvas transition-colors"
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

  // 段違い作業床 1 セット（床帯＋手摺 +450/+900）を描く helper。
  const floorGroup = (key: string, floorMm: number, x0: number, x1: number) => (
    <g key={key}>
      <rect x={sxg(x0)} y={sy(floorMm) - 2} width={Math.max(0, sxg(x1) - sxg(x0))} height={4} fill="#4ECDC4" fillOpacity={0.6} />
      <line x1={sxg(x0)} y1={sy(floorMm + 450)} x2={sxg(x1)} y2={sy(floorMm + 450)} stroke="#378ADD" strokeWidth={0.7} strokeOpacity={0.7} />
      <line x1={sxg(x0)} y1={sy(floorMm + 900)} x2={sxg(x1)} y2={sy(floorMm + 900)} stroke="#378ADD" strokeWidth={0.7} strokeOpacity={0.7} />
    </g>
  );

  // 奥→手前で重ね描き（depthCoord 昇順のまま。E-5 で前後判定・切断）。
  return (
    <svg
      viewBox={`0 0 ${VBW} ${VBH}`}
      width="100%"
      style={{ maxWidth: VBW, display: 'block', margin: '0 auto' }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* 建物シルエット（多階は重ね） */}
      {buildingOutlines.map((o) =>
        o.segments.map((s, i) => {
          const pts = [
            `${sxg(s.xStart).toFixed(1)},${glY.toFixed(1)}`,
            `${sxg(s.xStart).toFixed(1)},${sy(s.heightStartMm).toFixed(1)}`,
            `${sxg(s.xEnd).toFixed(1)},${sy(s.heightEndMm).toFixed(1)}`,
            `${sxg(s.xEnd).toFixed(1)},${glY.toFixed(1)}`,
          ].join(' ');
          return (
            <polygon
              key={`bo-${o.buildingId}-${i}`}
              points={pts}
              fill={fillOf(o.buildingId)}
              fillOpacity={0.22}
              stroke="#8a8a86"
              strokeWidth={1.5}
            />
          );
        }),
      )}

      {/* 屋根投影バンド（樋面: 軒プロファイル〜棟の帯・実線＋薄塗り。妻面では空） */}
      {roofBands.map((band) => {
        const o = buildingOutlines.find((bo) => bo.buildingId === band.buildingId);
        if (!o || o.segments.length === 0) return null;
        // 下端(軒プロファイル)を band の x 範囲（軒の出ぶん拡張）まで水平に延長。
        // ※勾配による軒先の下がりは棟ライン実装後の課題。今回は水平近似。
        const first = o.segments[0];
        const last = o.segments[o.segments.length - 1];
        const profile: string[] = [];
        profile.push(`${sxg(band.xStart).toFixed(1)},${sy(first.heightStartMm).toFixed(1)}`);
        o.segments.forEach((s, k) => {
          if (k === 0) profile.push(`${sxg(s.xStart).toFixed(1)},${sy(s.heightStartMm).toFixed(1)}`);
          profile.push(`${sxg(s.xEnd).toFixed(1)},${sy(s.heightEndMm).toFixed(1)}`);
        });
        profile.push(`${sxg(band.xEnd).toFixed(1)},${sy(last.heightEndMm).toFixed(1)}`);
        const pts = [
          ...profile,
          `${sxg(band.xEnd).toFixed(1)},${sy(band.ridgeMm).toFixed(1)}`,
          `${sxg(band.xStart).toFixed(1)},${sy(band.ridgeMm).toFixed(1)}`,
        ].join(' ');
        return (
          <g key={`rb-${band.buildingId}`}>
            <polygon points={pts} fill={fillOf(band.buildingId)} fillOpacity={0.42} stroke="#8a8a86" strokeWidth={1.2} />
            {/* 棟（水平実線） */}
            <line x1={sxg(band.xStart)} y1={sy(band.ridgeMm)} x2={sxg(band.xEnd)} y2={sy(band.ridgeMm)} stroke="#6b6b67" strokeWidth={1.4} />
            <text x={sxg(band.xEnd)} y={sy(band.ridgeMm) - 3} textAnchor="end" fill="#c9c9c6" fontSize={9} fontFamily="monospace">棟 {band.ridgeMm}</text>
          </g>
        );
      })}

      {/* 足場（列ごと） */}
      {scaffolds.map((sc, si) => {
        const jackTop = sc.levels.jackTopMm;
        const topRail = sc.levels.topRailMm;
        // 妻嵩上げ: 各支柱の延長上端(mm)＝隣接スパンの要求の高い方(raisedFloor+900)。
        const postExtendTop = new Map<number, number>();
        for (const r of sc.spanRaises) {
          const top = r.raisedFloorMm + 900;
          for (const px of [r.x0, r.x1]) {
            postExtendTop.set(px, Math.max(postExtendTop.get(px) ?? topRail, top));
          }
        }
        return (
          <g key={`sc-${si}`} opacity={0.95}>
            {/* 踏板（薄い帯） */}
            {sc.boards.map((b, i) => (
              <rect
                key={`bd-${i}`}
                x={sxg(b.x0)}
                y={sy(b.levelMm) - 2}
                width={Math.max(0, sxg(b.x1) - sxg(b.x0))}
                height={4}
                fill="#4ECDC4"
                fillOpacity={0.5}
              />
            ))}
            {/* 手摺（コマ位置の横線） */}
            {sc.rails.map((r, i) => (
              <line
                key={`rl-${i}`}
                x1={sxg(r.x0)}
                y1={sy(r.heightMm)}
                x2={sxg(r.x1)}
                y2={sy(r.heightMm)}
                stroke="#378ADD"
                strokeWidth={0.7}
                strokeOpacity={0.5}
              />
            ))}
            {/* 支柱（縦線） */}
            {sc.postXs.map((px, i) => (
              <line
                key={`ps-${i}`}
                x1={sxg(px)}
                y1={sy(jackTop)}
                x2={sxg(px)}
                y2={sy(topRail)}
                stroke="#FFD700"
                strokeWidth={1.6}
              />
            ))}
            {/* ジャッキ（支柱下端の小台形: 下広がり） */}
            {sc.postXs.map((px, i) => {
              const cx = sxg(px);
              const yTop = sy(jackTop);
              const yGL = glY;
              return (
                <polygon
                  key={`jk-${i}`}
                  points={`${cx - 2},${yTop} ${cx + 2},${yTop} ${cx + 4},${yGL} ${cx - 4},${yGL}`}
                  fill="#FFD700"
                  fillOpacity={0.85}
                />
              );
            })}
            {/* 妻嵩上げ: 4+1 分解の中間フル段＋最終床（各段に床帯＋手摺 +450/+900） */}
            {sc.spanRaises.map((r, i) => (
              <g key={`sr-${i}`}>
                {r.intermediateFloorsMm.map((fmm, j) => floorGroup(`im-${i}-${j}`, fmm, r.x0, r.x1))}
                {floorGroup(`rf-${i}`, r.raisedFloorMm, r.x0, r.x1)}
              </g>
            ))}
            {/* 妻嵩上げの支柱延長（天端→要求上端） */}
            {Array.from(postExtendTop.entries()).map(([px, top], i) => (
              <line key={`pe-${i}`} x1={sxg(px)} y1={sy(topRail)} x2={sxg(px)} y2={sy(top)} stroke="#FFD700" strokeWidth={1.6} />
            ))}
          </g>
        );
      })}

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
