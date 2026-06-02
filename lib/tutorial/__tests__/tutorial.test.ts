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
    settingsOpenedOnce: false,
  };
}

/** id でステップを取得 */
function stepById(id: string): TutorialStep {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`step not found: ${id}`);
  return s;
}

/** Phase B: 「次ステップ target 出現」 ポーリングの対象か (= store/DOM 完了条件が無い解説 + autoAdvance) */
function needsNextTargetPoll(step: TutorialStep): boolean {
  return step.completeWhen === undefined && step.completeWhenDom === undefined && step.autoAdvance === true;
}

/** DOM 値ポーリングの対象か (= completeWhenDom を持つ) */
function needsDomValuePoll(step: TutorialStep): boolean {
  return step.completeWhenDom !== undefined;
}

/** Phase C: 「次へ」 ボタンを表示するか (= autoAdvance=false のみ) */
function showsNextButton(step: TutorialStep): boolean {
  return !step.autoAdvance;
}

describe('tutorialStore', () => {
  beforeEach(() => {
    useTutorialStore.setState({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null, settingsOpenedOnce: false });
  });

  it('デフォルトで isActive=false、 currentStep=0、 snapshot/settings flag=初期値', () => {
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
    expect(s.settingsOpenedOnce).toBe(false);
  });

  it('startTutorial で各 state をリセット', () => {
    useTutorialStore.setState({ handrailsBeforeAutolayout: 5, settingsOpenedOnce: true });
    useTutorialStore.getState().startTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(true);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
    expect(s.settingsOpenedOnce).toBe(false);
  });

  it('nextStep で currentStep が +1 される', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(1);
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(2);
  });

  it('skipTutorial で各 state をリセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    useTutorialStore.setState({ handrailsBeforeAutolayout: 3, settingsOpenedOnce: true });
    useTutorialStore.getState().skipTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
    expect(s.settingsOpenedOnce).toBe(false);
  });

  it('endTutorial で各 state をリセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    useTutorialStore.setState({ handrailsBeforeAutolayout: 9, settingsOpenedOnce: true });
    useTutorialStore.getState().endTutorial();
    const s = useTutorialStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.currentStep).toBe(0);
    expect(s.handrailsBeforeAutolayout).toBeNull();
    expect(s.settingsOpenedOnce).toBe(false);
  });

  it('setHandrailsBeforeAutolayout / setSettingsOpenedOnce で値をセット', () => {
    useTutorialStore.getState().setHandrailsBeforeAutolayout(2);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBe(2);
    useTutorialStore.getState().setSettingsOpenedOnce(true);
    expect(useTutorialStore.getState().settingsOpenedOnce).toBe(true);
  });
});

describe('tutorialSteps (= 14 ステップ / 屋根 2 分割)', () => {
  it('全 14 ステップが定義されている', () => {
    expect(TUTORIAL_STEPS.length).toBe(14);
  });

  it('TOTAL_STEPS = 14 (= ステップ数と一致)', () => {
    expect(TOTAL_STEPS).toBe(14);
    expect(TOTAL_STEPS).toBe(TUTORIAL_STEPS.length);
  });

  it('ステップ id の順序が想定通り (= roof が roof-input/roof-confirm に分割)', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'settings',
      'kutai-open',
      'building-select',
      'wallinput-tab',
      'build-canvas',
      'roof-input',
      'roof-confirm',
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

  it('roof-confirm は「設定する」 ボタン (roof-confirm) を target にする', () => {
    expect(stepById('roof-confirm').targetSelector).toBe('[data-tutorial-id="roof-confirm"]');
  });
});

describe('屋根 2 分割ステップ', () => {
  it('roof-input は completeWhenDom を持ち completeWhen は持たない (= DOM 値監視)', () => {
    const s = stepById('roof-input');
    expect(typeof s.completeWhenDom).toBe('function');
    expect(s.completeWhen).toBeUndefined();
    expect(s.autoAdvance).toBe(true);
    expect(s.targetSelector).toBe('[data-tutorial-id="roof-overhang-input"]');
  });

  it('roof-confirm は completeWhen (uniformMm===500) を持つ', () => {
    const s = stepById('roof-confirm');
    expect(typeof s.completeWhen).toBe('function');
    expect(s.completeWhenDom).toBeUndefined();
    expect(s.autoAdvance).toBe(true);
    const fn = s.completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx500 = emptyCtx();
    ctx500.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx500)).toBe(true);
    const ctx600 = emptyCtx();
    ctx600.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 600, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx600)).toBe(false);
  });
});

