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
    showAreaCalcModal: false,
    showBuildingModal: false,
    autoOpenRoofForBuildingId: null,
    handrailsBeforeAutolayout: null,
  };
}

/** id でステップを取得 */
function stepById(id: string) {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`step not found: ${id}`);
  return s;
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

describe('tutorialSteps Phase A (= 12 ステップ)', () => {
  it('全 12 ステップが定義されている', () => {
    expect(TUTORIAL_STEPS.length).toBe(12);
  });

  it('TOTAL_STEPS = 12 (= ステップ数と一致)', () => {
    expect(TOTAL_STEPS).toBe(12);
    expect(TOTAL_STEPS).toBe(TUTORIAL_STEPS.length);
  });

  it('ステップ id の順序が想定通り', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'settings',
      'building-open',
      'wallinput-tab',
      'build-canvas',
      'roof',
      'obstacle-open',
      'obstacle-place',
      'height',
      'scaffold-start',
      'autolayout',
      'reorder',
      'areacalc',
    ]);
  });

  it('各ステップが id / title / description を持つ', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it('targetSelector は data-tutorial-id を指す文字列 または null (= Konva 操作)', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.targetSelector !== null) {
        expect(step.targetSelector).toMatch(/data-tutorial-id/);
      }
    }
    // Konva 操作ステップは targetSelector=null
    expect(stepById('build-canvas').targetSelector).toBeNull();
    expect(stepById('obstacle-place').targetSelector).toBeNull();
  });

  it('ステップ settings は completeWhen 未定義 (= 「次へ」 フォールバック)', () => {
    expect(stepById('settings').completeWhen).toBeUndefined();
  });

  it('ステップ building-open は showBuildingModal=true で true', () => {
    const fn = stepById('building-open').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.showBuildingModal = true;
    expect(fn(ctx)).toBe(true);
  });

  it("ステップ wallinput-tab は mode==='building' で true", () => {
    const fn = stepById('wallinput-tab').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.mode = 'building';
    expect(fn(ctx)).toBe(true);
  });

  it('ステップ build-canvas は buildings 1 個以上で true', () => {
    const fn = stepById('build-canvas').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('ステップ roof は いずれかの building の roof.uniformMm===500 で true', () => {
    const fn = stepById('roof').completeWhen!;
    // 建物なし → false
    expect(fn(emptyCtx())).toBe(false);
    // 既定 600 のまま → false
    const ctx600 = emptyCtx();
    ctx600.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx600)).toBe(false);
    // 500 に変更 → true
    const ctx500 = emptyCtx();
    ctx500.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx500)).toBe(true);
  });

  it("ステップ obstacle-open は mode==='obstacle' で true", () => {
    const fn = stepById('obstacle-open').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.mode = 'obstacle';
    expect(fn(ctx)).toBe(true);
  });

  it('ステップ obstacle-place は obstacles 1 個以上で true', () => {
    const fn = stepById('obstacle-place').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.canvasData.obstacles = [
      { id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('ステップ height は heightMarkers 1 個以上で true、 undefined でも false', () => {
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

  it('ステップ scaffold-start は scaffoldStart1F または 2F があれば true', () => {
    const fn = stepById('scaffold-start').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx1 = emptyCtx();
    ctx1.canvasData.scaffoldStart1F = { corner: 'tl' } as never;
    expect(fn(ctx1)).toBe(true);
    const ctx2 = emptyCtx();
    ctx2.canvasData.scaffoldStart2F = { corner: 'tl' } as never;
    expect(fn(ctx2)).toBe(true);
  });

  it('ステップ autolayout は snapshot より handrails が増えたら true', () => {
    const fn = stepById('autolayout').completeWhen!;
    // snapshot 未設定 (null) → false
    expect(fn(emptyCtx())).toBe(false);
    // snapshot=2 で handrails も 2 → 増えてない → false
    const ctxEq = emptyCtx();
    ctxEq.handrailsBeforeAutolayout = 2;
    ctxEq.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(ctxEq)).toBe(false);
    // snapshot=2 で handrails 3 → 増えた → true
    const ctxInc = emptyCtx();
    ctxInc.handrailsBeforeAutolayout = 2;
    ctxInc.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h3', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(ctxInc)).toBe(true);
  });

  it('ステップ reorder は completeWhen 未定義 (= 任意・「次へ」 フォールバック)', () => {
    expect(stepById('reorder').completeWhen).toBeUndefined();
  });

  it('ステップ areacalc は showAreaCalcModal=true で true', () => {
    const fn = stepById('areacalc').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.showAreaCalcModal = true;
    expect(fn(ctx)).toBe(true);
  });
});
