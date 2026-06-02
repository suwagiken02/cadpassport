import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorialStore } from '@/stores/tutorialStore';
import { TUTORIAL_STEPS, TOTAL_STEPS, type TutorialContext, type TutorialStep } from '@/lib/tutorial/tutorialSteps';
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
    showAreaCalcModal: false,
    showBuildingModal: false,
    autoOpenRoofForBuildingId: null,
    handrailsBeforeAutolayout: null,
  };
}

/** id でステップを取得 */
function stepById(id: string): TutorialStep {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`step not found: ${id}`);
  return s;
}

/** Phase B: DOM ポーリング自動進行の対象か (= 解説のみ + autoAdvance) */
function needsDomPoll(step: TutorialStep): boolean {
  return step.completeWhen === undefined && step.autoAdvance === true;
}

/** Phase C: 「次へ」 ボタンを表示するか (= autoAdvance=false のみ) */
function showsNextButton(step: TutorialStep): boolean {
  return !step.autoAdvance;
}

describe('tutorialStore', () => {
  beforeEach(() => {
    useTutorialStore.setState({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null });
  });

  it('デフォルトで isActive=false、 currentStep=0、 handrailsBeforeAutolayout=null', () => {
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
  });

  it('startTutorial で isActive=true、 currentStep=0、 snapshot リセット', () => {
    useTutorialStore.setState({ handrailsBeforeAutolayout: 5 });
    useTutorialStore.getState().startTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(true);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
  });

  it('nextStep で currentStep が +1 される', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(1);
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(2);
  });

  it('skipTutorial で isActive=false、 currentStep=0、 snapshot リセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    useTutorialStore.setState({ handrailsBeforeAutolayout: 3 });
    useTutorialStore.getState().skipTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
  });

  it('endTutorial で isActive=false、 currentStep=0、 snapshot リセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    useTutorialStore.setState({ handrailsBeforeAutolayout: 9 });
    useTutorialStore.getState().endTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
  });

  it('setHandrailsBeforeAutolayout で snapshot 値をセット', () => {
    useTutorialStore.getState().setHandrailsBeforeAutolayout(2);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBe(2);
    useTutorialStore.getState().setHandrailsBeforeAutolayout(null);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBeNull();
  });
});

describe('tutorialSteps Phase A.1+B (= 13 ステップ)', () => {
  it('全 13 ステップが定義されている', () => {
    expect(TUTORIAL_STEPS.length).toBe(13);
  });

  it('TOTAL_STEPS = 13 (= ステップ数と一致)', () => {
    expect(TOTAL_STEPS).toBe(13);
    expect(TOTAL_STEPS).toBe(TUTORIAL_STEPS.length);
  });

  it('ステップ id の順序が想定通り', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'settings',
      'kutai-open',
      'building-select',
      'wallinput-tab',
      'build-canvas',
      'roof',
      'obstacle-select',
      'obstacle-place',
      'height',
      'scaffold-start',
      'autolayout',
      'reorder',
      'areacalc',
    ]);
  });

  it('各ステップが id / title / description / autoAdvance を持つ', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(typeof step.autoAdvance).toBe('boolean');
    }
  });

  it('targetSelector は data-tutorial-id を指す文字列 または null (= Konva 操作)', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.targetSelector !== null) {
        expect(step.targetSelector).toMatch(/data-tutorial-id/);
      }
    }
    expect(stepById('build-canvas').targetSelector).toBeNull();
    expect(stepById('obstacle-place').targetSelector).toBeNull();
  });

  it('kutai-open は親ボタン (kutai-button) を target にする (= problem 1: 躯体が光る)', () => {
    expect(stepById('kutai-open').targetSelector).toBe('[data-tutorial-id="kutai-button"]');
  });
});

describe('autoAdvance フラグ (= Phase C: 次へ表示制御 / 飛ばし防止)', () => {
  it('settings と reorder のみ autoAdvance=false (= 次へ表示)', () => {
    const noAuto = TUTORIAL_STEPS.filter((s) => !s.autoAdvance).map((s) => s.id);
    expect(noAuto).toEqual(['settings', 'reorder']);
  });

  it('操作ステップは全て autoAdvance=true (= 次へ非表示・操作完了で進行)', () => {
    const auto = TUTORIAL_STEPS.filter((s) => s.autoAdvance).map((s) => s.id);
    expect(auto).toEqual([
      'kutai-open',
      'building-select',
      'wallinput-tab',
      'build-canvas',
      'roof',
      'obstacle-select',
      'obstacle-place',
      'height',
      'scaffold-start',
      'autolayout',
      'areacalc',
    ]);
  });

  it('showsNextButton: settings/reorder は true、 操作ステップは false', () => {
    expect(showsNextButton(stepById('settings'))).toBe(true);
    expect(showsNextButton(stepById('reorder'))).toBe(true);
    expect(showsNextButton(stepById('kutai-open'))).toBe(false);
    expect(showsNextButton(stepById('build-canvas'))).toBe(false);
    expect(showsNextButton(stepById('roof'))).toBe(false);
  });
});

