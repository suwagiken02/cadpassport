'use client';

// ============================================================
// 敷地の入口 (= S-4、 自動生成の中身は S-3)。
//
// 躯体メニューのボタンは「敷地」ひとつ。押すとまずここで
//   ・手で描く   … 方向入力（turtle）を敷地として起動する。以降は従来のまま
//   ・自動生成   … 建物の外周から一定距離の敷地を作る
// を選ばせる。どちらを選んだあとの流れも S-1〜S-3 から変えていない。
//
// 作られる敷地は手描き・自動を問わず同じ形で sitePolygons に入る
// （自動生成の目印は持たせない）。選択・移動・削除・DXF・PDF・ページ複製は
// すべて S-1 の仕組みのまま。
// ============================================================
import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';
import {
  SITE_AUTO_DEFAULT_MM, SITE_AUTO_MIN_MM, SITE_AUTO_PRESET_MM, clampSiteAutoMm,
} from '@/lib/konva/siteAutoGenerate';

export default function SiteModal() {
  const show = useCanvasStore((s) => s.showSiteModal);
  const buildingCount = useCanvasStore((s) => s.canvasData.buildings.length);
  const [step, setStep] = useState<'choose' | 'auto'>('choose');
  const [distanceMm, setDistanceMm] = useState(SITE_AUTO_DEFAULT_MM);

  // 開くたびに選択画面から始める（距離は前回の値を残す＝続けて作るときに楽）。
  useEffect(() => { if (show) setStep('choose'); }, [show]);

  if (!show) return null;

  const close = () => useCanvasStore.getState().setShowSiteModal(false);

  /** 手で描く: 方向入力を敷地として起動する（S-1 の起動そのもの）。 */
  const startDrawing = () => {
    const s = useCanvasStore.getState();
    s.setPendingTargetType('site');
    s.setBuildingInputMethod('direction');
    s.setMode('building');
    s.clearDirectionPoints();
    // 敷地は階を持たないので、対象階は訊かない。
    close();
  };

  const generate = () => {
    const s = useCanvasStore.getState();
    const n = s.generateSitePolygons(distanceMm);
    close();
    if (n === 0) s.setAlertMessage('建物がないため敷地を作れませんでした。先に建物を描いてください。');
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={close}>
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 max-w-xs w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}>

        {step === 'choose' ? (
          <>
            <h2 className="font-bold text-lg">敷地境界線</h2>
            <p className="text-xs text-dimension">どちらで作りますか。</p>
            <div className="space-y-2">
              <button data-tutorial-id="site-draw" onClick={startDrawing}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-left hover:border-accent transition-colors">
                <span className="text-2xl">✏️</span>
                <span>
                  <span className="block text-sm font-bold text-canvas">手で描く</span>
                  <span className="block text-[10px] text-dimension">キャラを方向で動かして外形を描く</span>
                </span>
              </button>
              <button data-tutorial-id="site-auto" onClick={() => setStep('auto')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-left hover:border-accent transition-colors">
                <span className="text-2xl">⧉</span>
                <span>
                  <span className="block text-sm font-bold text-canvas">自動生成</span>
                  <span className="block text-[10px] text-dimension">建物の外壁から一定距離で作る</span>
                </span>
              </button>
            </div>
            <button onClick={close}
              className="w-full py-2.5 border border-dark-border rounded-xl text-sm text-dimension">
              キャンセル
            </button>
          </>
        ) : (
          <>
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
              <button onClick={() => setStep('choose')}
                className="flex-1 py-2.5 border border-dark-border rounded-xl text-sm text-dimension">
                戻る
              </button>
              <button onClick={generate} disabled={buildingCount === 0}
                className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-bold disabled:opacity-40">
                敷地を作る
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
