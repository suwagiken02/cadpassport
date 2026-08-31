'use client';

// ============================================================
// 下図の合わせ込み (= U-1 commit 3)。
//
// 流れ: 読み込み → 2 点クリック → 実寸入力 → 位置合わせ → ずれの確認 → 確定
//
// ■ 中断しても残骸を作らない
// 下書き（打った点・実寸・向き・縮小した画像）は**すべてこのコンポーネントの
// ローカル state**に持つ。モーダルを閉じれば React が丸ごと捨てるので、
// 中途半端な状態が残りようがない。ストアにも canvasData にも書かない。
// Storage へ上げるのも**最後の「確定」の 1 回だけ**なので、途中でやめても
// 孤児の画像は 1 枚も生まれない。
//
// ■ 精度が最優先
// 2 点が近いと図面の反対側で大きくずれる。距離と**推定誤差(mm)**を出しっぱなしにし、
// 近すぎるうちは次へ進ませない。合わせたあとは 3 点目でずれを実測できる。
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import NumInput from '@/components/ui/NumInput';
import {
  UNDERLAY_DEFAULT_OPACITY, UNDERLAY_ERROR_RISK_MM, UNDERLAY_ERROR_WARN_MM, UNDERLAY_MIN_CALIB_PX,
  calibrateFromTwoPoints, canCalibrate, clickErrorImagePx, isRiskyError, estimatedErrorMm, guessOrientation,
  deviationMm, identityTransform, imageDistancePx, imageSpanMm, measureFromAnchorMm,
  originForAnchor, type CalibOrientation, type UnderlayTransform,
} from '@/lib/konva/underlay';
import { imagePxToView } from '@/lib/konva/imageViewport';
import { useImageViewport } from './useImageViewport';
import { prepareUnderlayImage, uploadUnderlay, type PreparedImage } from '@/lib/underlay/underlayStorage';
import { forgetUnderlayImage } from '@/lib/underlay/underlayImage';
import type { ImageView } from '@/lib/konva/imageViewport';
import type { Point } from '@/types';

type Step = 'load' | 'scale' | 'place' | 'verify';

/**
 * 打った点の印。**画像の画素で保持**しているので、拡大・移動しても
 * 図面上の同じ位置に留まる（表示のたびにビュー座標へ直すだけ）。
 */
function Marker({ p, view, label, tone }: {
  p: Point; view: ImageView; label: string; tone: string;
}) {
  const v = imagePxToView(view, p.x, p.y);
  return (
    <div
      className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2"
      style={{ left: v.x, top: v.y }}
    >
      <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: tone }} />
      <div className="absolute left-5 -top-1 text-[10px] font-bold whitespace-nowrap"
        style={{ color: tone }}>{label}</div>
    </div>
  );
}

