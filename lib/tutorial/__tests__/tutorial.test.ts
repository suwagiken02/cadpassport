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

function stepById(id: string): TutorialStep {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`step not found: ${id}`);
  return s;
}

/** Phase B: 「次ステップ target 出現」 ポーリングの対象か */
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

const KUTAI_BUTTON = '[data-tutorial-id="kutai-button"]';
const ASHIBA_BUTTON = '[data-tutorial-id="ashiba-button"]';

describe('tutorialStore', () => {
  beforeEach(() => {
    useTutorialStore.setState({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null, settingsOpenedOnce: false });
  });

  it('デフォルト値', () => {
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

  it('nextStep で currentStep +1', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(1);
  });

  it('skipTutorial / endTutorial で各 state をリセット', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.setState({ handrailsBeforeAutolayout: 3, settingsOpenedOnce: true, currentStep: 5 });
    useTutorialStore.getState().skipTutorial();
    expect(useTutorialStore.getState().currentStep).toBe(0);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBeNull();
    expect(useTutorialStore.getState().settingsOpenedOnce).toBe(false);
    useTutorialStore.getState().startTutorial();
    useTutorialStore.setState({ handrailsBeforeAutolayout: 7, settingsOpenedOnce: true });
    useTutorialStore.getState().endTutorial();
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBeNull();
    expect(useTutorialStore.getState().settingsOpenedOnce).toBe(false);
  });

  it('setHandrailsBeforeAutolayout / setSettingsOpenedOnce', () => {
    useTutorialStore.getState().setHandrailsBeforeAutolayout(2);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBe(2);
    useTutorialStore.getState().setSettingsOpenedOnce(true);
    expect(useTutorialStore.getState().settingsOpenedOnce).toBe(true);
  });
});

describe('tutorialSteps (= 15 ステップ / Phase A.2)', () => {
  it('全 15 ステップ + TOTAL_STEPS=15', () => {
    expect(TUTORIAL_STEPS.length).toBe(15);
    expect(TOTAL_STEPS).toBe(15);
  });

  it('ステップ id の順序 (= obstacle-close を追加)', () => {
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
      'obstacle-close',
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

  it('targetSelector は data-tutorial-id 文字列 または null', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.targetSelector !== null) {
        expect(step.targetSelector).toMatch(/data-tutorial-id/);
      }
    }
    expect(stepById('build-canvas').targetSelector).toBeNull();
    expect(stepById('obstacle-place').targetSelector).toBeNull();
    expect(stepById('obstacle-close').targetSelector).toBeNull();
  });
});

describe('fallbackTargetSelector (= submenu 親ボタン fallback)', () => {
  it('kutai 系 submenu ステップは fallback=kutai-button', () => {
    expect(stepById('building-select').fallbackTargetSelector).toBe(KUTAI_BUTTON);
    expect(stepById('obstacle-select').fallbackTargetSelector).toBe(KUTAI_BUTTON);
    expect(stepById('height').fallbackTargetSelector).toBe(KUTAI_BUTTON);
  });

  it('ashiba 系 submenu ステップは fallback=ashiba-button', () => {
    expect(stepById('scaffold-start').fallbackTargetSelector).toBe(ASHIBA_BUTTON);
    expect(stepById('autolayout').fallbackTargetSelector).toBe(ASHIBA_BUTTON);
    expect(stepById('reorder').fallbackTargetSelector).toBe(ASHIBA_BUTTON);
    expect(stepById('areacalc').fallbackTargetSelector).toBe(ASHIBA_BUTTON);
  });

  it('親ボタン自体 / Konva ステップは fallback なし', () => {
    expect(stepById('settings').fallbackTargetSelector).toBeUndefined();
    expect(stepById('kutai-open').fallbackTargetSelector).toBeUndefined();
    expect(stepById('build-canvas').fallbackTargetSelector).toBeUndefined();
    expect(stepById('obstacle-place').fallbackTargetSelector).toBeUndefined();
    expect(stepById('obstacle-close').fallbackTargetSelector).toBeUndefined();
  });
});

describe('autoAdvance / 次へ表示 / ポーリング種別', () => {
  it('reorder のみ autoAdvance=false', () => {
    expect(TUTORIAL_STEPS.filter((s) => !s.autoAdvance).map((s) => s.id)).toEqual(['reorder']);
  });

  it('showsNextButton: reorder のみ true', () => {
    expect(showsNextButton(stepById('reorder'))).toBe(true);
    expect(showsNextButton(stepById('settings'))).toBe(false);
  });

  it('needsNextTargetPoll: kutai-open のみ', () => {
    expect(TUTORIAL_STEPS.filter(needsNextTargetPoll).map((s) => s.id)).toEqual(['kutai-open']);
  });

  it('needsDomValuePoll: roof-input のみ', () => {
    expect(TUTORIAL_STEPS.filter(needsDomValuePoll).map((s) => s.id)).toEqual(['roof-input']);
  });

  it('次ステップ target ポーリングするステップの次ステップは非null target', () => {
    TUTORIAL_STEPS.forEach((step, i) => {
      if (needsNextTargetPoll(step)) {
        expect(TUTORIAL_STEPS[i + 1].targetSelector).not.toBeNull();
      }
    });
  });
});