describe('DOM ポーリング自動進行 (= Phase B)', () => {
  it('needsDomPoll: kutai-open のみ true (= 解説のみ + autoAdvance)', () => {
    const polled = TUTORIAL_STEPS.filter(needsDomPoll).map((s) => s.id);
    expect(polled).toEqual(['kutai-open']);
  });

  it('settings は completeWhen=undefined だが autoAdvance=false なので DOM ポーリング対象外', () => {
    expect(needsDomPoll(stepById('settings'))).toBe(false);
  });

  it('reorder は completeWhen=undefined だが autoAdvance=false なので DOM ポーリング対象外', () => {
    expect(needsDomPoll(stepById('reorder'))).toBe(false);
  });

  it('DOM ポーリングするステップの「次ステップ」は非null targetSelector を持つ (= 検知対象が存在)', () => {
    TUTORIAL_STEPS.forEach((step, i) => {
      if (needsDomPoll(step)) {
        const next = TUTORIAL_STEPS[i + 1];
        expect(next).toBeDefined();
        expect(next.targetSelector).not.toBeNull();
      }
    });
  });
});

describe('completeWhen 各ステップ', () => {
  it('settings は completeWhen 未定義', () => {
    expect(stepById('settings').completeWhen).toBeUndefined();
  });

  it('kutai-open は completeWhen 未定義 (= DOM ポーリングで進行)', () => {
    expect(stepById('kutai-open').completeWhen).toBeUndefined();
  });

  it('building-select は showBuildingModal=true で true', () => {
    const fn = stepById('building-select').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.showBuildingModal = true;
    expect(fn(ctx)).toBe(true);
  });

  it("wallinput-tab は mode==='building' で true", () => {
    const fn = stepById('wallinput-tab').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.mode = 'building';
    expect(fn(ctx)).toBe(true);
  });

  it('build-canvas は buildings 1 個以上で true', () => {
    const fn = stepById('build-canvas').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('roof は roof.uniformMm===500 で true (= 600 のままは false)', () => {
    const fn = stepById('roof').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx600 = emptyCtx();
    ctx600.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx600)).toBe(false);
    const ctx500 = emptyCtx();
    ctx500.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx500)).toBe(true);
  });

  it("obstacle-select は mode==='obstacle' で true", () => {
    const fn = stepById('obstacle-select').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.mode = 'obstacle';
    expect(fn(ctx)).toBe(true);
  });

  it('obstacle-place は obstacles 1 個以上で true', () => {
    const fn = stepById('obstacle-place').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.canvasData.obstacles = [
      { id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('height は heightMarkers 1 個以上で true、 undefined でも false', () => {
    const fn = stepById('height').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctxUndef = emptyCtx();
    ctxUndef.canvasData.heightMarkers = undefined;
    expect(fn(ctxUndef)).toBe(false);
    const ctx = emptyCtx();
    ctx.canvasData.heightMarkers = [
      { id: 'hm1', buildingId: 'b1', edgeIndex: 0, t: 0.5, heightMm: 6000 },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('scaffold-start は scaffoldStart1F または 2F があれば true', () => {
    const fn = stepById('scaffold-start').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx1 = emptyCtx();
    ctx1.canvasData.scaffoldStart1F = { corner: 'tl' } as never;
    expect(fn(ctx1)).toBe(true);
    const ctx2 = emptyCtx();
    ctx2.canvasData.scaffoldStart2F = { corner: 'tl' } as never;
    expect(fn(ctx2)).toBe(true);
  });

  it('autolayout は snapshot より handrails が増えたら true', () => {
    const fn = stepById('autolayout').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctxEq = emptyCtx();
    ctxEq.handrailsBeforeAutolayout = 2;
    ctxEq.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(ctxEq)).toBe(false);
    const ctxInc = emptyCtx();
    ctxInc.handrailsBeforeAutolayout = 2;
    ctxInc.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h3', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(ctxInc)).toBe(true);
  });

  it('reorder は completeWhen 未定義 (= 任意・「次へ」 フォールバック)', () => {
    expect(stepById('reorder').completeWhen).toBeUndefined();
  });

  it('areacalc は showAreaCalcModal=true で true', () => {
    const fn = stepById('areacalc').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.showAreaCalcModal = true;
    expect(fn(ctx)).toBe(true);
  });
});