export default function UnderlayModal() {
  const open = useCanvasStore((s) => s.showUnderlayModal);
  const existing = useCanvasStore((s) => s.canvasData.underlay);

  const [step, setStep] = useState<Step>('load');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 縮小済みの画像（まだ上げていない）。 */
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  /** 表示用のローカル URL（この画面の中だけ・閉じるときに解放する）。 */
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  const [p1, setP1] = useState<Point | null>(null);
  const [p2, setP2] = useState<Point | null>(null);
  const [realMm, setRealMm] = useState(4550);
  const [orientation, setOrientation] = useState<CalibOrientation | null>(null);
  /** 位置合わせの基準点（画像上）と、その置き先（グリッド）。 */
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [targetMm, setTargetMm] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  /** ずれの確認に打った 3 点目。 */
  const [checkPoint, setCheckPoint] = useState<Point | null>(null);
  /**
   * 期待する寸法(mm)。**任意**。図面に書かれている数字を入れてもらえば
   * 差を出すが、入れなくても実寸は見えるので必須にはしない。
   */
  const [expectMm, setExpectMm] = useState<{ x: string; y: string }>({ x: '', y: '' });
  /**
   * 精度が低いことを承知したか。**赤（見込み誤差が大きい）のときだけ**求める。
   * 完全に塞ぐと「概算で構わない」場面で詰むので、逃げ道は残す。
   * 点を打ち直したら要求し直す（前の承知を持ち越さない）。
   */
  const [riskAccepted, setRiskAccepted] = useState(false);

  /** すべての下書きを捨てる（閉じる・やり直す）。 */
  const resetDraft = useCallback(() => {
    setStep('load'); setBusy(null); setError(null);
    setPrepared(null);
    setLocalUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setP1(null); setP2(null); setRealMm(4550); setOrientation(null);
    setAnchor(null); setTargetMm({ x: 0, y: 0 }); setCheckPoint(null);
    setExpectMm({ x: '', y: '' }); setRiskAccepted(false);
  }, []);

  // 閉じたら必ず捨てる（中途半端な状態を残さない・ローカル URL も解放する）。
  useEffect(() => { if (!open) resetDraft(); }, [open, resetDraft]);
  // 画面から消えるときも解放する（保存し忘れのメモリを残さない）。
  useEffect(() => () => { setLocalUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); }, []);

  const nat = { w: prepared?.widthPx ?? 0, h: prepared?.heightPx ?? 0 };

  /**
   * 点を打つ（動かさずに離したとき）。座標は**画像の画素**で持つので、
   * 拡大・移動しても図面上の同じ位置に留まる。
   */
  const pick = useCallback((p: Point) => {
    setStepPick.current?.(p);
  }, []);
  /** step ごとの受け口。フックへ渡す関数を毎回作り直さないための箱。 */
  const setStepPick = useRef<((p: Point) => void) | null>(null);
  setStepPick.current = (p: Point) => {
    if (step === 'scale') {
      // 打ち直したら「承知のうえ」も取り消す（前の判断を持ち越さない）。
      setRiskAccepted(false);
      if (!p1 || (p1 && p2)) { setP1(p); setP2(null); setOrientation(null); return; }
      setP2(p);
      setOrientation(guessOrientation(p1, p));
      return;
    }
    if (step === 'place') { setAnchor(p); return; }
    if (step === 'verify') { setCheckPoint(p); }
  };

  const vp = useImageViewport({ naturalWidth: nat.w, naturalHeight: nat.h, onPick: pick });

  /** 2 点から決まる縮尺と回転（位置はまだ決まらない）。 */
  const calib = useMemo(() => {
    if (!p1 || !p2) return null;
    return calibrateFromTwoPoints(p1, p2, realMm, orientation ?? undefined);
  }, [p1, p2, realMm, orientation]);

  const distPx = p1 && p2 ? imageDistancePx(p1, p2) : 0;
  const tooClose = !!p1 && !!p2 && !canCalibrate(p1, p2);
  /**
   * 図面の反対側での見込み誤差(mm)。
   *
   * 人が狙うときにずれるのは**表示上の px** なので、いまの表示倍率で
   * 画像の画素へ直してから見積もる。縮小表示のままだと大きく、
   * 拡大して打てば小さく出る＝実態どおりの数字になる。
   */
  const errMm = useMemo(() => {
    if (!calib || !distPx) return null;
    return estimatedErrorMm(
      distPx, imageSpanMm(nat.w, nat.h, calib.scale), clickErrorImagePx(vp.displayScale),
    );
  }, [calib, distPx, nat.w, nat.h, vp.displayScale]);

  /** 見込み誤差が大きいか（＝承知のうえかを確かめる）。 */
  const risky = isRiskyError(errMm);

  /** 位置まで決めた変換。 */
  const transform: UnderlayTransform | null = useMemo(() => {
    if (!calib) return null;
    const base = anchor ?? { x: 0, y: 0 };
    const origin = originForAnchor(
      base, { x: targetMm.x / 10, y: targetMm.y / 10 }, calib.scale, calib.rotationDeg,
    );
    return { ...identityTransform(), scale: calib.scale, rotationDeg: calib.rotationDeg, originGrid: origin };
  }, [calib, anchor, targetMm]);

  /** 3 点目の実寸（基準点から見て）。グリッドとは比べない。 */
  const measured = useMemo(
    () => (checkPoint && anchor && transform
      ? measureFromAnchorMm(anchor, checkPoint, transform) : null),
    [checkPoint, anchor, transform],
  );

  /** 期待する寸法が入っていれば、そのぶんの差。両方入っているときだけ出す。 */
  const expected = useMemo(() => {
    const x = Number(expectMm.x), y = Number(expectMm.y);
    if (!expectMm.x.trim() || !expectMm.y.trim()) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { xMm: x, yMm: y };
  }, [expectMm]);
  const gap = useMemo(
    () => (measured && expected ? deviationMm(measured, expected) : null),
    [measured, expected],
  );

  if (!open) return null;

  const onPickFile = async (file: File) => {
    setError(null);
    setBusy('画像を読み込んでいます…');
    try {
      const prep = await prepareUnderlayImage(file);
      setLocalUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(prep.blob); });
      setPrepared(prep);
      setStep('scale');
    } catch (e) {
      setError(e instanceof Error ? e.message : '画像を読み込めませんでした');
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    const s = useCanvasStore.getState();
    if (!prepared || !transform || !s.projectId || !s.drawingId) {
      setError('保存先が分かりません。ページを開き直してください');
      return;
    }
    setBusy('保存しています…');
    setError(null);
    try {
      const id = `u${Date.now().toString(36)}`;
      const path = await uploadUnderlay(s.projectId, s.drawingId, id, prepared);
      // 差し替えたら、古い実体と取っておいた画像を捨てる。
      //   **新しいものを上げたあとに消す**ので、途中で失敗しても表示は壊れない。
      //   消せなくても確定は進める（容量が残るだけ。物件の削除で回収できる）。
      if (existing?.storagePath && existing.storagePath !== path) {
        forgetUnderlayImage(existing.storagePath);
        try {
          const { removeUnderlayObject } = await import('@/lib/underlay/underlayStorage');
          await removeUnderlayObject(existing.storagePath);
        } catch (e) {
          console.warn('[underlay] 古い画像を削除できませんでした', e);
        }
      }
      s.setUnderlay({
        id, storagePath: path,
        widthPx: prepared.widthPx, heightPx: prepared.heightPx,
        transform, opacity: existing?.opacity ?? UNDERLAY_DEFAULT_OPACITY,
      });
      s.setShowUnderlayModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      setBusy(null);
    }
  };

  const close = () => useCanvasStore.getState().setShowUnderlayModal(false);
  const btn = 'px-4 py-2 rounded-xl text-sm font-bold';

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-center justify-center p-4">
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base text-canvas font-bold">下図（したず）</h2>
          <button type="button" onClick={close} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-xs">{error}</div>
        )}
        {busy && <div className="mb-3 text-xs text-dimension">{busy}</div>}

        {/* --- 1. 読み込み --- */}
        {step === 'load' && (
          <div className="space-y-3">
            <p className="text-xs text-dimension leading-relaxed">
              平面図の画像（JPEG / PNG・10MB まで）を選びます。<br />
              長辺が 4000px を超える画像は、送る前に自動で縮小します。
            </p>
            <input
              type="file" accept="image/jpeg,image/png"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); }}
              className="text-xs text-canvas"
            />
            {existing && (
              <p className="text-[11px] text-dimension">
                いまの下図を置き換えます（元の画像は残るので、あとから消せます）。
              </p>
            )}
          </div>
        )}

        {/* --- 画像（2〜4 ステップ共通） --- */}
        {step !== 'load' && localUrl && (
          <>
            {/* 拡大・移動できる画像。狙って点を打つには縮小表示のままでは足りない
                （A3 を 700px で見ると表示上の 1px が図面の 5.7px にあたる）。 */}
            <div
              ref={vp.containerRef}
              className="relative w-full h-[46vh] min-h-[240px] mb-2 overflow-hidden rounded-lg border border-dark-border bg-black/20 cursor-crosshair select-none"
              style={{ touchAction: 'none' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={localUrl} alt="下図"
                width={nat.w} height={nat.h}
                className="absolute left-0 top-0 max-w-none pointer-events-none"
                style={{
                  width: nat.w, height: nat.h, transformOrigin: '0 0',
                  transform: `translate(${vp.view.tx}px, ${vp.view.ty}px) scale(${vp.view.scale})`,
                }}
                draggable={false}
              />
              {p1 && <Marker p={p1} view={vp.view} label="1" tone="#F59E0B" />}
              {p2 && <Marker p={p2} view={vp.view} label="2" tone="#F59E0B" />}
              {anchor && <Marker p={anchor} view={vp.view} label="基準" tone="#2563EB" />}
              {checkPoint && <Marker p={checkPoint} view={vp.view} label="確認" tone="#10B981" />}
            </div>

            {/* 拡大の操作（ホイールが使えない環境のため、ボタンも置く） */}
            <div className="flex items-center gap-2 mb-3 text-[11px] text-dimension flex-wrap">
              <button type="button" onClick={() => vp.zoomByButton(false)}
                className="px-3 py-1 rounded-lg bg-dark-border text-canvas font-bold">−</button>
              <button type="button" onClick={() => vp.zoomByButton(true)}
                className="px-3 py-1 rounded-lg bg-dark-border text-canvas font-bold">＋</button>
              <button type="button" onClick={vp.fit}
                className="px-3 py-1 rounded-lg bg-dark-border text-canvas font-bold">全体を表示</button>
              <span>表示倍率 <b className="text-canvas">{(vp.displayScale * 100).toFixed(0)}%</b></span>
              <span className="opacity-70">ホイール（ピンチ）で拡大 / ドラッグで移動 / 動かさずに離すと点を打つ</span>
            </div>

            {/* --- 2. 縮尺と回転 --- */}
            {step === 'scale' && (
              <div className="space-y-3">
                <p className="text-xs text-dimension leading-relaxed">
                  寸法線の<b className="text-canvas">両端を 2 か所クリック</b>し、その実寸を入れてください。<br />
                  <b className="text-canvas">できるだけ離れた 2 点</b>を選ぶほど、図面の反対側での誤差が小さくなります。
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-dimension">実寸</span>
                  <NumInput value={realMm} onChange={(v) => setRealMm(Math.max(1, Math.round(v)))} min={1} step={50} />
                  <span className="text-xs text-canvas">mm</span>
                </div>
                {p1 && p2 && (
                  <div className="text-[11px] space-y-1">
                    <div className="text-dimension">
                      2 点の間隔: <b className="text-canvas">{Math.round(distPx)}px</b>
                      {tooClose && <span className="text-red-300 ml-2">近すぎます（{UNDERLAY_MIN_CALIB_PX}px 以上離してください）</span>}
                    </div>
                    {errMm != null && Number.isFinite(errMm) && (
                      <>
                        <div className={errMm > UNDERLAY_ERROR_RISK_MM ? 'text-red-300'
                          : errMm > UNDERLAY_ERROR_WARN_MM ? 'text-amber-300' : 'text-emerald-300'}>
                          この 2 点だと、図面の反対側で <b>約 {Math.round(errMm)}mm</b> ずれる見込みです
                          <span className="opacity-70">（表示倍率 {(vp.displayScale * 100).toFixed(0)}% で狙った場合）</span>
                        </div>
                        {errMm > UNDERLAY_ERROR_WARN_MM && (
                          <div className="text-amber-300">
                            拡大してから打ち直すと精度が上がります。
                            {vp.displayScale < 1 && (
                              <>いま原寸より小さく表示しているので、
                                <b> 100% まで拡大すれば約 {Math.round(errMm * vp.displayScale)}mm</b> まで下がります。</>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <div className="text-dimension">
                      向き:
                      {(['horizontal', 'vertical'] as const).map((o) => (
                        <button
                          key={o} type="button" onClick={() => setOrientation(o)}
                          className={`ml-2 px-2 py-0.5 rounded ${(orientation ?? guessOrientation(p1, p2)) === o
                            ? 'bg-accent text-white' : 'bg-dark-border text-canvas'}`}
                        >
                          {o === 'horizontal' ? '横の寸法' : '縦の寸法'}
                        </button>
                      ))}
                      <span className="ml-2">（自動で推定しています。違っていたら押して切り替えてください）</span>
                    </div>
                  </div>
                )}
                {/* 赤（精度が低い）のときだけ、承知のうえかを確かめる。
                    完全に塞ぐと「概算で構わない」場面で詰むので、逃げ道は残す。 */}
                {risky && (
                  <label className="flex items-start gap-2 text-[11px] text-red-300 cursor-pointer select-none">
                    <input
                      type="checkbox" checked={riskAccepted}
                      onChange={(e) => setRiskAccepted(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      精度が低いことを承知で進む<br />
                      <span className="opacity-80">
                        （拡大して打ち直すか、もっと離れた 2 点を選ぶと精度が上がります）
                      </span>
                    </span>
                  </label>
                )}
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => { setP1(null); setP2(null); setOrientation(null); setRiskAccepted(false); }}
                    className={`${btn} bg-dark-border text-canvas`}>点を打ち直す</button>
                  <button type="button" disabled={!calib || tooClose || (risky && !riskAccepted)}
                    onClick={() => setStep('place')}
                    className={`${btn} bg-accent text-white disabled:opacity-40`}>次へ（位置合わせ）</button>
                </div>
                {/* 押せないときは理由を出す（黙って無効にしない）。 */}
                {p1 && p2 && tooClose && (
                  <p className="text-[11px] text-red-300">2 点が近すぎます。もっと離れた 2 点を選んでください。</p>
                )}
                {risky && !riskAccepted && !tooClose && (
                  <p className="text-[11px] text-red-300">上のチェックを入れると先へ進めます。</p>
                )}
              </div>
            )}

            {/* --- 3. 位置合わせ --- */}
            {step === 'place' && (
              <div className="space-y-3">
                <p className="text-xs text-dimension leading-relaxed">
                  図面の中で、<b className="text-canvas">建物の角をクリックしてください</b>。
                  その角を、キャンバスのどこに置くかを決めます（既定は原点 X=0 / Y=0）。
                </p>
                {/* どちらを動かすのかが伝わらない、という指摘への対応。 */}
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  建物は交点に沿って描くため動かせません。<b>合わせるのは下図の側</b>です。
                </p>
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-dimension">
                  <span>置き先 X</span>
                  <NumInput value={targetMm.x} onChange={(v) => setTargetMm((t) => ({ ...t, x: v }))} step={1000} />
                  <span>Y</span>
                  <NumInput value={targetMm.y} onChange={(v) => setTargetMm((t) => ({ ...t, y: v }))} step={1000} />
                  <span className="text-xs text-canvas">mm</span>
                </div>
                {/* 打ったあとに何をするのかを言い直す（打ちっぱなしで不安にさせない）。 */}
                {anchor && (
                  <p className="text-[11px] text-emerald-300">
                    この点を X = {targetMm.x.toLocaleString()}mm / Y = {targetMm.y.toLocaleString()}mm に置きます。
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep('scale')} className={`${btn} bg-dark-border text-canvas`}>戻る</button>
                  <button type="button" disabled={!anchor} onClick={() => setStep('verify')}
                    className={`${btn} bg-accent text-white disabled:opacity-40`}>次へ（ずれの確認）</button>
                </div>
                {/* 押せない理由を出す（黙って無効にしない）。 */}
                {!anchor && (
                  <p className="text-[11px] text-red-300">基準点をクリックしてください。</p>
                )}
                <p className="text-[10px] text-dimension">
                  細かい調整は、閉じたあとキャンバス上で下図をドラッグしてもできます。
                </p>
              </div>
            )}

            {/* --- 4. ずれの確認 --- */}
            {step === 'verify' && (
              <div className="space-y-3">
                <p className="text-xs text-dimension leading-relaxed">
                  合わせ込みの確かめです。<b className="text-canvas">基準点から遠い場所</b>にある
                  通り芯の交点をクリックしてください。<b className="text-canvas">基準点からの実寸</b>を出すので、
                  図面に書かれている寸法と見比べてください。
                </p>
                {measured ? (
                  <div className="text-[11px] space-y-2">
                    <div className="text-canvas">
                      基準点から <b>X = {Math.round(measured.xMm).toLocaleString()}mm</b>
                      {' / '}<b>Y = {Math.round(measured.yMm).toLocaleString()}mm</b> の位置です
                    </div>

                    {/* 任意。入れてもらえれば差を出すが、入れなくても実寸は見える。 */}
                    <div className="flex items-center gap-2 flex-wrap text-dimension">
                      <span>図面の寸法（任意）X</span>
                      <input
                        type="number" inputMode="numeric" value={expectMm.x}
                        onChange={(e) => setExpectMm((v) => ({ ...v, x: e.target.value }))}
                        placeholder="10010"
                        className="w-24 px-2 py-1 rounded-lg bg-dark-bg border border-dark-border text-canvas text-[11px]"
                      />
                      <span>Y</span>
                      <input
                        type="number" inputMode="numeric" value={expectMm.y}
                        onChange={(e) => setExpectMm((v) => ({ ...v, y: e.target.value }))}
                        placeholder="7280"
                        className="w-24 px-2 py-1 rounded-lg bg-dark-bg border border-dark-border text-canvas text-[11px]"
                      />
                      <span>mm</span>
                    </div>

                    {gap && (
                      <>
                        <div className={gap.distanceMm > 100 ? 'text-red-300' : gap.distanceMm > 50 ? 'text-amber-300' : 'text-emerald-300'}>
                          約 <b>{Math.round(gap.distanceMm)}mm</b> ずれています
                          （X {gap.dxMm >= 0 ? '+' : ''}{Math.round(gap.dxMm)}mm
                          {' / '}Y {gap.dyMm >= 0 ? '+' : ''}{Math.round(gap.dyMm)}mm）
                        </div>
                        <div className="text-dimension">
                          目安: 10mm 以下＝良好 ／ 50mm 以下＝実用 ／ 100mm 超＝撮り直しか歪み補正が必要
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-dimension">
                    交点をクリックすると、基準点からの実寸を表示します（省略もできます）。
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setCheckPoint(null); setStep('place'); }}
                    className={`${btn} bg-dark-border text-canvas`}>戻る</button>
                  <button type="button" disabled={!transform || !!busy} onClick={() => void confirm()}
                    className={`${btn} bg-accent text-white disabled:opacity-40`}>この内容で確定</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