describe('autoAdvance フラグ (= Phase C: 次へ表示制御 / 飛ばし防止)', () => {
  it('reorder のみ autoAdvance=false', () => {
    const noAuto = TUTORIAL_STEPS.filter((s) => !s.autoAdvance).map((s) => s.id);
    expect(noAuto).toEqual(['reorder']);
  });

  it('showsNextButton: reorder のみ true、 操作ステップは false', () => {
    expect(showsNextButton(stepById('reorder'))).toBe(true);
    expect(showsNextButton(stepById('settings'))).toBe(false);
    expect(showsNextButton(stepById('roof-input'))).toBe(false);
    expect(showsNextButton(stepById('roof-confirm'))).toBe(false);
  });
});

describe('DOM ポーリング自動進行 (= Phase B)', () => {
  it('needsNextTargetPoll: kutai-open のみ true (= store/DOM 完了条件なし + autoAdvance)', () => {
    const polled = TUTORIAL_STEPS.filter(needsNextTargetPoll).map((s) => s.id);
    expect(polled).toEqual(['kutai-open']);
  });

  it('needsDomValuePoll: roof-input のみ true (= completeWhenDom を持つ)', () => {
    const polled = TUTORIAL_STEPS.filter(needsDomValuePoll).map((s) => s.id);
    expect(polled).toEqual(['roof-input']);
  });

  it('reorder は autoAdvance=false なので次ステップ target ポーリング対象外', () => {
    expect(needsNextTargetPoll(stepById('reorder'))).toBe(false);
  });

  it('次ステップ target ポーリングするステップの「次ステップ」は非null targetSelector を持つ', () => {
    TUTORIAL_STEPS.forEach((step, i) => {
      if (needsNextTargetPoll(step)) {
        const next = TUTORIAL_STEPS[i + 1];
        expect(next).toBeDefined();
        expect(next.targetSelector).not.toBeNull();
      }
    });
  });
});

describe('completeWhen 各ステップ (store ベース)', () => {
  it('settings は settingsOpenedOnce && !showSettings で true (= 開いて閉じた)', () => {
    const fn = stepById('settings').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const opened = emptyCtx();
    opened.settingsOpenedOnce = true;
    opened.showSettings = true;
    expect(fn(opened)).toBe(false);
    const closed = emptyCtx();
    closed.settingsOpenedOnce = true;
    closed.showSettings = false;
    expect(fn(closed)).toBe(true);
    const never = emptyCtx();
    never.settingsOpenedOnce = false;
    never.showSettings = false;
    expect(fn(never)).toBe(false);
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

describe('step 飛びバグ回帰 (= ライブ currentStep 評価で多重進行しない)', () => {
  function simulateBurst(startId: string, ctxFactory: () => TutorialContext, bursts: number): number {
    let idx = TUTORIAL_STEPS.findIndex((s) => s.id === startId);
    for (let i = 0; i < bursts; i++) {
      const cur = TUTORIAL_STEPS[idx];
      if (cur && cur.completeWhen && cur.completeWhen(ctxFactory())) {
        idx += 1;
      }
    }
    return idx;
  }

  it('wallinput-tab で mode=building 後、 連続 store 変化が来ても 1 ステップ (build-canvas) のみ進む', () => {
    const ctxFactory = () => {
      const c = emptyCtx();
      c.mode = 'building';
      return c;
    };
    const result = simulateBurst('wallinput-tab', ctxFactory, 5);
    expect(result).toBe(TUTORIAL_STEPS.findIndex((s) => s.id === 'build-canvas'));
  });
});