describe('屋根 2 分割ステップ', () => {
  it('roof-input は completeWhenDom を持つ', () => {
    const s = stepById('roof-input');
    expect(typeof s.completeWhenDom).toBe('function');
    expect(s.completeWhen).toBeUndefined();
  });

  it('roof-confirm は completeWhen (uniformMm===500)', () => {
    const fn = stepById('roof-confirm').completeWhen!;
    const ctx = emptyCtx();
    ctx.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(fn(ctx)).toBe(true);
    expect(fn(emptyCtx())).toBe(false);
  });
});

describe('completeWhen 各ステップ', () => {
  it('settings: settingsOpenedOnce && !showSettings', () => {
    const fn = stepById('settings').completeWhen!;
    const closed = emptyCtx();
    closed.settingsOpenedOnce = true;
    expect(fn(closed)).toBe(true);
    const opened = emptyCtx();
    opened.settingsOpenedOnce = true;
    opened.showSettings = true;
    expect(fn(opened)).toBe(false);
    expect(fn(emptyCtx())).toBe(false);
  });

  it('building-select: showBuildingModal', () => {
    const fn = stepById('building-select').completeWhen!;
    const ctx = emptyCtx();
    ctx.showBuildingModal = true;
    expect(fn(ctx)).toBe(true);
  });

  it("wallinput-tab: mode==='building'", () => {
    const fn = stepById('wallinput-tab').completeWhen!;
    const ctx = emptyCtx();
    ctx.mode = 'building';
    expect(fn(ctx)).toBe(true);
  });

  it('build-canvas: buildings.length>0', () => {
    const fn = stepById('build-canvas').completeWhen!;
    const ctx = emptyCtx();
    ctx.canvasData.buildings = [{ id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' }];
    expect(fn(ctx)).toBe(true);
  });

  it("obstacle-select: mode==='obstacle'", () => {
    const fn = stepById('obstacle-select').completeWhen!;
    const ctx = emptyCtx();
    ctx.mode = 'obstacle';
    expect(fn(ctx)).toBe(true);
  });

  it('obstacle-place: obstacles.length>0', () => {
    const fn = stepById('obstacle-place').completeWhen!;
    const ctx = emptyCtx();
    ctx.canvasData.obstacles = [{ id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 }];
    expect(fn(ctx)).toBe(true);
  });

  it("obstacle-close: mode !== 'obstacle' で true (= パレットを閉じた)", () => {
    const fn = stepById('obstacle-close').completeWhen!;
    // obstacle のまま → false
    const stillObstacle = emptyCtx();
    stillObstacle.mode = 'obstacle';
    expect(fn(stillObstacle)).toBe(false);
    // select に戻した → true
    const closed = emptyCtx();
    closed.mode = 'select';
    expect(fn(closed)).toBe(true);
  });

  it('height: heightMarkers.length>0 (undefined でも false)', () => {
    const fn = stepById('height').completeWhen!;
    expect(fn(emptyCtx())).toBe(false);
    const ctx = emptyCtx();
    ctx.canvasData.heightMarkers = [{ id: 'hm1', buildingId: 'b1', edgeIndex: 0, t: 0.5, heightMm: 6000 }];
    expect(fn(ctx)).toBe(true);
  });

  it('scaffold-start: scaffoldStart1F||2F', () => {
    const fn = stepById('scaffold-start').completeWhen!;
    const ctx = emptyCtx();
    ctx.canvasData.scaffoldStart1F = { corner: 'tl' } as never;
    expect(fn(ctx)).toBe(true);
  });

  it('autolayout: snapshot より handrails 増で true', () => {
    const fn = stepById('autolayout').completeWhen!;
    const ctx = emptyCtx();
    ctx.handrailsBeforeAutolayout = 2;
    ctx.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h3', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(ctx)).toBe(true);
  });

  it('areacalc: showAreaCalcModal', () => {
    const fn = stepById('areacalc').completeWhen!;
    const ctx = emptyCtx();
    ctx.showAreaCalcModal = true;
    expect(fn(ctx)).toBe(true);
  });
});

describe('自動配置スキップ回帰 (= snapshot=null ガード)', () => {
  it('snapshot=null の間は autolayout completeWhen が false (= 足場開始バースト中に飛ばない)', () => {
    const fn = stepById('autolayout').completeWhen!;
    // 足場開始バースト中: snapshot 未取得 (null) + handrails が増えても false
    const ctx = emptyCtx();
    ctx.handrailsBeforeAutolayout = null;
    ctx.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(ctx)).toBe(false);
  });

  it('snapshot=確定本数 と同じなら false、 超えたら true (= 自動配置後のみ完了)', () => {
    const fn = stepById('autolayout').completeWhen!;
    const base = emptyCtx();
    base.handrailsBeforeAutolayout = 2;
    base.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(base)).toBe(false); // 足場開始の 2 本のみ → まだ
  });
});

describe('step 飛びバグ回帰 (= ライブ currentStep 評価)', () => {
  function simulateBurst(startId: string, ctxFactory: () => TutorialContext, bursts: number): number {
    let idx = TUTORIAL_STEPS.findIndex((s) => s.id === startId);
    for (let i = 0; i < bursts; i++) {
      const cur = TUTORIAL_STEPS[idx];
      if (cur && cur.completeWhen && cur.completeWhen(ctxFactory())) idx += 1;
    }
    return idx;
  }

  it('wallinput-tab で mode=building 後、 連続変化でも build-canvas で止まる', () => {
    const result = simulateBurst('wallinput-tab', () => {
      const c = emptyCtx();
      c.mode = 'building';
      return c;
    }, 5);
    expect(result).toBe(TUTORIAL_STEPS.findIndex((s) => s.id === 'build-canvas'));
  });
});
