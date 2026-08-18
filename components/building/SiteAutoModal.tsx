'use client';

// ============================================================
// 敷地境界線の自動生成 (= S-3)。
//
// 建物の外周から一定距離の敷地を作る。「外壁から 1m」が代表的な使い方。
// 作られる敷地は手で描いたものとまったく同じ形で sitePolygons に入るので、
// 選択・移動・削除・DXF・PDF・ページ複製はすべて S-1 の仕組みのまま動く
// （自動生成の目印は持たせない）。
//
// すでに敷地がある状態で押しても**置き換えず追記**する。要らなければ
// 消去モードで消せる。
// ============================================================
import React, { useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';
import {
  SITE_AUTO_DEFAULT_MM, SITE_AUTO_MIN_MM, SITE_AUTO_PRESET_MM, clampSiteAutoMm,
} from '@/lib/konva/siteAutoGenerate';

export default function SiteAutoModal() {
  const show = useCanvasStore((s) => s.showSiteAutoModal);
  const buildingCount = useCanvasStore((s) => s.canvasData.buildings.length);
  const [distanceMm, setDistanceMm] = useState(SITE_AUTO_DEFAULT_MM);

  if (!show) return null;

  const close = () => useCanvasStore.getState().setShowSiteAutoModal(false);

  const generate = () => {
    const st = useCanvasStore.getState();
    const n = st.generateSitePolygons(distanceMm);
    close();
    if (n === 0) st.setAlertMessage('建物がないため敷地を作れませんでした。先に建物を描いてください。');
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={close}>
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-xs w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg">敷地の自動生成</h2>
        <p className="text-xs text-dimension">
          建物の外壁から指定した距離だけ外側に、敷地境界線を作ります。
          {buildingCount === 0 && (
            <span className="block mt-1 text-orange-400">建物がまだありません。先に建物を描いてください。</span>
          )}
        </p>

        <div className="flex items-center gap-2">
          <span className="text-sm text-dimension">外壁からの距離</span>
          <NumInput value={distanceMm} onChange={(v) => setDistanceMm(clampSiteAutoMm(v))}
            min={SITE_AUTO_MIN_MM} step={100}
            className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-right font-mono" />
          <span className="text-xs text-dimension">mm</span>
        </div>

        {/* 距離プリセット（方向入力の距離プリセットと同じ作法） */}
        <div className="flex flex-wrap gap-1.5">
          {SITE_AUTO_PRESET_MM.map((mm) => (
            <button key={mm} onClick={() => setDistanceMm(mm)}
              className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${
                distanceMm === mm ? 'bg-accent text-white border-accent' : 'border-dark-border text-dimension'
              }`}>{mm}</button>
          ))}
        </div>

        <p className="text-[10px] text-dimension">
          いまある敷地は消えません（新しい敷地として増えます）。要らなければ消去モードで消せます。
        </p>

        <div className="flex gap-3">
          <button onClick={close}
            className="flex-1 py-2.5 border border-dark-border rounded-xl text-sm text-dimension">
            キャンセル
          </button>
          <button onClick={generate} disabled={buildingCount === 0}
            className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-bold disabled:opacity-40">
            敷地を作る
          </button>
        </div>
      </div>
    </div>
  );
}
