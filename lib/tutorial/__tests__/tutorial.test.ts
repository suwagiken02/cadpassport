import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorialStore } from '@/stores/tutorialStore';
import { TUTORIAL_STEPS, TOTAL_STEPS, type TutorialContext } from '@/lib/tutorial/tutorialSteps';
import type { CanvasData } from '@/types';

function emptyCanvas(): CanvasData {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [],
    roofOverhangs: [],
    obstacles: [],
    handrails: [],
    posts: [],
    antis: [],
    memos: [],
    compass: { angle: 0 },
  };
}

function emptyCtx(): TutorialContext {
  return {
    canvasData: emptyCanvas(),
    mode: 'select',
    showSettings: false,
    showSettingsPanel: false,
  };
}

describe('tutorialStore', () => {
  beforeEach(() => {
    // テスト間 state リセット
    useTutorialStore.setState({ isActive: false, currentStep: 0 });
  });

  it('デフォルトで isActive=false、 currentStep=0 (= 既存ユーザに勝手に出さない)', () => {
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
  });

  it('startTutorial で isActive=true、 currentStep=0', () => {
    useTutorialStore.getState().startTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(true);
    expect(s.currentStep).toBe(0);
  });

  it('nextStep で currentStep が +1 される', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(1);
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(2);
  });

  it('skipTutorial で isActive=false、 currentStep=0 にリセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    useTutorialStore.getState().nextStep();
    useTutorialStore.getState().skipTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
  });

  it('endTutorial で isActive=false、 currentStep=0 にリセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    useTutorialStore.getState().endTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
  });
});

describe('tutorialSteps Phase 1', () => {
  it('全 3 ステップが定義されている', () => {
    expect(TUTORIAL_STEPS.length).toBe(3);
  });

  it('TOTAL_STEPS = 9 (= Phase 2 完成時の総数)', () => {
    expect(TOTAL_STEPS).toBe(9);
  });

  it('各ステップが id / targetSelector / title / description を持つ', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.targetSelector).toMatch(/data-tutorial-id/);
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it('ステップ 1 (= 設定) は completeWhen 未定義 (= 「次へ」 フォールバック)', () => {
    expect(TUTORIAL_STEPS[0].id).toBe('settings');
    expect(TUTORIAL_STEPS[0].completeWhen).toBeUndefined();
  });

  it('ステップ 2 (= 躯体) は buildings 1 個以上で true', () => {
    const step = TUTORIAL_STEPS[1];
    expect(step.id).toBe('kutai-building');
    expect(step.completeWhen).toBeDefined();
    const fn = step.completeWhen!;
    // 空 canvas は false
    expect(fn(emptyCtx())).toBe(false);
    // building 1 個追加で true
    const ctx = emptyCtx();
    ctx.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('ステップ 3 (= 障害物) は obstacles 1 個以上で true', () => {
    const step = TUTORIAL_STEPS[2];
    expect(step.id).toBe('obstacle');
    expect(step.completeWhen).toBeDefined();
    const fn = step.completeWhen!;
    // 空 canvas は false
    expect(fn(emptyCtx())).toBe(false);
    // obstacle 1 個追加で true
    const ctx = emptyCtx();
    ctx.canvasData.obstacles = [
      { id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 },
    ];
    expect(fn(ctx)).toBe(true);
  });
});
