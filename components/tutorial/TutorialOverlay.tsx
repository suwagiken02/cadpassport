'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useTutorialStore } from '@/stores/tutorialStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { TUTORIAL_STEPS, TOTAL_STEPS, type TutorialContext } from '@/lib/tutorial/tutorialSteps';

/**
 * チュートリアル overlay。 isActive のとき表示。
 * 構成: 4 つの半透明矩形でスポットライト + 点滅枠 + 吹き出し (= title/description/「次へ」/「スキップ」/「✕」).
 * 完了検知: useCanvasStore subscribe で各ステップの completeWhen を監視、 true で自動 nextStep。
 * 完了検知が無いステップは「次へ」 ボタンで進む。
 */
export default function TutorialOverlay() {
  const isActive = useTutorialStore((s) => s.isActive);
  const currentStep = useTutorialStore((s) => s.currentStep);
  const nextStep = useTutorialStore((s) => s.nextStep);
  const skipTutorial = useTutorialStore((s) => s.skipTutorial);
  const endTutorial = useTutorialStore((s) => s.endTutorial);

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step =
    isActive && currentStep >= 0 && currentStep < TUTORIAL_STEPS.length
      ? TUTORIAL_STEPS[currentStep]
      : null;

  // 対象要素の位置取得 (= resize / scroll / 動的 UI 変化に追従、 500ms ポーリング)
  useEffect(() => {
    if (!step) {
      setTargetRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(step.targetSelector);
      if (el) {
        const r = el.getBoundingClientRect();
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

  // 完了検知: useCanvasStore subscribe
  const checkComplete = useCallback(() => {
    if (!step || !step.completeWhen) return;
    const s = useCanvasStore.getState();
    const ctx: TutorialContext = {
      canvasData: s.canvasData,
      mode: s.mode,
      showSettings: s.showSettings,
      showSettingsPanel: s.showSettingsPanel ?? false,
      showAreaCalcModal: s.showAreaCalcModal ?? false,
    };
    if (step.completeWhen(ctx)) {
      nextStep();
    }
  }, [step, nextStep]);

  useEffect(() => {
    if (!step) return;
    // 初回 check
    checkComplete();
    // store 変化を subscribe
    const unsub = useCanvasStore.subscribe(() => {
      checkComplete();
    });
    return unsub;
  }, [step, checkComplete]);

  // 全ステップ完了時に自動 endTutorial
  useEffect(() => {
    if (isActive && currentStep >= TUTORIAL_STEPS.length) {
      // Phase 1 で 3 ステップ終了したら一旦 end (= Phase 2 で TOTAL_STEPS に拡張)
      endTutorial();
    }
  }, [isActive, currentStep, endTutorial]);

  if (!step) return null;

  // 吹き出し位置: ターゲット (= ハイライト枠) に被らないよう、 target と反対側の画面端に固定配置。
  // - target が画面下半分 → balloon は上部 (top: 80)
  // - target が画面上半分 → balloon は下部 (bottom: 80)
  // - target なし → 画面中央
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const isTargetInBottomHalf = !!targetRect && targetRect.top > vh / 2;
  const balloonStyle: React.CSSProperties = !targetRect
    ? {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 320,
        maxWidth: '90vw',
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

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* スポットライト効果: 4 つの半透明矩形で対象周囲を覆う (= 対象部分は穴あき) */}
      {targetRect && (
        <>
          <div
            className="absolute bg-black/60"
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: Math.max(0, targetRect.top - padding),
              pointerEvents: 'none',
            }}
          />
          <div
            className="absolute bg-black/60"
            style={{
              top: targetRect.bottom + padding,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
            }}
          />
          <div
            className="absolute bg-black/60"
            style={{
              top: Math.max(0, targetRect.top - padding),
              left: 0,
              width: Math.max(0, targetRect.left - padding),
              height: targetRect.height + padding * 2,
              pointerEvents: 'none',
            }}
          />
          <div
            className="absolute bg-black/60"
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
          <button
            type="button"
            onClick={nextStep}
            className="flex-1 py-2 bg-accent text-white rounded-lg text-sm font-bold"
          >
            次へ →
          </button>
        </div>
      </div>
    </div>
  );
}
