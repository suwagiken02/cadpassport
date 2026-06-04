'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTutorialStore } from '@/stores/tutorialStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { gridToScreen } from '@/lib/konva/gridUtils';
import { TUTORIAL_STEPS, TOTAL_STEPS, type TutorialContext } from '@/lib/tutorial/tutorialSteps';

/**
 * セレクタにマッチする要素のうち「可視（rect>0）」のものを返す。
 * mobile/PC で同 data-tutorial-id が二重に存在しても、 display:none (rect=0) を除外して可視側を選ぶ。
 */
function queryVisible(selector: string): Element | null {
  const els = document.querySelectorAll(selector);
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return els[i];
  }
  return els.length > 0 ? els[0] : null;
}

/**
 * チュートリアル overlay。 isActive のとき表示。
 * 構成: スポットライト暗幕 + 点滅枠 + 吹き出し + (arrowTarget 指定時) canvas 交点を指す 👇 矢印。
 */
export default function TutorialOverlay() {
  const isActive = useTutorialStore((s) => s.isActive);
  const currentStep = useTutorialStore((s) => s.currentStep);
  const nextStep = useTutorialStore((s) => s.nextStep);
  const skipTutorial = useTutorialStore((s) => s.skipTutorial);
  const endTutorial = useTutorialStore((s) => s.endTutorial);

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  // arrowTarget ステップ: canvas 上の交点を指す 👇 矢印の viewport 座標
  const [arrowPos, setArrowPos] = useState<{ x: number; y: number } | null>(null);

  const step =
    isActive && currentStep >= 0 && currentStep < TUTORIAL_STEPS.length
      ? TUTORIAL_STEPS[currentStep]
      : null;

  // viewport 外への自動スクロールをステップごと 1 回に制限するための ref
  const scrolledForStep = useRef<number | null>(null);

  // 対象要素の位置取得 (= 500ms ポーリング)。 priority → primary → fallback の順にハイライト。
  // viewport 外 (特に下) ならステップごと 1 回だけ自動スクロール (= モーダル下部の確定ボタン等を見せる)。
  useEffect(() => {
    const priority = step?.priorityTargetSelector ?? null;
    const primary = step?.targetSelector ?? null;
    const fallback = step?.fallbackTargetSelector ?? null;
    if (!step || (!priority && !primary && !fallback)) {
      setTargetRect(null);
      return;
    }
    scrolledForStep.current = null;
    const update = () => {
      let el: Element | null = null;
      if (priority) el = queryVisible(priority);
      if (!el && primary) el = queryVisible(primary);
      if (!el && fallback) el = queryVisible(fallback);
      if (el) {
        const r = el.getBoundingClientRect();
        if (
          (r.bottom > window.innerHeight || r.top < 0) &&
          scrolledForStep.current !== currentStep
        ) {
          scrolledForStep.current = currentStep;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setTargetRect((prev) => {
          if (
            prev &&
            prev.top === r.top &&
            prev.left === r.left &&
            prev.width === r.width &&
            prev.height === r.height
          ) {
            return prev;
          }
          return r;
        });
      } else {
        setTargetRect(null);
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const interval = setInterval(update, 500);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      clearInterval(interval);
    };
  }, [step]);

  // arrowTarget: canvas 上の交点 (grid 座標) を viewport 座標に変換して矢印で指す。
  // ⚠️ gridToScreen は canvas コンテナ内ローカル座標を返すため、 コンテナの getBoundingClientRect().left/top を
  //    必ず加算して viewport 絶対座標にする (= 前回ヘッダ分ずれたバグの修正)。
  // pan/zoom 追従は canvasStore.subscribe + resize/scroll + 500ms フォールバック。
  useEffect(() => {
    const fn = step?.arrowTarget;
    if (!fn) {
      setArrowPos(null);
      return;
    }
    const compute = () => {
      const s = useCanvasStore.getState();
      const g = fn(s.directionPoints ?? []);
      if (!g) {
        setArrowPos(null);
        return;
      }
      const scr = gridToScreen(g.x, g.y, s.panX, s.panY, s.zoom);
      const container =
        typeof document !== 'undefined' ? document.querySelector('[data-canvas-container]') : null;
      const rect = container?.getBoundingClientRect();
      const vx = scr.x + (rect?.left ?? 0);
      const vy = scr.y + (rect?.top ?? 0);
      setArrowPos((prev) => (prev && prev.x === vx && prev.y === vy ? prev : { x: vx, y: vy }));
    };
    compute();
    const unsub = useCanvasStore.subscribe(compute);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    const interval = setInterval(compute, 500);
    return () => {
      unsub();
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      clearInterval(interval);
    };
  }, [step]);

  // 完了検知: useCanvasStore subscribe。
  // ⚠️ クロージャの step ではなく useTutorialStore のライブ currentStep で評価 (= step 飛び防止)。
  const checkComplete = useCallback(() => {
    const t = useTutorialStore.getState();
    const idx = t.currentStep;
    if (!t.isActive || idx < 0 || idx >= TUTORIAL_STEPS.length) return;
    const curStep = TUTORIAL_STEPS[idx];
    const s = useCanvasStore.getState();
    // step1: 設定パネルを一度でも開いたら記録
    if (s.showSettings && !t.settingsOpenedOnce) {
      t.setSettingsOpenedOnce(true);
    }
    if (!curStep.completeWhen) return;
    const ctx: TutorialContext = {
      canvasData: s.canvasData,
      mode: s.mode,
      showSettings: s.showSettings,
      showSettingsPanel: s.showSettingsPanel ?? false,
      showAreaCalcModal: s.showAreaCalcModal ?? false,
      showBuildingModal: s.showBuildingModal ?? false,
      autoOpenRoofForBuildingId: s.autoOpenRoofForBuildingId ?? null,
      handrailsBeforeAutolayout: t.handrailsBeforeAutolayout,
      settingsOpenedOnce: useTutorialStore.getState().settingsOpenedOnce,
      directionPointsLength: s.directionPoints?.length ?? 0,
      isHeightMarkerMode: s.isHeightMarkerMode ?? false,
      heightInputMarkerId: s.heightInputMarkerId ?? null,
      showScaffoldStart: s.showScaffoldStart ?? false,
      showAutoLayout: s.showAutoLayout ?? false,
    };
    if (curStep.completeWhen(ctx)) {
      t.nextStep();
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    checkComplete();
    const unsub = useCanvasStore.subscribe(() => {
      checkComplete();
    });
    return unsub;
  }, [isActive, currentStep, checkComplete]);

  // 自動配置「配置」ステップ突入時に handrails 本数を snapshot (= レンダー後に取得し、 足場開始の追加が
  // 確定した本数を基準にする。 同期バースト中に取ると中間値で誤完了するため useEffect で取る)。
  useEffect(() => {
    if (step?.id !== 'autolayout-place') return;
    if (useTutorialStore.getState().handrailsBeforeAutolayout != null) return;
    useTutorialStore
      .getState()
      .setHandrailsBeforeAutolayout(useCanvasStore.getState().canvasData.handrails.length);
  }, [step]);

  // DOM ポーリング自動進行: autoAdvance ステップを 500ms ごとに監視。
  // (1) completeWhenDom があれば DOM 値で完了判定。
  // (2) completeWhen も completeWhenDom も無い解説ステップは、 次ステップ target が DOM 出現で進む。
  useEffect(() => {
    if (!step || !step.autoAdvance) return;
    if (step.completeWhenDom) {
      const domCheck = step.completeWhenDom;
      const poll = () => {
        if (domCheck()) nextStep();
      };
      poll();
      const interval = setInterval(poll, 500);
      return () => clearInterval(interval);
    }
    if (step.completeWhen) return;
    const next = TUTORIAL_STEPS[currentStep + 1];
    if (!next || !next.targetSelector) return;
    const nextSelector = next.targetSelector;
    const poll = () => {
      if (document.querySelector(nextSelector)) {
        nextStep();
      }
    };
    poll();
    const interval = setInterval(poll, 500);
    return () => clearInterval(interval);
  }, [step, currentStep, nextStep]);

  // 全ステップ完了時に自動 endTutorial
  useEffect(() => {
    if (isActive && currentStep >= TUTORIAL_STEPS.length) {
      endTutorial();
    }
  }, [isActive, currentStep, endTutorial]);

  if (!step) return null;

  // 吹き出し位置: ターゲットに被らないよう反対側の画面端に固定。 target なしは画面最上部に小さく配置。
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const isTargetInBottomHalf = !!targetRect && targetRect.top > vh / 2;
  const balloonStyle: React.CSSProperties = !targetRect
    ? {
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 320,
        maxWidth: '90vw',
        maxHeight: 200,
        overflowY: 'auto',
        zIndex: 110,
      }
    : {
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 320,
        maxWidth: '90vw',
        zIndex: 110,
        ...(isTargetInBottomHalf ? { top: 80 } : { bottom: 80 }),
      };

  const padding = 8;
  // 暗幕の濃さ: dimmed=false (= Konva/モーダル操作で図面を見せたい) は薄く。
  const dimClass = step.dimmed === false ? 'absolute bg-black/20' : 'absolute bg-black/60';

  // 矢印位置 (= 交点座標に div の「下端中央」を合わせる。 transform: translate(-50%,-92%) で
  // 👇 絵文字の指先 (= 下端中央付近、 下に僅かな余白あり) が交点に正確に重なる)。 画面端は簡易クランプ。
  const showArrow = !!arrowPos;
  const arrowX = arrowPos ? Math.max(24, Math.min(arrowPos.x, vw - 24)) : 0;
  const arrowY = arrowPos ? Math.max(44, Math.min(arrowPos.y, vh - 8)) : 0;

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* スポットライト効果: 4 つの半透明矩形で対象周囲を覆う (= 対象部分は穴あき) */}
      {targetRect && (
        <>
          <div
            className={dimClass}
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: Math.max(0, targetRect.top - padding),
              pointerEvents: 'none',
            }}
          />
          <div
            className={dimClass}
            style={{
              top: targetRect.bottom + padding,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
            }}
          />
          <div
            className={dimClass}
            style={{
              top: Math.max(0, targetRect.top - padding),
              left: 0,
              width: Math.max(0, targetRect.left - padding),
              height: targetRect.height + padding * 2,
              pointerEvents: 'none',
            }}
          />
          <div
            className={dimClass}
            style={{
              top: Math.max(0, targetRect.top - padding),
              left: targetRect.right + padding,
              right: 0,
              height: targetRect.height + padding * 2,
              pointerEvents: 'none',
            }}
          />
          {/* 点滅枠 (= pointer-events: none で対象操作を透過) */}
          <div
            className="absolute border-4 border-yellow-400 rounded-lg animate-highlight"
            style={{
              top: targetRect.top - padding,
              left: targetRect.left - padding,
              width: targetRect.width + padding * 2,
              height: targetRect.height + padding * 2,
              pointerEvents: 'none',
              boxShadow: '0 0 16px rgba(250, 204, 21, 0.6)',
            }}
          />
        </>
      )}

      {/* arrowTarget: canvas 上の交点を指す光る 👇 矢印 (= 交点の少し上に配置して下を指す) */}
      {showArrow && (
        <div
          className="absolute animate-highlight"
          style={{
            left: arrowX,
            top: arrowY,
            transform: 'translate(-50%, -86%)',
            fontSize: 40,
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 110,
            textShadow: '0 0 10px rgba(0,0,0,0.9), 0 0 6px rgba(239,68,68,0.9)',
          }}
          aria-hidden
        >
          👇
        </div>
      )}

      {/* DEBUG(一時): arrowPos の生座標に transform なしの赤点。 交点に乗るか切り分け用。 原因特定後に除去。 */}
      {showArrow && arrowPos && (
        <div
          style={{
            position: 'absolute',
            left: arrowPos.x,
            top: arrowPos.y,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'red',
            pointerEvents: 'none',
            zIndex: 110,
          }}
          aria-hidden
        />
      )}

      {/* 吹き出し */}
      <div
        className="bg-dark-surface border-2 border-accent rounded-2xl shadow-2xl p-4 pointer-events-auto"
        style={balloonStyle}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-dimension">
            ステップ {currentStep + 1} / {TOTAL_STEPS}
          </span>
          <button
            type="button"
            onClick={skipTutorial}
            className="text-dimension hover:text-canvas px-2"
            aria-label="チュートリアルを閉じる"
          >
            ✕
          </button>
        </div>
        {step.iconHint && (
          <div className="text-5xl text-center mb-1 animate-highlight" aria-hidden>
            {step.iconHint}
          </div>
        )}
        <h3 className="font-bold text-lg text-canvas mb-1">{step.title}</h3>
        <p className="text-sm text-dimension mb-3 leading-relaxed">{step.description}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={skipTutorial}
            className="flex-1 py-2 border border-dark-border rounded-lg text-sm text-dimension hover:text-canvas"
          >
            スキップ
          </button>
          {/* 操作で進行するステップ (autoAdvance=true) は「次へ」を隠し、 操作完了でのみ進行 (= 飛ばし防止) */}
          {!step.autoAdvance && (
            <button
              type="button"
              onClick={nextStep}
              className="flex-1 py-2 bg-accent text-white rounded-lg text-sm font-bold"
            >
              次へ →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
